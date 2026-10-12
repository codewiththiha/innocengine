import { UciParser } from './uci-parser';
import { EngineRegistry } from './engine-registry';
import { mapEloToStockfishParams, getMaiaTuning, getGwayMaeGyiTuning } from './engine-tuning';
import { evaluateHumanPolicy, predictRanked } from './maia-policy';
import {
  GWAYMAEGYI_MAX_NODES,
  gwaymaegyiWorkerPath,
  reportToEvaluation,
  supportsSimd128,
  type GwayWorkerRequest,
  type GwayWorkerResponse,
} from './gwaymaegyi-protocol';
import type { EngineEvaluation, EngineCandidate, EngineSettings, MoveLine } from './types';

export interface EngineRunOptions {
  depth: number;
  multiPv: number;
  limitStrength: boolean;
  targetElo: number;
  threads?: number;
  hashMb?: number;
  senderTabId?: number;
  maxNodes?: number;
  gwaymaegyiPersonality?: 'aggressive' | 'human' | 'full_strength' | 'solid';
  gwaymaegyiLimitStrength?: boolean;
  gwaymaegyiElo?: number;
  gwaymaegyiPerformance?: 'responsive' | 'balanced' | 'deep';
  gwaymaegyiManualDepth?: boolean;
}

export interface IEngineRunner {
  readonly id: string;
  readonly name: string;
  init(): Promise<void>;
  analyze(fen: string, analysisId: number, positionKey: string, options: EngineRunOptions): void;
  stop(): void;
  destroy(): void;
}

// --------------------------------------------------------------------------
// 1. Stockfish WASM Engine Runner
// --------------------------------------------------------------------------
class StockfishRunner implements IEngineRunner {
  public readonly id = 'stockfish';
  public readonly name = 'Stockfish 17 (WASM)';

  private worker: Worker | null = null;
  private parser: UciParser;
  private isReady: boolean = false;
  private currentFen: string = '';
  private currentAnalysisId: number = 0;
  private currentPositionKey: string = '';
  private currentMultiPv: number = 1;
  private currentSkillLevel: number = -1;
  private senderTabId?: number;
  private onEval: (evalData: EngineEvaluation, tabId?: number) => void;
  private onStatus: (status: 'loading' | 'ready' | 'analyzing' | 'error', msg?: string, tabId?: number) => void;

  constructor(
    onEval: (evalData: EngineEvaluation, tabId?: number) => void,
    onStatus: (status: 'loading' | 'ready' | 'analyzing' | 'error', msg?: string, tabId?: number) => void
  ) {
    this.parser = new UciParser();
    this.onEval = onEval;
    this.onStatus = onStatus;
  }

  public async init(): Promise<void> {
    try {
      this.onStatus('loading', 'Initializing Stockfish WASM...');
      const workerUrl = chrome.runtime.getURL('engine/stockfish.js');
      this.worker = new Worker(workerUrl);

      this.worker.onmessage = (event: MessageEvent) => {
        const line = typeof event.data === 'string' ? event.data : '';
        this.handleLine(line);
      };

      this.worker.onerror = (err) => {
        console.error('[StockfishRunner] Worker error:', err);
        this.onStatus('error', 'Stockfish worker failed');
      };

      this.worker.postMessage('uci');
      this.worker.postMessage('isready');
      this.worker.postMessage('setoption name Hash value 16');
      this.worker.postMessage(`setoption name MultiPV value ${this.currentMultiPv}`);
      this.worker.postMessage('setoption name Skill Level value 20');
      this.currentSkillLevel = 20;
    } catch (err) {
      console.error('[StockfishRunner] Initialization failed:', err);
      this.onStatus('error', 'Failed to launch Stockfish worker');
    }
  }

