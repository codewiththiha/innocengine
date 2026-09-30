import type { EngineSettings } from './types';

const STORAGE_KEY = 'chess_overlay_settings';

export const DEFAULT_SETTINGS: EngineSettings = {
  depth: 16,
  multiPv: 2,
  threads: 1,
  hashMb: 32,
  limitStrength: false,
  targetElo: 2000,
  patriciaPersonality: 'aggressive',
  patriciaLimitStrength: true,
  patriciaElo: 2500,
  patriciaManualDepth: false,
  patriciaPerformance: 'responsive',
  reviewEngineId: 'stockfish',
  reviewDepth: 18,
  reviewMultiPv: 3,
  autoRecordGames: true,
  autoReview: true,
  showHighlights: true,
  highlightPlayerMoves: true,
  highlightOpponentMoves: false,
  highlighterOpacity: 0.35,
  showArrows: true,
  showConnectors: true,
  showOpponentMoves: false,
  showEvalBar: true,
  showHud: true,
  autoAnalyze: true,
  controlledColor: 'auto',
  activeEngineId: 'stockfish',
  captureResistantOverlay: false,
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
      patricia: {
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
    showArrows: loaded.showArrows ?? loaded.showConnectors ?? true,
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
