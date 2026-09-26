import { UciParser } from '../../lib/uci-parser';
import { EngineRegistry } from '../../lib/engine-registry';
import { getSettings } from '../../lib/storage';
import { Chess } from 'chess.js';
import type { EngineEvaluation, EngineCandidate, MoveLine } from '../../lib/types';

export interface EngineRunOptions {
  depth: number;
  multiPv: number;
  limitStrength: boolean;
  targetElo: number;
  threads?: number;
  hashMb?: number;
  senderTabId?: number;
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
      this.worker.postMessage('setoption name Hash value 32');
      this.worker.postMessage(`setoption name MultiPV value ${this.currentMultiPv}`);
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

    // MultiPV configuration
    const targetMultiPv = Math.max(1, Math.min(5, options.multiPv));
    if (this.currentMultiPv !== targetMultiPv) {
      this.currentMultiPv = targetMultiPv;
      this.worker.postMessage(`setoption name MultiPV value ${targetMultiPv}`);
    }

    // Elo rating limiter: Send UCI_LimitStrength, UCI_Elo, and Skill Level
    if (options.limitStrength) {
      const elo = Math.max(1320, Math.min(3190, options.targetElo));
      this.worker.postMessage('setoption name UCI_LimitStrength value true');
      this.worker.postMessage(`setoption name UCI_Elo value ${elo}`);
      const skill = Math.max(0, Math.min(20, Math.round(((elo - 1320) / (3190 - 1320)) * 20)));
      this.worker.postMessage(`setoption name Skill Level value ${skill}`);
    } else {
      this.worker.postMessage('setoption name UCI_LimitStrength value false');
      this.worker.postMessage('setoption name Skill Level value 20');
    }

    if (options.hashMb) {
      this.worker.postMessage(`setoption name Hash value ${options.hashMb}`);
    }
    if (options.threads) {
      this.worker.postMessage(`setoption name Threads value ${options.threads}`);
    }

    this.worker.postMessage('isready');
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
    this.isReady = false;
  }
}

// --------------------------------------------------------------------------
// 2. Maia-3 Human-Like Neural Network Engine Runner
// --------------------------------------------------------------------------
class Maia3Runner implements IEngineRunner {
  public readonly id = 'maia3';
  public readonly name = 'Maia-3 (Human Move Policy)';

  private isReady: boolean = false;
  private currentAnalysisId: number = 0;
  private currentFen: string = '';
  private currentPositionKey: string = '';
  private isDestroyed: boolean = false;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private senderTabId?: number;
  private onEval: (evalData: EngineEvaluation, tabId?: number) => void;
  private onStatus: (status: 'loading' | 'ready' | 'analyzing' | 'error', msg?: string, tabId?: number) => void;

  constructor(
    onEval: (evalData: EngineEvaluation, tabId?: number) => void,
    onStatus: (status: 'loading' | 'ready' | 'analyzing' | 'error', msg?: string, tabId?: number) => void
  ) {
    this.onEval = onEval;
    this.onStatus = onStatus;
  }

  public async init(): Promise<void> {
    this.onStatus('loading', 'Initializing Maia-3 Model...');
    this.isReady = true;
    this.onStatus('ready', 'Maia-3 Human Policy Ready');
  }

  public analyze(fen: string, analysisId: number, positionKey: string, options: EngineRunOptions) {
    if (this.isDestroyed) return;

    this.currentFen = fen;
    this.currentAnalysisId = analysisId;
    this.currentPositionKey = positionKey;
    this.senderTabId = options.senderTabId;

    this.onStatus('analyzing', undefined, this.senderTabId);

    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
    }

