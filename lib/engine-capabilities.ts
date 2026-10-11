import type { EngineCapabilities } from './types';

export const ENGINE_CAPABILITIES: Record<string, EngineCapabilities> = {
  stockfish: {
    id: 'stockfish',
    name: 'Stockfish 17 (WASM)',
    author: 'Stockfish Developers',
    hasElo: true,
    hasLimitStrength: true,
    hasSkillLevel: true,
    hasThreads: true,
    hasHash: true,
    hasDepth: true,
    hasMultiPv: true,
    hasPersonality: false,
    eloMin: 800,
    eloMax: 3000,
    eloStep: 25,
    options: {},
  },
  gwaymaegyi: {
    id: 'gwaymaegyi',
    name: 'GwayMaeGyi (Rust NNUE)',
    author: 'codewiththiha',
    hasElo: true,
    hasLimitStrength: true,
    hasSkillLevel: true,
    hasThreads: false, // Cooperative single-worker WASM; no shared memory required
    hasHash: true, // 1..64 MiB browser ceiling
    hasDepth: true,
    hasMultiPv: true,
    hasPersonality: true,
    eloMin: 500,
    eloMax: 3000,
    eloStep: 50,
    options: {},
  },
  maia3: {
    id: 'maia3',
    name: 'Maia-3 (Chessformer Human Policy)',
    author: 'CSSLab / University of Toronto',
    hasElo: true,
    hasLimitStrength: false, // Pure 1-node human policy
    hasSkillLevel: false,
    hasThreads: false,
    hasHash: false,
    hasDepth: false, // Depth slider hidden
    hasMultiPv: true,
    hasPersonality: false,
    eloMin: 600,
    eloMax: 2600,
    eloStep: 100,
    options: {},
  },
  maia2: {
    id: 'maia2',
    name: 'Maia-2 (NeurIPS 2024 Human Model)',
    author: 'CSSLab / University of Toronto',
    hasElo: true,
    hasLimitStrength: false,
    hasSkillLevel: false,
    hasThreads: false,
    hasHash: false,
    hasDepth: false,
    hasMultiPv: true,
    hasPersonality: false,
    eloMin: 1100,
    eloMax: 1900,
    eloStep: 100,
    options: {},
  },
};

export const DEFAULT_CUSTOM_CAPABILITIES: EngineCapabilities = {
  id: 'custom',
  name: 'Custom WASM Engine',
  author: 'Custom Developer',
  hasElo: true,
  hasLimitStrength: true,
  hasSkillLevel: true,
  hasThreads: true,
  hasHash: true,
  hasDepth: true,
  hasMultiPv: true,
  hasPersonality: false,
  eloMin: 800,
  eloMax: 3000,
  eloStep: 50,
  options: {},
};

export function capsFor(id: string, live?: EngineCapabilities | null): EngineCapabilities {
  const base = ENGINE_CAPABILITIES[id] || DEFAULT_CUSTOM_CAPABILITIES;
  if (!live?.options || Object.keys(live.options).length === 0) {
    return base;
  }
  return {
    ...base,
    hasThreads: !!live.options['Threads'],
    hasHash: !!live.options['Hash'],
    hasLimitStrength: !!live.options['UCI_LimitStrength'],
    hasSkillLevel: !!live.options['Skill Level'] || !!live.options['Skill_Level'],
    options: live.options,
  };
}
