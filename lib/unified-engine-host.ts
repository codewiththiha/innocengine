import { UciParser } from './uci-parser';
import { EngineRegistry } from './engine-registry';
import { mapEloToStockfishParams, getMaiaTuning, getPatriciaTuning } from './engine-tuning';
import { evaluateHumanPolicy, predictRanked } from './maia-policy';
import { Chess } from 'chess.js';
import type { EngineEvaluation, EngineCandidate, MoveLine } from './types';

export interface EngineRunOptions {
  depth: number;
  multiPv: number;
  limitStrength: boolean;
  targetElo: number;
  threads?: number;
  hashMb?: number;
  senderTabId?: number;
  maxNodes?: number;
  patriciaPersonality?: 'aggressive' | 'human' | 'full_strength' | 'solid';
  patriciaLimitStrength?: boolean;
  patriciaElo?: number;
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
// 3. Patricia WASM Engine Runner (Aggressive & Human Mode)
// --------------------------------------------------------------------------
class PatriciaRunner implements IEngineRunner {
  public readonly id = 'patricia';
  public readonly name = 'Patricia 5.1 (Aggressive & Human)';

  private worker: Worker | null = null;
  private parser: UciParser;
  private isReady: boolean = false;
  private isSearching: boolean = false;
  private activeSearchAnalysisId: number = 0;
  private activeSearchPositionKey: string = '';
  private currentFen: string = '';
  private currentAnalysisId: number = 0;
  private currentPositionKey: string = '';
  private currentMultiPv: number = 1;
  private currentSkillLevel: number = -1;
  private initializationFailed: boolean = false;
  private senderTabId?: number;
  private pendingAnalysis: { fen: string; analysisId: number; positionKey: string; options: EngineRunOptions } | null = null;
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

  public init(): Promise<void> {
    return new Promise((resolve) => {
      try {
        if (this.worker) {
          try {
            this.worker.terminate();
          } catch (_) {}
          this.worker = null;
        }

        this.initializationFailed = false;
        this.isReady = false;
        this.isSearching = false;
        this.onStatus('loading', 'Initializing Patricia WASM...');
        this.currentSkillLevel = -1;
        const workerUrl = chrome.runtime.getURL('engine/patricia/patricia-worker.js');
        this.worker = new Worker(workerUrl);

        let settled = false;
        let timeout: ReturnType<typeof setTimeout> | null = null;
        const fail = (message: string, error?: unknown) => {
          if (settled) return;
          settled = true;
          if (timeout) clearTimeout(timeout);
          if (error) console.error('[PatriciaRunner] Initialization failed:', error);
          this.initializationFailed = true;
          this.isReady = false;
          this.isSearching = false;
          this.pendingAnalysis = null;
          try {
            this.worker?.terminate();
          } catch (_) {}
          this.worker = null;
          this.onStatus('error', message);
          resolve();
        };
        const markReady = () => {
          if (settled) return;
          settled = true;
          if (timeout) clearTimeout(timeout);
          this.isReady = true;
          this.isSearching = false;
          this.onStatus('ready', 'Patricia 5.1 Ready');
          resolve();
          if (this.pendingAnalysis) {
            const pending = this.pendingAnalysis;
            this.pendingAnalysis = null;
            this.analyze(pending.fen, pending.analysisId, pending.positionKey, pending.options);
          }
        };

        timeout = setTimeout(() => {
          fail('Patricia worker did not complete UCI initialization');
        }, 6000);

        this.worker.onmessage = (event: MessageEvent) => {
          const line = typeof event.data === 'string' ? event.data : event.data?.line || '';
          if (line === 'uciok' || line === 'readyok') {
            markReady();
            return;
          }
          this.handleLine(line);
        };

        this.worker.onerror = (error) => {
          if (!settled) {
            fail('Patricia worker failed to initialize', error);
            return;
          }

          console.error('[PatriciaRunner] Worker failed:', error);
          this.initializationFailed = true;
          this.isReady = false;
          this.isSearching = false;
          this.pendingAnalysis = null;
          try {
            this.worker?.terminate();
          } catch (_) {}
          this.worker = null;
          this.onStatus('error', 'Patricia worker failed');
        };

        this.worker.postMessage('uci');
        this.worker.postMessage('isready');
        this.worker.postMessage('setoption name Hash value 32');
        this.worker.postMessage(`setoption name MultiPV value ${this.currentMultiPv}`);
      } catch (error) {
        console.error('[PatriciaRunner] Initialization failed:', error);
        this.initializationFailed = true;
        this.isReady = false;
        this.pendingAnalysis = null;
        this.onStatus('error', 'Failed to launch Patricia worker');
        resolve();
      }
    });
  }

