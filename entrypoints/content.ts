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
        const patriciaChanged =
          newSettings.patriciaElo !== currentSettings.patriciaElo ||
          newSettings.patriciaPersonality !== currentSettings.patriciaPersonality ||
          newSettings.patriciaLimitStrength !== currentSettings.patriciaLimitStrength;
        const eloChanged =
          newSettings.limitStrength !== currentSettings.limitStrength ||
          newSettings.targetElo !== currentSettings.targetElo ||
          patriciaChanged;
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
      currentBoard = board;
      lastPositionKey = '';

      // If there was a previous board, game was replaced (navigation or new game)
      if (gameRecorder && gameRecorder.isActive()) {
        // no-op — previous game was either completed & saved in handleBoardChange, or
        // aborted by navigation (we don't save aborted/navigated-away games).
      }
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

      if (!state.isGameActive) {
        // Game over — persist if auto-record is enabled and we have a move list.
        if (gameRecorder && gameRecorder.isActive() && state.moveHistory && state.moveHistory.length > 0) {
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
