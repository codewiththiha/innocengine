/**
 * dual-engine-host.ts
 *
 * Runs an engine in an offscreen-compatible Worker for deep post-game review.
 * Unlike the live-overlay runner (which prioritises sub-100ms interrupts, a warm
 * standby worker, tight time budgets, and fast move-time stops), this runner
 * is optimised for analysis quality: it can take deeper depths and longer movetime
 * per position. It reuses the UCI protocol but never fights with the live engine.
 */
import { UciParser } from './uci-parser';
import type { EngineCandidate, EngineEvaluation, MoveLine } from './types';
import { getPatriciaTuning } from './engine-tuning';
import { getStockfishTuning, mapEloToStockfishParams } from './engine-tuning';

export interface AnalysisProgress {
  gameId: string;
  ply: number;           // index into moves
  totalPlies: number;
  depth: number;
  isCalculating: boolean;
}

export interface PositionAnalysisResult {
  ply: number;
  fen: string;
  bestMoveUci: string;
  bestMoveSan?: string;
  lines: EngineCandidate[];
  multiPvLines: MoveLine[];
  depth: number;
  scoreCp: number | null;
  scoreMate: number | null;
}

export type ProgressCallback = (p: AnalysisProgress) => void;

/** UCI-capable single-runner used by the deep-review job. */
class SingleRunner {
  private worker: Worker | null = null;
  private ready: boolean = false;
  private engineId: string;

  constructor(engineId: string) {
    this.engineId = engineId;
  }

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      let url: string;
      if (this.engineId === 'patricia') {
        url = chrome.runtime.getURL('engine/patricia/patricia-worker.js');
      } else {
        url = chrome.runtime.getURL('engine/stockfish.js');
      }
      const w = new Worker(url);
      this.worker = w;
      const to = setTimeout(() => reject(new Error('Deep review worker init timeout')), 15000);
      w.onmessage = (ev) => {
        const line = typeof ev.data === 'string' ? ev.data : ev.data?.line || '';
        if (line === 'uciok' || line === 'readyok') {
          clearTimeout(to);
          this.ready = true;
          resolve();
        }
      };
      w.onerror = (e) => { clearTimeout(to); reject(e); };
      w.postMessage('uci');
      w.postMessage('isready');
      // Sensible defaults for deep review
      w.postMessage('setoption name Hash value 128');
      w.postMessage('setoption name MultiPV value 3');
      if (this.engineId === 'stockfish') {
        w.postMessage('setoption name Skill Level value 20');
      }
    });
  }

  /**
   * Analyse a single FEN at depth. Resolves with stable multipv snapshot at the
   * target depth (returns on bestmove).
   */
  analyze(fen: string, depth: number, multiPv: number): Promise<EngineEvaluation> {
    return new Promise((resolve, reject) => {
      if (!this.worker || !this.ready) return reject(new Error('review worker not ready'));
      const parser = new UciParser();
      const posKey = fen.split(/\s+/).slice(0, 4).join(' ');
      parser.reset(fen, 0, posKey);

      let resolved = false;
      let lastEval: EngineEvaluation | null = null;
      const to = setTimeout(() => {
        if (!resolved && lastEval) { resolved = true; resolve(lastEval); }
      }, Math.max(6000, depth * 700));

      const handler = (ev: MessageEvent) => {
        const line = typeof ev.data === 'string' ? ev.data : ev.data?.line || '';
        const parsed = parser.parseLine(line);
        if (parsed && parsed.bestMove) {
          const isBlack = fen.split(' ')[1] === 'b';
          const evalData: EngineEvaluation = {
            engineInstanceId: this.engineId,
            analysisId: 0,
            positionKey: posKey,
            fen,
            depth: parsed.depth || 0,
            scoreCp: parsed.scoreCp ?? null,
            scoreMate: parsed.scoreMate ?? null,
            whiteScoreCp: parsed.scoreCp !== null && parsed.scoreCp !== undefined ? (isBlack ? -parsed.scoreCp : parsed.scoreCp) : null,
            whiteScoreMate: parsed.scoreMate !== null && parsed.scoreMate !== undefined ? (isBlack ? -parsed.scoreMate : parsed.scoreMate) : null,
            bestMove: parsed.bestMove,
            multiPvLines: parsed.multiPvLines || [],
            candidates: parsed.candidates || [],
            isCalculating: parsed.isCalculating ?? true,
            timestamp: Date.now(),
          };
          lastEval = evalData;

          if (!parsed.isCalculating && !resolved) {
            resolved = true;
            clearTimeout(to);
            this.worker!.removeEventListener('message', handler);
            resolve(evalData);
          }
        }
      };

      this.worker.addEventListener('message', handler);
      this.worker.postMessage('stop');
      this.worker.postMessage(`setoption name MultiPV value ${multiPv}`);

      if (this.engineId === 'patricia') {
        // Deep analysis always uses full strength for review
        this.worker.postMessage('setoption name Personality value full_strength');
        this.worker.postMessage('setoption name UCI_LimitStrength value false');
        this.worker.postMessage('setoption name Skill_Level value 21');
        this.worker.postMessage(`position fen ${fen}`);
        this.worker.postMessage(`go depth ${depth} movetime 4000`);
      } else {
        this.worker.postMessage('setoption name Skill Level value 20');
        this.worker.postMessage(`position fen ${fen}`);
        this.worker.postMessage(`go depth ${depth} movetime 4000`);
      }
    });
  }

  destroy() {
    if (this.worker) {
      try {
        this.worker.postMessage('quit');
        this.worker.terminate();
      } catch (_) {}
      this.worker = null;
    }
    this.ready = false;
  }
}

