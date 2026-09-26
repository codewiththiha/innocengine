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

export const PATRICIA_SKILL_LEVELS = [
  500, 800, 1000, 1200, 1300, 1400, 1500, 1600, 1700, 1800,
  1900, 2000, 2100, 2200, 2300, 2400, 2500, 2650, 2800, 3000,
];

export interface PatriciaTuning {
  isHuman: boolean;
  skillLevel: number; // 1..20 for human mode, 21 for full strength
  targetElo: number;
  recommendedDepth: number;
  personality: 'aggressive' | 'human' | 'full_strength' | 'solid';
  multiPv: number;
  cpLoss: number;
}

export function mapEloToPatriciaSkill(targetElo: number): {
  skillLevel: number;
  clampedElo: number;
  cpLoss: number;
} {
  let closestIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < PATRICIA_SKILL_LEVELS.length; i++) {
    const diff = Math.abs(PATRICIA_SKILL_LEVELS[i]! - targetElo);
    if (diff < minDiff) {
      minDiff = diff;
      closestIdx = i;
    }
  }
  const clampedElo = PATRICIA_SKILL_LEVELS[closestIdx] ?? 2500;
  const skillLevel = closestIdx + 1; // 1-based (1..20)
  const cpLoss = Math.max(0, 120 - Math.floor(clampedElo / 25));
  return { skillLevel, clampedElo, cpLoss };
}

export function getPatriciaTuning(settings: EngineSettings): PatriciaTuning {
  const personality = settings.patriciaPersonality || 'aggressive';
  const limitStrength = settings.patriciaLimitStrength ?? (personality === 'human');
  const rawElo = settings.patriciaElo || 2500;
  const multiPv = Math.max(1, Math.min(4, settings.multiPv || 1));

  if (!limitStrength && personality !== 'human') {
    return {
      isHuman: false,
      skillLevel: 21,
      targetElo: 3500,
      recommendedDepth: Math.min(10, settings.depth || 10),
      personality,
      multiPv,
      cpLoss: 0,
    };
  }

  const { skillLevel, clampedElo, cpLoss } = mapEloToPatriciaSkill(rawElo);
  // Fast, responsive human calibration: depth 7 to 10 ensures sub-300ms analysis
  const recommendedDepth = Math.max(7, Math.min(10, Math.round(7 + ((clampedElo - 500) / 2500) * 3)));

  return {
    isHuman: true,
    skillLevel,
    targetElo: clampedElo,
    recommendedDepth,
    personality,
    multiPv,
    cpLoss,
  };
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

  if (settings.activeEngineId === 'patricia') {
    const patricia = getPatriciaTuning(settings);
    if (!patricia.isHuman) {
      return {
        badge: 'Patricia 5.1 (CCRL ~3500+)',
        detail: 'Skill Level 21 • Full Strength (EAS 430,000 Aggressive)',
        subtext: "Adam Kulju's romantic aggressive engine at maximum tactical strength. High draw contempt and ruthless piece sacrifices.",
      };
    }
    return {
      badge: `Patricia Human (${patricia.targetElo})`,
      detail: `Skill Level ${patricia.skillLevel} / 20 (${patricia.targetElo} Elo) • cp_loss: ${patricia.cpLoss}`,
      subtext: `Calibrated human blunder rate with MultiPV error distribution. Recommended depth: ${patricia.recommendedDepth} ply for ~${patricia.targetElo} Elo play.`,
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
