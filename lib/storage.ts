import type { EngineSettings } from './types';

const STORAGE_KEY = 'chess_overlay_settings';

export const DEFAULT_SETTINGS: EngineSettings = {
  depth: 8,
  multiPv: 1,
  threads: 1,
  hashMb: 32,
  limitStrength: true,
  targetElo: 2200,
  ballmaegyiPersonality: 'human',
  ballmaegyiLimitStrength: true,
  ballmaegyiElo: 2200,
  ballmaegyiManualDepth: false,
  ballmaegyiPerformance: 'responsive',
  reviewEngineId: 'stockfish',
  reviewDepth: 18,
  reviewMultiPv: 3,
  autoRecordGames: true,
  manualRecording: false,
  autoReview: false,
  showHighlights: true,
  highlightPlayerMoves: true,
  highlightOpponentMoves: false,
  highlighterOpacity: 0.28,
  showArrows: true,
  showConnectors: false,
  showOpponentMoves: false,
  showEvalBar: true,
  showHud: false,
  showNumberCircles: false,
  autoAnalyze: true,
  controlledColor: 'auto',
  activeEngineId: 'ballmaegyi',
  lastPopupTab: 'engine',
  captureResistantOverlay: false,
  highlightShape: 'square',
  opening: {
    enabled: false,
    repertoireId: 'auto',
    whiteRepertoireId: 'auto',
    blackRepertoireId: 'auto',
    selectedOpeningIds: [],
    mode: 'adaptive',
    maxPlies: 14,
    reserveSlot: true,
    categories: [],
    includeMeme: false,
    includeWeird: false,
    maxRisk: 5,
    adaptiveSelection: true,
    safety: {
      maxLossCp: 250,
      forbidQueenHang: true,
      minEngineDepth: 8,
      maxEngineDisagreementCp: 200,
      allowRiskyOpenings: false,
      allowMemeOpenings: false,
    },
    enginePolicy: {
      stockfish: {
        mode: 'adaptive',
        maxLossCp: 200,
        minEngineDepth: 10,
        allowOffBook: false,
        allowRisky: false,
        allowMeme: false,
      },
      ballmaegyi: {
        mode: 'adaptive',
        maxLossCp: 300,
        minEngineDepth: 2,
        allowOffBook: true,
        allowRisky: true,
        allowMeme: false,
      },
      maia3: {
        mode: 'hint',
        maxLossCp: 180,
        minEngineDepth: 0,
        allowOffBook: true,
        allowRisky: false,
        allowMeme: false,
      },
      maia2: {
        mode: 'hint',
        maxLossCp: 180,
        minEngineDepth: 0,
        allowOffBook: true,
        allowRisky: false,
        allowMeme: false,
      },
    },
  },
  customOptions: {},
};

function normalizeSettings(loaded: Partial<EngineSettings> = {}): EngineSettings {
  // v1.3 rename: 'patricia' engine id → 'ballmaegyi'
  if ((loaded as any).activeEngineId === 'patricia') loaded.activeEngineId = 'ballmaegyi';
  if ((loaded as any).reviewEngineId === 'patricia') loaded.reviewEngineId = 'ballmaegyi';
  const loadedOpening = { ...(loaded.opening ?? {}) } as Partial<EngineSettings['opening']> & {
    strictLine?: boolean;
  };
  delete loadedOpening.strictLine;

  return {
    ...DEFAULT_SETTINGS,
    ...loaded,
    highlightPlayerMoves: loaded.highlightPlayerMoves ?? loaded.showHighlights ?? true,
    highlightOpponentMoves: loaded.highlightOpponentMoves ?? false,
    highlighterOpacity: loaded.highlighterOpacity ?? DEFAULT_SETTINGS.highlighterOpacity,
    showArrows: loaded.showArrows ?? DEFAULT_SETTINGS.showArrows,
    showConnectors: loaded.showConnectors ?? DEFAULT_SETTINGS.showConnectors,
    showHud: loaded.showHud ?? DEFAULT_SETTINGS.showHud,
    showNumberCircles: loaded.showNumberCircles ?? DEFAULT_SETTINGS.showNumberCircles,
    highlightShape: loaded.highlightShape ?? DEFAULT_SETTINGS.highlightShape,
    multiPv: loaded.multiPv ?? DEFAULT_SETTINGS.multiPv,
    activeEngineId: loaded.activeEngineId ?? DEFAULT_SETTINGS.activeEngineId,
    ballmaegyiPersonality: loaded.ballmaegyiPersonality ?? DEFAULT_SETTINGS.ballmaegyiPersonality,
    ballmaegyiElo: loaded.ballmaegyiElo ?? DEFAULT_SETTINGS.ballmaegyiElo,
    limitStrength: loaded.limitStrength ?? DEFAULT_SETTINGS.limitStrength,
    targetElo: loaded.targetElo ?? DEFAULT_SETTINGS.targetElo,
    opening: {
      ...DEFAULT_SETTINGS.opening,
      ...loadedOpening,
      safety: {
        ...DEFAULT_SETTINGS.opening.safety,
        ...(loadedOpening.safety ?? {}),
      },
      enginePolicy: {
        ...DEFAULT_SETTINGS.opening.enginePolicy,
        ...(loadedOpening.enginePolicy ?? {}),
      },
    },
  };
}

export async function getSettings(): Promise<EngineSettings> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return DEFAULT_SETTINGS;
  }

  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return normalizeSettings(result?.[STORAGE_KEY] as Partial<EngineSettings> | undefined);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Partial<EngineSettings>): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }

  try {
    const current = await getSettings();
    const nextOpening = settings.opening
      ? {
          ...current.opening,
          ...settings.opening,
          safety: { ...current.opening.safety, ...settings.opening.safety },
          enginePolicy: { ...current.opening.enginePolicy, ...settings.opening.enginePolicy },
        }
      : current.opening;

    await chrome.storage.local.set({
      [STORAGE_KEY]: normalizeSettings({ ...current, ...settings, opening: nextOpening }),
    });
  } catch {
    // Storage is unavailable in non-extension test contexts.
  }
}

export function subscribeToSettings(callback: (settings: EngineSettings) => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
    return () => {};
  }

  const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
    const stored = changes[STORAGE_KEY]?.newValue;
    if (stored) {
      callback(normalizeSettings(stored as Partial<EngineSettings>));
    }
  };

  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
