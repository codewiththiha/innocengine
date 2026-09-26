import { BoardParser } from '../lib/board-parser';
import { GameStateAdapter, type GameState } from '../lib/game-state-adapter';
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
    let lastBoardFingerprint: string = '';
    let lastPositionKey: string = '';
    let lastFlipped: boolean = false;
    let lastTurn: 'w' | 'b' = 'w';
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

        // Retained low-frequency candidate highlight commits
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
            const gameState = GameStateAdapter.extractGameState(board, lastTurn);
            if (gameState) {
              engineClient.analyze(gameState.fen, currentSettings);
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
          return target.id?.startsWith('chess-ai-') || target.closest?.('#chess-ai-svg-overlay, #chess-ai-hud, #chess-ai-eval-bar');
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

      const gameState: GameState | null = GameStateAdapter.extractGameState(currentBoard, lastTurn);
      if (!gameState) return;

      overlay.setFlipped(gameState.isFlipped);

      // Distinguish piece selection highlights from real position moves
      const isSameFingerprint = gameState.boardFingerprint === lastBoardFingerprint;
      const isSameOrientation = gameState.isFlipped === lastFlipped;

      if (isSameFingerprint && isSameOrientation && lastPositionKey) {
        return;
      }

      lastBoardFingerprint = gameState.boardFingerprint;
      lastFlipped = gameState.isFlipped;
      lastTurn = gameState.turn;

      const boardState: BoardState = {
        fen: gameState.fen,
        positionKey: gameState.positionKey,
        isFlipped: gameState.isFlipped,
        turn: gameState.turn,
        controlledColor: currentSettings.controlledColor,
        pieceMap: gameState.pieceMap,
        boardElement: currentBoard,
      };

      highlightController.setBoardState(boardState);

      if (gameState.positionKey !== lastPositionKey) {
        lastPositionKey = gameState.positionKey;
        if (currentSettings.autoAnalyze) {
          engineClient.analyze(gameState.fen, currentSettings);
        }
      }
    }

    init();
  },
});
