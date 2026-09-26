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
  showOpponentMoves: false,
  showConnectors: true,
  showEvalBar: true,
  showHud: true,
  autoAnalyze: true,
  controlledColor: 'auto',
  activeEngineId: 'stockfish',
  captureResistantOverlay: false,
  opening: {
    enabled: true,
    repertoireId: 'sicilian',
    mode: 'prefer',
    maxPlies: 12,
  },
  customOptions: {},
};

export async function getSettings(): Promise<EngineSettings> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  if (!result || !result[STORAGE_KEY]) {
    return DEFAULT_SETTINGS;
  }
  return { ...DEFAULT_SETTINGS, ...result[STORAGE_KEY] };
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
