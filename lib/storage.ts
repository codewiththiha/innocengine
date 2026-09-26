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
    selectedOpeningIds: [],
    mode: 'adaptive',
    maxPlies: 14,
    reserveSlot: true,
    categories: [],
    includeMeme: false,
    includeWeird: false,
    maxRisk: 5,
    strictLine: true,
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
        minEngineDepth: 8,
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

export async function getSettings(): Promise<EngineSettings> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return DEFAULT_SETTINGS;
  }
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    if (!result || !result[STORAGE_KEY]) {
      return DEFAULT_SETTINGS;
    }
    const loaded = (result[STORAGE_KEY] || {}) as Partial<EngineSettings>;
    const loadedOpening = (loaded.opening || {}) as any;
    return {
      ...DEFAULT_SETTINGS,
      ...loaded,
      highlightPlayerMoves: loaded.highlightPlayerMoves ?? loaded.showHighlights ?? true,
      highlightOpponentMoves: loaded.highlightOpponentMoves ?? false,
      highlighterOpacity: loaded.highlighterOpacity ?? 0.35,
      showArrows: loaded.showArrows ?? loaded.showConnectors ?? true,
      opening: {
        ...DEFAULT_SETTINGS.opening,
        ...loadedOpening,
        safety: {
          ...DEFAULT_SETTINGS.opening.safety,
          ...(loadedOpening.safety || {}),
        },
        enginePolicy: {
          ...DEFAULT_SETTINGS.opening.enginePolicy,
          ...(loadedOpening.enginePolicy || {}),
        },
      },
    };
  } catch (_) {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Partial<EngineSettings>): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    return;
  }
  try {
    const current = await getSettings();
    const updated = { ...current, ...settings };
    await chrome.storage.local.set({ [STORAGE_KEY]: updated });
  } catch (_) {}
}

export function subscribeToSettings(callback: (settings: EngineSettings) => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) {
    return () => {};
  }
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
    if (changes[STORAGE_KEY] && changes[STORAGE_KEY].newValue) {
      callback({ ...DEFAULT_SETTINGS, ...changes[STORAGE_KEY].newValue });
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    try {
      chrome.storage.onChanged.removeListener(listener);
    } catch (_) {}
  };
}
