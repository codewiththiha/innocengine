import { UciParser } from '../uci-parser';
import { mapEloToStockfishParams } from '../engine-tuning';
import { OPTION, formatSetOption, parseUciOptionLine } from '../engine-options';
import { TelemetryTracker } from './telemetry-tracker';
import type { EngineEvaluation, UciOption } from '../types';
import type { AnalysisRequest, IEngineRunner, RunnerHost } from './types';

const INIT_TIMEOUT_MS = 8000;

/**
 * Stockfish's wasm build keeps Threads pinned to one and stalls if the option
 * is written, so the search is always single-threaded and only MultiPV, Hash
 * and Skill Level are driven.
 */
export class StockfishRunner implements IEngineRunner {
  public readonly id = 'stockfish';
  public readonly name = 'Stockfish (WASM)';

  private worker: Worker | null = null;
  private readonly parser = new UciParser();
  private readonly host: RunnerHost;
  private readonly telemetry = new TelemetryTracker();

  private isReady = false;
  private searching = false;
  private currentFen = '';
  private currentAnalysisId = 0;
  private currentPositionKey = '';
  private senderTabId?: number;

  private sentHash = -1;
  private sentMultiPv = -1;
  private sentSkill = -1;

  private options: Record<string, UciOption> = {};
  private capabilitiesReported = false;
  private hashMb = 16;

  constructor(host: RunnerHost) {
    this.host = host;
  }

  public init(): Promise<void> {
    return new Promise((resolve) => {
      this.host.onStatus('loading', 'Loading Stockfish...');
      this.options = {};
      this.capabilitiesReported = false;

      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const settle = (): boolean => {
        if (settled) return false;
        settled = true;
        if (timeout) clearTimeout(timeout);
        return true;
      };

      try {
        this.worker = new Worker(chrome.runtime.getURL('engine/stockfish.js'));
      } catch (error) {
        console.error('[StockfishRunner] Failed to launch worker:', error);
        this.host.onStatus('error', 'Failed to launch the Stockfish worker');
        resolve();
        return;
      }

      timeout = setTimeout(() => {
        if (settle()) this.host.onStatus('error', 'Stockfish did not answer the UCI handshake');
        resolve();
      }, INIT_TIMEOUT_MS);

      this.worker.onmessage = (event: MessageEvent) => {
        const line = typeof event.data === 'string' ? event.data : '';
        if (!line) return;

        if (!settled && (line === 'uciok' || line === 'readyok')) {
          settle();
          this.isReady = true;
          this.reportCapabilities();
          this.host.onStatus('ready', 'Stockfish ready');
          resolve();
          return;
        }

        this.handleLine(line);
      };

      this.worker.onerror = (error) => {
        console.error('[StockfishRunner] Worker error:', error);
        if (settle()) {
          this.host.onStatus('error', 'Stockfish worker crashed');
          resolve();
        }
      };

      this.worker.postMessage('uci');
      this.worker.postMessage('isready');
    });
  }

  private handleLine(line: string): void {
    const option = parseUciOptionLine(line);
    if (option) {
      this.options[option.name] = option;
      return;
    }

    if (line.startsWith('bestmove')) {
      this.searching = false;
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
      isCalculating: partial.isCalculating ?? true,
      timestamp: Date.now(),
    };

    this.telemetry.markResult(evaluation.depth, evaluation.nodes, evaluation.nps);
    this.host.onEvaluation(evaluation, this.senderTabId);

    if (!partial.isCalculating) {
      this.host.onStatus('ready', 'Stockfish ready', this.senderTabId);
    }
  }

  private reportCapabilities(): void {
    if (this.capabilitiesReported) return;
    this.capabilitiesReported = true;
    this.host.onCapabilities({
      id: this.id,
      name: this.name,
      author: 'Stockfish developers',
      hasElo: !!this.options[OPTION.limitStrength],
      hasLimitStrength: !!this.options[OPTION.limitStrength],
      hasSkillLevel: !!this.options[OPTION.skillLevel],
      hasThreads: false,
      hasHash: !!this.options[OPTION.hash],
      hasDepth: true,
      hasMultiPv: !!this.options[OPTION.multiPv],
      hasPersonality: false,
      hasAggressiveness: false,
      eloMin: this.options[OPTION.elo]?.min ?? 800,
      eloMax: this.options[OPTION.elo]?.max ?? 3000,
      eloStep: 25,
      options: this.options,
    });
  }

  private emitTelemetry(): void {
    this.host.onTelemetry(
      this.telemetry.snapshot({
        hashMb: this.hashMb,
        threads: 1,
        threaded: false,
        budgetMs: 0,
        estimatedMemoryMb: this.hashMb + 48,
        isSearching: this.searching,
      })
    );
  }

  public analyze(request: AnalysisRequest): void {
    const worker = this.worker;
    if (!worker || !this.isReady) return;

    this.currentFen = request.fen;
    this.currentAnalysisId = request.analysisId;
    this.currentPositionKey = request.positionKey;
    this.senderTabId = request.options.senderTabId;
    this.parser.reset(request.fen, request.analysisId, request.positionKey);
    this.telemetry.markRequested();

    worker.postMessage('stop');

    // Hash must not be reallocated while a search is running, so it is only
    // written between searches.
    const hashMb = Math.max(16, Math.min(256, Math.round(request.options.hashMb)));
    if (hashMb !== this.sentHash) {
      worker.postMessage(formatSetOption(OPTION.hash, hashMb));
      this.sentHash = hashMb;
      this.hashMb = hashMb;
    }

    const multiPv = Math.max(1, Math.min(4, request.options.multiPv));
    if (multiPv !== this.sentMultiPv) {
      worker.postMessage(formatSetOption(OPTION.multiPv, multiPv));
      this.sentMultiPv = multiPv;
    }

    let depth = request.options.depth;
    let skill = 20;

    if (request.options.limitStrength) {
      const mapped = mapEloToStockfishParams(request.options.targetElo, request.options.depth);
      skill = mapped.skillLevel;
      depth = mapped.maxDepth;
    }

    if (skill !== this.sentSkill) {
      worker.postMessage(formatSetOption(OPTION.skillLevel, skill));
      this.sentSkill = skill;
    }

    worker.postMessage(`position fen ${request.fen}`);
    worker.postMessage(`go depth ${depth}`);

    this.searching = true;
    this.host.onStatus('analyzing', undefined, this.senderTabId);
  }

  public stop(): void {
    if (!this.worker) return;
    this.worker.postMessage('stop');
    this.searching = false;
    this.host.onStatus('ready', 'Stockfish ready', this.senderTabId);
  }

  public destroy(): void {
    if (this.worker) {
      try {
        this.worker.onmessage = null;
        this.worker.onerror = null;
        this.worker.postMessage('quit');
        this.worker.terminate();
      } catch (_) {
        // Already terminated.
      }
      this.worker = null;
    }
    this.telemetry.destroy();
    this.isReady = false;
    this.searching = false;
    this.options = {};
    this.sentHash = -1;
    this.sentMultiPv = -1;
    this.sentSkill = -1;
  }
}
