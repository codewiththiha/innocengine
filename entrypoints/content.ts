import { BoardParser } from '../lib/board-parser';
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
    let lastPlacement: string = '';
    let lastTurn: 'w' | 'b' = 'w';
    let lastFlipped: boolean = false;
    let boardObserver: MutationObserver | null = null;
    let pendingScanRaf: number | null = null;
    let isHiddenByPrivacyHotkey: boolean = false;

    async function init() {
      currentSettings = await getSettings();
      engineClient = new EngineClient();

      engineClient.onEvaluation((evaluation) => {
        if (!overlay || !highlightController) return;

        // Throttled high-frequency updates for score text and HUD
        overlay.updateEvaluationMetadata(evaluation);

        // Retained candidate highlight commits
        highlightController.handleEvaluation(evaluation);
      });

      subscribeToSettings((newSettings) => {
        currentSettings = newSettings;
        if (overlay) {
          overlay.updateSettings(newSettings);
        }
        if (highlightController) {
          highlightController.updateSettings(newSettings);
        }
        if (lastPositionKey && engineClient && newSettings.autoAnalyze) {
          const board = currentBoard || BoardParser.findBoardElement();
          if (board) {
            const state = BoardParser.extractBoardState(board);
            if (state) {
              engineClient.analyze(state.fen, currentSettings);
            }
          }
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

      handleBoardChange();

      boardObserver = new MutationObserver((mutations) => {
        const isSelfMutation = mutations.every((m) => {
          const target = m.target as HTMLElement;
          return (
            target.id?.startsWith('chess-ai-') ||
            target.closest?.('#chess-ai-svg-overlay, #chess-ai-hud, #chess-ai-eval-bar')
          );
        });
        if (isSelfMutation) return;

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

      overlay.setFlipped(state.isFlipped);

      // Distinguish piece selection highlights from actual board moves
      const isSamePlacement = state.placement === lastPlacement;
      const isSameTurn = state.turn === lastTurn;
      const isSameOrientation = state.isFlipped === lastFlipped;

      if (isSamePlacement && isSameTurn && isSameOrientation && lastPositionKey) {
        // Selection or click without piece movement: preserve existing highlights, do not reset engine
        return;
      }

      console.log('[AI TRACE] Board position changed:', {
        positionKey: state.positionKey,
        turn: state.turn,
        isFlipped: state.isFlipped,
      });

      lastPlacement = state.placement || '';
      lastTurn = state.turn;
      lastFlipped = state.isFlipped;
      lastPositionKey = state.positionKey;

      highlightController.setBoardState(state);

      if (currentSettings.autoAnalyze) {
        console.log('[AI TRACE] Dispatching engine analyze for FEN:', state.fen);
        engineClient.analyze(state.fen, currentSettings);
      }
    }

    init();
  },
});
