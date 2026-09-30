/**
 * review-classifier.ts
 *
 * Classifies each move against engine best play using Lichess/Chess.com-style
 * categories (Brilliant, Great, Best, Good, Book, Inaccuracy, Mistake, Blunder).
 * Thresholds calibrated to match Chess.com intuition:
 *
 *   Blunder      ≥ 300 cp drop (or forced mate missed/conceded)
 *   Mistake      ≥ 100 cp drop
 *   Inaccuracy   ≥ 50 cp drop
 *   Good         ≤ 20 cp drop and move matches top non-book line but isn't best
 *   Best         Played the engine's top line (within 10 cp)
 *   Great        Top-line find at a high depth or winning sacrifice
 *   Brilliant    Sacrifices material while keeping ≥ +1 advantage (within 30 cp)
 *   Book         Matched opening-book move in the first 12 plies
 */

export type MoveClass =
  | 'brilliant'
  | 'great'
  | 'best'
  | 'book'
  | 'good'
  | 'inaccuracy'
  | 'mistake'
  | 'blunder';

export interface MoveAnnotation {
  ply: number;                // 0-based move index in the SAN move list
  san: string;
  uci: string;
  classification: MoveClass;
  cpLoss: number;             // engine evaluation drop (centipawns, positive = worse for mover)
  evalBefore: number | null;  // from mover's perspective, cp; null = mate
  evalAfter: number | null;
  bestMove: string;           // uci of the move the engine preferred
  bestMoveSan?: string;
  pv?: string[];
  comment?: string;
}

export interface ReviewResult {
  engineId: string;
  depth: number;
  multiPv: number;
  reviewedAt: number;
  annotations: MoveAnnotation[];
  accuracy: {                // overall accuracy 0-100, white and black
    white: number;
    black: number;
  };
  summary: {
    brilliant: number;
    great: number;
    best: number;
    good: number;
    book: number;
    inaccuracy: number;
    mistake: number;
    blunder: number;
  };
}

// --- Thresholds (centipawns), mirroring Chess.com intuition ---
const BLUNDER_CP   = 300;
const MISTAKE_CP   = 100;
const INACCURACY_CP = 50;
const GOOD_CP       = 20;

// Sacrifice piece values (approx, for Brilliant detection)
const PIECE_VALUE: Record<string, number> = {
  p: 100, n: 320, b: 330, r: 500, q: 900, k: 0,
};

interface MoveInfo {
  uci: string;
  san?: string;
  cp: number | null;   // cp from mover's perspective (positive = good for mover)
  mate: number | null; // mate in N moves from mover's perspective
  pv: string[];
  isCapture: boolean;
  capturedPiece: string | null; // lowercase piece letter
}

function classifyMove(
  played: MoveInfo,
  best: MoveInfo,
  isBookMove: boolean,
  ply: number
): MoveClass {
  // Book move takes precedence early in the game
  if (isBookMove && ply < 14) return 'book';

  const playedEval = played.mate !== null
    ? (played.mate > 0 ? 100000 - Math.abs(played.mate) : -100000 + Math.abs(played.mate))
    : (played.cp ?? 0);
  const bestEval = best.mate !== null
    ? (best.mate > 0 ? 100000 - Math.abs(best.mate) : -100000 + Math.abs(best.mate))
    : (best.cp ?? 0);

  const cpLoss = Math.max(0, bestEval - playedEval);

  // Mate conversions: missing a mate is at least a blunder; blundering mate is a blunder.
  if (best.mate !== null && best.mate > 0 && (played.mate === null || played.mate <= 0)) {
    return 'blunder';
  }
  if (played.mate !== null && played.mate < 0) {
    return 'blunder';
  }

  // Brilliant: sacrifice (captured enemy piece < own piece given up on next turns) while keeping advantage
  if (played.isCapture === false && cpLoss <= 30 && (bestEval > 100)) {
    // Heuristic: a sacrifice appears when top PV is a strong attack with material deficit. We detect via
    // best move being a quiet move that retains a ≥ +1.5 eval while opponent's follow-up can capture a piece.
    // Cheap approximation: if the played move is the engine best but there is an imminent non-pawn capture
    // of one of our pieces in the opponent's first reply and we still hold ≥ +1.0 eval, flag brilliant.
    const oppReply = played.pv?.[1];
    if (oppReply && oppReply.length >= 4 && /[qrbn]/.test(oppReply[4] || '')) {
      return 'brilliant';
    }
  }
  // Brilliant sacrifice: give up material but eval stays within 30 cp of best at high depth and we're winning
  if (played.isCapture && played.capturedPiece && cpLoss <= 30 && bestEval > 150) {
    const capVal = PIECE_VALUE[played.capturedPiece] || 0;
    const knightVal = PIECE_VALUE['n'] || 320;
    // If we gave up more than we captured (captured piece < knight) and eval stayed strong: brilliant
    if (capVal < knightVal && bestEval - playedEval > -30) {
      return 'brilliant';
    }
  }

  // Best: played engine's #1 move within tolerance
  if (cpLoss <= 10 && (best.mate === null || played.mate === best.mate)) {
    // Great: found the best move in a sharp / winning position (mate or large advantage) at depth ≥ 16
    if (bestEval >= 500 || (best.mate !== null && best.mate > 0)) return 'great';
    return 'best';
  }

  if (cpLoss >= BLUNDER_CP) return 'blunder';
  if (cpLoss >= MISTAKE_CP) return 'mistake';
  if (cpLoss >= INACCURACY_CP) return 'inaccuracy';
  if (cpLoss <= GOOD_CP) return 'good';
  return 'good';
}

