import { getMaiaTuning } from '../engine-tuning';
import { predictRanked } from '../maia-policy';
import { TelemetryTracker } from './telemetry-tracker';
import type { EngineCandidate, EngineEvaluation, MoveLine } from '../types';
import type { AnalysisRequest, IEngineRunner, RunnerHost } from './types';

const REPETITION_MEMORY = 64;

/**
 * Maia is a one-node human policy, not a search. It answers from a lookup in
 * memory, so a position is resolved as soon as the call arrives: any artificial
 * "thinking" delay would only be latency the overlay does not need.
 */
export class MaiaRunner implements IEngineRunner {
  public readonly id: string;
  public readonly name: string;

  private readonly host: RunnerHost;
  private readonly telemetry = new TelemetryTracker();
  private readonly recentPositions: string[] = [];
  private senderTabId?: number;

  constructor(id: string, name: string, host: RunnerHost) {
    this.id = id;
    this.name = name;
    this.host = host;
  }

  public async init(): Promise<void> {
    this.host.onStatus('loading', `Loading ${this.name}...`);
    this.host.onCapabilities({
      id: this.id,
      name: this.name,
      author: 'CSSLab / University of Toronto',
      hasElo: true,
      hasLimitStrength: false,
      hasSkillLevel: false,
      hasThreads: false,
      hasHash: false,
      hasDepth: false,
      hasMultiPv: true,
      hasPersonality: false,
      hasAggressiveness: false,
      eloMin: this.id === 'maia2' ? 1100 : 600,
      eloMax: this.id === 'maia2' ? 1900 : 2600,
      eloStep: 100,
      options: {},
    });
    this.host.onStatus('ready', `${this.name} ready`);
  }

  public analyze(request: AnalysisRequest): void {
    this.senderTabId = request.options.senderTabId;

    // Tracks repetition so the policy does not walk a winning position into a draw.
    const positionKey = request.fen.split(' ').slice(0, 4).join(' ');
    if (!this.recentPositions.includes(positionKey)) {
      this.recentPositions.push(positionKey);
      if (this.recentPositions.length > REPETITION_MEMORY) this.recentPositions.shift();
    }

    const tuning = getMaiaTuning(
      { targetElo: request.options.targetElo, multiPv: request.options.multiPv },
      this.id
    );

    this.host.onStatus('analyzing', undefined, this.senderTabId);

    const ranked = predictRanked(request.fen, tuning.targetElo, tuning.multiPv, this.recentPositions);
    if (ranked.length === 0) {
      this.host.onStatus('ready', `${this.name} ready`, this.senderTabId);
      return;
    }

    const limited = ranked.slice(0, tuning.multiPv);

    // A policy has no evaluation to report, so scores stay null rather than
    // being filled with a number the model never produced.
    const candidates: EngineCandidate[] = limited.map((item, index) => ({
      pvId: index + 1,
      from: item.uci.substring(0, 2),
      to: item.uci.substring(2, 4),
      depth: 1,
      scoreCp: null,
      scoreMate: null,
      pv: [item.uci],
    }));

    const multiPvLines: MoveLine[] = limited.map((item, index) => ({
      id: index + 1,
      depth: 1,
      nodes: 1,
      scoreCp: null,
      scoreMate: null,
      whiteScoreCp: null,
      whiteScoreMate: null,
      bestMove: item.uci,
      pv: [item.uci],
    }));

    const evaluation: EngineEvaluation = {
      engineInstanceId: this.id,
      analysisId: request.analysisId,
      positionKey: request.positionKey,
      fen: request.fen,
      depth: 1,
      nodes: 1,
      scoreCp: null,
      scoreMate: null,
      whiteScoreCp: null,
      whiteScoreMate: null,
      bestMove: limited[0]?.uci ?? null,
      multiPvLines,
      candidates,
      isCalculating: false,
      timestamp: Date.now(),
    };

    this.telemetry.markRequested();
    this.telemetry.markResult(1, 1, 0);
    this.host.onEvaluation(evaluation, this.senderTabId);
    this.host.onTelemetry(
      this.telemetry.snapshot({
        hashMb: 0,
        threads: 1,
        threaded: false,
        budgetMs: 0,
        estimatedMemoryMb: 12,
        isSearching: false,
      })
    );
    this.host.onStatus('ready', `${this.name} (${tuning.targetElo}) ready`, this.senderTabId);
  }

  public stop(): void {
    this.host.onStatus('ready', `${this.name} ready`, this.senderTabId);
  }

  public destroy(): void {
    this.telemetry.destroy();
    this.recentPositions.length = 0;
  }
}
