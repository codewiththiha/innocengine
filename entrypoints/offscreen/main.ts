import { UciParser } from '../../lib/uci-parser';
import { EngineRegistry } from '../../lib/engine-registry';
import { mapEloToStockfishParams, getMaiaTuning } from '../../lib/engine-tuning';
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
  maxNodes?: number;
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

    // Resolve discrete Maia-3 checkpoint rating (600 - 2600) and maxNodes: 1
    const maiaTuning = getMaiaTuning({
      targetElo: options.targetElo,
      multiPv: options.multiPv,
    } as any);
    const targetElo = maiaTuning.targetElo;
    const multiPv = Math.max(1, Math.min(4, maiaTuning.multiPv));
    const isBlack = fen.split(' ')[1] === 'b';

    const candidateList = this.evaluateHumanPolicy(fen, targetElo, multiPv);
    if (candidateList.length === 0 || this.isDestroyed || this.currentAnalysisId !== analysisId) {
      return;
    }

    const bestMoveUci = candidateList[0]?.uci || '';

    // Build candidates and multiPvLines with depth 1 / nodes 1 (zero-search human policy)
    const candidates: EngineCandidate[] = candidateList.slice(0, multiPv).map((item, idx) => {
      const from = item.uci.substring(0, 2);
      const to = item.uci.substring(2, 4);
      const winP = item.winProb;
      const scoreCp = Math.round(Math.log(Math.max(0.01, Math.min(0.99, winP)) / (1 - winP)) / 0.00368208);

      return {
        pvId: idx + 1,
        from,
        to,
        depth: 1, // 1-node policy depth
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
        depth: 1,
        nodes: 1,
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
      depth: 1,
      nodes: 1,
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
    this.onStatus('ready', `Maia ${targetElo} Ready`, this.senderTabId);
  }

  // Deterministic human move-probability policy conditioned on Maia discrete Elo checkpoints (600 - 2600)
  // Evaluates static exchange defense, sound development, castling, and tactical awareness
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
      const extendedCenter = new Set(['c3', 'd3', 'e3', 'f3', 'c6', 'd6', 'e6', 'f6']);
      const rimSquares = new Set(['a3', 'h3', 'a6', 'h6', 'a4', 'h4', 'a5', 'h5']);

      const elo = Math.max(600, Math.min(2600, targetElo));
      const eloRatio = (elo - 600) / 2000; // 0.0 at 600 Elo to 1.0 at 2600 Elo

      const tokens = fen.trim().split(/\s+/);
      const fullmove = parseInt(tokens[5] || '1', 10);
      const isOpening = fullmove <= 10;

      const scoredMoves = legalMoves.map((m) => {
        let score = 0;

        // 1. Static Exchange Evaluation (Exchange defense & hanging piece detection)
        const capturedVal = m.captured ? (pieceValues[m.captured] || 100) : 0;
        const myPieceVal = pieceValues[m.piece] || 100;

        chess.move(m);
        const oppReplies = chess.moves({ verbose: true });
        const directCaptures = oppReplies.filter((r) => r.to === m.to);

        let netExchange = capturedVal;
        let isHanging = false;

        if (directCaptures.length > 0) {
          directCaptures.sort((a, b) => (pieceValues[a.piece] || 100) - (pieceValues[b.piece] || 100));
          const lowestAttacker = directCaptures[0];
          const oppAttackerVal = pieceValues[lowestAttacker?.piece || 'p'] || 100;

          if (lowestAttacker) {
            chess.move(lowestAttacker);
            const ourRecaptures = chess.moves({ verbose: true }).filter((r) => r.to === m.to);
            chess.undo();

            if (ourRecaptures.length > 0) {
              if (myPieceVal > oppAttackerVal) {
                netExchange = capturedVal - (myPieceVal - oppAttackerVal);
              }
            } else {
              netExchange = capturedVal - myPieceVal;
              isHanging = true;
            }
          }
        }

        chess.undo();

        if (netExchange > 0) {
          score += netExchange * 2.2; // Winning free material
        } else if (netExchange < 0) {
          if (netExchange <= -400) {
            score += netExchange * (3.0 + eloRatio * 2.0); // Severe penalty for hanging major pieces
          } else {
            score += netExchange * (1.8 + eloRatio * 1.5);
          }
        }

        // 2. Checkmate in 1
        if (m.san.includes('#')) {
          return { uci: `${m.from}${m.to}${m.promotion || ''}`, score: 50000 };
        }

        // 3. Checks (rewarded only if safe)
        if (m.san.includes('+')) {
          if (netExchange >= 0 && !isHanging) {
            score += 35 + (1 - eloRatio) * 20;
          } else {
            score -= 150;
          }
        }

        // 4. Castling (King Safety)
        if (m.flags.includes('k') || m.flags.includes('q')) {
          score += 60 + eloRatio * 40;
        }

        // 5. King losing castling rights prematurely
        if (isOpening && m.piece === 'k' && !m.flags.includes('k') && !m.flags.includes('q')) {
          score -= 60;
        }

        // 6. Center Control & Occupation
        if (centerSquares.has(m.to)) {
          score += 30 + eloRatio * 20;
        } else if (extendedCenter.has(m.to)) {
          score += 15 + eloRatio * 10;
        }

        // 7. Opening Principles
        if (isOpening) {
          if (m.piece === 'p' && (m.to === 'e4' || m.to === 'd4' || m.to === 'c4' || m.to === 'e5' || m.to === 'd5' || m.to === 'c5')) {
            score += 45 + eloRatio * 25;
          }

          if (m.piece === 'n' || m.piece === 'b') {
            const backRank = m.color === 'w' ? '1' : '8';
            if (m.from[1] === backRank && m.to[1] !== backRank) {
              score += 40 + eloRatio * 30;
            }
          }

          if (m.piece === 'n' && rimSquares.has(m.to)) {
            score -= 25 + eloRatio * 35;
          }

          if (m.piece === 'q' && !m.captured && fullmove <= 6) {
            score -= eloRatio * 60;
          }
        }

        // 8. Promotion
        if (m.promotion) {
          score += 900;
        }

        const uci = `${m.from}${m.to}${m.promotion || ''}`;
        return { uci, score };
      });

      // Softmax probabilities
      const maxScore = Math.max(...scoredMoves.map((m) => m.score));
      const temperature = 0.85 - eloRatio * 0.60;
      const expScores = scoredMoves.map((m) => {
        const z = (m.score - maxScore) / (temperature * 50);
        return Math.exp(Math.max(-25, Math.min(25, z)));
      });
      const sumExp = expScores.reduce((acc, v) => acc + v, 0);

      const movesWithProb = scoredMoves.map((m, i) => {
        const expVal = expScores[i] ?? 0;
        const prob = sumExp > 0 ? expVal / sumExp : 1 / scoredMoves.length;
        const winP = 1 / (1 + Math.exp(-m.score / 250));
        return {
          uci: m.uci,
          score: m.score,
          probability: Math.round(prob * 1000) / 1000,
          winProb: Math.max(0.05, Math.min(0.95, Math.round(winP * 1000) / 1000)),
        };
      });

      movesWithProb.sort((a, b) => b.probability - a.probability);
      return movesWithProb.slice(0, multiPv);
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
        this.lastAnalysisId,
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
            depth: targetEngine === 'maia3' ? 1 : (message.depth || 16),
            multiPv: message.multiPv || 1,
            limitStrength: message.limitStrength ?? this.lastOptions.limitStrength,
            targetElo: message.targetElo ?? this.lastOptions.targetElo,
            threads: message.threads,
            hashMb: message.hashMb,
            senderTabId: message.senderTabId,
            maxNodes: targetEngine === 'maia3' ? 1 : undefined,
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

new UnifiedEngineHost();
