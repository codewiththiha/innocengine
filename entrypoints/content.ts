import { BoardParser } from '../lib/board-parser';
import { SvgOverlay } from '../lib/svg-overlay';
import { EngineClient } from '../lib/engine-client';
import { getSettings, subscribeToSettings } from '../lib/storage';
import type { EngineSettings } from '../lib/types';

export default defineContentScript({
  matches: ['*://*.chess.com/*'],
  runAt: 'document_idle',
  main() {
    let currentBoard: HTMLElement | null = null;
    let overlay: SvgOverlay | null = null;
    let engineClient: EngineClient | null = null;
    let currentSettings: EngineSettings;
    let lastFen: string = '';
    let boardObserver: MutationObserver | null = null;

    async function init() {
      currentSettings = await getSettings();
      engineClient = new EngineClient();

      engineClient.onEvaluation((evaluation) => {
        if (overlay && currentSettings.showHighlights) {
          overlay.renderEvaluation(evaluation);
        }
      });

      subscribeToSettings((newSettings) => {
        currentSettings = newSettings;
        if (overlay) {
          overlay.updateSettings(newSettings);
        }
        if (lastFen && engineClient && newSettings.autoAnalyze) {
          engineClient.analyze(lastFen, currentSettings);
        }
      });

      startBoardScanner();
    }

    function startBoardScanner() {
      // Check immediately
      const initialBoard = BoardParser.findBoardElement();
      if (initialBoard) {
        attachToBoard(initialBoard);
      }

      // Continuous scanner for SPA view switches
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

      if (boardObserver) {
        boardObserver.disconnect();
      }

      handleBoardChange();

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

      const normalizedCurrent = state.fen.split(' ').slice(0, 2).join(' ');
      const normalizedLast = lastFen.split(' ').slice(0, 2).join(' ');

      if (normalizedCurrent !== normalizedLast) {
        lastFen = state.fen;
        overlay.clearHighlights();

        if (currentSettings.autoAnalyze) {
          engineClient.analyze(state.fen, currentSettings);
        }
      }
    }

    init();
  },
});
