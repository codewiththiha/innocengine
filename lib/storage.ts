import type { EngineSettings } from './types';

const STORAGE_KEY = 'chess_overlay_settings';

export const DEFAULT_SETTINGS: EngineSettings = {
  depth: 8,
  multiPv: 1,
  threads: 1,
  hashMb: 32,
  limitStrength: true,
  targetElo: 2200,
  gwaymaegyiPersonality: 'human',
  gwaymaegyiLimitStrength: true,
  gwaymaegyiElo: 2200,
  gwaymaegyiManualDepth: false,
  gwaymaegyiPerformance: 'responsive',
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
  activeEngineId: 'gwaymaegyi',
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
      gwaymaegyi: {
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
  // v1.5 engine replacement: patricia/ballmaegyi → gwaymaegyi (id and tuning keys)
  const legacy = loaded as any;
  if (legacy.activeEngineId === 'patricia' || legacy.activeEngineId === 'ballmaegyi') {
    legacy.activeEngineId = 'gwaymaegyi';
  }
  for (const key of ['Personality', 'LimitStrength', 'Elo', 'ManualDepth', 'Performance']) {
    const oldKey = `ballmaegyi${key}`;
    if (oldKey in legacy) {
      legacy[`gwaymaegyi${key}`] ??= legacy[oldKey];
      delete legacy[oldKey];
    }
  }
  // v1.4 drop legacy review/recording keys
  delete (loaded as any).reviewEngineId;
  delete (loaded as any).reviewDepth;
  delete (loaded as any).reviewMultiPv;
  delete (loaded as any).autoRecordGames;
  delete (loaded as any).manualRecording;
  delete (loaded as any).autoReview;
  const loadedOpening = { ...(loaded.opening ?? {}) } as Partial<EngineSettings['opening']> & {
    strictLine?: boolean;
  };
  delete loadedOpening.strictLine;
  const loadedPolicy = { ...(loadedOpening.enginePolicy ?? {}) } as Record<string, unknown>;
  if ('ballmaegyi' in loadedPolicy) {
    loadedPolicy['gwaymaegyi'] ??= loadedPolicy['ballmaegyi'];
    delete loadedPolicy['ballmaegyi'];
  }
  loadedOpening.enginePolicy = loadedPolicy as EngineSettings['opening']['enginePolicy'];

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
    gwaymaegyiPersonality: loaded.gwaymaegyiPersonality ?? DEFAULT_SETTINGS.gwaymaegyiPersonality,
    gwaymaegyiElo: loaded.gwaymaegyiElo ?? DEFAULT_SETTINGS.gwaymaegyiElo,
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
