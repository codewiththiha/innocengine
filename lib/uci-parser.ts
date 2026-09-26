import type { MoveLine, EngineEvaluation, EngineCandidate } from './types';

export class UciParser {
  private currentLines: Map<number, MoveLine> = new Map();
  private currentFen: string = '';
  private currentTurn: 'w' | 'b' = 'w';
  private maxDepthSeen: number = 0;
  private currentAnalysisId: number = 0;
  private currentPositionKey: string = '';

  public reset(fen: string, analysisId: number = 0, positionKey: string = '') {
    this.currentLines.clear();
    this.currentFen = fen;
    this.currentAnalysisId = analysisId;
    this.currentPositionKey = positionKey || this.extractPositionKey(fen);
    this.maxDepthSeen = 0;
    const tokens = fen.trim().split(/\s+/);
    this.currentTurn = tokens.length > 1 && tokens[1] === 'b' ? 'b' : 'w';
  }

  public extractPositionKey(fen: string): string {
    if (!fen) return '';
    return fen.trim().split(/\s+/).slice(0, 4).join(' ');
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
    const depthMatch = line.match(/\bdepth\s+(\d+)/);
    const depth = depthMatch && depthMatch[1] ? parseInt(depthMatch[1], 10) : 0;
    if (depth > this.maxDepthSeen) {
      this.maxDepthSeen = depth;
    }

    const multiPvMatch = line.match(/\bmultipv\s+(\d+)/);
    const multiPvId = multiPvMatch && multiPvMatch[1] ? parseInt(multiPvMatch[1], 10) : 1;

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

    const nodesMatch = line.match(/\bnodes\s+(\d+)/);
    const nodes = nodesMatch && nodesMatch[1] ? parseInt(nodesMatch[1], 10) : undefined;

    const npsMatch = line.match(/\bnps\s+(\d+)/);
    const nps = npsMatch && npsMatch[1] ? parseInt(npsMatch[1], 10) : undefined;

    const timeMatch = line.match(/\btime\s+(\d+)/);
    const timeMs = timeMatch && timeMatch[1] ? parseInt(timeMatch[1], 10) : undefined;

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

    const candidates: EngineCandidate[] = sortedLines
      .filter((l) => l.bestMove && l.bestMove.length >= 4)
      .map((l) => ({
        pvId: l.id,
        from: l.bestMove.substring(0, 2),
        to: l.bestMove.substring(2, 4),
        promotion: l.bestMove.length > 4 ? l.bestMove[4] : undefined,
        depth: l.depth,
        scoreCp: l.scoreCp,
        scoreMate: l.scoreMate,
        pv: l.pv,
      }));

    return {
      analysisId: this.currentAnalysisId,
      positionKey: this.currentPositionKey,
      fen: this.currentFen,
      depth: this.maxDepthSeen,
      scoreCp: primaryLine.scoreCp,
      scoreMate: primaryLine.scoreMate,
      bestMove: primaryLine.bestMove,
      multiPvLines: sortedLines,
      candidates,
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

    const candidates: EngineCandidate[] = sortedLines
      .filter((l) => l.bestMove && l.bestMove.length >= 4)
      .map((l) => ({
        pvId: l.id,
        from: l.bestMove.substring(0, 2),
        to: l.bestMove.substring(2, 4),
        promotion: l.bestMove.length > 4 ? l.bestMove[4] : undefined,
        depth: l.depth,
        scoreCp: l.scoreCp,
        scoreMate: l.scoreMate,
        pv: l.pv,
      }));

    return {
      analysisId: this.currentAnalysisId,
      positionKey: this.currentPositionKey,
      fen: this.currentFen,
      depth: this.maxDepthSeen,
      scoreCp: primaryLine ? primaryLine.scoreCp : null,
      scoreMate: primaryLine ? primaryLine.scoreMate : null,
      bestMove: bestMove !== '(none)' ? bestMove : primaryLine ? primaryLine.bestMove : null,
      multiPvLines: sortedLines,
      candidates,
      isCalculating: false,
      timestamp: Date.now(),
    };
  }
}
