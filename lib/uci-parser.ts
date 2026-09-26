import type { MoveLine, EngineEvaluation } from './types';

export class UciParser {
  private currentLines: Map<number, MoveLine> = new Map();
  private currentFen: string = '';
  private currentTurn: 'w' | 'b' = 'w';
  private maxDepthSeen: number = 0;

  constructor() {}

  public reset(fen: string) {
    this.currentLines.clear();
    this.currentFen = fen;
    this.maxDepthSeen = 0;
    const tokens = fen.trim().split(/\s+/);
    this.currentTurn = tokens.length > 1 && tokens[1] === 'b' ? 'b' : 'w';
  }

  public parseLine(line: string): Partial<EngineEvaluation> | null {
    const trimmed = line.trim();

    if (trimmed.startsWith('info') && trimmed.includes(' score ')) {
      return this.parseInfoLine(trimmed);
    }

    if (trimmed.startsWith('bestmove')) {
      return this.parseBestMoveLine(trimmed);
    }

    return null;
  }

  private parseInfoLine(line: string): Partial<EngineEvaluation> {
    // Extract depth
    const depthMatch = line.match(/\bdepth\s+(\d+)/);
    const depth = depthMatch && depthMatch[1] ? parseInt(depthMatch[1], 10) : 0;
    if (depth > this.maxDepthSeen) {
      this.maxDepthSeen = depth;
    }

    // Extract multipv index (default 1)
    const multiPvMatch = line.match(/\bmultipv\s+(\d+)/);
    const multiPvId = multiPvMatch && multiPvMatch[1] ? parseInt(multiPvMatch[1], 10) : 1;

    // Extract score
    let scoreCp: number | null = null;
    let scoreMate: number | null = null;

    const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
    if (cpMatch && cpMatch[1]) {
      const rawCp = parseInt(cpMatch[1], 10);
      scoreCp = this.currentTurn === 'b' ? -rawCp : rawCp;
    }

    const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
    if (mateMatch && mateMatch[1]) {
      const rawMate = parseInt(mateMatch[1], 10);
      scoreMate = this.currentTurn === 'b' ? -rawMate : rawMate;
    }

    // Extract nodes, nps, time
    const nodesMatch = line.match(/\bnodes\s+(\d+)/);
    const nodes = nodesMatch && nodesMatch[1] ? parseInt(nodesMatch[1], 10) : undefined;

    const npsMatch = line.match(/\bnps\s+(\d+)/);
    const nps = npsMatch && npsMatch[1] ? parseInt(npsMatch[1], 10) : undefined;

    const timeMatch = line.match(/\btime\s+(\d+)/);
    const timeMs = timeMatch && timeMatch[1] ? parseInt(timeMatch[1], 10) : undefined;

    // Extract PV (principal variation)
    const pvIndex = line.indexOf(' pv ');
    let pvMoves: string[] = [];
    let bestMove = '';

    if (pvIndex !== -1) {
      const pvString = line.substring(pvIndex + 4).trim();
      pvMoves = pvString.split(/\s+/).filter((m) => m.length >= 4);
      if (pvMoves.length > 0 && pvMoves[0]) {
        bestMove = pvMoves[0];
      }
    }

    const moveLine: MoveLine = {
      id: multiPvId,
      depth,
      scoreCp,
      scoreMate,
      bestMove,
      pv: pvMoves,
      nodes,
      nps,
      timeMs,
    };
    this.currentLines.set(multiPvId, moveLine);

    const sortedLines = Array.from(this.currentLines.values()).sort((a, b) => a.id - b.id);
    const primaryLine = sortedLines[0] || moveLine;

    return {
      fen: this.currentFen,
      depth: this.maxDepthSeen,
      scoreCp: primaryLine.scoreCp,
      scoreMate: primaryLine.scoreMate,
      bestMove: primaryLine.bestMove,
      multiPvLines: sortedLines,
      nodes,
      nps,
      timeMs,
      isCalculating: true,
      timestamp: Date.now(),
    };
  }

  private parseBestMoveLine(line: string): Partial<EngineEvaluation> {
    const parts = line.split(/\s+/);
    const bestMove = parts.length > 1 && parts[1] ? parts[1] : '';
    const sortedLines = Array.from(this.currentLines.values()).sort((a, b) => a.id - b.id);
    const primaryLine = sortedLines[0];

    return {
      fen: this.currentFen,
      depth: this.maxDepthSeen,
      scoreCp: primaryLine ? primaryLine.scoreCp : null,
      scoreMate: primaryLine ? primaryLine.scoreMate : null,
      bestMove: bestMove !== '(none)' ? bestMove : primaryLine ? primaryLine.bestMove : null,
      multiPvLines: sortedLines,
      isCalculating: false,
      timestamp: Date.now(),
    };
  }
}