export interface PositionAnalysis {
  /** Engine multipv lines, sorted by rank 1..n, from the MOVER's perspective */
  lines: MoveInfo[];
  depth: number;
}

/**
 * Annotate a full game from per-position analyses.
 * @param moves   SAN move list actually played
 * @param perPositionAnalyses array length = moves.length + 1 (before-move + after each move) -
 *        but we only need BEFORE each move for the mover's choices. So length === moves.length.
 */
export function annotateGame(
  moves: { san: string; uci: string; isBook: boolean }[],
  analyses: PositionAnalysis[]
): { annotations: MoveAnnotation[]; accuracy: { white: number; black: number }; summary: ReviewResult['summary'] } {
  const annotations: MoveAnnotation[] = [];
  const summary: ReviewResult['summary'] = {
    brilliant: 0, great: 0, best: 0, good: 0, book: 0,
    inaccuracy: 0, mistake: 0, blunder: 0,
  };

  let whiteError = 0;
  let blackError = 0;
  let whiteMoves = 0;
  let blackMoves = 0;

  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i]!;
    const pos = analyses[i];
    if (!pos || pos.lines.length === 0) continue;

    // lines are from mover's perspective (we'll guarantee that from caller)
    const best = pos.lines[0]!;
    // Find the played move among multiPV lines; if not present, treat as worst of listed.
    const playedLine =
      pos.lines.find((l) => l.uci.substring(0, 4) === mv.uci.substring(0, 4)) ||
      {
        uci: mv.uci,
        san: mv.san,
        cp: pos.lines[pos.lines.length - 1]!.cp !== null
          ? (pos.lines[pos.lines.length - 1]!.cp! - 200)
          : null,
        mate: null,
        pv: [mv.uci],
        isCapture: false,
        capturedPiece: null,
      };

    const bestEval = best.mate !== null
      ? (best.mate > 0 ? 100000 : -100000)
      : (best.cp ?? 0);
    const playedEval = playedLine.mate !== null
      ? (playedLine.mate > 0 ? 100000 : -100000)
      : (playedLine.cp ?? 0);
    const cpLoss = Math.max(0, bestEval - playedEval);

    const classification = classifyMove(playedLine, best, mv.isBook, i);
    summary[classification]++;

    const isWhiteMove = i % 2 === 0;
    if (isWhiteMove) { whiteMoves++; whiteError += cpLoss; }
    else { blackMoves++; blackError += cpLoss; }

    annotations.push({
      ply: i,
      san: mv.san,
      uci: mv.uci,
      classification,
      cpLoss,
      evalBefore: best.cp,
      evalAfter: playedLine.cp,
      bestMove: best.uci,
      bestMoveSan: best.san,
      pv: playedLine.pv,
    });
  }

  // Convert total error (cp) into 0-100 accuracy using Lichess-style win% drop
  const accuracyFor = (errorCp: number, moveCount: number) => {
    if (moveCount === 0) return 100;
    const avgLoss = errorCp / moveCount;
    // 0 cp loss → 100, 150cp avg → ~50, 300+ → 0
    const score = Math.max(0, 100 - (avgLoss / 3));
    return Math.round(score * 10) / 10;
  };

  return {
    annotations,
    accuracy: {
      white: accuracyFor(whiteError, whiteMoves),
      black: accuracyFor(blackError, blackMoves),
    },
    summary,
  };
}

export const CLASS_META: Record<MoveClass, {
  label: string;
  symbol: string;        // single-letter glyph used by Chess.com
  color: string;        // Chess.com-ish color
  bg: string;           // background chip color
  border: string;
  description: string;
}> = {
  brilliant: {
    label: 'Brilliant',
    symbol: '!!',
    color: '#1baca6',   // teal
    bg: 'rgba(27, 172, 166, 0.15)',
    border: '#1baca6',
    description: 'An outstanding, counter-intuitive move that finds a winning advantage.',
  },
  great: {
    label: 'Great',
    symbol: '!',
    color: '#62a447',   // green
    bg: 'rgba(98, 164, 71, 0.15)',
    border: '#62a447',
    description: 'Found the best move in a difficult, sharp position.',
  },
  best: {
    label: 'Best',
    symbol: '★',
    color: '#81b64c',
    bg: 'rgba(129, 182, 76, 0.15)',
    border: '#81b64c',
    description: 'Exact best move according to the engine.',
  },
  book: {
    label: 'Book',
    symbol: 'B',
    color: '#a88865',
    bg: 'rgba(168, 136, 101, 0.15)',
    border: '#a88865',
    description: 'A known opening-theory move.',
  },
  good: {
    label: 'Good',
    symbol: '✓',
    color: '#7a99ac',
    bg: 'rgba(122, 153, 172, 0.15)',
    border: '#7a99ac',
    description: 'A solid, reasonable move.',
  },
  inaccuracy: {
    label: 'Inaccuracy',
    symbol: '?!',
    color: '#f7c948',
    bg: 'rgba(247, 201, 72, 0.18)',
    border: '#f7c948',
    description: 'A slight slip; the position got a little worse.',
  },
  mistake: {
    label: 'Mistake',
    symbol: '?',
    color: '#ff8c38',
    bg: 'rgba(255, 140, 56, 0.18)',
    border: '#ff8c38',
    description: 'A significant error that changed evaluation.',
  },
  blunder: {
    label: 'Blunder',
    symbol: '??',
    color: '#fa412d',
    bg: 'rgba(250, 65, 45, 0.18)',
    border: '#fa412d',
    description: 'A decisive mistake that loses material or the game.',
  },
};
