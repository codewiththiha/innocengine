import { Chess } from 'chess.js';

export interface HumanPolicyCandidate {
  uci: string;
  san: string;
  score: number;
  probability: number;
  winProb: number;
}

export const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 20000,
};

const CENTER_SQUARES = new Set(['d4', 'e4', 'd5', 'e5', 'c4', 'f4', 'c5', 'f5']);
const EXTENDED_CENTER = new Set(['c3', 'd3', 'e3', 'f3', 'c6', 'd6', 'e6', 'f6']);
const RIM_SQUARES = new Set(['a3', 'h3', 'a6', 'h6', 'a4', 'h4', 'a5', 'h5']);

/**
 * Finds the coordinate of a given King on the board.
 * file: 0..7 (a..h), rank: 0..7 (1..8)
 */
export function findKingPosition(
  chess: Chess,
  color: 'w' | 'b'
): { file: number; rank: number } | null {
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    const row = board[r];
    if (!row) continue;
    for (let c = 0; c < 8; c++) {
      const p = row[c];
      if (p && p.type === 'k' && p.color === color) {
        return { file: c, rank: 7 - r };
      }
    }
  }
  return null;
}

/**
 * Extracts standard 12-plane bitboard representation: [P, N, B, R, Q, K, p, n, b, r, q, k]
 */