  private handleLine(line: string) {
    if (line === 'uciok' || line === 'readyok') {
      this.isReady = true;
      this.onStatus('ready', 'Stockfish Ready');
      return;
    }

    const partialEval = this.parser.parseLine(line);
    if (partialEval && partialEval.bestMove) {
      // Discard stale empty evaluations from previous stopped searches
      if (!partialEval.isCalculating && (!partialEval.candidates || partialEval.candidates.length === 0)) {
        return;
      }

      const isBlack = (partialEval.fen || this.currentFen).split(' ')[1] === 'b';
      const whiteCp = partialEval.scoreCp !== null && partialEval.scoreCp !== undefined
        ? (isBlack ? -partialEval.scoreCp : partialEval.scoreCp)
        : null;
      const whiteMate = partialEval.scoreMate !== null && partialEval.scoreMate !== undefined
        ? (isBlack ? -partialEval.scoreMate : partialEval.scoreMate)
        : null;

      const evaluation: EngineEvaluation = {
        engineInstanceId: 'stockfish',
        analysisId: partialEval.analysisId || this.currentAnalysisId,
        positionKey: partialEval.positionKey || this.currentPositionKey,
        fen: partialEval.fen || this.currentFen,
        depth: partialEval.depth || 0,
        scoreCp: partialEval.scoreCp ?? null,
        scoreMate: partialEval.scoreMate ?? null,
        whiteScoreCp: whiteCp,
        whiteScoreMate: whiteMate,
        bestMove: partialEval.bestMove,
        multiPvLines: partialEval.multiPvLines || [],
        candidates: partialEval.candidates || [],
        nodes: partialEval.nodes,
        nps: partialEval.nps,
        timeMs: partialEval.timeMs,
        isCalculating: partialEval.isCalculating ?? true,
        timestamp: Date.now(),
      };

      this.onEval(evaluation, this.senderTabId);
    }
  }

  public analyze(fen: string, analysisId: number, positionKey: string, options: EngineRunOptions) {
    if (!this.worker || !this.isReady) return;

    this.currentFen = fen;
    this.currentAnalysisId = analysisId;
    this.currentPositionKey = positionKey;
    this.senderTabId = options.senderTabId;
    this.parser.reset(fen, analysisId, positionKey);

    this.worker.postMessage('stop');

    // MultiPV configuration (1 - 4 lines)
    const targetMultiPv = Math.max(1, Math.min(4, options.multiPv));
    if (this.currentMultiPv !== targetMultiPv) {
      this.currentMultiPv = targetMultiPv;
      this.worker.postMessage(`setoption name MultiPV value ${targetMultiPv}`);
    }

    // Determine target Skill Level and Depth based on limitStrength & targetElo
    let targetSkill = 20;
    let targetDepth = options.depth || 16;

    if (options.limitStrength) {
      const { skillLevel, maxDepth } = mapEloToStockfishParams(options.targetElo || 1500, options.depth || 16);
      targetSkill = skillLevel;
      targetDepth = maxDepth;
    }

    if (this.currentSkillLevel !== targetSkill) {
      this.currentSkillLevel = targetSkill;
      this.worker.postMessage(`setoption name Skill Level value ${targetSkill}`);
    }

    // Note: Never send Threads or Hash commands during analyze.
    // In this WASM build, Threads is fixed to 1 and sending Threads deadlocks the runtime.
    // Hash re-allocates transposition table memory mid-search.
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage(`go depth ${targetDepth}`);
    this.onStatus('analyzing', undefined, this.senderTabId);
  }

  public stop() {
    if (this.worker) {
      this.worker.postMessage('stop');
      this.onStatus('ready');
    }
  }

  public destroy() {
    if (this.worker) {
      try {
        this.worker.postMessage('quit');
        this.worker.terminate();
      } catch (_) {}
      this.worker = null;
    }
    this.isReady = false;
  }
}

// --------------------------------------------------------------------------
// 2. Maia Human-Like Policy Engine Runner (Maia-2 & Maia-3, nodes: 1)
// --------------------------------------------------------------------------
class MaiaRunner implements IEngineRunner {
  public readonly id: string;
  public readonly name: string;

  private isReady: boolean = false;
  private currentAnalysisId: number = 0;
  private currentFen: string = '';
  private currentPositionKey: string = '';
  private isDestroyed: boolean = false;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private senderTabId?: number;
  private recentPositions: string[] = [];
  private onEval: (evalData: EngineEvaluation, tabId?: number) => void;
  private onStatus: (status: 'loading' | 'ready' | 'analyzing' | 'error', msg?: string, tabId?: number) => void;

