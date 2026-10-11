// Strongly typed contract for the GwayMaeGyi module worker plus the pure
// report → EngineEvaluation mapping. Mirrors the upstream message schema in
// gwaymaegyi docs/wasm.md; nodes use decimal strings to survive u64 precision.

import type { EngineCandidate, EngineEvaluation, MoveLine } from './types';

export const GWAYMAEGYI_ENGINE_ID = 'gwaymaegyi';

// Search-space ceiling; depth and timeMs are the real limits in practice.
export const GWAYMAEGYI_MAX_NODES = '18446744073709551615';

// Mate score encoding of the WASM build: |score| in [MATE_THRESHOLD, MATE].
const MATE = 30000;
const MATE_THRESHOLD = MATE - 96;

export interface GwayConfigureOptions {
  mode?: 'balanced' | 'aggressive' | 'human-like' | 'analysis';
  elo?: number;
  skillLevel?: number;
  hashMiB?: number;
  multiPv?: number;
  chess960?: boolean;
  seed?: string;
}

export type GwayWorkerRequest =
  | { id: string; type: 'configure'; options: GwayConfigureOptions }
  | { id: string; type: 'position'; fen: string; moves?: string[] }
  | {
      id: string;
      type: 'start';
      depth?: number;
      nodes?: string;
      quantum?: number;
      reportIntervalMs?: number;
      timeMs?: number | null;
      roots?: string[];
    }
  | { id: string; type: 'stop'; target?: string }
  | { id: string; type: 'reset' }
  | { id: string; type: 'status' }
  | { id: string; type: 'dispose' };

export interface GwayVariation {
  scoreCp: number;
  pv: string[];
}

export interface GwayReport {
  status: 'idle' | 'running' | 'depth' | 'nodes' | 'stopped' | 'terminal' | 'tablebase';
  finished: boolean;
  depth: number;
  selectiveDepth: number;
  nodes: string;
  bestMove: string | null;
  scoreCp: number | null;
  mate: number | null;
  bestMoveNodes: string;
  tablebaseHits: string;
  pv: string[];
  variations: GwayVariation[];
}

export type GwayWorkerResponse =
  | { type: 'ready'; capabilities: Record<string, unknown> }
  | { type: 'init-error'; error: string }
  | { id: string | null; type: 'ack'; state?: Record<string, unknown> }
  | { id: string; type: 'progress'; report: GwayReport }
  | { id: string; type: 'done'; report: GwayReport; reason?: string }
  | { id: string | null; type: 'error'; error: string };

// Same probe as upstream web/loader.mjs: a minimal i8x16.relaxed_swizzle module.
export function supportsSimd128(): boolean {
  const probe = new Uint8Array([
    0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 9, 1, 7, 0,
    65, 0, 253, 15, 26, 11,
  ]);
  return typeof WebAssembly !== 'undefined' && WebAssembly.validate(probe);
}

export function gwaymaegyiWorkerPath(simd128: boolean): string {
  return `engine/gwaymaegyi/${simd128 ? 'simd128' : 'portable'}/engine-worker.mjs`;
}

function mateIn(scoreCp: number): number | null {
  const magnitude = Math.abs(scoreCp);
  if (magnitude < MATE_THRESHOLD || magnitude > MATE) return null;
  return Math.trunc((MATE - magnitude + 1) / 2) * Math.sign(scoreCp);
}

function clampNodes(decimal: string): number {
  return Math.min(Number(decimal), Number.MAX_SAFE_INTEGER);
}

/**
 * Converts a worker report into the overlay's evaluation shape. Scores stay
 * relative to the side to move everywhere except the white-relative mirrors,
 * matching UciParser output. A finished report's `bestMove` is authoritative
 * (human/aggressive modes may style-pick a non-top line), so it is promoted
 * to candidates[0], just like the UCI `bestmove` path does.
 */
export function reportToEvaluation(
  report: GwayReport,
  fen: string,
  analysisId: number,
  positionKey: string,
  elapsedMs: number
): EngineEvaluation {
  const isBlack = fen.split(' ')[1] === 'b';
  const whiteScore = (cp: number | null) =>
    cp === null ? null : isBlack ? -cp : cp;

  const lines: MoveLine[] = report.variations.map((variation, index) => {
    const mate = mateIn(variation.scoreCp);
    const cp = mate === null ? variation.scoreCp : null;
    return {
      id: index + 1,
      depth: report.depth,
      scoreCp: cp,
      scoreMate: mate,
      whiteScoreCp: whiteScore(cp),
      whiteScoreMate: whiteScore(mate),
      bestMove: variation.pv[0] ?? '',
      pv: variation.pv,
      nodes: clampNodes(report.nodes),
      timeMs: Math.round(elapsedMs),
    };
  });

  let candidates: EngineCandidate[] = lines
    .filter((line) => line.bestMove.length >= 4)
    .map((line) => ({
      pvId: line.id,
      from: line.bestMove.substring(0, 2),
      to: line.bestMove.substring(2, 4),
      promotion: line.bestMove.length > 4 ? line.bestMove[4] : undefined,
      depth: line.depth,
      scoreCp: line.scoreCp,
      scoreMate: line.scoreMate,
      pv: line.pv,
      continuation:
        line.pv.length >= 2 && line.pv[1]!.length >= 4
          ? { from: line.pv[1]!.substring(0, 2), to: line.pv[1]!.substring(2, 4) }
          : undefined,
    }));

  const bestMove = report.bestMove;
  if (report.finished && bestMove && bestMove.length >= 4) {
    const matchIndex = candidates.findIndex(
      (candidate) => candidate.from === bestMove.substring(0, 2) && candidate.to === bestMove.substring(2, 4)
    );
    if (matchIndex > 0) {
      const [chosen] = candidates.splice(matchIndex, 1);
      candidates.unshift({ ...chosen!, pvId: 1 });
    } else if (matchIndex === -1) {
      candidates.unshift({
        pvId: 1,
        from: bestMove.substring(0, 2),
        to: bestMove.substring(2, 4),
        promotion: bestMove.length > 4 ? bestMove[4] : undefined,
        depth: report.depth,
        scoreCp: report.mate === null ? report.scoreCp : null,
        scoreMate: report.mate,
        pv: [bestMove],
      });
    }
    candidates.forEach((candidate, index) => {
      candidate.pvId = index + 1;
    });
  }

  const primaryCp = report.mate === null ? report.scoreCp : null;
  const nodes = clampNodes(report.nodes);

  return {
    engineInstanceId: GWAYMAEGYI_ENGINE_ID,
    analysisId,
    positionKey,
    fen,
    depth: report.depth,
    scoreCp: primaryCp,
    scoreMate: report.mate,
    whiteScoreCp: whiteScore(primaryCp),
    whiteScoreMate: whiteScore(report.mate),
    bestMove: bestMove ?? (lines[0]?.bestMove || null),
    multiPvLines: lines,
    candidates,
    nodes,
    nps: elapsedMs > 0 ? Math.round((nodes * 1000) / elapsedMs) : undefined,
    timeMs: Math.round(elapsedMs),
    isCalculating: !report.finished,
    timestamp: Date.now(),
  };
}
