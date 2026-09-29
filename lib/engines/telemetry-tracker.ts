import type { EngineTelemetry } from '../types';

/** The compute facts only the runner can know. */
export interface ComputeProfile {
  hashMb: number;
  threads: number;
  threaded: boolean;
  budgetMs: number;
  estimatedMemoryMb: number;
  isSearching: boolean;
}

const HISTORY_LENGTH = 24;

/**
 * Accumulates the readings the Resources tab plots. Depth history is capped
 * because the sparkline shows a trend, not a log.
 */
export class TelemetryTracker {
  private readonly history: number[] = [];
  private depth = 0;
  private nodes = 0;
  private nps = 0;
  private responseMs = 0;
  private requestedAt = 0;
  private firstResultAt = 0;

  public markRequested(): void {
    this.requestedAt = Date.now();
    this.firstResultAt = 0;
    this.depth = 0;
  }

  public markResult(depth: number, nodes?: number, nps?: number): void {
    this.depth = Math.max(this.depth, depth);
    if (typeof nodes === 'number') this.nodes = nodes;
    if (typeof nps === 'number') this.nps = nps;
    if (!this.firstResultAt) {
      this.firstResultAt = Date.now();
      this.responseMs = Math.max(0, this.firstResultAt - this.requestedAt);
      this.history.push(this.depth);
      if (this.history.length > HISTORY_LENGTH) this.history.shift();
    }
  }

  public snapshot(profile: ComputeProfile): EngineTelemetry {
    return {
      nps: this.nps,
      nodes: this.nodes,
      depth: this.depth,
      hashMb: profile.hashMb,
      threads: profile.threads,
      estimatedMemoryMb: profile.estimatedMemoryMb,
      isSearching: profile.isSearching,
      history: this.history.slice(),
      threaded: profile.threaded,
      budgetMs: profile.budgetMs,
      responseMs: this.responseMs,
    };
  }

  public destroy(): void {
    this.history.length = 0;
    this.depth = 0;
    this.nodes = 0;
    this.nps = 0;
    this.responseMs = 0;
  }
}