  constructor(
    id: string,
    name: string,
    onEval: (evalData: EngineEvaluation, tabId?: number) => void,
    onStatus: (status: 'loading' | 'ready' | 'analyzing' | 'error', msg?: string, tabId?: number) => void
  ) {
    this.id = id;
    this.name = name;
    this.onEval = onEval;
    this.onStatus = onStatus;
  }

  public async init(): Promise<void> {
    this.onStatus('loading', `Initializing ${this.name}...`);
    this.isReady = true;
    this.onStatus('ready', `${this.name} Ready`);
  }

  public analyze(fen: string, analysisId: number, positionKey: string, options: EngineRunOptions) {
    if (this.isDestroyed) return;

    this.currentFen = fen;
    this.currentAnalysisId = analysisId;
    this.currentPositionKey = positionKey;
    this.senderTabId = options.senderTabId;

    // Track position history to avoid 3-fold repetition / perpetual draw when winning
    const posKey = fen.split(' ').slice(0, 4).join(' ');
    if (!this.recentPositions.includes(posKey)) {
      this.recentPositions.push(posKey);
      if (this.recentPositions.length > 64) {
        this.recentPositions.shift();
      }
    }

    this.onStatus('analyzing', undefined, this.senderTabId);

    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
    }

    // Simulate human-like evaluation latency (100ms - 150ms)
    this.pendingTimer = setTimeout(() => {
      this.predictMove(fen, analysisId, positionKey, options);
    }, 120);
  }

  private predictMove(
    fen: string,
    analysisId: number,
    positionKey: string,
    options: EngineRunOptions
  ) {
    if (this.isDestroyed || this.currentAnalysisId !== analysisId) return;

    // Resolve discrete Maia checkpoint rating and nodes: 1 constraint
    const maiaTuning = getMaiaTuning(
      {
        targetElo: options.targetElo,
        multiPv: options.multiPv,
      } as any,
      this.id
    );
    const targetElo = maiaTuning.targetElo;
    const multiPv = Math.max(1, Math.min(4, maiaTuning.multiPv));

    // Single ranked pass without replacement guarantees candidates and bestMove match
    const candidateList = predictRanked(fen, targetElo, multiPv, this.recentPositions);
    if (candidateList.length === 0 || this.isDestroyed || this.currentAnalysisId !== analysisId) {
      return;
    }

    const bestMoveUci = candidateList[0]?.uci || '';

    // Human policy engine: honest null centipawns (no fake numerical score)
    const candidates: EngineCandidate[] = candidateList.slice(0, multiPv).map((item, idx) => {
      const from = item.uci.substring(0, 2);
      const to = item.uci.substring(2, 4);

      return {
        pvId: idx + 1,
        from,
        to,
        depth: 1, // 1-node policy depth
        scoreCp: null,
        scoreMate: null,
        pv: [item.uci],
      };
    });

    const multiPvLines: MoveLine[] = candidateList.slice(0, multiPv).map((item, idx) => {
      return {
        id: idx + 1,
        depth: 1,
        nodes: 1,
        scoreCp: null,
        scoreMate: null,
        whiteScoreCp: null,
        whiteScoreMate: null,
        bestMove: item.uci,
        pv: [item.uci],
      };
    });

    const evaluation: EngineEvaluation = {
      engineInstanceId: this.id,
      analysisId,
      positionKey,
      fen,
      depth: 1,
      nodes: 1,
      scoreCp: null,
      scoreMate: null,
      whiteScoreCp: null,
      whiteScoreMate: null,
      bestMove: bestMoveUci,
      multiPvLines,
      candidates,
      isCalculating: false,
      timestamp: Date.now(),
    };

    this.onEval(evaluation, this.senderTabId);
    this.onStatus('ready', `${this.name} (${targetElo}) Ready`, this.senderTabId);
  }

  public stop() {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.onStatus('ready');
  }

  public destroy() {
    this.isDestroyed = true;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    this.isReady = false;
  }
}

// --------------------------------------------------------------------------
// 3. GwayMaeGyi Rust WASM Engine Runner (typed worker protocol)
// --------------------------------------------------------------------------
class GwayMaeGyiRunner implements IEngineRunner {
  public readonly id = 'gwaymaegyi';
  public readonly name = 'GwayMaeGyi (Rust NNUE)';