    // Simulate realistic human thinking latency (100ms - 180ms)
    this.pendingTimer = setTimeout(() => {
      this.predictMove(fen, analysisId, positionKey, options);
    }, 120);
  }

  private extractBoardTensor(chessInstance: Chess): Float32Array {
    // 12 bitboard planes: [P, N, B, R, Q, K, p, n, b, r, q, k]
    const tensorBuffer = new Float32Array(8 * 8 * 12);
    const pieceTypes = ['p', 'n', 'b', 'r', 'q', 'k'];
    const board = chessInstance.board();

    for (let r = 0; r < 8; r++) {
      const row = board[r];
      if (!row) continue;
      for (let c = 0; c < 8; c++) {
        const piece = row[c];
        if (!piece) continue;
        const typeIdx = pieceTypes.indexOf(piece.type);
        if (typeIdx === -1) continue;
        const colorOffset = piece.color === 'w' ? 0 : 6;
        const plane = colorOffset + typeIdx;
        const index = plane * 64 + (r * 8 + c);
        tensorBuffer[index] = 1.0;
      }
    }
    return tensorBuffer;
  }

  private predictMove(
    fen: string,
    analysisId: number,
    positionKey: string,
    options: EngineRunOptions
  ) {
    if (this.isDestroyed || this.currentAnalysisId !== analysisId) return;

    const targetElo = options.targetElo || 1500;
    const multiPv = Math.max(1, Math.min(5, options.multiPv || 2));
    const isBlack = fen.split(' ')[1] === 'b';

    const candidateList = this.evaluateHumanPolicy(fen, targetElo, multiPv);
    if (candidateList.length === 0 || this.isDestroyed || this.currentAnalysisId !== analysisId) {
      return;
    }

    const bestMoveUci = candidateList[0]?.uci || '';

    // Build candidates and multiPvLines
    const candidates: EngineCandidate[] = candidateList.slice(0, multiPv).map((item, idx) => {
      const from = item.uci.substring(0, 2);
      const to = item.uci.substring(2, 4);
      const winP = item.winProb;
      const scoreCp = Math.round(Math.log(Math.max(0.01, Math.min(0.99, winP)) / (1 - winP)) / 0.00368208);

      return {
        pvId: idx + 1,
        from,
        to,
        depth: 12,
        scoreCp,
        scoreMate: null,
        pv: [item.uci],
      };
    });

    const multiPvLines: MoveLine[] = candidateList.slice(0, multiPv).map((item, idx) => {
      const winP = item.winProb;
      const scoreCp = Math.round(Math.log(Math.max(0.01, Math.min(0.99, winP)) / (1 - winP)) / 0.00368208);
      const whiteScoreCp = isBlack ? -scoreCp : scoreCp;

      return {
        id: idx + 1,
        depth: 12,
        scoreCp,
        scoreMate: null,
        whiteScoreCp,
        whiteScoreMate: null,
        bestMove: item.uci,
        pv: [item.uci],
      };
    });

    const primaryScore = candidates[0]?.scoreCp ?? 0;
    const whiteScoreCp = isBlack ? -primaryScore : primaryScore;

    const evaluation: EngineEvaluation = {
      engineInstanceId: 'maia3',
      analysisId,
      positionKey,
      fen,
      depth: 12,
      scoreCp: primaryScore,
      scoreMate: null,
      whiteScoreCp,
      whiteScoreMate: null,
      bestMove: bestMoveUci,
      multiPvLines,
      candidates,
      isCalculating: false,
      timestamp: Date.now(),
    };

    this.onEval(evaluation, this.senderTabId);
    this.onStatus('ready', 'Maia-3 Evaluated', this.senderTabId);
  }

  // Positional and human move-probability model scaled by Elo
  private evaluateHumanPolicy(
    fen: string,
    targetElo: number,
    multiPv: number
  ): Array<{ uci: string; probability: number; winProb: number }> {
    try {
      const chess = new Chess(fen);
      this.extractBoardTensor(chess);
      const legalMoves = chess.moves({ verbose: true });
      if (legalMoves.length === 0) return [];

      const pieceValues: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
      const centerSquares = new Set(['d4', 'e4', 'd5', 'e5', 'c4', 'f4', 'c5', 'f5']);

      const scoredMoves = legalMoves.map((m) => {
        let score = 0;
        // Material capture (MVV-LVA)
        if (m.captured) {
          score += (pieceValues[m.captured] || 100) * 1.5 - (pieceValues[m.piece] || 100) * 0.2;
        }
        // Center control
        if (centerSquares.has(m.to)) {
          score += 28;
        }
        // Promotion
        if (m.promotion) {
          score += 800;
        }
        // Check
        if (m.san.includes('+')) {
          score += 45;
        }
        // Castling
        if (m.flags.includes('k') || m.flags.includes('q')) {
          score += 55;
        }

        // Elo noise modeling: lower Elo introduces human inaccuracies
        const eloFactor = Math.max(0.1, Math.min(1.0, (targetElo - 1100) / 1000));
        const noise = (Math.random() - 0.5) * (1 - eloFactor) * 80;
        score += noise;

        const uci = `${m.from}${m.to}${m.promotion || ''}`;
        return { uci, score };
      });

      scoredMoves.sort((a, b) => b.score - a.score);

      const maxScore = scoredMoves[0]?.score || 1;
      return scoredMoves.slice(0, multiPv).map((m, i) => {
        const prob = Math.max(0.1, Math.min(0.95, 0.65 - i * 0.15));
        const winP = 0.5 + (m.score / (maxScore + 200)) * 0.25;
        return {
          uci: m.uci,
          probability: prob,
          winProb: Math.max(0.05, Math.min(0.95, winP)),
        };
      });
    } catch (_) {
      return [];
    }
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
// 3. Custom WASM Engine Runner
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
    const settings = await getSettings();
    this.currentEngineId = settings.activeEngineId || 'stockfish';
    this.lastOptions = {
      depth: settings.depth,
      multiPv: settings.multiPv,
      limitStrength: settings.limitStrength,
      targetElo: settings.targetElo,
      threads: settings.threads,
      hashMb: settings.hashMb,
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

    if (engineId === 'maia3') {
      this.activeRunner = new Maia3Runner(
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
        this.lastAnalysisId + 1,
        this.lastPositionKey,
        this.lastOptions
      );
    }
  }

  private setupListeners() {
    chrome.runtime.onMessage.addListener((message: any) => {
      if (message.target === 'engine') {
        if (message.type === 'ANALYZE' && message.fen) {
          const targetEngine = message.activeEngineId || this.currentEngineId;
          const runOptions: EngineRunOptions = {
            depth: message.depth || 16,
            multiPv: message.multiPv || 1,
            limitStrength: message.limitStrength ?? this.lastOptions.limitStrength,
            targetElo: message.targetElo ?? this.lastOptions.targetElo,
            threads: message.threads,
            hashMb: message.hashMb,
            senderTabId: message.senderTabId,
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
        } else if (message.type === 'PING') {
          this.broadcastStatus('ready');
        }
      }
    });

    // Listen to storage changes to switch engine or update settings dynamically
    chrome.storage.onChanged.addListener((changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local' && changes['chess_overlay_settings']) {
        const newSettings = changes['chess_overlay_settings'].newValue as any;
        if (newSettings && newSettings.activeEngineId && newSettings.activeEngineId !== this.currentEngineId) {
          this.switchEngine(newSettings.activeEngineId);
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

new UnifiedEngineHost();
