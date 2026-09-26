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
    let boardObserver: MutationObserver | null = null;
    let pendingScanRaf: number | null = null;

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

      startBoardScanner();
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
        // Guard against feedback loops caused by our own overlay DOM nodes
        const isSelfMutation = mutations.every((m) => {
          const target = m.target as HTMLElement;
          return target.id?.startsWith('chess-ai-') || target.closest?.('#chess-ai-svg-overlay, #chess-ai-hud, #chess-ai-eval-bar');
        });
        if (isSelfMutation) return;

        // Debounce board extraction to ensure pieces have settled
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
      highlightController.setBoardState(state);

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
