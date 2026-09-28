import { BoardParser } from '../lib/board-parser';
import { GameStateAdapter } from '../lib/game-state-adapter';
import { SvgOverlay } from '../lib/svg-overlay';
import { EngineClient } from '../lib/engine-client';
import { HighlightController } from '../lib/highlight-controller';
import { getSettings, subscribeToSettings } from '../lib/storage';
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
    let pendingScanRaf: number | null = null;
    let isHiddenByPrivacyHotkey: boolean = false;

    async function init() {
      currentSettings = await getSettings();
      engineClient = new EngineClient();

      engineClient.onEvaluation((evaluation) => {
        if (!overlay || !highlightController) return;

        // Throttled high-frequency updates for evaluation score and HUD
        overlay.updateEvaluationMetadata(evaluation);

        // Low-frequency stabilized candidate commit for chessboard highlights
        highlightController.handleEvaluation(evaluation);
      });

      let settingsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

      subscribeToSettings((newSettings) => {
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
            if (!currentBoard) return;
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
      window.addEventListener('keydown', (e) => {
        if (e.altKey && e.code === 'KeyH') {
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
      });
    }

    function startBoardScanner() {
      const initialBoard = BoardParser.findBoardElement();
      if (initialBoard) {
        attachToBoard(initialBoard);
      }

      setInterval(() => {
        const board = BoardParser.findBoardElement();
        if (board && board !== currentBoard) {
          attachToBoard(board);
        }
      }, 1000);

      const bodyObserver = new MutationObserver(() => {
        const board = BoardParser.findBoardElement();
        if (board && board !== currentBoard) {
          attachToBoard(board);
        }
      });
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    function attachToBoard(board: HTMLElement) {
      currentBoard = board;

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
        return;
      }

      if (state.positionKey !== lastPositionKey) {
        lastPositionKey = state.positionKey;
        if (currentSettings.autoAnalyze) {
          engineClient.analyze(state.fen, currentSettings);
        }
      }
    }

    init();
  },
});
