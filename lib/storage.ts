import type { EngineSettings } from './types';

const STORAGE_KEY = 'chess_overlay_settings';

export const DEFAULT_SETTINGS: EngineSettings = {
  depth: 16,
  multiPv: 2,
  threads: 1,
  hashMb: 32,
  limitStrength: false,
  targetElo: 2000,
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
    repertoireId: 'sicilian',
    mode: 'coexist',
    maxPlies: 12,
  },
  customOptions: {},
};

export async function getSettings(): Promise<EngineSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (!result || !result[STORAGE_KEY]) {
    return DEFAULT_SETTINGS;
  }
  const loaded = (result[STORAGE_KEY] || {}) as Partial<EngineSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...loaded,
    highlightPlayerMoves: loaded.highlightPlayerMoves ?? loaded.showHighlights ?? true,
    highlightOpponentMoves: loaded.highlightOpponentMoves ?? false,
    highlighterOpacity: loaded.highlighterOpacity ?? 0.35,
    showArrows: loaded.showArrows ?? loaded.showConnectors ?? true,
  };
}

export async function saveSettings(settings: Partial<EngineSettings>): Promise<void> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
}

export function subscribeToSettings(callback: (settings: EngineSettings) => void): () => void {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
    if (changes[STORAGE_KEY] && changes[STORAGE_KEY].newValue) {
      callback({ ...DEFAULT_SETTINGS, ...changes[STORAGE_KEY].newValue });
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
