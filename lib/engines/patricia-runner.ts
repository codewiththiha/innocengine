import { UciParser } from '../uci-parser';
import { getPatriciaTuning } from '../engine-tuning';
import { OPTION, formatSetOption, parseUciOptionLine } from '../engine-options';
import { TelemetryTracker } from './telemetry-tracker';
import type { EngineCapabilities, EngineEvaluation, UciOption } from '../types';
import type { AnalysisRequest, EngineRunOptions, IEngineRunner, RunnerHost } from './types';

const INIT_TIMEOUT_MS = 8000;
/** `info string Patricia build=… threads=… hash=… aggressiveness=… budget=…` */
const PROFILE_PATTERN = /build=(\w+) threads=(\d+) hash=(\d+) aggressiveness=(\d+) budget=(\d+)/;
const SCRIPT = 'engine/patricia/patricia-worker.js';

/**
 * Patricia, run in a worker so the offscreen page never blocks.
 *
 * Two properties drive this class:
 *
 * 1. Loading the module costs a 5 MB wasm instantiation plus three NNUE
 *    networks. Terminating the worker to cancel a search therefore costs far
 *    more than the search it cancels, so cancellation is only ever a last
 *    resort.
 * 2. The single-threaded build searches synchronously inside the command call
 *    and cannot be interrupted at all. When that build is live, a newer
 *    position waits for the running search instead of restarting the engine.
 */
export class PatriciaRunner implements IEngineRunner {
  public readonly id = 'patricia';
  public readonly name = 'Patricia 5.1 (Aggressive & Human)';

  private worker: Worker | null = null;
  private readonly parser = new UciParser();
  private readonly host: RunnerHost;
  private readonly telemetry = new TelemetryTracker();
  private readonly preferThreaded: boolean;

  private isReady = false;
  private failed = false;
  private searching = false;
  private pending: AnalysisRequest | null = null;
  private currentFen = '';
  private currentAnalysisId = 0;
  private currentPositionKey = '';
  private senderTabId?: number;
  private searchStartedAt = 0;
  private stallTimer: ReturnType<typeof setTimeout> | null = null;

  /** Last value written to the engine, so redundant setup is never re-sent. */
  private sentHash = -1;
  private sentThreads = -1;
  private sentBudget = -1;
  private sentAggressiveness = -1;
  private sentSkill = -1;
  private sentMultiPv = -1;

  private options: Record<string, UciOption> = {};
  private capabilitiesReported = false;
  private threaded = false;
  private threads = 1;
  private hashMb = 32;
  private budgetMs = 0;

  constructor(host: RunnerHost, preferThreaded: boolean) {
    this.host = host;
    this.preferThreaded = preferThreaded;
  }

  public init(): Promise<void> {
    return new Promise((resolve) => {
      this.teardownWorker();
      this.failed = false;
      this.isReady = false;
      this.searching = false;
      this.options = {};
      this.capabilitiesReported = false;
      this.host.onStatus('loading', 'Loading Patricia...', this.senderTabId);

      const base = chrome.runtime.getURL(SCRIPT);
      // The worker reads this at import time, so the build choice cannot be a
      // command; it has to be part of the URL.
      const url = this.canThread() ? `${base}?build=threaded` : base;

      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const settle = (): boolean => {
        if (settled) return false;
        settled = true;
        if (timeout) clearTimeout(timeout);
        return true;
      };

      try {
        this.worker = new Worker(url);
      } catch (error) {
        this.fail('Failed to launch the Patricia worker', error);
        resolve();
        return;
      }

      timeout = setTimeout(() => {
        if (settle()) this.fail('Patricia did not answer the UCI handshake');
        resolve();
      }, INIT_TIMEOUT_MS);

      this.worker.onmessage = (event: MessageEvent) => {
        const line = typeof event.data === 'string' ? event.data : event.data?.line || '';
        if (!line) return;

        if (!settled && (line === 'uciok' || line === 'readyok')) {
          settle();
          this.isReady = true;
          this.reportCapabilities();
          this.host.onStatus('ready', 'Patricia ready', this.senderTabId);
          this.drainPending();
          resolve();
          return;
        }

        this.handleLine(line);
      };

      this.worker.onerror = (error) => {
        if (settle()) {
          this.fail('Patricia worker crashed', error);
          resolve();
          return;
        }
        this.fail('Patricia worker crashed', error);
      };

      this.worker.postMessage('uci');
      this.worker.postMessage('isready');
    });
  }

  private canThread(): boolean {
    if (!this.preferThreaded) return false;
    return typeof SharedArrayBuffer === 'function';
  }

  private fail(message: string, error?: unknown): void {
    if (error) console.error(`[PatriciaRunner] ${message}:`, error);
    this.failed = true;
    this.isReady = false;
    this.searching = false;
    this.pending = null;
    this.clearStallTimer();
    this.teardownWorker();
    this.host.onStatus('error', message, this.senderTabId);
  }

