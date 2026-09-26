import { Chess } from 'chess.js';
import type { OpeningDefinition, BookPositionEntry } from './types';

export function normalizeFenForBook(fen: string): string {
  const tokens = fen.trim().split(/\s+/);
  const placement = tokens[0] ?? '';
  const turn = tokens[1] ?? 'w';
  const castling = tokens[2] ?? '-';
  const enPassant = tokens[3] ?? '-';
  return `${placement} ${turn} ${castling} ${enPassant}`;
}

export function pgnToSans(pgn: string): string[] {
  return pgn
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\d+\.{1,3}/g, ' ')
    .replace(/(1-0|0-1|1\/2-1\/2|\*)/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export class OpeningIndex {
  private byFen = new Map<string, BookPositionEntry[]>();
  private definitions: OpeningDefinition[] = [];

  constructor(definitions: OpeningDefinition[]) {
    this.build(definitions);
  }

  public build(definitions: OpeningDefinition[]) {
    this.byFen.clear();
    this.definitions = definitions.filter((d) => d.enabled !== false);

    for (const def of this.definitions) {
      try {
        this.indexDefinition(def);
      } catch (err) {
        console.error(`[OpeningIndex] Failed to index opening "${def.id}":`, err);
        throw err;
      }
    }
  }

  private indexDefinition(def: OpeningDefinition) {
    const chess = new Chess(def.startFen);
    const sans = pgnToSans(def.pgn);
    const line: string[] = [];

    sans.forEach((san, index) => {
      const beforeFen = normalizeFenForBook(chess.fen());
      const turn = beforeFen.split(' ')[1] as 'w' | 'b';
      let move;
      try {
        move = chess.move(san);
      } catch (err) {
        throw new Error(`Illegal move "${san}" in opening "${def.id}" at ply ${index + 1}: ${err}`);
      }

      if (!move) {
        throw new Error(`Move "${san}" could not be played in opening "${def.id}" at ply ${index + 1}`);
      }

      line.push(move.san);
      const uci = `${move.from}${move.to}${move.promotion ?? ''}`;

      // Only index recommendations for the intended side of the repertoire!
      // White repertoires ('w') only recommend moves on White's turn ('w').
      // Black repertoires ('b') only recommend moves on Black's turn ('b').
      // Universal repertoires ('any') recommend moves on either turn.
      const isRecommendationForSide = def.side === 'any' || def.side === turn;

      if (isRecommendationForSide) {
        const entry: BookPositionEntry = {
          openingId: def.id,
          openingName: def.name,
          side: def.side,
          fen: beforeFen,
          uci,
          san: move.san,
          ply: index + 1,
          line: [...line],
          risk: def.risk,
          categories: def.categories,
          meme: def.meme,
          trap: def.trap,
          priority: def.priority ?? 0,
        };

        const existing = this.byFen.get(beforeFen) ?? [];
        existing.push(entry);
        this.byFen.set(beforeFen, existing);
      }
    });
  }

  public lookup(fen: string): BookPositionEntry[] {
    const key = normalizeFenForBook(fen);
    return this.byFen.get(key)?.slice() ?? [];
  }

  public lookupFiltered(
    fen: string,
    filter?: (entry: BookPositionEntry) => boolean
  ): BookPositionEntry[] {
    const entries = this.lookup(fen);
    if (!filter) return entries;
    return entries.filter(filter);
  }

  public getDefinitions(): OpeningDefinition[] {
    return this.definitions.slice();
  }

  public getOpeningById(id: string): OpeningDefinition | undefined {
    return this.definitions.find((d) => d.id === id);
  }
}
