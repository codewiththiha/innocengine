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
    hasAggressiveness: false,
    eloMin: 800,
    eloMax: 3000,
    eloStep: 25,
    options: {},
  },
  patricia: {
    id: 'patricia',
    name: 'Patricia 5.1 (Aggressive & Human)',
    author: 'Adam Kulju',
    hasElo: true,
    hasLimitStrength: true,
    hasSkillLevel: true,
    // Present in the pthread build; the single-threaded fallback clamps to 1.
    hasThreads: true,
    hasHash: true,
    hasDepth: true,
    hasMultiPv: true,
    hasPersonality: true,
    hasAggressiveness: true,
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

/**
 * Reconciles the static profile with the options the engine actually reported
 * during its `uci` handshake, so a control is only offered when the loaded
 * binary can honour it.
 */
export function capsFor(id: string, live?: EngineCapabilities | null): EngineCapabilities {
  const base = ENGINE_CAPABILITIES[id] || DEFAULT_CUSTOM_CAPABILITIES;
  if (!live) return base;
  // A report from the live runner wins outright. It knows which options it will
  // actually write, and an option appearing in the handshake does not imply
  // that: Stockfish's wasm build advertises Threads and stalls if it is set.
  return live;
}
