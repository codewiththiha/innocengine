import type { EngineCapabilities, EngineEvaluation, EngineTelemetry } from '../types';

export type EngineStatus = 'loading' | 'ready' | 'analyzing' | 'error';

export interface EngineRunOptions {
  depth: number;
  multiPv: number;
  threads: number;
  hashMb: number;
  /** Ceiling on think time per position in ms. 0 keeps the engine's own budget. */
  searchBudgetMs: number;
  /** Patricia style scale. 100 is the engine default. */
  aggressiveness: number;
  /** Load the pthread wasm build when the host can back SharedArrayBuffer. */
  preferThreaded: boolean;
  limitStrength: boolean;
  targetElo: number;
  senderTabId?: number;
  patriciaPersonality?: 'aggressive' | 'human' | 'full_strength' | 'solid';
  patriciaLimitStrength?: boolean;
  patriciaElo?: number;
  maxNodes?: number;
}

export interface AnalysisRequest {
  fen: string;
  analysisId: number;
  positionKey: string;
  options: EngineRunOptions;
}

/** Callbacks a runner uses to reach the rest of the extension. */
export interface RunnerHost {
  onEvaluation(evaluation: EngineEvaluation, tabId?: number): void;
  onStatus(status: EngineStatus, message?: string, tabId?: number): void;
  onCapabilities(capabilities: EngineCapabilities): void;
  onTelemetry(telemetry: EngineTelemetry): void;
}

export interface IEngineRunner {
  readonly id: string;
  readonly name: string;
  init(): Promise<void>;
  /**
   * Requests analysis of one position. A runner must never block on a previous
   * request: newer positions supersede older ones.
   */
  analyze(request: AnalysisRequest): void;
  stop(): void;
  destroy(): void;
}
