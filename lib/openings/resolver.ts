import type {
  BookPositionEntry,
  OpeningConfig,
} from './types';
import type { EngineCandidate, EngineSettings } from '../types';
import { validateBookMoveCached } from '../opening-safety';
import type { OpeningIndex } from './index';
import { globalOpeningSession } from './session';

export interface ResolvedBookEntry extends BookPositionEntry {
  validationLoss: number;
}

export function categoryMatches(
  entry: BookPositionEntry,
  config: OpeningConfig
): boolean {
  if (entry.categories.includes('meme') && !config.includeMeme) {
    return false;
  }

  if (entry.categories.includes('weird') && !config.includeWeird) {
    return false;
  }

  if (entry.meme && !config.includeMeme) {
    return false;
  }

  if (config.maxRisk != null && entry.risk > config.maxRisk) {
    return false;
  }

  if (config.categories && config.categories.length > 0) {
    const hasMatch = config.categories.some((cat) =>
      entry.categories.includes(cat)
    );
    if (!hasMatch) return false;
  }

  return true;
}

export function selectedOpeningMatches(
  entry: BookPositionEntry,
  config: OpeningConfig,
  playerColor?: 'w' | 'b'
): boolean {
  if (config.selectedOpeningIds && config.selectedOpeningIds.length > 0) {
    return config.selectedOpeningIds.includes(entry.openingId);
  }

  // Side-specific repertoire binding:
  if (playerColor === 'w' && (config as any).whiteRepertoireId && (config as any).whiteRepertoireId !== 'auto') {
    return entry.openingId === (config as any).whiteRepertoireId;
  }
  if (playerColor === 'b' && (config as any).blackRepertoireId && (config as any).blackRepertoireId !== 'auto') {
    return entry.openingId === (config as any).blackRepertoireId;
  }

  if (config.repertoireId && config.repertoireId !== 'auto') {
    return entry.openingId === config.repertoireId;
  }

  return true;
}

export function engineAllowsEntry(
  entry: BookPositionEntry,
  engineCandidates: EngineCandidate[],
  settings: EngineSettings,
  config: OpeningConfig
): boolean {
  if (!engineCandidates.length) return true;

  const enginePolicy = config.enginePolicy?.[settings.activeEngineId] ?? {};
  const minEngineDepth =
    enginePolicy.minEngineDepth ?? (settings.activeEngineId === 'patricia' ? 2 : config.safety?.minEngineDepth ?? 8);
  const top = engineCandidates[0];

  if (!top) return true;

  if ((top.depth ?? 0) < minEngineDepth) {
    return true;
  }

  const engineIncludesBookMove = engineCandidates.some(
    (c) =>
      c.from === entry.uci.slice(0, 2) &&
      c.to === entry.uci.slice(2, 4) &&
      (c.promotion ?? '') === (entry.uci.slice(4, 5) ?? '')
  );

  if (engineIncludesBookMove) {
    return true;
  }

  // Never show book moves if engine detects a forced checkmate against us
  if (top.scoreMate != null) {
    return false;
  }

  const allowOffBook =
    enginePolicy.allowOffBook ??
    (config.mode === 'book-only' || config.mode === 'prefer');

  if (!allowOffBook && !engineIncludesBookMove) {
    return false;
  }

  if (entry.risk >= 4 && !enginePolicy.allowRisky && !config.safety?.allowRiskyOpenings) {
    return false;
  }

  if (entry.meme && !enginePolicy.allowMeme && !config.safety?.allowMemeOpenings) {
    return false;
  }

  return true;
}

export function resolveSafeOpeningEntry(
  index: OpeningIndex,
  fen: string,
  settings: EngineSettings,
  engineCandidates: EngineCandidate[] = [],
  playerColor?: 'w' | 'b'
): ResolvedBookEntry | null {
  const config = settings.opening;
  if (!config?.enabled) return null;

  const turn = fen.split(' ')[1] as 'w' | 'b';
  const effectivePlayerColor = playerColor || turn;

  const entries = index.lookupFiltered(fen, (entry) => {
    // 1. Repertoire side matching: ensure opening belongs to the player's color
    if (entry.side !== 'any' && entry.side !== effectivePlayerColor) {
      return false;
    }
    if (!selectedOpeningMatches(entry, config, effectivePlayerColor)) return false;
    if (!categoryMatches(entry, config)) return false;
    return true;
  });

  if (!entries.length) return null;

  // Strict line tracking: if an active opening is tracked and user deviated, only continue if in-line
  if (config.strictLine && globalOpeningSession.isActive()) {
    const activeId = globalOpeningSession.getActiveOpeningId();
    if (activeId) {
      const activeEntry = entries.find((e) => e.openingId === activeId);
      if (!activeEntry) {
        // Position is not part of the active opening line
        return null;
      }
    }
  }

  const sorted = entries.sort((a, b) => {
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    if (a.risk !== b.risk) {
      return a.risk - b.risk;
    }
    return a.ply - b.ply;
  });

  for (const entry of sorted) {
    const validation = validateBookMoveCached(fen, entry.uci, config.safety);
    if (!validation.legal || !validation.safe) {
      continue;
    }

    if (!engineAllowsEntry(entry, engineCandidates, settings, config)) {
      continue;
    }

    return {
      ...entry,
      validationLoss: validation.loss,
    };
  }

  return null;
}