  private teardownWorker(): void {
    if (!this.worker) return;
    try {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.postMessage('quit');
      this.worker.terminate();
    } catch (_) {
      // The worker may already be gone; termination is best effort.
    }
    this.worker = null;
  }

  private handleLine(line: string): void {
    const option = parseUciOptionLine(line);
    if (option) {
      this.options[option.name] = option;
      return;
    }

    if (line.startsWith('info string ')) {
      const profile = line.match(PROFILE_PATTERN);
      if (profile) {
        this.threaded = profile[1] === 'threaded';
        this.threads = parseInt(profile[2] ?? '1', 10);
        this.hashMb = parseInt(profile[3] ?? '32', 10);
        this.budgetMs = parseInt(profile[5] ?? '0', 10);
        this.reportCapabilities();
        this.emitTelemetry();
        return;
      }
      this.host.onStatus('ready', line.slice('info string '.length), this.senderTabId);
      return;
    }

    if (line.startsWith('bestmove')) {
      this.searching = false;
      this.clearStallTimer();
      this.emitTelemetry();
    }

    const partial = this.parser.parseLine(line);
    if (!partial) return;

    if (partial.isCalculating === false && (!partial.candidates || partial.candidates.length === 0)) {
      return;
    }
    if (partial.positionKey && partial.positionKey !== this.currentPositionKey) return;

    const isBlack = (partial.fen || this.currentFen).split(' ')[1] === 'b';
    const sign = isBlack ? -1 : 1;
    const scoreCp = partial.scoreCp ?? null;
    const scoreMate = partial.scoreMate ?? null;

    const evaluation: EngineEvaluation = {
      engineInstanceId: this.id,
      analysisId: this.currentAnalysisId,
      positionKey: this.currentPositionKey,
      fen: this.currentFen,
      depth: partial.depth || 0,
      scoreCp,
      scoreMate,
      whiteScoreCp: scoreCp === null ? null : scoreCp * sign,
      whiteScoreMate: scoreMate === null ? null : scoreMate * sign,
      bestMove: partial.bestMove ?? null,
      multiPvLines: partial.multiPvLines || [],
      candidates: partial.candidates || [],
      nodes: partial.nodes,
      nps: partial.nps,
      timeMs: partial.timeMs,
      isCalculating: partial.isCalculating ?? false,
      timestamp: Date.now(),
    };

    this.telemetry.markResult(evaluation.depth, evaluation.nodes, evaluation.nps);
    this.host.onEvaluation(evaluation, this.senderTabId);

    if (!partial.isCalculating) {
      this.host.onStatus('ready', 'Patricia ready', this.senderTabId);
    }
  }

  private reportCapabilities(): void {
    if (this.capabilitiesReported || Object.keys(this.options).length === 0) return;
    this.capabilitiesReported = true;

    const capabilities: EngineCapabilities = {
      id: this.id,
      name: this.name,
      author: 'Adam Kulju',
      hasElo: !!this.options[OPTION.elo],
      hasLimitStrength: !!this.options[OPTION.limitStrength],
      hasSkillLevel: !!this.options[OPTION.skillLevelUnderscore] || !!this.options[OPTION.skillLevel],
      // Threads only parallelises in the pthread build; the fallback engine
      // clamps it to 1, so offering the control there would be a lie.
      hasThreads: this.threaded && !!this.options[OPTION.threads],
      hasHash: !!this.options[OPTION.hash],
      hasDepth: true,
      hasMultiPv: !!this.options[OPTION.multiPv],
      hasPersonality: true,
      hasAggressiveness: !!this.options[OPTION.aggressiveness],
      eloMin: this.options[OPTION.elo]?.min ?? 500,
      eloMax: this.options[OPTION.elo]?.max ?? 3000,
      eloStep: 50,
      options: this.options,
    };

    this.host.onCapabilities(capabilities);
  }

  private emitTelemetry(): void {
    this.host.onTelemetry(
      this.telemetry.snapshot({
        hashMb: this.hashMb,
        threads: this.threads,
        threaded: this.threaded,
        budgetMs: this.budgetMs,
        estimatedMemoryMb: this.hashMb + (this.threaded ? 52 : 48),
        isSearching: this.searching,
      })
    );
  }

  /** Writes only the settings that changed since the last search. */
  private applyOptions(options: EngineRunOptions): void {
    const worker = this.worker;
    if (!worker) return;

    const hashMb = Math.max(1, Math.min(131072, Math.round(options.hashMb)));
    if (hashMb !== this.sentHash) {
      worker.postMessage(formatSetOption(OPTION.hash, hashMb));
      this.sentHash = hashMb;
      this.hashMb = hashMb;
    }

    // Sending Threads to the single-threaded build tears down and rebuilds its
    // thread pool for no gain, so it is only sent where it parallelises.
    const threads = this.threaded
      ? Math.max(1, Math.min(32, Math.round(options.threads)))
      : 1;
    if (threads !== this.sentThreads) {
      if (this.threaded) worker.postMessage(formatSetOption(OPTION.threads, threads));
      this.sentThreads = threads;
      this.threads = threads;
    }

    const budget = Math.max(0, Math.round(options.searchBudgetMs));
    if (budget !== this.sentBudget) {
      worker.postMessage(formatSetOption('Search_Budget', budget));
      this.sentBudget = budget;
      this.budgetMs = budget;
    }

    const aggressiveness = Math.max(25, Math.min(300, Math.round(options.aggressiveness)));
    if (aggressiveness !== this.sentAggressiveness) {
      worker.postMessage(formatSetOption(OPTION.aggressiveness, aggressiveness));
      this.sentAggressiveness = aggressiveness;
    }
  }