  private worker: Worker | null = null;
  private isReady: boolean = false;
  private isSearching: boolean = false;
  private initializationFailed: boolean = false;
  private activeJobId: string = '';
  private activeSearchAnalysisId: number = 0;
  private currentFen: string = '';
  private currentAnalysisId: number = 0;
  private currentPositionKey: string = '';
  private appliedConfigKey: string = '';
  private searchStartedAt: number = 0;
  private lastEvalFingerprint: string = '';
  private armedStart: { analysisId: number; request: GwayWorkerRequest } | null = null;
  private senderTabId?: number;
  private pendingAnalysis: { fen: string; analysisId: number; positionKey: string; options: EngineRunOptions } | null = null;
  private onEval: (evalData: EngineEvaluation, tabId?: number) => void;
  private onStatus: (status: 'loading' | 'ready' | 'analyzing' | 'error', msg?: string, tabId?: number) => void;

  constructor(
    onEval: (evalData: EngineEvaluation, tabId?: number) => void,
    onStatus: (status: 'loading' | 'ready' | 'analyzing' | 'error', msg?: string, tabId?: number) => void
  ) {
    this.onEval = onEval;
    this.onStatus = onStatus;
  }

  public init(): Promise<void> {
    return new Promise((resolve) => {
      this.destroyWorker();
      this.initializationFailed = false;
      this.isReady = false;
      this.isSearching = false;
      this.armedStart = null;
      this.appliedConfigKey = '';
      this.onStatus('loading', 'Initializing GwayMaeGyi WASM...');

      let worker: Worker;
      try {
        worker = new Worker(chrome.runtime.getURL(gwaymaegyiWorkerPath(supportsSimd128())), { type: 'module' });
      } catch (error) {
        console.error('[GwayMaeGyiRunner] Worker spawn failed:', error);
        this.initializationFailed = true;
        this.onStatus('error', 'Failed to launch GwayMaeGyi worker');
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        console.warn('[GwayMaeGyiRunner] Initialization timed out');
        this.initializationFailed = true;
        try { worker.terminate(); } catch (_) {}
        this.onStatus('error', 'GwayMaeGyi WebAssembly initialization timed out');
        resolve();
      }, 10000);

      worker.onmessage = (event: MessageEvent) => {
        const message = event.data as GwayWorkerResponse;
        if (message.type === 'ready') {
          clearTimeout(timeout);
          this.worker = worker;
          this.bindWorker(worker);
          this.isReady = true;
          this.onStatus('ready', 'GwayMaeGyi Ready');
          resolve();
          const pending = this.pendingAnalysis;
          this.pendingAnalysis = null;
          if (pending) {
            this.analyze(pending.fen, pending.analysisId, pending.positionKey, pending.options);
          }
          return;
        }
        if (message.type === 'init-error') {
          clearTimeout(timeout);
          console.error('[GwayMaeGyiRunner] Engine init failed:', message.error);
          this.initializationFailed = true;
          try { worker.terminate(); } catch (_) {}
          this.onStatus('error', 'GwayMaeGyi engine failed to initialize');
          resolve();
        }
      };

      worker.onerror = (error) => {
        clearTimeout(timeout);
        console.error('[GwayMaeGyiRunner] Worker failed during init:', error);
        this.initializationFailed = true;
        try { worker.terminate(); } catch (_) {}
        this.onStatus('error', 'GwayMaeGyi worker failed');
        resolve();
      };
    });
  }

  private bindWorker(worker: Worker) {
    worker.onmessage = (event: MessageEvent) => this.handleMessage(event.data as GwayWorkerResponse);
    worker.onerror = (error) => {
      console.error('[GwayMaeGyiRunner] Worker failed:', error);
      this.initializationFailed = true;
      this.isReady = false;
      this.isSearching = false;
      this.armedStart = null;
      this.pendingAnalysis = null;
      this.destroyWorker();
      this.onStatus('error', 'GwayMaeGyi worker failed');
    };
  }

  private handleMessage(message: GwayWorkerResponse) {
    switch (message.type) {
      case 'ack': {
        // The start request is chained on the position ack: the worker validates
        // the FEN atomically, and searching an old position after a rejected FEN
        // would highlight moves for the wrong board.
        const armed = this.armedStart;
        if (armed && message.id === `pos-${armed.analysisId}` && armed.analysisId === this.currentAnalysisId) {
          this.armedStart = null;
          this.activeJobId = armed.request.id as string;
          this.searchStartedAt = performance.now();
          this.isSearching = true;
          this.worker?.postMessage(armed.request);
          this.onStatus('analyzing', undefined, this.senderTabId);
        }
        return;
      }
      case 'progress':
      case 'done': {
        // The worker suppresses stale callbacks; the job id correlation guards
        // against an in-flight report of a just-replaced analysis.
        if (message.id !== this.activeJobId || this.activeSearchAnalysisId !== this.currentAnalysisId) {
          return;
        }
        // Suppress same-decision repaints: long final iterations can echo an
        // unchanged report (liveness heartbeats), and identical arrows must not
        // re-render. The final 'done' report always goes through.
        const report = message.report;
        const fingerprint = `${message.id}|${report.depth}|${report.bestMove}|${report.mate}|${report.scoreCp}`;
        if (message.type === 'progress' && fingerprint === this.lastEvalFingerprint) {
          return;
        }
        this.lastEvalFingerprint = fingerprint;
        const elapsedMs = Math.max(0, performance.now() - this.searchStartedAt);
        const evaluation = reportToEvaluation(
          message.report,
          this.currentFen,
          this.currentAnalysisId,
          this.currentPositionKey,
          elapsedMs
        );
        this.onEval(evaluation, this.senderTabId);
        if (message.type === 'done') {
          this.isSearching = false;
          this.onStatus('ready', 'GwayMaeGyi Ready', this.senderTabId);
        }
        return;
      }
      case 'error': {
        const armed = this.armedStart;
        if (armed && message.id === `pos-${armed.analysisId}`) {
          this.armedStart = null;
          this.isSearching = false;
          this.onStatus('error', 'GwayMaeGyi rejected the board position', this.senderTabId);
          return;
        }
        if (message.id && message.id === this.activeJobId) {
          this.isSearching = false;
          this.onStatus('error', message.error, this.senderTabId);
          return;
        }
        // Invalid input leaves engine state intact; log and keep the worker usable.
        console.warn('[GwayMaeGyiRunner] Worker rejected request:', message.id, message.error);
        return;
      }
      default:
        return;
    }
  }

  public analyze(fen: string, analysisId: number, positionKey: string, options: EngineRunOptions) {
    this.currentFen = fen;
    this.currentAnalysisId = analysisId;
    this.currentPositionKey = positionKey;
    this.senderTabId = options.senderTabId;
    // A fresh analysis must publish its progress even when the first report
    // echoes the previous job's decision state.
    this.lastEvalFingerprint = '';

    if (this.initializationFailed) return;

    if (!this.worker || !this.isReady) {
      this.pendingAnalysis = { fen, analysisId, positionKey, options };
      return;
    }

    this.activeSearchAnalysisId = analysisId;

    const tuning = getGwayMaeGyiTuning({
      gwaymaegyiPersonality: options.gwaymaegyiPersonality,
      gwaymaegyiLimitStrength: options.gwaymaegyiLimitStrength,
      gwaymaegyiElo: options.gwaymaegyiElo ?? options.targetElo,
      targetElo: options.targetElo,
      depth: options.depth,
      multiPv: options.multiPv,
      gwaymaegyiManualDepth: options.gwaymaegyiManualDepth,
      gwaymaegyiPerformance: options.gwaymaegyiPerformance,
    } as EngineSettings);

    const hashMiB = Math.max(1, Math.min(64, options.hashMb ?? 32));
    const configKey = `${tuning.mode}|${tuning.skillLevel}|${tuning.multiPv}|${hashMiB}`;
    if (configKey !== this.appliedConfigKey) {
      this.appliedConfigKey = configKey;
      this.post({
        id: `cfg-${analysisId}`,
        type: 'configure',
        options: {
          mode: tuning.mode,
          skillLevel: tuning.skillLevel,
          multiPv: tuning.multiPv,
          hashMiB,
        },
      });
    }

    this.post({ id: `pos-${analysisId}`, type: 'position', fen });
    this.armedStart = {
      analysisId,
      request: {
        id: `go-${analysisId}`,
        type: 'start',
        depth: Math.min(64, tuning.recommendedDepth),
        nodes: GWAYMAEGYI_MAX_NODES,
        quantum: tuning.quantum,
        reportIntervalMs: tuning.reportIntervalMs,
        timeMs: tuning.timeMs,
      },
    };
    this.onStatus('analyzing', undefined, this.senderTabId);
  }

  public stop() {
    if (this.initializationFailed) return;
    this.armedStart = null;
    if (this.worker && this.isReady && this.isSearching) {
      // Cooperative slices make stop cheap: it lands between bounded work slices,
      // so the terminate + respawn machinery of the old blocking build is gone.
      this.post({ id: `stop-${this.currentAnalysisId}`, type: 'stop' });
    }
    this.isSearching = false;
    this.onStatus('ready', 'GwayMaeGyi Ready', this.senderTabId);
  }

  public destroy() {
    // Termination reclaims peak WASM memory; a graceful dispose handshake only
    // matters when the worker outlives the engine, which never happens here.
    this.armedStart = null;
    this.destroyWorker();
    this.isReady = false;
    this.isSearching = false;
    this.initializationFailed = false;
    this.pendingAnalysis = null;
  }

  private post(request: GwayWorkerRequest) {
    try {
      this.worker?.postMessage(request);
    } catch (error) {
      console.warn('[GwayMaeGyiRunner] Failed to post worker request:', request.type, error);
    }
  }

  private destroyWorker() {
    if (this.worker) {
      try {
        this.worker.onmessage = null;
        this.worker.onerror = null;
        this.worker.terminate();
      } catch (_) {}
      this.worker = null;
    }
  }
}

