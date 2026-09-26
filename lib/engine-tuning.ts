import type { EngineSettings } from './types';

export interface StockfishTuning {
  skillLevel: number;
  maxDepth: number;
  multiPv: number;
  isThrottled: boolean;
}

export interface MaiaTuning {
  targetElo: number;
  multiPv: number;
  maxNodes: number; // Force 1 node search (zero-search human policy)
}

/**
 * Maps a target Elo rating (800 - 3000) smoothly into Stockfish native parameters:
 * 1. Skill Level (0 - 20)
 * 2. Search Depth limit (4 - maxUserDepth)
 *
 * This completely avoids sending unsupported options like UCI_LimitStrength or UCI_Elo
 * which cause command queue deadlocks in the Stockfish WASM binary.
 */
export function mapEloToStockfishParams(
  targetElo: number,
  maxUserDepth: number = 16
): { skillLevel: number; maxDepth: number } {
  const clampedElo = Math.max(800, Math.min(3000, targetElo));

  // Skill Level ranges 0 to 20
  // 800 Elo -> 0, 2700+ Elo -> 20
  const skillFraction = (clampedElo - 800) / (2700 - 800);
  const skillLevel = Math.max(0, Math.min(20, Math.round(skillFraction * 20)));

  // Depth ranges 4 to maxUserDepth
  const depthFraction = (clampedElo - 800) / (2600 - 800);
  const scaledDepth = Math.round(4 + depthFraction * (maxUserDepth - 4));
  const maxDepth = Math.max(4, Math.min(maxUserDepth, scaledDepth));

  return { skillLevel, maxDepth };
}

/**
 * Resolves active Stockfish execution parameters according to user settings.
 */
export function getStockfishTuning(settings: EngineSettings): StockfishTuning {
  const multiPv = Math.max(1, Math.min(4, settings.multiPv || 1));
  const userDepth = Math.max(6, Math.min(24, settings.depth || 16));

  if (!settings.limitStrength) {
    return {
      skillLevel: 20,
      maxDepth: userDepth,
      multiPv,
      isThrottled: false,
    };
  }

  const { skillLevel, maxDepth } = mapEloToStockfishParams(settings.targetElo || 2000, userDepth);
  return {
    skillLevel,
    maxDepth,
    multiPv,
    isThrottled: true,
  };
}

/**
 * Resolves active Maia execution parameters according to user settings and active engine model.
 * - Maia-3 models support discrete rating checkpoints spanning 600 to 2600.
 * - Maia-2 models support discrete rating checkpoints spanning 1100 to 1900.
 * In accordance with Maia architecture, tree search lookahead must be disabled (maxNodes: 1).
 */
export function getMaiaTuning(settings: EngineSettings, engineId?: string): MaiaTuning {
  const activeId = engineId || settings.activeEngineId || 'maia3';
  const minElo = activeId === 'maia2' ? 1100 : 600;
  const maxElo = activeId === 'maia2' ? 1900 : 2600;
  const clampedElo = Math.max(minElo, Math.min(maxElo, Math.round((settings.targetElo || 1500) / 100) * 100));
  const multiPv = Math.max(1, Math.min(4, settings.multiPv || 1));
  return {
    targetElo: clampedElo,
    multiPv,
    maxNodes: 1, // CRITICAL: Tells caller to use 'go nodes 1' / 1-node policy
  };
}

/**
 * Provides user-facing status and description strings for the active engine and strength setting.
 */
export function getEngineStrengthDescription(settings: EngineSettings): {
  badge: string;
  detail: string;
  subtext: string;
} {
  if (settings.activeEngineId === 'maia3') {
    const maia = getMaiaTuning(settings, 'maia3');
    return {
      badge: `Maia-3 (${maia.targetElo})`,
      detail: `Maia-3 (Chessformer): ${maia.targetElo} Elo • Zero-Search (nodes: 1)`,
      subtext: `Direct neural move prediction conditioned on human games played at ~${maia.targetElo} rating (600–2600). Tree search disabled to preserve human behavior.`,
    };
  }

  if (settings.activeEngineId === 'maia2') {
    const maia = getMaiaTuning(settings, 'maia2');
    return {
      badge: `Maia-2 (${maia.targetElo})`,
      detail: `Maia-2 (NeurIPS 2024): ${maia.targetElo} Elo • Zero-Search (nodes: 1)`,
      subtext: `Unified skill-aware human move prediction conditioned on human games at ~${maia.targetElo} rating (1100–1900). Tree search disabled to preserve human play.`,
    };
  }

  if (settings.activeEngineId === 'stockfish') {
    const sf = getStockfishTuning(settings);
    if (!sf.isThrottled) {
      return {
        badge: 'Unrestricted (GM ~3000+)',
        detail: `Skill Level 20 • Full Search Depth ${sf.maxDepth} ply`,
        subtext: 'Stockfish plays at maximum tactical capability with zero blunder handicapping.',
      };
    }
    return {
      badge: `Throttled (~${settings.targetElo} Elo)`,
      detail: `Skill Level ${sf.skillLevel} / 20 • Max Depth ${sf.maxDepth} ply`,
      subtext: 'Mapped smoothly via native Skill Level and search depth without sending invalid UCI commands.',
    };
  }

  return {
    badge: 'Custom Engine',
    detail: `Depth ${settings.depth} ply`,
    subtext: 'Running custom WebAssembly chess engine.',
  };
}
