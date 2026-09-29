import { Chess } from 'chess.js';
import { normalizeFenForBook, pgnToSans } from './index';
import type { OpeningDefinition, OpeningSide } from './types';

export interface OpeningProgress {
  openingId: string;
  name: string;
  eco?: string;
  side: OpeningSide;
  /** Plies of this line that the game has actually reached. */
  reachedPlies: number;
  /** Total plies the catalogue knows for this line. */
  linePlies: number;
  /** San of the move the line recommends here, null at the end of a line. */
  nextSan: string | null;
  /** Every catalogue line passing through this position. */
  candidateLines: number;
  /** True once the game has left every line it was following. */
  offBook: boolean;
}

interface PositionRecord {
  definition: OpeningDefinition;
  ply: number;
  linePlies: number;
  nextSan: string | null;
}

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * Names the opening the game is actually in, on either player's turn.
 *
 * `OpeningIndex` answers a different question: it only records the positions
 * where a repertoire would recommend a move, which leaves the opponent's turns
 * unnamed. The bubble has to label every position, so this walks each line
 * again and keeps every position along it, including the last.
 */
export class OpeningTracker {
  private readonly byFen = new Map<string, PositionRecord[]>();

  constructor(definitions: OpeningDefinition[]) {
    for (const definition of definitions) {
      if (definition.enabled === false) continue;
      try {
        this.indexDefinition(definition);
      } catch (error) {
        // A malformed line must not take the whole tracker down; the index
        // build already reports it loudly at startup.
        console.error(`[OpeningTracker] Skipping "${definition.id}":`, error);
      }
    }
  }

  private indexDefinition(definition: OpeningDefinition): void {
    const chess = new Chess(definition.startFen || START_FEN);
    const sans = pgnToSans(definition.pgn);

    sans.forEach((san, index) => {
      const fen = normalizeFenForBook(chess.fen());
      let move;
      try {
        move = chess.move(san);
      } catch (error) {
        throw new Error(`illegal move "${san}" at ply ${index + 1}: ${error}`);
      }
      if (!move) throw new Error(`move "${san}" could not be played at ply ${index + 1}`);

      const records = this.byFen.get(fen) ?? [];
      records.push({ definition, ply: index + 1, linePlies: sans.length, nextSan: move.san });
      this.byFen.set(fen, records);
    });

    // The position after the final move is still part of this line, but it has
    // no move to recommend.
    const tail = normalizeFenForBook(chess.fen());
    const tailRecords = this.byFen.get(tail) ?? [];
    tailRecords.push({ definition, ply: sans.length, linePlies: sans.length, nextSan: null });
    this.byFen.set(tail, tailRecords);
  }

  public track(fen: string): OpeningProgress | null {
    if (!fen) return null;
    const records = this.byFen.get(normalizeFenForBook(fen));
    if (!records || records.length === 0) return null;

    // Prefer how far the game has travelled over how deep the line goes, then
    // the more specific line, then alphabetical order for a stable label.
    const best = records.slice().sort((left, right) => {
      if (left.ply !== right.ply) return right.ply - left.ply;
      if (left.linePlies !== right.linePlies) return right.linePlies - left.linePlies;
      const leftPriority = left.definition.priority ?? 0;
      const rightPriority = right.definition.priority ?? 0;
      if (leftPriority !== rightPriority) return rightPriority - leftPriority;
      return left.definition.id.localeCompare(right.definition.id);
    })[0];

    if (!best) return null;

    return {
      openingId: best.definition.id,
      name: best.definition.name,
      eco: best.definition.eco,
      side: best.definition.side,
      reachedPlies: best.ply,
      linePlies: best.linePlies,
      nextSan: best.nextSan,
      candidateLines: records.length,
      offBook: best.nextSan === null,
    };
  }

  public get size(): number {
    return this.byFen.size;
  }
}
