import { Chess } from 'chess.js';
import type { AutoMoveSettings } from './types';

export interface HumanPolicyCandidate {
  uci: string;
  san: string;
  score: number;
  probability: number;
  winProb: number;
}

export const PIECE_VALUES: Record<string, number> = {
  p: 100,
  n: 300,
  b: 320,
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
 * Calculates worst immediate material loss (cp) if opponent gets one free reply after `uci`.
 */
export function immediateBlunderCost(chess: Chess, uci: string): number {
  const from = uci.slice(0, 2);
  const to = uci.slice(2, 4);
  const promotion = uci[4];
  const mv = chess.move({ from, to, promotion });
  if (!mv) return Infinity; // illegal -> never playable
  let worst = 0;
  const oppCaptures = chess.moves({ verbose: true }).filter((r) => r.captured);
  for (const reply of oppCaptures) {
    if (!reply.captured) continue;
    const victim = PIECE_VALUES[reply.captured] ?? 0;
    if (victim <= worst) continue;
    const attacker = PIECE_VALUES[reply.piece] ?? 0;
    chess.move(reply);
    const canRecap = chess.moves({ verbose: true }).some((m) => m.to === reply.to);
    chess.undo();
    const loss = canRecap ? Math.max(0, victim - attacker) : victim;
    if (loss > worst) worst = loss;
  }
  chess.undo();
  return worst;
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
 * Elo-calibrated blunder budget: defines maximum centipawn loss a player at given Elo might overlook.
 * 600 Elo overlooks up to ~900cp; 2600 Elo overlooks <= ~40cp.
 */
export function blunderBudget(elo: number): number {
  const t = Math.max(0, Math.min(1, (elo - 600) / (2600 - 600)));
  return 900 - t * 860;
}

/**
 * Probability of an unforced tactical blunder occurring at a given rating.
 */
export function blunderRate(elo: number): number {
  const t = Math.max(0, Math.min(1, (elo - 600) / (2600 - 600)));
  return 0.45 * (1 - t) * (1 - t) + 0.02;
}

/**
 * Evaluates human move policy conditioned on target Elo and position features.
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
        return { uci, san: m.san, score: 50000, hang: 0 };
      }

      // Material capture value
      if (m.captured) {
        score += (PIECE_VALUES[m.captured] ?? 0) * 0.9;
      }

      // Immediate 1-ply blunder cost (hanging the moved piece)
      const hang = immediateBlunderCost(chess, uci);
      score -= hang * (0.75 + 0.25 * eloRatio);

      // Simulate move to evaluate post-move state
      chess.move(m);

      // Global board threat check (leaving other friendly pieces hanging)
      const postMoveThreats = calculateHangingThreats(chess, turn);
      score -= postMoveThreats * (0.85 + 0.35 * eloRatio);

      const isStalemate = chess.isStalemate();
      const nextPosKey = chess.fen().split(' ').slice(0, 4).join(' ');
      const isRepetition = recentPositions.length > 0 && recentPositions.includes(nextPosKey);

      // 1. Stalemate prevention
      if (isStalemate) {
        chess.undo();
        if (isDecisiveAdvantage) {
          return { uci, san: m.san, score: -50000, hang: 99999 };
        }
        if (materialDiff <= -200) {
          return { uci, san: m.san, score: 15000, hang: 0 };
        }
      }

      // 2. Threefold repetition / draw avoidance
      if (isRepetition) {
        if (isDecisiveAdvantage) {
          score -= 35000;
        } else if (materialDiff <= -200) {
          score += 12000;
        }
      }

      // 3. Winning Endgame Heuristics (Converting advantage, opposition, mating net)
      if (isEndgame && isDecisiveAdvantage) {
        const myKing = findKingPosition(chess, turn);
        const oppKing = findKingPosition(chess, oppColor);

        if (myKing && oppKing) {
          const kingDist = Math.max(Math.abs(myKing.file - oppKing.file), Math.abs(myKing.rank - oppKing.rank));
          score += (7 - kingDist) * 45;

          const oppEdgeDist = Math.min(oppKing.file, 7 - oppKing.file, oppKing.rank, 7 - oppKing.rank);
          score += (3 - oppEdgeDist) * 55;

          const oppKingLegalMoves = chess.moves({ verbose: true }).filter((r) => r.piece === 'k').length;
          score += (8 - oppKingLegalMoves) * 25;
        }

        if (m.piece === 'p') {
          const toRank = parseInt(m.to[1] ?? '1', 10);
          const rankFrom0 = turn === 'w' ? (toRank - 1) : (8 - toRank);
          score += rankFrom0 * 40;
        }

        if (m.san.includes('+')) {
          const currentOppKing = findKingPosition(chess, oppColor);
          const edgeDist = currentOppKing
            ? Math.min(currentOppKing.file, 7 - currentOppKing.file, currentOppKing.rank, 7 - currentOppKing.rank)
            : 2;
          if (edgeDist === 0) {
            score += 70;
          } else {
            score -= 60;
          }
        }
      } else {
        if (m.san.includes('+')) {
          if (hang === 0 && postMoveThreats === 0) {
            score += 25 + (1 - eloRatio) * 15;
          } else {
            score -= 150;
          }
        }

        if (m.flags.includes('k') || m.flags.includes('q')) {
          score += 60 + eloRatio * 40;
        }

        if (isOpening && m.piece === 'k' && !m.flags.includes('k') && !m.flags.includes('q')) {
          score -= 60;
        }

        if (CENTER_SQUARES.has(m.to)) {
          score += 30 + eloRatio * 20;
        } else if (EXTENDED_CENTER.has(m.to)) {
          score += 15 + eloRatio * 10;
        }

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

      if (m.promotion) {
        score += 900;
      }

      chess.undo();
      return { uci, san: m.san, score, hang: Math.max(hang, postMoveThreats) };
    });

    // Filter using Elo-calibrated blunder budget
    const budget = blunderBudget(elo);
    const allowedBlunder = Math.random() < blunderRate(elo);
    const safe = scoredMoves.filter((m) => m.hang <= budget || (allowedBlunder && m.hang <= budget + 250));
    const pool = safe.length > 0 ? safe : scoredMoves.sort((a, b) => a.hang - b.hang).slice(0, 3);

    // Softmax probabilities
    const maxScore = Math.max(...pool.map((m) => m.score));
    const temperature = 0.10 + 0.55 * (1 - eloRatio);
    const expScores = pool.map((m) => {
      const z = (m.score - maxScore) / (temperature * 100);
      return Math.exp(Math.max(-30, Math.min(0, z)));
    });
    const sumExp = expScores.reduce((acc, v) => acc + v, 0);

    const movesWithProb: HumanPolicyCandidate[] = pool.map((m, i) => {
      const expVal = expScores[i] ?? 0;
      const prob = sumExp > 0 ? expVal / sumExp : 1 / pool.length;
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

/**
 * Predicts human moves via a single ranked pass without replacement.
 * Guarantees that candidates and bestMove are strictly consistent.
 */
export function predictRanked(
  fen: string,
  targetElo: number,
  multiPv: number = 1,
  recentPositions: string[] = []
): HumanPolicyCandidate[] {
  const pool = evaluateHumanPolicy(fen, targetElo, 100, recentPositions);
  if (pool.length === 0) return [];

  const out: HumanPolicyCandidate[] = [];
  const remaining = [...pool];

  while (out.length < multiPv && remaining.length > 0) {
    const totalProb = remaining.reduce((s, m) => s + m.probability, 0);
    if (totalProb <= 0) {
      out.push(remaining.shift()!);
      continue;
    }
    let r = Math.random() * totalProb;
    let idx = 0;
    for (let i = 0; i < remaining.length; i++) {
      r -= remaining[i]!.probability;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    const [chosen] = remaining.splice(idx, 1);
    if (chosen) out.push(chosen);
  }

  return out;
}

/**
 * Deterministic think-time model for the auto-move feature.
 *
 * Timings are derived by hashing the position, never sampled at play time, so
 * the same position always yields the same think time and two runs of the same
 * game look identical. The shape of the distribution is what makes it read as
 * human: forced moves go instantly, busy middlegames take longer than sparse
 * endgames, checks and big positions take longer still, and a small share of
 * positions get a deliberate long think.
 */
export interface ThinkTimePlan {
  /** How long this position is meant to take, in milliseconds. */
  thinkMs: number;
  /** Wall-clock timestamp (ms) after which the move may be played. */
  readyAt: number;
  /** Why the number came out as it did, for the settings UI and tests. */
  reason: 'instant' | 'forced' | 'clock' | 'modelled' | 'fixed';
}

const MAX_THINK_CEILING_MS = 300_000;
/** Never spend more than this share of the remaining clock on one move. */
const CLOCK_SHARE = 0.04;

function mix32(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function clampMs(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Models one position. `clockMs` is this side's remaining clock when the UI
 * exposes it; when it is unknown the model simply does not apply the guard.
 */
export function humanThinkTimeMs(
  fen: string,
  settings: AutoMoveSettings,
  positionKey: string,
  clockMs: number | null = null
): ThinkTimePlan {
  const min = clampMs(settings.minThinkMs, 0, MAX_THINK_CEILING_MS);
  const max = Math.max(min, clampMs(settings.maxThinkMs, 0, MAX_THINK_CEILING_MS));

  if (settings.mode === 'instant') return { thinkMs: 0, readyAt: 0, reason: 'instant' };
  if (settings.mode === 'delay') {
    const fixed = clampMs(settings.delayMs, 0, MAX_THINK_CEILING_MS);
    return { thinkMs: fixed, readyAt: 0, reason: 'fixed' };
  }

  const seed = mix32(`${fen}|${positionKey}`);
  const quick = (seed & 0xff) / 255;
  const deep = ((seed >>> 8) & 0xff) / 255;

  let busy = 0.4;
  let forced = false;
  try {
    const chess = new Chess(fen);
    const pieces = (fen.split(' ')[0] ?? '').replace(/[^a-zA-Z]/g, '').length;
    const replies = chess.moves().length;
    forced = replies <= 1;
    // 32 pieces is a full board; the model treats anything under 12 as an
    // endgame where there is much less to calculate.
    busy = 0.35 + 0.5 * Math.min(1, Math.max(0, (pieces - 12) / 20));
    if (chess.inCheck()) busy += 0.15;
    if (replies > 34) busy += 0.08;
  } catch {
    // An unparseable FEN falls back to the neutral busy-ness above.
  }

  const modelled = busy * 0.75 + ((quick + deep) / 2) * 0.25;
  let thinkMs = min + (max - min) * modelled;
  if (forced) thinkMs = 0;
  else if (deep > 0.93) thinkMs = max;
  else if (quick < 0.18) thinkMs = min + (max - min) * 0.1;

  let reason: ThinkTimePlan['reason'] = forced ? 'forced' : 'modelled';
  if (clockMs !== null && clockMs > 0) {
    const budget = Math.max(60, clockMs * CLOCK_SHARE);
    if (thinkMs > budget) {
      thinkMs = budget;
      reason = 'clock';
    }
  }

  return { thinkMs: Math.round(thinkMs), readyAt: 0, reason };
}

/**
 * Caches the plan for the position currently on the board. `content.ts` clears
 * it whenever the board changes, so each move gets exactly one plan.
 */
export class HumanMovePlanner {
  private positionKey = '';
  private plan: ThinkTimePlan | null = null;

  public planFor(
    positionKey: string,
    fen: string,
    settings: AutoMoveSettings,
    now: number,
    clockMs: number | null = null
  ): ThinkTimePlan {
    if (!this.plan || this.positionKey !== positionKey) {
      const thought = humanThinkTimeMs(fen, settings, positionKey, clockMs);
      this.plan = { ...thought, readyAt: now + thought.thinkMs };
      this.positionKey = positionKey;
    }
    return this.plan;
  }

  public get lastReason(): ThinkTimePlan['reason'] | null {
    return this.plan?.reason ?? null;
  }

  public get thinkMs(): number {
    return this.plan?.thinkMs ?? 0;
  }

  /** Timestamp the current plan may be played from; 0 when there is no plan. */
  public get readyAtMs(): number {
    return this.plan?.readyAt ?? 0;
  }

  public clear(): void {
    this.plan = null;
    this.positionKey = '';
  }
}