export async function runDeepReview(params: {
  gameId: string;
  initialFen: string;
  moves: { san: string; uci: string }[];
  engineId: 'stockfish' | 'patricia';
  depth: number;
  multiPv?: number;
  onProgress?: ProgressCallback;
  isBookMove?: (fen: string, ply: number) => boolean;
  signal?: { cancelled: boolean };
}): Promise<PositionAnalysisResult[]> {
  const { Chess } = await import('chess.js');
  const runner = new SingleRunner(params.engineId);
  await runner.init();
  const results: PositionAnalysisResult[] = [];
  const chess = new Chess(params.initialFen);
  const multiPv = Math.max(2, Math.min(5, params.multiPv || 3));

  try {
    for (let i = 0; i < params.moves.length; i++) {
      if (params.signal?.cancelled) break;

      // Before making move i, analyze the current position (mover's decision point)
      const fenBefore = chess.fen();
      params.onProgress?.({
        gameId: params.gameId,
        ply: i,
        totalPlies: params.moves.length,
        depth: 0,
        isCalculating: true,
      });

      const evalRes = await runner.analyze(fenBefore, params.depth, multiPv);

      // Turn is whoever is to move at fenBefore
      const moverIsBlack = fenBefore.split(' ')[1] === 'b';
      const fromMoverCp = (cp: number | null) =>
        cp === null ? null : moverIsBlack ? -cp : cp;
      const fromMoverMate = (m: number | null) =>
        m === null ? null : moverIsBlack ? -m : m;

      const lines = evalRes.candidates.map((c) => ({
        ...c,
        scoreCpMover: fromMoverCp(c.scoreCp),
        scoreMateMover: fromMoverMate(c.scoreMate),
      }));

      results.push({
        ply: i,
        fen: fenBefore,
        bestMoveUci: evalRes.bestMove || '',
        lines: evalRes.candidates,
        multiPvLines: evalRes.multiPvLines,
        depth: evalRes.depth,
        scoreCp: fromMoverCp(evalRes.scoreCp),
        scoreMate: fromMoverMate(evalRes.scoreMate),
      });

      try {
        chess.move(params.moves[i]!.san);
      } catch (_) {
        break;
      }

      params.onProgress?.({
        gameId: params.gameId,
        ply: i + 1,
        totalPlies: params.moves.length,
        depth: evalRes.depth,
        isCalculating: i + 1 < params.moves.length,
      });
    }
  } finally {
    runner.destroy();
  }

  return results;
}