  public analyze(request: AnalysisRequest): void {
    if (this.failed) return;

    // Only the newest position matters; an older queued request is dropped
    // rather than searched and thrown away.
    this.pending = request;

    if (!this.isReady || !this.worker) {
      if (this.isStalled()) void this.init();
      return;
    }

    if (this.searching) {
      // The pthread build can cancel mid-search and start immediately. The
      // synchronous build cannot, so the newest position waits its turn: one
      // bounded search is still far cheaper than reloading the module.
      if (this.threaded && this.worker) {
        this.worker.postMessage('stop');
      }
      if (this.isStalled()) void this.init();
      return;
    }

    this.startPending();
  }

  private isStalled(): boolean {
    if (!this.searching) return false;
    const ceiling = this.budgetMs > 0 ? this.budgetMs : 600;
    return Date.now() - this.searchStartedAt > Math.max(4000, ceiling * 6);
  }

  private drainPending(): void {
    if (this.pending && !this.searching && this.isReady) {
      this.startPending();
    }
  }

  private startPending(): void {
    const request = this.pending;
    const worker = this.worker;
    if (!request || !worker || !this.isReady) return;

    this.pending = null;
    this.searching = true;
    this.currentFen = request.fen;
    this.currentAnalysisId = request.analysisId;
    this.currentPositionKey = request.positionKey;
    this.senderTabId = request.options.senderTabId;
    this.searchStartedAt = Date.now();
    this.parser.reset(request.fen, request.analysisId, request.positionKey);
    this.telemetry.markRequested();

    const tuning = getPatriciaTuning({
      patriciaPersonality: request.options.patriciaPersonality,
      patriciaLimitStrength: request.options.patriciaLimitStrength,
      patriciaElo: request.options.patriciaElo ?? request.options.targetElo,
      depth: request.options.depth,
      multiPv: request.options.multiPv,
    });

    worker.postMessage(
      formatSetOption(OPTION.personality, tuning.personality)
    );
    worker.postMessage(formatSetOption(OPTION.limitStrength, tuning.isHuman));
    worker.postMessage(formatSetOption(OPTION.elo, tuning.targetElo));

    if (tuning.skillLevel !== this.sentSkill) {
      worker.postMessage(formatSetOption(OPTION.skillLevelUnderscore, tuning.skillLevel));
      this.sentSkill = tuning.skillLevel;
    }

    const multiPv = Math.max(1, Math.min(4, request.options.multiPv));
    if (multiPv !== this.sentMultiPv) {
      worker.postMessage(formatSetOption(OPTION.multiPv, multiPv));
      this.sentMultiPv = multiPv;
    }

    this.applyOptions(request.options);

    const depth = tuning.isHuman ? tuning.recommendedDepth : request.options.depth;
    worker.postMessage(`position fen ${request.fen}`);
    // movetime is still sent because the worker reads it only as a fallback;
    // the selected budget travels separately as Search_Budget.
    worker.postMessage(`go depth ${depth} movetime ${Math.max(120, this.budgetMs || 500)}`);

    this.armStallTimer();
    this.host.onStatus('analyzing', undefined, this.senderTabId);
  }

  private armStallTimer(): void {
    this.clearStallTimer();
    const ceiling = this.budgetMs > 0 ? this.budgetMs : 600;
    const limit = Math.max(4000, ceiling * 6);
    this.stallTimer = setTimeout(() => {
      if (!this.searching) return;
      // A search that never returns is the one case where reloading the module
      // is cheaper than waiting.
      console.warn('[PatriciaRunner] Search stalled; reloading the engine');
      this.searching = false;
      void this.init();
    }, limit);
  }

  private clearStallTimer(): void {
    if (this.stallTimer) {
      clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  }

  public stop(): void {
    this.pending = null;
    this.clearStallTimer();
    if (this.worker && this.threaded) {
      this.worker.postMessage('stop');
    }
    this.host.onStatus('ready', 'Patricia ready', this.senderTabId);
  }

  public destroy(): void {
    this.stop();
    this.teardownWorker();
    this.telemetry.destroy();
    this.isReady = false;
    this.searching = false;
    this.failed = false;
    this.pending = null;
    this.options = {};
    this.sentHash = -1;
    this.sentThreads = -1;
    this.sentBudget = -1;
    this.sentAggressiveness = -1;
    this.sentSkill = -1;
    this.sentMultiPv = -1;
  }
}
