import { BoardParser } from '../lib/board-parser';
import { GameStateAdapter } from '../lib/game-state-adapter';
import { SvgOverlay } from '../lib/svg-overlay';
import { EngineClient } from '../lib/engine-client';
import { HighlightController } from '../lib/highlight-controller';
import { getSettings, saveSettings, subscribeToSettings } from '../lib/storage';
import { OpeningTracker } from '../lib/openings/tracker';
import { OPENING_CATALOG } from '../lib/openings/catalog';
import { OverlayBubble } from '../lib/overlay-bubble';
import { AutoMoveController } from '../lib/auto-move';
import { BoardInput } from '../lib/board-input';
import type { AutoMoveStatus } from '../lib/auto-move';
import type { OpeningProgress } from '../lib/openings/tracker';
import type {
  EngineSettings,
  BoardState,
  EngineCapabilities,
  EngineEvaluation,
  EngineTelemetry,
} from '../lib/types';

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
    let bubble: OverlayBubble | null = null;
    let autoMove: AutoMoveController | null = null;
    let lastAutoMoveStatus: AutoMoveStatus | null = null;
    let lastBoardState: BoardState | null = null;
    let engineMessageHandler: ((message: unknown) => void) | null = null;
    let lastEvaluation: EngineEvaluation | null = null;
    let capabilities: EngineCapabilities | null = null;
    let telemetry: EngineTelemetry | null = null;
    let engineLabel = 'Engine';
    let bubbleSignature = '';
    let cachedTrackFen = '';
    let cachedTrack: OpeningProgress | null = null;

    // Built once per page: the tracker indexes ~150 lines and never changes.
    const openingTracker = new OpeningTracker(OPENING_CATALOG);

    async function init() {
      const settings = await getSettings();
      if (disposed) return;
      currentSettings = settings;
      engineClient = new EngineClient();

      engineClient.onEvaluation((evaluation) => {
        lastEvaluation = evaluation;
        refreshBubble();

        if (!overlay || !highlightController) return;

        // Throttled high-frequency updates for evaluation score and HUD
        overlay.updateEvaluationMetadata(evaluation);

        // Low-frequency stabilized candidate commit for chessboard highlights
        highlightController.handleEvaluation(evaluation);
      });

      engineMessageHandler = (message: unknown) => {
        const payload = message as { target?: string; type?: string; capabilities?: EngineCapabilities; telemetry?: EngineTelemetry };
        if (payload.target !== 'content') return;
        if (payload.type === 'ENGINE_INFO' && payload.capabilities) {
          capabilities = payload.capabilities;
          engineLabel = payload.capabilities.name || currentSettings.activeEngineId;
          refreshBubble();
        }
        if (payload.type === 'TELEMETRY_UPDATE' && payload.telemetry) {
          telemetry = payload.telemetry;
          refreshBubble();
        }
      };
      chrome.runtime.onMessage.addListener(engineMessageHandler);

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
        if (bubble) {
          bubble.updateSettings(newSettings.bubble);
        }
        if (autoMove) {
          autoMove.updateSettings(newSettings.autoMove);
        }
        if (engineChanged) {
          capabilities = null;
          telemetry = null;
          engineLabel = newSettings.activeEngineId;
        }
        refreshBubble();

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
      lastBoardState = null;
      lastEvaluation = null;
      bubbleSignature = '';
      cachedTrackFen = '';
      cachedTrack = null;

      highlightController?.destroy();
      if (overlay) {
        overlay.destroy();
      }
      overlay = new SvgOverlay(board, currentSettings);

      bubble?.destroy();
      bubble = new OverlayBubble(board, currentSettings.bubble, {
        onToggleAutoMove: (enabled) => {
          // Persisting is the popup's job; here the bubble just asks for the
          // same change the popup would make, through storage.
          void setAutoMoveEnabled(enabled);
        },
        onToggleVisible: (visible) => {
          void updateBubbleSettings({ visible });
        },
        onPositionChanged: (x, y) => {
          void updateBubbleSettings({ x, y });
        },
      });

      autoMove?.destroy();
      autoMove = new AutoMoveController(currentSettings.autoMove, {
        playMove: (candidate, state) =>
          BoardInput.play(board, { from: candidate.from, to: candidate.to, promotion: candidate.promotion }, state.isFlipped),
        onStatus: (status) => {
          lastAutoMoveStatus = status;
          if (status.halted && status.enabled) {
            console.warn('[AutoMove] stopped:', status.halted);
          }
          refreshBubble();
        },
      });

      highlightController = new HighlightController(currentSettings, (snapshot) => {
        if (overlay) {
          overlay.renderCandidates(snapshot.candidates);
        }
        if (autoMove && lastBoardState) {
          autoMove.onCandidates(lastBoardState, snapshot.candidates, Date.now());
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

    async function setAutoMoveEnabled(enabled: boolean) {
      const stored = await getSettings();
      if (disposed) return;
      await saveSettings({ autoMove: { ...stored.autoMove, enabled } });
    }

    async function updateBubbleSettings(patch: Partial<EngineSettings['bubble']>) {
      const stored = await getSettings();
      if (disposed) return;
      await saveSettings({ bubble: { ...stored.bubble, ...patch } });
    }

    /**
     * Pushes the latest engine view into the bubble. Called on every engine
     * line, so the catalogue lookup is memoised per FEN and identical content
     * skips the DOM writes entirely.
     */
    function refreshBubble() {
      if (!bubble) return;
      const state = lastBoardState;
      if (state?.fen && state.fen !== cachedTrackFen) {
        cachedTrackFen = state.fen;
        cachedTrack = openingTracker.track(state.fen);
      }
      const progress = state?.fen ? cachedTrack : null;
      const status = lastAutoMoveStatus;
      const evaluation = lastEvaluation;

      let evalText = '-';
      if (evaluation?.scoreMate != null) {
        const mate = evaluation.whiteScoreMate ?? evaluation.scoreMate;
        evalText = `${mate > 0 ? '+' : '-'}M${Math.abs(mate)}`;
      } else {
        const cp = evaluation?.whiteScoreCp ?? evaluation?.scoreCp ?? null;
        evalText = cp === null ? '-' : `${cp >= 0 ? '+' : ''}${(cp / 100).toFixed(2)}`;
      }

      const signature = [
        progress?.openingId ?? '',
        progress?.reachedPlies ?? -1,
        progress?.candidateLines ?? -1,
        engineLabel,
        evaluation?.depth ?? -1,
        evalText,
        evaluation?.timeMs ?? -1,
        capabilities?.hasThreads ? 1 : 0,
        telemetry?.threads ?? currentSettings.threads,
        telemetry?.hashMb ?? currentSettings.hashMb,
        status?.enabled ?? currentSettings.autoMove.enabled,
        status?.mode ?? currentSettings.autoMove.mode,
        status?.playedMoves ?? 0,
        status?.maxMoves ?? currentSettings.autoMove.maxMoves,
        status?.halted ?? '',
        state?.isGameActive === false ? 0 : 1,
      ].join('|');
      if (signature === bubbleSignature) return;
      bubbleSignature = signature;

      bubble.render({
        gameActive: state?.isGameActive !== false,
        openingName: progress?.name ?? null,
        eco: progress?.eco,
        reachedPlies: progress?.reachedPlies ?? 0,
        linePlies: progress?.linePlies ?? 0,
        nextSan: progress?.nextSan ?? null,
        candidateLines: progress?.candidateLines ?? 0,
        offBook: progress?.offBook ?? false,
        engineLabel,
        depth: evaluation?.depth ?? 0,
        evalText,
        responseMs: evaluation?.timeMs ?? 0,
        threaded: capabilities?.hasThreads === true,
        threads: telemetry?.threads ?? currentSettings.threads,
        hashMb: telemetry?.hashMb ?? currentSettings.hashMb,
        autoMoveEnabled: status?.enabled ?? currentSettings.autoMove.enabled,
        autoMoveMode: status?.mode ?? currentSettings.autoMove.mode,
        autoMovesPlayed: status?.playedMoves ?? 0,
        autoMoveHalted: status?.halted ?? null,
        autoMoveLimit: status?.maxMoves ?? currentSettings.autoMove.maxMoves,
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

      lastBoardState = state;
      highlightController.setBoardState(state);
      autoMove?.onPosition(state, Date.now());

      if (!state.isGameActive) {
        refreshBubble();
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
      if (engineMessageHandler) {
        chrome.runtime.onMessage.removeListener(engineMessageHandler);
      }
      if (privacyHotkeyHandler) {
        window.removeEventListener('keydown', privacyHotkeyHandler);
      }
      highlightController?.destroy();
      autoMove?.destroy();
      bubble?.destroy();
      overlay?.destroy();
      engineClient?.destroy();

      boardScanInterval = null;
      settingsDebounceTimer = null;
      pendingScanRaf = null;
      boardObserver = null;
      bodyObserver = null;
      unsubscribeFromSettings = null;
      engineMessageHandler = null;
      privacyHotkeyHandler = null;
      highlightController = null;
      autoMove = null;
      bubble = null;
      overlay = null;
      engineClient = null;
      lastBoardState = null;
      lastEvaluation = null;
      capabilities = null;
      telemetry = null;
      currentBoard = null;
    }

    window.addEventListener('beforeunload', cleanup, { once: true });
    init();
  },
});