  private handleLine(line: string) {
    if (line === 'uciok' || line === 'readyok') {
      this.isReady = true;
      this.isSearching = false;
      this.onStatus('ready', 'Patricia 5.1 Ready');
      return;
    }

    if (line.startsWith('bestmove')) {
      this.isSearching = false;
    }

    // STRICT STALENESS FILTER:
    // If this line was emitted from an older analysis or a different position key,
    // immediately drop it! This prevents previous-move suggestions from rendering on a new position.
    if (this.activeSearchAnalysisId !== this.currentAnalysisId) {
      return;
    }

    const partialEval = this.parser.parseLine(line);
    if (partialEval && partialEval.bestMove) {
      if (!partialEval.isCalculating && (!partialEval.candidates || partialEval.candidates.length === 0)) {
        return;
      }

      // Ensure the evaluated positionKey matches the active position
      if (partialEval.positionKey && partialEval.positionKey !== this.currentPositionKey) {
        return;
      }

      const isBlack = (partialEval.fen || this.currentFen).split(' ')[1] === 'b';
      const whiteCp =
        partialEval.scoreCp !== null && partialEval.scoreCp !== undefined
          ? isBlack
            ? -partialEval.scoreCp
            : partialEval.scoreCp
          : null;
      const whiteMate =
        partialEval.scoreMate !== null && partialEval.scoreMate !== undefined
          ? isBlack
            ? -partialEval.scoreMate
            : partialEval.scoreMate
          : null;

      const evalData: EngineEvaluation = {
        engineInstanceId: 'patricia',
        analysisId: this.currentAnalysisId,
        positionKey: this.currentPositionKey,
        fen: this.currentFen,
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
        isCalculating: partialEval.isCalculating ?? false,
        timestamp: Date.now(),
      };

      this.onEval(evalData, this.senderTabId);

      if (!partialEval.isCalculating) {
        this.onStatus('ready', 'Patricia Ready', this.senderTabId);
      }
    }
  }

  public analyze(fen: string, analysisId: number, positionKey: string, options: EngineRunOptions) {
    this.currentFen = fen;
    this.currentAnalysisId = analysisId;
    this.currentPositionKey = positionKey;
    this.senderTabId = options.senderTabId;

    // INSTANT TERMINATION OF STALE SYNCHRONOUS SEARCH:
    // Single-threaded WASM engines execute synchronous C++ loops that cannot be
    // interrupted by postMessage('stop'). Terminating the busy worker immediately halts
    // the old calculation in 0ms and eliminates the lagging queue backlog.
    if (this.isSearching && this.worker) {
      try {
        this.worker.onerror = null;
        this.worker.onmessage = null;
        this.worker.terminate();
      } catch (_) {}
      this.worker = null;
      this.isReady = false;
      this.isSearching = false;
      this.pendingAnalysis = { fen, analysisId, positionKey, options };
      this.init();
      return;
    }

    if (this.initializationFailed) {
      return;
    }

    if (!this.worker || !this.isReady) {
      this.pendingAnalysis = { fen, analysisId, positionKey, options };
      return;
    }

    this.activeSearchAnalysisId = analysisId;
    this.activeSearchPositionKey = positionKey;
    this.isSearching = true;
    this.parser.reset(fen, analysisId, positionKey);

    // Dynamic MultiPV
    const targetMultiPv = Math.max(1, Math.min(4, options.multiPv || 1));
    if (this.currentMultiPv !== targetMultiPv) {
      this.worker.postMessage(`setoption name MultiPV value ${targetMultiPv}`);
      this.currentMultiPv = targetMultiPv;
    }

    // Configure Patricia Human / Aggressive Tuning
    const tuning = getPatriciaTuning({
      patriciaPersonality: options.patriciaPersonality,
      patriciaLimitStrength: options.patriciaLimitStrength,
      patriciaElo: options.patriciaElo ?? options.targetElo,
      depth: options.depth,
      multiPv: options.multiPv,
    } as any);

    this.worker.postMessage(`setoption name Personality value ${tuning.personality}`);
    this.worker.postMessage(`setoption name UCI_LimitStrength value ${tuning.isHuman}`);
    this.worker.postMessage(`setoption name UCI_Elo value ${tuning.targetElo}`);

    if (this.currentSkillLevel !== tuning.skillLevel) {
      this.worker.postMessage(`setoption name Skill_Level value ${tuning.skillLevel}`);
      this.currentSkillLevel = tuning.skillLevel;
    }

    const targetDepth = tuning.isHuman ? tuning.recommendedDepth : (options.depth || 16);
    const moveTime = tuning.isHuman ? Math.min(350, Math.max(120, targetDepth * 50)) : 500;

    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage(`go depth ${targetDepth} movetime ${moveTime}`);
    this.onStatus('analyzing', undefined, this.senderTabId);
  }

  public stop() {
    if (this.initializationFailed) return;

    if (this.isSearching && this.worker) {
      try {
        this.worker.onerror = null;
        this.worker.onmessage = null;
        this.worker.terminate();
      } catch (_) {}
      this.worker = null;
      this.isReady = false;
      this.isSearching = false;
      this.init();
    } else if (this.worker) {
      this.worker.postMessage('stop');
    }
    this.onStatus('ready', 'Patricia Ready', this.senderTabId);
  }

  public destroy() {
    if (this.worker) {
      try {
        this.worker.onerror = null;
        this.worker.onmessage = null;
        this.worker.postMessage('quit');
        this.worker.terminate();
      } catch (_) {}
      this.worker = null;
    }
    this.isReady = false;
    this.isSearching = false;
    this.initializationFailed = false;
    this.pendingAnalysis = null;
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
// 4. Unified Engine Host (Manages Lifecycle & Switching)
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

    if (engineId === 'patricia') {
      this.activeRunner = new PatriciaRunner(
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
            patriciaPersonality: message.patriciaPersonality ?? this.lastOptions.patriciaPersonality,
            patriciaLimitStrength: message.patriciaLimitStrength ?? this.lastOptions.patriciaLimitStrength,
            patriciaElo: message.patriciaElo ?? this.lastOptions.patriciaElo,
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
            patriciaPersonality: s.patriciaPersonality ?? this.lastOptions.patriciaPersonality,
            patriciaLimitStrength: s.patriciaLimitStrength ?? this.lastOptions.patriciaLimitStrength,
            patriciaElo: s.patriciaElo ?? this.lastOptions.patriciaElo,
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

export { UnifiedEngineHost };