export function extractBoardTensor(chessInstance: Chess): Float32Array {
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

/**
 * Calculates total material value of pieces currently hanging/attacked for a side.
 * Evaluates whether pieces left behind are attacked by lower-value pieces or completely undefended.
 */
export function calculateHangingThreats(chess: Chess, sideToDefend: 'w' | 'b'): number {
  let hangingPenalty = 0;
  const oppReplies = chess.moves({ verbose: true });
  const board = chess.board();

  for (let r = 0; r < 8; r++) {
    const row = board[r];
    if (!row) continue;
    for (let c = 0; c < 8; c++) {
      const piece = row[c];
      if (piece && piece.color === sideToDefend && piece.type !== 'k') {
        const sq = `${String.fromCharCode(97 + c)}${8 - r}`;
        const attackers = oppReplies.filter((r) => r.to === sq);

        if (attackers.length > 0) {
          const pieceVal = PIECE_VALUES[piece.type] || 100;
          // Sort attackers to find lowest-value attacker (e.g. Pawn before Queen)
          attackers.sort((a, b) => (PIECE_VALUES[a.piece] || 100) - (PIECE_VALUES[b.piece] || 100));
          const lowestAttacker = attackers[0];
          const lowestAttackerVal = PIECE_VALUES[lowestAttacker?.piece || 'p'] || 100;

          // Check if piece is defended by simulating the capture and checking recaptures
          if (lowestAttacker) {
            try {
              chess.move(lowestAttacker);
              const ourRecaptures = chess.moves({ verbose: true }).filter((m) => m.to === sq);
              chess.undo();

              if (ourRecaptures.length === 0) {
                // Completely hanging piece (e.g. Queen left undefended)
                hangingPenalty += pieceVal;
              } else if (pieceVal > lowestAttackerVal) {
                // Bad trade exposure (e.g. Rook or Pawn attacking Queen, even if defended)
                hangingPenalty += (pieceVal - lowestAttackerVal);
              }
            } catch (_) {
              // Fail-safe in case of any move simulation error
            }
          }
        }
      }
    }
  }

  return hangingPenalty;
}

/**
 * Evaluates human move policy conditioned on target Elo and position features.
 * Features:
 * 1. Zero-search lookahead (nodes: 1)
 * 2. Static Exchange Evaluation (SEE) defense against blunders
 * 3. Repetition & Draw Avoidance: Refuses 3-fold repetition when ahead in material
 * 4. Stalemate Prevention: Strictly penalizes stalemate when holding a decisive advantage
 * 5. Endgame Mating Drive: Directs friendly King opposition, corners enemy King, and restricts mobility
 * 6. Global Board Threat & Hanging Piece Defense: Never ignores attacked Queens or major pieces
 */
export function evaluateHumanPolicy(
  fen: string,
  targetElo: number,
  multiPv: number = 1,
  recentPositions: string[] = []
): HumanPolicyCandidate[] {
  try {
    const chess = new Chess(fen);
    extractBoardTensor(chess);
    const legalMoves = chess.moves({ verbose: true });
    if (legalMoves.length === 0) return [];

    const turn = chess.turn();
    const oppColor: 'w' | 'b' = turn === 'w' ? 'b' : 'w';

    // Calculate material distribution
    let ourMaterial = 0;
    let oppMaterial = 0;
    const board = chess.board();
    for (let r = 0; r < 8; r++) {
      const row = board[r];
      if (!row) continue;
      for (let c = 0; c < 8; c++) {
        const p = row[c];
        if (!p) continue;
        const val = PIECE_VALUES[p.type] || 100;
        if (p.color === turn) {
          if (p.type !== 'k') ourMaterial += val;
        } else {
          if (p.type !== 'k') oppMaterial += val;
        }
      }
    }

    const materialDiff = ourMaterial - oppMaterial;
    // Endgame when total non-pawn material is <= 1500 per side
    const isEndgame = ourMaterial <= 1500 && oppMaterial <= 1500;
    const isDecisiveAdvantage = materialDiff >= 200;

    const elo = Math.max(600, Math.min(2600, targetElo));
    const eloRatio = (elo - 600) / 2000; // 0.0 at 600 to 1.0 at 2600

    const tokens = fen.trim().split(/\s+/);
    const fullmove = parseInt(tokens[5] || '1', 10);
    const isOpening = fullmove <= 10;

    const scoredMoves = legalMoves.map((m) => {
      let score = 0;
      const uci = `${m.from}${m.to}${m.promotion || ''}`;

      // Checkmate in 1 (highest priority)
      if (m.san.includes('#')) {
        return { uci, san: m.san, score: 50000 };
      }

      // Simulate move to evaluate post-move state
      chess.move(m);

      // CRITICAL: Evaluate hanging threats across ALL friendly pieces after move 'm'
      // This prevents blundering an attacked Queen/Rook by moving another piece elsewhere
      const postMoveThreats = calculateHangingThreats(chess, turn);

      const isStalemate = chess.isStalemate();
      const nextPosKey = chess.fen().split(' ').slice(0, 4).join(' ');
      const isRepetition = recentPositions.length > 0 && recentPositions.includes(nextPosKey);

      // 1. Stalemate prevention
      if (isStalemate) {
        chess.undo();
        if (isDecisiveAdvantage) {
          return { uci, san: m.san, score: -50000 }; // Never stalemate when winning!
        }
        if (materialDiff <= -200) {
          return { uci, san: m.san, score: 15000 }; // Stalemate swindle when losing is great
        }
      }

      // 2. Threefold repetition / draw avoidance
      if (isRepetition) {
        if (isDecisiveAdvantage) {
          score -= 35000; // Strictly avoid repeating moves when winning!
        } else if (materialDiff <= -200) {
          score += 12000; // Welcome draw by repetition when losing
        }
      }

      // 3. Static Exchange Evaluation (SEE) defense against blunders
      const capturedVal = m.captured ? (PIECE_VALUES[m.captured] || 100) : 0;
      const myPieceVal = PIECE_VALUES[m.piece] || 100;
      const oppReplies = chess.moves({ verbose: true });
      const directCaptures = oppReplies.filter((r) => r.to === m.to);

      let netExchange = capturedVal;
      let isHanging = false;

      if (directCaptures.length > 0) {
        directCaptures.sort((a, b) => (PIECE_VALUES[a.piece] || 100) - (PIECE_VALUES[b.piece] || 100));
        const lowestAttacker = directCaptures[0];
        const oppAttackerVal = PIECE_VALUES[lowestAttacker?.piece || 'p'] || 100;

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

      if (netExchange > 0) {
        score += netExchange * 2.2;
      } else if (netExchange < 0) {
        if (netExchange <= -400) {
          score += netExchange * (3.0 + eloRatio * 2.0);
        } else {
          score += netExchange * (1.8 + eloRatio * 1.5);
        }
      }

      // Heavily penalize moves that leave hanging pieces behind (e.g. leaving Queen under attack)
      score -= postMoveThreats * 2.5;

      // 4. Winning Endgame Heuristics (Converting advantage, opposition, mating net)
      if (isEndgame && isDecisiveAdvantage) {
        const myKing = findKingPosition(chess, turn);
        const oppKing = findKingPosition(chess, oppColor);

        if (myKing && oppKing) {
          // King Proximity (Opposition): Friendly king marches to help checkmate
          const kingDist = Math.max(Math.abs(myKing.file - oppKing.file), Math.abs(myKing.rank - oppKing.rank));
          score += (7 - kingDist) * 45;

          // Cornering the enemy king towards the board edge
          const oppEdgeDist = Math.min(oppKing.file, 7 - oppKing.file, oppKing.rank, 7 - oppKing.rank);
          score += (3 - oppEdgeDist) * 55;

          // Restricting enemy king escape squares
          const oppKingLegalMoves = oppReplies.filter((r) => r.piece === 'k').length;
          score += (8 - oppKingLegalMoves) * 25;
        }

        // Passed pawn advancement towards 8th rank
        if (m.piece === 'p') {
          const toRank = parseInt(m.to[1] ?? '1', 10);
          const rankFrom0 = turn === 'w' ? (toRank - 1) : (8 - toRank);
          score += rankFrom0 * 40;
        }

        // Smart endgame checks: Only give check if enemy King is already on the edge or restricted
        if (m.san.includes('+')) {
          const currentOppKing = findKingPosition(chess, oppColor);
          const edgeDist = currentOppKing
            ? Math.min(currentOppKing.file, 7 - currentOppKing.file, currentOppKing.rank, 7 - currentOppKing.rank)
            : 2;
          if (edgeDist === 0) {
            score += 70; // Check on the edge converges into mate
          } else {
            score -= 60; // Do NOT spam aimless checks in open center that allow King to flee
          }
        }
      } else {
        // Middlegame / Opening safe check reward
        if (m.san.includes('+')) {
          if (netExchange >= 0 && !isHanging) {
            score += 35 + (1 - eloRatio) * 20;
          } else {
            score -= 150;
          }
        }

        // Castling (King Safety)
        if (m.flags.includes('k') || m.flags.includes('q')) {
          score += 60 + eloRatio * 40;
        }

        // Premature King move in opening
        if (isOpening && m.piece === 'k' && !m.flags.includes('k') && !m.flags.includes('q')) {
          score -= 60;
        }

        // Center Control & Occupation
        if (CENTER_SQUARES.has(m.to)) {
          score += 30 + eloRatio * 20;
        } else if (EXTENDED_CENTER.has(m.to)) {
          score += 15 + eloRatio * 10;
        }

        // Opening Principles
        if (isOpening) {
          if (
            m.piece === 'p' &&
            (m.to === 'e4' || m.to === 'd4' || m.to === 'c4' || m.to === 'e5' || m.to === 'd5' || m.to === 'c5')
          ) {
            score += 45 + eloRatio * 25;
          }

          if (m.piece === 'n' || m.piece === 'b') {
            const backRank = m.color === 'w' ? '1' : '8';
            if (m.from[1] === backRank && m.to[1] !== backRank) {
              score += 40 + eloRatio * 30;
            }
          }

          if (m.piece === 'n' && RIM_SQUARES.has(m.to)) {
            score -= 25 + eloRatio * 35;
          }

          if (m.piece === 'q' && !m.captured && fullmove <= 6) {
            score -= eloRatio * 60;
          }
        }
      }

      // Promotion bonus
      if (m.promotion) {
        score += 900;
      }

      chess.undo();
      return { uci, san: m.san, score };
    });

    // Softmax probabilities
    const maxScore = Math.max(...scoredMoves.map((m) => m.score));
    const temperature = 0.85 - eloRatio * 0.60;
    const expScores = scoredMoves.map((m) => {
      const z = (m.score - maxScore) / (temperature * 50);
      return Math.exp(Math.max(-25, Math.min(25, z)));
    });
    const sumExp = expScores.reduce((acc, v) => acc + v, 0);

    const movesWithProb: HumanPolicyCandidate[] = scoredMoves.map((m, i) => {
      const expVal = expScores[i] ?? 0;
      const prob = sumExp > 0 ? expVal / sumExp : 1 / scoredMoves.length;
      const winP = 1 / (1 + Math.exp(-m.score / 250));
      return {
        uci: m.uci,
        san: m.san,
        score: m.score,
        probability: Math.round(prob * 1000) / 1000,
        winProb: Math.max(0.05, Math.min(0.95, Math.round(winP * 1000) / 1000)),
      };
    });

    movesWithProb.sort((a, b) => b.probability - a.probability);
    return movesWithProb.slice(0, Math.max(1, multiPv));
  } catch (_) {
    return [];
  }
}
