import { BoardParser } from '../lib/board-parser';
import { GameStateAdapter } from '../lib/game-state-adapter';
import { SvgOverlay } from '../lib/svg-overlay';
import { EngineClient } from '../lib/engine-client';
import { HighlightController } from '../lib/highlight-controller';
import { getSettings, subscribeToSettings } from '../lib/storage';
import { isChessDomain, type EngineSettings, type BoardState } from '../lib/types';

export default defineContentScript({
  matches: ['*://*.chess.com/*'],
  runAt: 'document_idle',
  main() {
    // Belt-and-suspenders: never run on any non-chess.com host, even if the
    // manifest match somehow misses (e.g. if a dev reload or extension
    // tester shoves this script into another page).
    if (!isChessDomain()) return;

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
    let seenMoveCountAtGameStart = 0;
    let lastObservedMoveCount = 0;

    async function init() {
      // Double-check hostname after any async gap
      if (!isChessDomain()) return;
      const settings = await getSettings();
      if (disposed) return;
      currentSettings = settings;
      engineClient = new EngineClient();

      engineClient.onEvaluation((evaluation) => {
        if (!overlay || !highlightController) return;
        overlay.updateEvaluationMetadata(evaluation);
        highlightController.handleEvaluation(evaluation);
      });

      unsubscribeFromSettings = subscribeToSettings((newSettings) => {
        const multiPvChanged = newSettings.multiPv !== currentSettings.multiPv;
        const depthChanged = newSettings.depth !== currentSettings.depth;
        const engineChanged = newSettings.activeEngineId !== currentSettings.activeEngineId;
        const gwaymaegyiChanged =
          newSettings.gwaymaegyiElo !== currentSettings.gwaymaegyiElo ||
          newSettings.gwaymaegyiPersonality !== currentSettings.gwaymaegyiPersonality ||
          newSettings.gwaymaegyiLimitStrength !== currentSettings.gwaymaegyiLimitStrength;
        const eloChanged =
          newSettings.limitStrength !== currentSettings.limitStrength ||
          newSettings.targetElo !== currentSettings.targetElo ||
          gwaymaegyiChanged;
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
        if (overlay) overlay.updateSettings(newSettings);
        if (highlightController) highlightController.updateSettings(newSettings);

        if (currentBoard && (multiPvChanged || depthChanged || engineChanged || eloChanged || openingChanged)) {
          if (settingsDebounceTimer) clearTimeout(settingsDebounceTimer);
          settingsDebounceTimer = setTimeout(() => {
            if (disposed || !currentBoard) return;
            const state = BoardParser.extractBoardState(currentBoard);
            if (state && currentSettings.autoAnalyze) {
              const authGame = GameStateAdapter.extractGameState(currentBoard, state.turn, state);
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
      if (initialBoard) attachToBoard(initialBoard);

      boardScanInterval = setInterval(() => {
        if (disposed || !isChessDomain()) return;
        const board = BoardParser.findBoardElement();
        if (board && board !== currentBoard) attachToBoard(board);
      }, 1000);

      bodyObserver = new MutationObserver(() => {
        if (disposed || !isChessDomain()) return;
        const board = BoardParser.findBoardElement();
        if (board && board !== currentBoard) attachToBoard(board);
      });
      bodyObserver.observe(document.body, { childList: true, subtree: true });
    }

    function attachToBoard(board: HTMLElement) {
      if (disposed || !isChessDomain()) return;
      currentBoard = board;
      lastPositionKey = '';

      highlightController?.destroy();
      if (overlay) overlay.destroy();
      overlay = new SvgOverlay(board, currentSettings);
      highlightController = new HighlightController(currentSettings, (snapshot) => {
        if (overlay) overlay.renderCandidates(snapshot.candidates);
      });

      if (boardObserver) boardObserver.disconnect();
      if (pendingScanRaf !== null) { cancelAnimationFrame(pendingScanRaf); pendingScanRaf = null; }

      handleBoardChange();

      const state = BoardParser.extractBoardState(board);
      if (state && state.moveHistory) {
        seenMoveCountAtGameStart = state.moveHistory.length;
        lastObservedMoveCount = state.moveHistory.length;
      }

      boardObserver = new MutationObserver((mutations) => {
        if (disposed) return;
        const isSelfMutation = mutations.every((m) => {
          const target = m.target as HTMLElement;
          return target.id?.startsWith('chess-ai-') || target.closest?.('#chess-ai-svg-overlay, #chess-ai-hud, #chess-ai-eval-bar') !== null;
        });
        if (isSelfMutation) return;
        const isTransientOnly = mutations.every((m) => {
          const target = m.target as HTMLElement;
          if (target.id?.startsWith('chess-ai-') || target.closest?.('#chess-ai-svg-overlay, #chess-ai-hud, #chess-ai-eval-bar')) return true;
          if (m.type === 'attributes' && m.attributeName === 'class') {
            const cls = target.className || '';
            const isSquareHighlight = cls.includes('square-selected') || cls.includes('hover-square') || cls.includes('selected');
            if (isSquareHighlight && !target.classList.contains('piece')) return true;
          }
          if (m.type === 'childList') {
            const nodes = [...Array.from(m.addedNodes), ...Array.from(m.removedNodes)] as HTMLElement[];
            const allHints = nodes.every(
              (n) => n.classList?.contains('hint') || n.classList?.contains('capture-hint') || n.id?.startsWith('chess-ai-')
            );
            if (allHints && nodes.length > 0) return true;
          }
          return false;
        });
        if (isTransientOnly) return;

        if (pendingScanRaf !== null) cancelAnimationFrame(pendingScanRaf);
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
        // Clear highlights when the game ends, but don't auto-record.
        return;
      }

      if (state.positionKey !== lastPositionKey) {
        lastPositionKey = state.positionKey;
        if (currentSettings.autoAnalyze) engineClient.analyze(state.fen, currentSettings);
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
      if (privacyHotkeyHandler) window.removeEventListener('keydown', privacyHotkeyHandler);
      highlightController?.destroy();
      overlay?.destroy();
      engineClient?.destroy();
    }

    window.addEventListener('beforeunload', cleanup, { once: true });
    init();
  },
});
