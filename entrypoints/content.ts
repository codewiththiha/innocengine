import { BoardParser } from '../lib/board-parser';
import { SvgOverlay } from '../lib/svg-overlay';
import { EngineClient } from '../lib/engine-client';
import { getSettings, subscribeToSettings } from '../lib/storage';
import type { EngineSettings } from '../lib/types';

export default defineContentScript({
  matches: ['*://*.chess.com/*'],
  runAt: 'document_idle',
  main() {
    console.log('[Chess AI Overlay] Content script injected on Chess.com');

    let currentBoard: HTMLElement | null = null;
    let overlay: SvgOverlay | null = null;
    let engineClient: EngineClient | null = null;
    let currentSettings: EngineSettings;
    let lastFen: string = '';
    let boardObserver: MutationObserver | null = null;
    let scanInterval: any = null;

    async function init() {
      currentSettings = await getSettings();
      engineClient = new EngineClient();

      engineClient.onEvaluation((evaluation) => {
        if (overlay && currentSettings.showArrows) {
          overlay.renderEvaluation(evaluation);
        }
      });

      // Subscribe to popup settings changes
      subscribeToSettings((newSettings) => {
        currentSettings = newSettings;
        if (overlay) {
          overlay.updateSettings(newSettings);
        }
        // If settings changed (e.g. depth or multiPv), re-analyze current position
        if (lastFen && engineClient && newSettings.autoAnalyze) {
          engineClient.analyze(lastFen, currentSettings);
        }
      });

      // Start scanning for chess board
      startBoardScanner();
    }

    function startBoardScanner() {
      // Periodic check in case user navigates between games/analysis
      scanInterval = setInterval(() => {
        const board = BoardParser.findBoardElement();
        if (board && board !== currentBoard) {
          attachToBoard(board);
        }
      }, 1000);

      // Also observe document body for dynamic board insertion
      const bodyObserver = new MutationObserver(() => {
        const board = BoardParser.findBoardElement();
        if (board && board !== currentBoard) {
          attachToBoard(board);
        }
      });
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    function attachToBoard(board: HTMLElement) {
      console.log('[Chess AI Overlay] Board attached:', board.tagName);
      currentBoard = board;

      if (overlay) {
        overlay.destroy();
      }
      overlay = new SvgOverlay(board, currentSettings);

      if (boardObserver) {
        boardObserver.disconnect();
      }

      // Check initial position
      handleBoardChange();

      // Observe piece moves and board flips
      boardObserver = new MutationObserver(() => {
        handleBoardChange();
      });

      boardObserver.observe(board, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style'],
      });
    }

    function handleBoardChange() {
      if (!currentBoard || !overlay || !engineClient) return;

      const state = BoardParser.extractBoardState(currentBoard);
      if (!state) return;

      overlay.setFlipped(state.isFlipped);

      // Only trigger calculation if FEN placement or turn changed
      const normalizedCurrent = state.fen.split(' ').slice(0, 2).join(' ');
      const normalizedLast = lastFen.split(' ').slice(0, 2).join(' ');

      if (normalizedCurrent !== normalizedLast) {
        lastFen = state.fen;
        overlay.clearArrows();

        if (currentSettings.autoAnalyze) {
          engineClient.analyze(state.fen, currentSettings);
        }
      }
    }

    init();
  },
});
