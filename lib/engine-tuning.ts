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

export const BALLMAEGYI_SKILL_LEVELS = [
  500, 800, 1000, 1200, 1300, 1400, 1500, 1600, 1700, 1800,
  1900, 2000, 2100, 2200, 2300, 2400, 2500, 2650, 2800, 3000,
];

export interface BallMaeGyiTuning {
  isHuman: boolean;
  skillLevel: number; // 1..20 for human mode, 21 for full strength
  targetElo: number;
  recommendedDepth: number;
  personality: 'aggressive' | 'human' | 'full_strength' | 'solid';
  multiPv: number;
  cpLoss: number;
  useProgressiveInfo: boolean;
  moveTimeMs: number;
}

export function mapEloToBallMaeGyiSkill(targetElo: number): {
  skillLevel: number;
  clampedElo: number;
  cpLoss: number;
} {
  const clampedElo = Math.max(500, Math.min(3000, targetElo));
  let closestIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < BALLMAEGYI_SKILL_LEVELS.length; i++) {
    const diff = Math.abs(BALLMAEGYI_SKILL_LEVELS[i]! - clampedElo);
    if (diff < minDiff) {
      minDiff = diff;
      closestIdx = i;
    }
  }
  const skillLevel = closestIdx + 1; // 1-based (1..20)
  const cpLoss = Math.max(0, 120 - Math.floor(clampedElo / 25));
  return { skillLevel, clampedElo, cpLoss };
}

export function getBallMaeGyiTuning(settings: EngineSettings): BallMaeGyiTuning {
  const personality = settings.ballmaegyiPersonality || 'aggressive';
  const limitStrength = settings.ballmaegyiLimitStrength ?? (personality !== 'full_strength');
  const rawElo = settings.ballmaegyiElo ?? settings.targetElo ?? 2500;
  const multiPv = Math.max(1, Math.min(4, settings.multiPv || 1));

  if (!limitStrength || personality === 'full_strength') {
    const perfMode = settings.ballmaegyiPerformance || 'responsive';
    const baseDepth = Math.min(20, Math.max(12, settings.depth || 16));
    const fullDepth =
      perfMode === 'responsive' ? Math.min(16, baseDepth) :
      perfMode === 'balanced' ? Math.min(18, baseDepth) :
      Math.min(22, baseDepth);
    return {
      isHuman: false,
      skillLevel: 21,
      targetElo: 3500,
      recommendedDepth: fullDepth,
      personality: 'full_strength',
      multiPv,
      cpLoss: 0,
      useProgressiveInfo: true,
      moveTimeMs: perfMode === 'responsive' ? 350 : perfMode === 'balanced' ? 600 : 1200,
    };
  }

  const manualDepth = !!settings.ballmaegyiManualDepth;
  const perfMode = settings.ballmaegyiPerformance || 'responsive';
  const userDepth = settings.depth || 16;

  const { skillLevel, clampedElo, cpLoss } = mapEloToBallMaeGyiSkill(rawElo);

  // Realistic novice-to-master depth scaling (baseline, "balanced" profile):
  // 500-600 Elo: depth 2 (novice 1-move tactical horizon)
  // 650-800 Elo: depth 3 (beginner 1.5-move horizon)
  // 850-1100 Elo: depth 4 (casual club horizon)
  // 1150-1400 Elo: depth 5 (intermediate club)
  // 1450-1750 Elo: depth 6 (strong club player)
  // 1751-2100 Elo: depth 8 (expert / candidate master)
  // 2101-2500 Elo: depth 10 (FIDE master / master)
  // 2501-2800 Elo: depth 12 (International / Grandmaster)
  // 2801+ Elo: depth 14 (Super-GM)
  let baselineDepth = 2;
  if (clampedElo <= 600) baselineDepth = 2;
  else if (clampedElo <= 800) baselineDepth = 3;
  else if (clampedElo <= 1100) baselineDepth = 4;
  else if (clampedElo <= 1400) baselineDepth = 5;
  else if (clampedElo <= 1750) baselineDepth = 6;
  else if (clampedElo <= 2100) baselineDepth = 8;
  else if (clampedElo <= 2500) baselineDepth = 10;
  else if (clampedElo <= 2800) baselineDepth = 12;
  else baselineDepth = 14;

  // Performance profile tweaks the auto-depth for near-instant feedback.
  // "responsive" caps depth to keep highlights near-instantaneous.
  let autoDepth = baselineDepth;
  if (perfMode === 'responsive') {
    autoDepth = Math.min(10, baselineDepth);
  } else if (perfMode === 'balanced') {
    autoDepth = baselineDepth;
  } else {
    // deep: allow +2 plies on stronger profiles; capped at 16 to prevent runaway lags
    autoDepth = Math.min(16, baselineDepth + 2);
  }

  // Manual override: when user force-enables depth slider, respect their choice.
  const recommendedDepth = manualDepth ? Math.max(2, Math.min(24, userDepth)) : autoDepth;

  // Progressive info streaming is essential for instant highlight feedback.
  // Always enable for aggro/human modes so early depths show highlights immediately.
  const useProgressiveInfo = true;

  // Tighten movetime budgets in "responsive" mode so the single-threaded WASM
  // doesn't block the worker for hundreds of milliseconds past its target depth.
  const moveTimeMs =
    perfMode === 'responsive'
      ? Math.min(220, Math.max(80, recommendedDepth * 22))
      : perfMode === 'balanced'
      ? Math.min(420, Math.max(120, recommendedDepth * 35))
      : Math.min(900, Math.max(180, recommendedDepth * 60));

  return {
    isHuman: true,
    skillLevel,
    targetElo: clampedElo,
    recommendedDepth,
    personality,
    multiPv,
    cpLoss,
    useProgressiveInfo,
    moveTimeMs,
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

  if (settings.activeEngineId === 'ballmaegyi') {
    const ballmaegyi = getBallMaeGyiTuning(settings);
    if (!ballmaegyi.isHuman || ballmaegyi.personality === 'full_strength') {
      return {
        badge: 'BallMaeGyi 5.1 (CCRL ~3500+)',
        detail: 'Skill Level 21 • Full Strength (EAS 430,000 Aggressive)',
        subtext: "Adam Kulju's romantic aggressive engine at maximum tactical strength. High draw contempt and ruthless piece sacrifices.",
      };
    }
    const modeLabel =
      ballmaegyi.personality === 'aggressive'
        ? 'Aggressive (EAS 430k)'
        : ballmaegyi.personality === 'solid'
        ? 'Solid Positional'
        : 'Human-Like';
    return {
      badge: `BallMaeGyi ${modeLabel.split(' ')[0]} (${ballmaegyi.targetElo})`,
      detail: `${modeLabel} • Skill Level ${ballmaegyi.skillLevel} / 20 (${ballmaegyi.targetElo} Elo) • Depth ${ballmaegyi.recommendedDepth} ply`,
      subtext:
        ballmaegyi.personality === 'aggressive'
          ? `Tactical sacrifices and king attack with search scaled to ~${ballmaegyi.targetElo} Elo.`
          : ballmaegyi.personality === 'solid'
          ? `Positional king safety and classical solid lines calibrated to ~${ballmaegyi.targetElo} Elo.`
          : `Calibrated human blunder rate with MultiPV error distribution for authentic ~${ballmaegyi.targetElo} Elo play.`,
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
