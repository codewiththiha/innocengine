import type { MoveLine, EngineEvaluation, EngineCandidate } from './types';

export class UciParser {
  private currentLines: Map<number, MoveLine> = new Map();
  private currentFen: string = '';
  private maxDepthSeen: number = 0;
  private currentAnalysisId: number = 0;
  private currentPositionKey: string = '';

  public reset(fen: string, analysisId: number = 0, positionKey: string = '') {
    this.currentLines.clear();
    this.maxDepthSeen = 0;
    this.currentFen = fen;
    this.currentAnalysisId = analysisId;
    this.currentPositionKey = positionKey;
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
      scoreCp = parseInt(cpMatch[1], 10);
    }

    const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
    if (mateMatch && mateMatch[1]) {
      scoreMate = parseInt(mateMatch[1], 10);
    }

    const nodesMatch = line.match(/\bnodes\s+(\d+)/);
    const nodes = nodesMatch && nodesMatch[1] ? parseInt(nodesMatch[1], 10) : undefined;

    const npsMatch = line.match(/\bnps\s+(\d+)/);
    const nps = npsMatch && npsMatch[1] ? parseInt(npsMatch[1], 10) : undefined;

    const timeMatch = line.match(/\btime\s+(\d+)/);
    const timeMs = timeMatch && timeMatch[1] ? parseInt(timeMatch[1], 10) : undefined;

    let bestMove: string = '';
    let pvMoves: string[] = [];

    const pvIndex = line.indexOf(' pv ');
    if (pvIndex !== -1) {
      const pvStr = line.substring(pvIndex + 4).trim();
      pvMoves = pvStr ? pvStr.split(/\s+/).filter(Boolean) : [];
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
    const isBlack = this.currentFen.split(' ')[1] === 'b';
    const whiteScoreCp = primaryLine.scoreCp !== null ? (isBlack ? -primaryLine.scoreCp : primaryLine.scoreCp) : null;
    const whiteScoreMate = primaryLine.scoreMate !== null ? (isBlack ? -primaryLine.scoreMate : primaryLine.scoreMate) : null;

    const candidates = this.buildCandidates(sortedLines);

    return {
      analysisId: this.currentAnalysisId,
      positionKey: this.currentPositionKey,
      fen: this.currentFen,
      depth: this.maxDepthSeen,
      scoreCp: primaryLine.scoreCp,
      scoreMate: primaryLine.scoreMate,
      whiteScoreCp,
      whiteScoreMate,
      bestMove: primaryLine.bestMove,
      multiPvLines: sortedLines.map((line) => ({
        ...line,
        whiteScoreCp: line.scoreCp !== null ? (isBlack ? -line.scoreCp : line.scoreCp) : null,
        whiteScoreMate: line.scoreMate !== null ? (isBlack ? -line.scoreMate : line.scoreMate) : null,
      })),
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
    const isBlack = this.currentFen.split(' ')[1] === 'b';
    const whiteScoreCp = primaryLine && primaryLine.scoreCp !== null ? (isBlack ? -primaryLine.scoreCp : primaryLine.scoreCp) : null;
    const whiteScoreMate = primaryLine && primaryLine.scoreMate !== null ? (isBlack ? -primaryLine.scoreMate : primaryLine.scoreMate) : null;

    let candidates = this.buildCandidates(sortedLines);

    // CRITICAL: When the engine finishes search and emits `bestmove <uci>`, that move is the
    // authoritative choice of the engine (e.g. human blunder selection in Patricia or Maia).
    // If candidates[0] does not match bestMove, promote or inject bestMove as candidates[0]!
    if (bestMove && bestMove !== '(none)' && bestMove.length >= 4) {
      const matchIdx = candidates.findIndex(
        (c) => c.from === bestMove.substring(0, 2) && c.to === bestMove.substring(2, 4)
      );

      if (matchIdx > 0) {
        const [chosen] = candidates.splice(matchIdx, 1);
        if (chosen) {
          candidates.unshift({
            ...chosen,
            pvId: 1,
          });
          candidates.forEach((c, idx) => {
            c.pvId = idx + 1;
          });
        }
      } else if (matchIdx === -1) {
        const chosenCandidate: EngineCandidate = {
          pvId: 1,
          from: bestMove.substring(0, 2),
          to: bestMove.substring(2, 4),
          promotion: bestMove.length > 4 ? bestMove[4] : undefined,
          depth: this.maxDepthSeen,
          scoreCp: null,
          scoreMate: null,
          pv: [bestMove],
        };
        candidates.unshift(chosenCandidate);
        candidates.forEach((c, idx) => {
          c.pvId = idx + 1;
        });
      }
    }

    return {
      analysisId: this.currentAnalysisId,
      positionKey: this.currentPositionKey,
      fen: this.currentFen,
      depth: this.maxDepthSeen,
      scoreCp: primaryLine ? primaryLine.scoreCp : null,
      scoreMate: primaryLine ? primaryLine.scoreMate : null,
      whiteScoreCp,
      whiteScoreMate,
      bestMove: bestMove !== '(none)' ? bestMove : primaryLine ? primaryLine.bestMove : null,
      multiPvLines: sortedLines.map((line) => ({
        ...line,
        whiteScoreCp: line.scoreCp !== null ? (isBlack ? -line.scoreCp : line.scoreCp) : null,
        whiteScoreMate: line.scoreMate !== null ? (isBlack ? -line.scoreMate : line.scoreMate) : null,
      })),
      candidates,
      isCalculating: false,
      timestamp: Date.now(),
    };
  }

  private buildCandidates(lines: MoveLine[]): EngineCandidate[] {
    return lines
      .filter((l) => l.bestMove && l.bestMove.length >= 4)
      .map((l) => {
        let continuation: { from: string; to: string } | undefined;
        if (l.pv.length >= 2 && l.pv[1] && l.pv[1].length >= 4) {
          continuation = {
            from: l.pv[1].substring(0, 2),
            to: l.pv[1].substring(2, 4),
          };
        }

        return {
          pvId: l.id,
          from: l.bestMove.substring(0, 2),
          to: l.bestMove.substring(2, 4),
          promotion: l.bestMove.length > 4 ? l.bestMove[4] : undefined,
          depth: l.depth,
          scoreCp: l.scoreCp,
          scoreMate: l.scoreMate,
          pv: l.pv,
          continuation,
        };
      });
  }
}
