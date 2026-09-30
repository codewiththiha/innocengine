import { BoardParser } from '../lib/board-parser';
import { GameStateAdapter } from '../lib/game-state-adapter';
import { SvgOverlay } from '../lib/svg-overlay';
import { EngineClient } from '../lib/engine-client';
import { HighlightController } from '../lib/highlight-controller';
import { getSettings, subscribeToSettings } from '../lib/storage';
import { GameRecorder } from '../lib/game-recorder';
import type { EngineSettings, BoardState } from '../lib/types';

export default defineContentScript({
  matches: ['*://*.chess.com/*'],
  runAt: 'document_idle',
  main() {
    let currentBoard: HTMLElement | null = null;
    let overlay: SvgOverlay | null = null;
    let engineClient: EngineClient | null = null;
    let highlightController: HighlightController | null = null;
    let currentSettings: EngineSettings;
    let lastPositionKey: string = '';
    let boardObserver: MutationObserver | null = null;
    let bodyObserver: MutationObserver | null = null;
    let boardScanInterval: ReturnType<typeof setInterval> | null = null;
    let settingsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeFromSettings: (() => void) | null = null;
    let privacyHotkeyHandler: ((event: KeyboardEvent) => void) | null = null;
    let pendingScanRaf: number | null = null;
    let isHiddenByPrivacyHotkey: boolean = false;
    let disposed = false;
    let gameRecorder: GameRecorder | null = null;
    let gameOverPollTimer: ReturnType<typeof setInterval> | null = null;
    let seenMoveCountAtGameStart = 0;
    let lastObservedMoveCount = 0;

    async function init() {
      const settings = await getSettings();
      if (disposed) return;
      currentSettings = settings;
      engineClient = new EngineClient();
      gameRecorder = new GameRecorder();

      engineClient.onEvaluation((evaluation) => {
        if (!overlay || !highlightController) return;

        // Throttled high-frequency updates for evaluation score and HUD
        overlay.updateEvaluationMetadata(evaluation);

        // Low-frequency stabilized candidate commit for chessboard highlights
        highlightController.handleEvaluation(evaluation);
      });

      unsubscribeFromSettings = subscribeToSettings((newSettings) => {
        const multiPvChanged = newSettings.multiPv !== currentSettings.multiPv;
        const depthChanged = newSettings.depth !== currentSettings.depth;
        const engineChanged = newSettings.activeEngineId !== currentSettings.activeEngineId;
        const ballmaegyiChanged =
          newSettings.ballmaegyiElo !== currentSettings.ballmaegyiElo ||
          newSettings.ballmaegyiPersonality !== currentSettings.ballmaegyiPersonality ||
          newSettings.ballmaegyiLimitStrength !== currentSettings.ballmaegyiLimitStrength;
        const eloChanged =
          newSettings.limitStrength !== currentSettings.limitStrength ||
          newSettings.targetElo !== currentSettings.targetElo ||
          ballmaegyiChanged;
        const openingChanged =
          JSON.stringify(newSettings.opening) !== JSON.stringify(currentSettings.opening);
        const visualChanged =
          newSettings.showHighlights !== currentSettings.showHighlights ||
          newSettings.highlightPlayerMoves !== currentSettings.highlightPlayerMoves ||
          newSettings.highlightOpponentMoves !== currentSettings.highlightOpponentMoves ||
          newSettings.highlighterOpacity !== currentSettings.highlighterOpacity ||
          newSettings.showArrows !== currentSettings.showArrows ||
          newSettings.showEvalBar !== currentSettings.showEvalBar ||
          newSettings.showHud !== currentSettings.showHud;

        currentSettings = newSettings;
        if (overlay) {
          overlay.updateSettings(newSettings);
        }
        if (highlightController) {
          highlightController.updateSettings(newSettings);
        }

        if (currentBoard && (multiPvChanged || depthChanged || engineChanged || eloChanged || openingChanged)) {
          if (settingsDebounceTimer) {
            clearTimeout(settingsDebounceTimer);
          }
          settingsDebounceTimer = setTimeout(() => {
            if (disposed || !currentBoard) return;
            const state = BoardParser.extractBoardState(currentBoard);
            if (state && currentSettings.autoAnalyze) {
              const authGame = GameStateAdapter.extractGameState(currentBoard, state.turn);
              if (authGame && authGame.fen) {
                state.fen = authGame.fen;
                state.positionKey = authGame.positionKey;
                state.turn = authGame.turn;
              }
              engineClient?.analyze(state.fen, currentSettings);
            }
          }, 120);
        }
      });

      setupPrivacyHotkey();
      startBoardScanner();
      startGameOverWatcher();
    }

    /**
     * Defense-in-depth game-over watcher. Chess.com's game-over dialog can be
     * added to the DOM without triggering a board-class mutation that our
     * board observer catches, so we also poll (cheaply) and listen for
     * body subtree mutations that add the modal.
     */
    function startGameOverWatcher() {
      const check = () => {
        if (disposed || !currentBoard || !gameRecorder) return;
        if (!gameRecorder.isActive()) return;
        if (BoardParser.isGameActive(currentBoard)) return;
        const state = BoardParser.extractBoardState(currentBoard);
        if (state && state.moveHistory && state.moveHistory.length >= 2) {
          const auth = GameStateAdapter.extractGameState(currentBoard, state.turn, state);
          const fen = auth?.fen || state.fen;
          gameRecorder.onGameOver(currentBoard, state.moveHistory, fen).catch(() => {});
        }
      };

      if (gameOverPollTimer) clearInterval(gameOverPollTimer);
      gameOverPollTimer = setInterval(check, 750);

      // Also listen globally for the game-over modal being inserted.
      const bodyObs = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of Array.from(m.addedNodes)) {
            const el = n as HTMLElement;
            if (el?.nodeType !== 1) continue;
            const isModal =
              el.classList?.contains?.('game-over-modal-shell-container') ||
              el.classList?.contains?.('game-over-modal-component') ||
              el.classList?.contains?.('game-over-dialog-component') ||
              (typeof el.querySelector === 'function' && el.querySelector?.('.game-over-modal-shell-container, .game-over-modal-component, .game-over-dialog-component'));
            if (isModal) {
              // Defer one tick so the DOM move-list is fully populated.
              setTimeout(check, 50);
              return;
            }
          }
        }
      });
      bodyObs.observe(document.body, { childList: true, subtree: true });
    }

    function setupPrivacyHotkey() {
      privacyHotkeyHandler = (event) => {
        if (event.altKey && event.code === 'KeyH') {
          isHiddenByPrivacyHotkey = !isHiddenByPrivacyHotkey;
          if (overlay) {
            overlay.updateSettings({
              ...currentSettings,
              showHighlights: !isHiddenByPrivacyHotkey && currentSettings.showHighlights,
              showEvalBar: !isHiddenByPrivacyHotkey && currentSettings.showEvalBar,
              showHud: !isHiddenByPrivacyHotkey && currentSettings.showHud,
            });
          }
        }
      };
      window.addEventListener('keydown', privacyHotkeyHandler);
    }

    function startBoardScanner() {
      const initialBoard = BoardParser.findBoardElement();
      if (initialBoard) {
        attachToBoard(initialBoard);
      }

      boardScanInterval = setInterval(() => {
        if (disposed) return;
        const board = BoardParser.findBoardElement();
        if (board && board !== currentBoard) {
          attachToBoard(board);
        }
      }, 1000);

      bodyObserver = new MutationObserver(() => {
        if (disposed) return;
        const board = BoardParser.findBoardElement();
        if (board && board !== currentBoard) {
          attachToBoard(board);
        }
      });
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    function attachToBoard(board: HTMLElement) {
      if (disposed) return;

      // When replacing the current board, flush the previous game if it
      // actually had moves (protects against missed game-over events).
      if (currentBoard && gameRecorder && gameRecorder.isActive() && currentSettings.autoRecordGames) {
        const prevState = BoardParser.extractBoardState(currentBoard);
        if (prevState && prevState.moveHistory && prevState.moveHistory.length >= 2) {
          const auth = GameStateAdapter.extractGameState(currentBoard, prevState.turn, prevState);
          gameRecorder.flush(currentBoard, prevState.moveHistory, auth?.fen || prevState.fen).catch(() => {});
        }
      }

      currentBoard = board;
      lastPositionKey = '';

      if (gameRecorder && currentSettings.autoRecordGames) {
        gameRecorder.start(board);
      }

      highlightController?.destroy();
      if (overlay) {
        overlay.destroy();
      }
      overlay = new SvgOverlay(board, currentSettings);

      highlightController = new HighlightController(currentSettings, (snapshot) => {
        if (overlay) {
          overlay.renderCandidates(snapshot.candidates);
        }
      });

      if (boardObserver) {
        boardObserver.disconnect();
      }
      if (pendingScanRaf !== null) {
        cancelAnimationFrame(pendingScanRaf);
        pendingScanRaf = null;
      }

      handleBoardChange();

      // If the newly attached board already shows a finished game (e.g. user
      // loaded a completed-game URL), save it immediately.
      if (currentSettings.autoRecordGames && gameRecorder) {
        const state = BoardParser.extractBoardState(board);
        if (state && !BoardParser.isGameActive(board) && state.moveHistory && state.moveHistory.length >= 2) {
          const auth = GameStateAdapter.extractGameState(board, state.turn, state);
          gameRecorder.onGameOver(board, state.moveHistory, auth?.fen || state.fen).catch(() => {});
        } else if (state && state.moveHistory) {
          // If the game is already in-progress when we attach (e.g. content
          // script loaded mid-game), mark start move count so we don't falsely
          // think we recorded the game at start.
          seenMoveCountAtGameStart = state.moveHistory.length;
          lastObservedMoveCount = state.moveHistory.length;
        }
      }

      boardObserver = new MutationObserver((mutations) => {
        if (disposed) return;
        // Guard against feedback loops caused by our own overlay DOM nodes
        const isSelfMutation = mutations.every((m) => {
          const target = m.target as HTMLElement;
          return target.id?.startsWith('chess-ai-') || target.closest?.('#chess-ai-svg-overlay, #chess-ai-hud, #chess-ai-eval-bar') !== null;
        });
        if (isSelfMutation) return;

        // Ignore transient UI mutations whose only changes are selection/hints
        const isTransientOnly = mutations.every((m) => {
          const target = m.target as HTMLElement;
          if (target.id?.startsWith('chess-ai-') || target.closest?.('#chess-ai-svg-overlay, #chess-ai-hud, #chess-ai-eval-bar')) {
            return true;
          }
          if (m.type === 'attributes' && m.attributeName === 'class') {
            const cls = target.className || '';
            const isSquareHighlight =
              cls.includes('square-selected') ||
              cls.includes('hover-square') ||
              cls.includes('selected');
            if (isSquareHighlight && !target.classList.contains('piece')) {
              return true;
            }
          }
          if (m.type === 'childList') {
            const nodes = [...Array.from(m.addedNodes), ...Array.from(m.removedNodes)] as HTMLElement[];
            const allHints = nodes.every(
              (n) =>
                n.classList?.contains('hint') ||
                n.classList?.contains('capture-hint') ||
                n.id?.startsWith('chess-ai-')
            );
            if (allHints && nodes.length > 0) {
              return true;
            }
          }
          return false;
        });
        if (isTransientOnly) return;

        // Schedule extraction immediately on next animation frame (~16ms) without artificial lag
        if (pendingScanRaf !== null) {
          cancelAnimationFrame(pendingScanRaf);
        }
        pendingScanRaf = requestAnimationFrame(() => {
          pendingScanRaf = null;
          handleBoardChange();
        });
      });

      boardObserver.observe(board, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
    }

  function handleBoardChange() {
      if (!currentBoard || !overlay || !engineClient || !highlightController) return;

      const state: BoardState | null = BoardParser.extractBoardState(currentBoard);
      if (!state) return;

      // Authoritative FEN & turn resolution via DOM move list replay with chess.js
      const authGame = GameStateAdapter.extractGameState(currentBoard, state.turn, state);
      if (authGame && authGame.fen) {
        state.fen = authGame.fen;
        state.positionKey = authGame.positionKey;
        state.turn = authGame.turn;
      }

      overlay.setFlipped(state.isFlipped);
      overlay.setPlayerColor(state.playerColor);
      overlay.setGameActive(state.isGameActive ?? true);

      highlightController.setBoardState(state);

      // Track move-count growth to detect a game finishing with a stale board
      const moveCount = state.moveHistory?.length ?? 0;
      if (moveCount !== lastObservedMoveCount) {
        lastObservedMoveCount = moveCount;
      }

      if (!state.isGameActive) {
        // Game over — persist if auto-record is enabled and we have a move list.
        if (gameRecorder && gameRecorder.isActive() && state.moveHistory && state.moveHistory.length >= 2) {
          gameRecorder.onGameOver(currentBoard!, state.moveHistory, state.fen).catch(() => {});
        }
        return;
      }

      if (state.positionKey !== lastPositionKey) {
        lastPositionKey = state.positionKey;
        if (currentSettings.autoAnalyze) {
          engineClient.analyze(state.fen, currentSettings);
        }
      }
    }

    function cleanup() {
      if (disposed) return;
      disposed = true;

      if (boardScanInterval) clearInterval(boardScanInterval);
      if (settingsDebounceTimer) clearTimeout(settingsDebounceTimer);
      if (pendingScanRaf !== null) cancelAnimationFrame(pendingScanRaf);
      boardObserver?.disconnect();
      bodyObserver?.disconnect();
      unsubscribeFromSettings?.();
      if (privacyHotkeyHandler) {
        window.removeEventListener('keydown', privacyHotkeyHandler);
      }
      highlightController?.destroy();
      overlay?.destroy();
      engineClient?.destroy();
      if (gameOverPollTimer) { clearInterval(gameOverPollTimer); gameOverPollTimer = null; }

      boardScanInterval = null;
      settingsDebounceTimer = null;
      pendingScanRaf = null;
      boardObserver = null;
      bodyObserver = null;
      unsubscribeFromSettings = null;
      privacyHotkeyHandler = null;
      highlightController = null;
      overlay = null;
      engineClient = null;
      currentBoard = null;
    }

    window.addEventListener('beforeunload', cleanup, { once: true });
    init();
  },
});
