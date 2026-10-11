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

// Nominal skill table, identical to upstream gwaymaegyi SkillLevel::NOMINAL_ELO.
// These labels are engine controls, not calibrated playing ratings.
export const GWAYMAEGYI_SKILL_LEVELS = [
  500, 800, 1000, 1200, 1300, 1400, 1500, 1600, 1700, 1800,
  1900, 2000, 2100, 2200, 2300, 2400, 2500, 2650, 2800, 3000,
];

export interface GwayMaeGyiTuning {
  mode: 'balanced' | 'aggressive' | 'human-like' | 'analysis';
  isLimited: boolean;
  skillLevel: number; // 1..20 limited play, 21 (full strength) otherwise
  targetElo: number;
  recommendedDepth: number;
  personality: 'aggressive' | 'human' | 'full_strength' | 'solid';
  multiPv: number;
  timeMs: number; // hard worker deadline; the engine adapts a soft stop inside it
  quantum: number; // work units per cooperative slice
  reportIntervalMs: number;
}

export function mapEloToGwayMaeGyiSkill(targetElo: number): {
  skillLevel: number;
  clampedElo: number;
} {
  const clampedElo = Math.max(500, Math.min(3000, targetElo));
  let closestIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < GWAYMAEGYI_SKILL_LEVELS.length; i++) {
    const diff = Math.abs(GWAYMAEGYI_SKILL_LEVELS[i]! - clampedElo);
    if (diff < minDiff) {
      minDiff = diff;
      closestIdx = i;
    }
  }
  return { skillLevel: closestIdx + 1, clampedElo }; // 1-based (1..20)
}

export function getGwayMaeGyiTuning(settings: EngineSettings): GwayMaeGyiTuning {
  const personality = settings.gwaymaegyiPersonality || 'aggressive';
  const limitStrength = settings.gwaymaegyiLimitStrength ?? (personality !== 'full_strength');
  const rawElo = settings.gwaymaegyiElo ?? settings.targetElo ?? 2500;
  const multiPv = Math.max(1, Math.min(4, settings.multiPv || 1));
  const perfMode = settings.gwaymaegyiPerformance || 'responsive';
  const quantum = perfMode === 'responsive' ? 128 : perfMode === 'balanced' ? 256 : 512;
  const reportIntervalMs = 50;

  const mode =
    personality === 'human' ? 'human-like' :
    personality === 'solid' ? 'balanced' :
    'aggressive';

  if (!limitStrength || personality === 'full_strength') {
    const baseDepth = Math.min(20, Math.max(12, settings.depth || 16));
    const fullDepth =
      perfMode === 'responsive' ? Math.min(16, baseDepth) :
      perfMode === 'balanced' ? Math.min(18, baseDepth) :
      Math.min(22, baseDepth);
    return {
      mode,
      isLimited: false,
      skillLevel: 21,
      targetElo: 3500,
      recommendedDepth: fullDepth,
      personality: 'full_strength',
      multiPv,
      timeMs: perfMode === 'responsive' ? 350 : perfMode === 'balanced' ? 600 : 1200,
      quantum,
      reportIntervalMs,
    };
  }

  const manualDepth = !!settings.gwaymaegyiManualDepth;
  const userDepth = settings.depth || 16;

  const { skillLevel, clampedElo } = mapEloToGwayMaeGyiSkill(rawElo);

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

  // Cooperative slices keep the worker interruptible between slices, so the
  // deadline only bounds the move budget instead of a blocking search.
  //
  // The budget scales with the nominal Elo: stronger presets must reach far
  // deeper iterations, and a flat ~220 ms deadline left high-Elo searches
  // truncated mid-iteration, so 2500/3000 really played weaker than 2200.
  // Manual-depth users get extra headroom proportional to their ply setting.
  const eloFactor = (clampedElo - 500) / 2500;
  const budgetRange: readonly [number, number] =
    perfMode === 'responsive' ? [140, 480] : perfMode === 'balanced' ? [260, 980] : [380, 2000];
  const timeMs = Math.round(
    budgetRange[0] +
      (budgetRange[1] - budgetRange[0]) * eloFactor +
      (manualDepth
        ? recommendedDepth * (perfMode === 'responsive' ? 10 : perfMode === 'balanced' ? 16 : 26)
        : 0)
  );

  return {
    mode,
    isLimited: true,
    skillLevel,
    targetElo: clampedElo,
    recommendedDepth,
    personality,
    multiPv,
    timeMs,
    quantum,
    reportIntervalMs,
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

  if (settings.activeEngineId === 'gwaymaegyi') {
    const gwaymaegyi = getGwayMaeGyiTuning(settings);
    if (!gwaymaegyi.isLimited || gwaymaegyi.personality === 'full_strength') {
      return {
        badge: 'GwayMaeGyi (Full Strength)',
        detail: 'Skill Level 21 • Full Strength (Rust NNUE)',
        subtext: 'Safe Rust engine with NNUE evaluation at maximum tactical strength. Cooperative WASM search with resumable slices.',
      };
    }
    const modeLabel =
      gwaymaegyi.personality === 'aggressive'
        ? 'Aggressive'
        : gwaymaegyi.personality === 'solid'
        ? 'Solid Positional'
        : 'Human-Like';
    return {
      badge: `GwayMaeGyi ${modeLabel.split(' ')[0]} (${gwaymaegyi.targetElo})`,
      detail: `${modeLabel} • Skill Level ${gwaymaegyi.skillLevel} / 20 (${gwaymaegyi.targetElo} nominal Elo) • Depth ${gwaymaegyi.recommendedDepth} ply`,
      subtext:
        gwaymaegyi.personality === 'aggressive'
          ? `NNUE-attacked play scaled to ~${gwaymaegyi.targetElo} nominal Elo. Strength labels are uncalibrated.`
          : gwaymaegyi.personality === 'solid'
          ? `Balanced positional evaluation at ~${gwaymaegyi.targetElo} nominal Elo. Strength labels are uncalibrated.`
          : `Human-like error tolerance conditioned on ~${gwaymaegyi.targetElo} nominal Elo. Strength labels are uncalibrated.`,
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