// --------------------------------------------------------------------------
// 4. Custom WASM Engine Runner
// --------------------------------------------------------------------------
class CustomWasmRunner implements IEngineRunner {
  public readonly id: string;
  public readonly name: string;

  private worker: Worker | null = null;
  private blobUrl: string | null = null;
  private parser: UciParser;
  private isReady: boolean = false;
  private currentFen: string = '';
  private currentAnalysisId: number = 0;
  private currentPositionKey: string = '';
  private senderTabId?: number;
  private onEval: (evalData: EngineEvaluation, tabId?: number) => void;
  private onStatus: (status: 'loading' | 'ready' | 'analyzing' | 'error', msg?: string, tabId?: number) => void;

  constructor(
    id: string,
    name: string,
    onEval: (evalData: EngineEvaluation, tabId?: number) => void,
    onStatus: (status: 'loading' | 'ready' | 'analyzing' | 'error', msg?: string, tabId?: number) => void
  ) {
    this.id = id;
    this.name = name;
    this.parser = new UciParser();
    this.onEval = onEval;
    this.onStatus = onStatus;
  }

  public async init(): Promise<void> {
    try {
      this.onStatus('loading', `Loading custom WASM: ${this.name}...`);
      const bytes = await EngineRegistry.getEngineWasmBytes(this.id);
      if (!bytes) {
        throw new Error('Custom WASM binary not found in storage');
      }

      // Self-contained UCI worker harness
      const workerCode = `
        let wasmInstance = null;
        self.onmessage = async function(e) {
          const cmd = e.data;
          if (cmd === 'quit') {
            self.close();
            return;
          }
          if (cmd === 'uci') {
            self.postMessage('id name ${this.name}');
            self.postMessage('uciok');
          } else if (cmd === 'isready') {
            self.postMessage('readyok');
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      this.blobUrl = URL.createObjectURL(blob);
      this.worker = new Worker(this.blobUrl);

      this.worker.onmessage = (e) => {
        const line = typeof e.data === 'string' ? e.data : '';
        if (line === 'readyok' || line === 'uciok') {
          this.isReady = true;
          this.onStatus('ready');
        }
      };

      this.worker.postMessage('uci');
      this.worker.postMessage('isready');
      this.isReady = true;
      this.onStatus('ready', `${this.name} Ready`);
    } catch (err) {
      console.error('[CustomWasmRunner] Init error:', err);
      this.onStatus('error', 'Failed to initialize custom WASM engine');
    }
  }

  public analyze(fen: string, analysisId: number, positionKey: string, options: EngineRunOptions) {
    if (!this.worker || !this.isReady) return;
    this.currentFen = fen;
    this.currentAnalysisId = analysisId;
    this.currentPositionKey = positionKey;
    this.senderTabId = options.senderTabId;
    this.parser.reset(fen, analysisId, positionKey);

    this.worker.postMessage('stop');
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage(`go depth ${options.depth}`);
    this.onStatus('analyzing', undefined, this.senderTabId);
  }

  public stop() {
    if (this.worker) {
      this.worker.postMessage('stop');
      this.onStatus('ready');
    }
  }

  public destroy() {
    if (this.worker) {
      try {
        this.worker.postMessage('quit');
        this.worker.terminate();
      } catch (_) {}
      this.worker = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
    this.isReady = false;
  }
}

// --------------------------------------------------------------------------
// 5. Unified Engine Host (Manages Lifecycle & Switching)
// --------------------------------------------------------------------------
class UnifiedEngineHost {
  private activeRunner: IEngineRunner | null = null;
  private currentEngineId: string = 'stockfish';
  private lastFen: string = '';
  private lastAnalysisId: number = 0;
  private lastPositionKey: string = '';
  private lastOptions: EngineRunOptions = {
    depth: 16,
    multiPv: 2,
    limitStrength: false,
    targetElo: 2000,
  };

  constructor() {
    this.init();
    this.setupListeners();
  }

  private async init() {
    this.currentEngineId = 'stockfish';
    this.lastOptions = {
      depth: 16,
      multiPv: 1,
      limitStrength: false,
      targetElo: 1500,
      threads: 1,
      hashMb: 16,
    };
    await this.switchEngine(this.currentEngineId);
  }

  public async switchEngine(engineId: string) {
    if (this.activeRunner) {
      this.activeRunner.stop();
      this.activeRunner.destroy();
      this.activeRunner = null;
    }

    this.currentEngineId = engineId;

    if (engineId === 'gwaymaegyi') {
      this.activeRunner = new GwayMaeGyiRunner(
        (ev, tabId) => this.broadcastEvaluation(ev, tabId),
        (st, msg, tabId) => this.broadcastStatus(st, msg, tabId)
      );
    } else if (engineId === 'maia2') {
      this.activeRunner = new MaiaRunner(
        'maia2',
        'Maia-2 (Unified Model)',
        (ev, tabId) => this.broadcastEvaluation(ev, tabId),
        (st, msg, tabId) => this.broadcastStatus(st, msg, tabId)
      );
    } else if (engineId === 'maia3') {
      this.activeRunner = new MaiaRunner(
        'maia3',
        'Maia-3 (Chessformer)',
        (ev, tabId) => this.broadcastEvaluation(ev, tabId),
        (st, msg, tabId) => this.broadcastStatus(st, msg, tabId)
      );
    } else if (engineId === 'stockfish') {
      this.activeRunner = new StockfishRunner(
        (ev, tabId) => this.broadcastEvaluation(ev, tabId),
        (st, msg, tabId) => this.broadcastStatus(st, msg, tabId)
      );
    } else {
      this.activeRunner = new CustomWasmRunner(
        engineId,
        engineId,
        (ev, tabId) => this.broadcastEvaluation(ev, tabId),
        (st, msg, tabId) => this.broadcastStatus(st, msg, tabId)
      );
    }

    await this.activeRunner.init();

    // If there was an active board position, resume analysis on the new engine
    if (this.lastFen && this.lastPositionKey) {
      this.activeRunner.analyze(
        this.lastFen,
        this.lastAnalysisId,
        this.lastPositionKey,
        this.lastOptions
      );
    }
  }

  private setupListeners() {
    chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender) => {
      if (message.target === 'engine') {
        if (message.type === 'ANALYZE' && message.fen) {
          const targetEngine = message.activeEngineId || this.currentEngineId;
          const isMaia = targetEngine === 'maia2' || targetEngine === 'maia3' || targetEngine.startsWith('maia');
          const runOptions: EngineRunOptions = {
            depth: isMaia ? 1 : (message.depth || 16),
            multiPv: message.multiPv || 1,
            limitStrength: message.limitStrength ?? this.lastOptions.limitStrength,
            targetElo: message.targetElo ?? this.lastOptions.targetElo,
            gwaymaegyiPersonality: message.gwaymaegyiPersonality ?? this.lastOptions.gwaymaegyiPersonality,
            gwaymaegyiLimitStrength: message.gwaymaegyiLimitStrength ?? this.lastOptions.gwaymaegyiLimitStrength,
            gwaymaegyiElo: message.gwaymaegyiElo ?? this.lastOptions.gwaymaegyiElo,
            gwaymaegyiPerformance: message.gwaymaegyiPerformance ?? this.lastOptions.gwaymaegyiPerformance,
            gwaymaegyiManualDepth: message.gwaymaegyiManualDepth ?? this.lastOptions.gwaymaegyiManualDepth,
            threads: message.threads,
            hashMb: message.hashMb,
            senderTabId: message.senderTabId || sender?.tab?.id,
            maxNodes: isMaia ? 1 : undefined,
          };

          this.lastFen = message.fen;
          this.lastAnalysisId = message.analysisId || 0;
          this.lastPositionKey = message.positionKey || '';
          this.lastOptions = runOptions;

          if (targetEngine !== this.currentEngineId) {
            this.switchEngine(targetEngine).then(() => {
              this.activeRunner?.analyze(
                message.fen,
                this.lastAnalysisId,
                this.lastPositionKey,
                runOptions
              );
            });
            return;
          }

          this.activeRunner?.analyze(
            message.fen,
            this.lastAnalysisId,
            this.lastPositionKey,
            runOptions
          );
        } else if (message.type === 'STOP') {
          this.activeRunner?.stop();
        } else if (message.type === 'SWITCH_ENGINE' && message.engineId) {
          this.switchEngine(message.engineId);
        } else if (message.type === 'SETTINGS_UPDATE' && message.settings) {
          const s = message.settings;
          this.lastOptions = {
            depth: s.depth ?? this.lastOptions.depth,
            multiPv: s.multiPv ?? this.lastOptions.multiPv,
            limitStrength: s.limitStrength ?? this.lastOptions.limitStrength,
            targetElo: s.targetElo ?? this.lastOptions.targetElo,
            gwaymaegyiPersonality: s.gwaymaegyiPersonality ?? this.lastOptions.gwaymaegyiPersonality,
            gwaymaegyiLimitStrength: s.gwaymaegyiLimitStrength ?? this.lastOptions.gwaymaegyiLimitStrength,
            gwaymaegyiElo: s.gwaymaegyiElo ?? this.lastOptions.gwaymaegyiElo,
            gwaymaegyiPerformance: s.gwaymaegyiPerformance ?? this.lastOptions.gwaymaegyiPerformance,
            gwaymaegyiManualDepth: s.gwaymaegyiManualDepth ?? this.lastOptions.gwaymaegyiManualDepth,
            threads: s.threads ?? this.lastOptions.threads,
            hashMb: s.hashMb ?? this.lastOptions.hashMb,
          };
          if (s.activeEngineId && s.activeEngineId !== this.currentEngineId) {
            this.switchEngine(s.activeEngineId);
          }
        } else if (message.type === 'PING') {
          this.broadcastStatus('ready');
        }
      }
    });
  }

  private broadcastStatus(
    status: 'loading' | 'ready' | 'analyzing' | 'error',
    message?: string,
    senderTabId?: number
  ) {
    try {
      chrome.runtime.sendMessage({
        target: 'content',
        type: 'ENGINE_STATUS',
        status,
        message,
        senderTabId,
      });
    } catch (_) {}
  }

  private broadcastEvaluation(evaluation: EngineEvaluation, senderTabId?: number) {
    try {
      chrome.runtime.sendMessage({
        target: 'content',
        type: 'EVAL_UPDATE',
        evaluation,
        senderTabId,
      });
    } catch (_) {}
  }
}

export { UnifiedEngineHost, GwayMaeGyiRunner };
