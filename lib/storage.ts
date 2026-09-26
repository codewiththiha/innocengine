import type { EngineSettings } from './types';

export const DEFAULT_SETTINGS: EngineSettings = {
  depth: 16,
  multiPv: 2,
  threads: 1,
  showArrows: true,
  showMultiPv: true,
  showHighlights: true,
  showEvalBar: true,
  showHud: true,
  autoAnalyze: true,
  arrowColor: '#10b981',
  engineVariant: 'wasm',
};

const STORAGE_KEY = 'chess_overlay_settings';

export async function getSettings(): Promise<EngineSettings> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEY] || {}) };
  } catch (err) {
    console.warn('[Storage] Failed to read chrome.storage.local, using defaults:', err);
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Partial<EngineSettings>): Promise<EngineSettings> {
  const current = await getSettings();
  const updated = { ...current, ...settings };
  await chrome.storage.local.set({ [STORAGE_KEY]: updated });
  return updated;
}

export function subscribeToSettings(callback: (settings: EngineSettings) => void): () => void {
  const listener = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
    if (areaName === 'local' && changes[STORAGE_KEY]) {
      const newSettings = { ...DEFAULT_SETTINGS, ...(changes[STORAGE_KEY].newValue || {}) };
      callback(newSettings);
    }
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
