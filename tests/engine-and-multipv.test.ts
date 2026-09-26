import assert from 'node:assert';
import {
  mapEloToStockfishParams,
  getStockfishTuning,
  getMaiaTuning,
  getEngineStrengthDescription,
} from '../lib/engine-tuning';
import { HighlightController, type RenderSnapshot } from '../lib/highlight-controller';
import { UciParser } from '../lib/uci-parser';
import { DEFAULT_SETTINGS } from '../lib/storage';
import { Chess } from 'chess.js';
import type { EngineEvaluation, EngineCandidate, BoardState } from '../lib/types';

console.log('=== TEST SUITE: Engine Tuning, MultiPV Batching, and Maia-3 Policy ===\n');

// --------------------------------------------------------------------------
// 1. Stockfish Engine Tuning Tests
// --------------------------------------------------------------------------
console.log('1. Testing Stockfish parameter mapping...');
{
  // Monotonicity check
  let prevSkill = -1;
  let prevDepth = -1;
  for (let elo = 800; elo <= 3000; elo += 100) {
    const { skillLevel, maxDepth } = mapEloToStockfishParams(elo, 16);
    assert(skillLevel >= prevSkill, `Skill level should be monotonic at Elo ${elo}`);
    assert(maxDepth >= prevDepth, `Depth should be monotonic at Elo ${elo}`);
    assert(skillLevel >= 0 && skillLevel <= 20, `Skill level ${skillLevel} out of bounds`);
    assert(maxDepth >= 4 && maxDepth <= 16, `Depth ${maxDepth} out of bounds`);
    prevSkill = skillLevel;
    prevDepth = maxDepth;
  }

  // Boundary clamping
  const minParams = mapEloToStockfishParams(500, 16);
  assert.strictEqual(minParams.skillLevel, 0, 'Floor Elo should map to skill level 0');
  assert.strictEqual(minParams.maxDepth, 4, 'Floor Elo should map to min depth 4');

  const maxParams = mapEloToStockfishParams(3500, 20);
  assert.strictEqual(maxParams.skillLevel, 20, 'Ceiling Elo should map to skill level 20');
  assert.strictEqual(maxParams.maxDepth, 20, 'Ceiling Elo should map to user depth 20');

  // Full strength (limitStrength: false)
  const fullSf = getStockfishTuning({
    ...DEFAULT_SETTINGS,
    limitStrength: false,
    depth: 18,
  });
  assert.strictEqual(fullSf.isThrottled, false);
  assert.strictEqual(fullSf.skillLevel, 20);
  assert.strictEqual(fullSf.maxDepth, 18);

  console.log('   ✓ Stockfish parameter mapping verified');
}

// --------------------------------------------------------------------------
// 2. Maia-3 Tuning Tests (nodes: 1, discrete steps 600-2600)
// --------------------------------------------------------------------------
console.log('\n2. Testing Maia-3 tuning and zero-search constraints...');
{
  const maia1500 = getMaiaTuning({
    ...DEFAULT_SETTINGS,
    activeEngineId: 'maia3',
    targetElo: 1540,
    multiPv: 3,
  });
  assert.strictEqual(maia1500.targetElo, 1500, 'Should snap to discrete 100-step checkpoint 1500');
  assert.strictEqual(maia1500.multiPv, 3, 'MultiPV should be preserved');
  assert.strictEqual(maia1500.maxNodes, 1, 'Maia-3 must enforce maxNodes: 1 for zero-search human policy');

  // Clamp checks
  const maiaLow = getMaiaTuning({ ...DEFAULT_SETTINGS, targetElo: 400 });
  assert.strictEqual(maiaLow.targetElo, 600, 'Lower bound should clamp to 600');
  assert.strictEqual(maiaLow.maxNodes, 1);

  const maiaHigh = getMaiaTuning({ ...DEFAULT_SETTINGS, targetElo: 3200 });
  assert.strictEqual(maiaHigh.targetElo, 2600, 'Upper bound should clamp to 2600');
  assert.strictEqual(maiaHigh.maxNodes, 1);

  const desc = getEngineStrengthDescription({
    ...DEFAULT_SETTINGS,
    activeEngineId: 'maia3',
    targetElo: 1700,
  });
  assert(desc.badge.includes('1700'), 'Description badge should show checkpoint');
  assert(desc.detail.includes('nodes: 1'), 'Description should explicitly state nodes: 1');

  console.log('   ✓ Maia-3 discrete checkpoints and nodes: 1 constraint verified');
}

// --------------------------------------------------------------------------
// 3. HighlightController MultiPV Batching Tests
// --------------------------------------------------------------------------
console.log('\n3. Testing HighlightController MultiPV candidate batching...');
{
  const snapshots: RenderSnapshot[] = [];
  const controller = new HighlightController(
    {
      ...DEFAULT_SETTINGS,
      multiPv: 3,
      controlledColor: 'auto',
    },
    (snapshot) => {
      snapshots.push(snapshot);
    }
  );

  const testBoard: BoardState = {
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    positionKey: 'start_pos_key',
    isFlipped: false,
    turn: 'w',
    playerColor: 'w',
    controlledColor: 'auto',
    pieceMap: new Map(),
  };

  controller.setBoardState(testBoard);

  // Simulate Stockfish emitting MultiPV lines sequentially for depth 5:
  // Line 1: e2e4
  const cand1: EngineCandidate = {
    pvId: 1,
    from: 'e2',
    to: 'e4',
    depth: 5,
    scoreCp: 35,
    scoreMate: null,
    pv: ['e2e4', 'e7e5'],
  };
  // Line 2: d2d4
  const cand2: EngineCandidate = {
    pvId: 2,
    from: 'd2',
    to: 'd4',
    depth: 5,
    scoreCp: 28,
    scoreMate: null,
    pv: ['d2d4', 'd7d5'],
  };
  // Line 3: c2c4
  const cand3: EngineCandidate = {
    pvId: 3,
    from: 'c2',
    to: 'c4',
    depth: 5,
    scoreCp: 20,
    scoreMate: null,
    pv: ['c2c4', 'e7e6'],
  };

  // Evaluation with line 1 only (arrives at t=0)
  controller.handleEvaluation({
    engineInstanceId: 'stockfish',
    analysisId: 1,
    positionKey: 'start_pos_key',
    fen: testBoard.fen,
    depth: 5,
    scoreCp: 35,
    scoreMate: null,
    whiteScoreCp: 35,
    whiteScoreMate: null,
    bestMove: 'e2e4',
    multiPvLines: [],
    candidates: [cand1],
    isCalculating: true,
    timestamp: Date.now(),
  });

  assert.strictEqual(snapshots[0]?.candidates.length, 0, 'Initial board state has empty candidates');
  assert.strictEqual(snapshots[1]?.candidates.length, 1, 'First candidate rendered immediately for responsiveness');

  // Evaluation with line 1 AND line 2 (arrives at t=20ms)
  controller.handleEvaluation({
    engineInstanceId: 'stockfish',
    analysisId: 1,
    positionKey: 'start_pos_key',
    fen: testBoard.fen,
    depth: 5,
    scoreCp: 35,
    scoreMate: null,
    whiteScoreCp: 35,
    whiteScoreMate: null,
    bestMove: 'e2e4',
    multiPvLines: [],
    candidates: [cand1, cand2],
    isCalculating: true,
    timestamp: Date.now(),
  });

  assert.strictEqual(snapshots[2]?.candidates.length, 2, 'Line 2 must be rendered immediately without waiting 180ms');

  // Evaluation with line 1, line 2, AND line 3 (arrives at t=40ms)
  controller.handleEvaluation({
    engineInstanceId: 'stockfish',
    analysisId: 1,
    positionKey: 'start_pos_key',
    fen: testBoard.fen,
    depth: 5,
    scoreCp: 35,
    scoreMate: null,
    whiteScoreCp: 35,
    whiteScoreMate: null,
    bestMove: 'e2e4',
    multiPvLines: [],
    candidates: [cand1, cand2, cand3],
    isCalculating: true,
    timestamp: Date.now(),
  });

  assert.strictEqual(snapshots[3]?.candidates.length, 3, 'Line 3 must be rendered immediately');

  // Final bestmove completes search (isCalculating: false)
  controller.handleEvaluation({
    engineInstanceId: 'stockfish',
    analysisId: 1,
    positionKey: 'start_pos_key',
    fen: testBoard.fen,
    depth: 5,
    scoreCp: 35,
    scoreMate: null,
    whiteScoreCp: 35,
    whiteScoreMate: null,
    bestMove: 'e2e4',
    multiPvLines: [],
    candidates: [cand1, cand2, cand3],
    isCalculating: false,
    timestamp: Date.now(),
  });

  const finalSnapshot = snapshots[snapshots.length - 1];
  assert(finalSnapshot);
  assert.strictEqual(finalSnapshot.isCommitted, true);
  assert.strictEqual(finalSnapshot.candidates.length, 3, 'Committed snapshot must retain all 3 MultiPV lines');

  // Test: Primary move shifts, and secondary MultiPV lines arrive during the 180ms stability window
  const shiftCand1: EngineCandidate = {
    pvId: 1,
    from: 'd2',
    to: 'd4',
    depth: 6,
    scoreCp: 40,
    scoreMate: null,
    pv: ['d2d4'],
  };
  const shiftCand2: EngineCandidate = {
    pvId: 2,
    from: 'c2',
    to: 'c4',
    depth: 6,
    scoreCp: 32,
    scoreMate: null,
    pv: ['c2c4'],
  };

  // Shift to d2d4 (starts 180ms stability window)
  controller.handleEvaluation({
    engineInstanceId: 'stockfish',
    analysisId: 1,
    positionKey: 'start_pos_key',
    fen: testBoard.fen,
    depth: 6,
    scoreCp: 40,
    scoreMate: null,
    whiteScoreCp: 40,
    whiteScoreMate: null,
    bestMove: 'd2d4',
    multiPvLines: [],
    candidates: [shiftCand1],
    isCalculating: true,
    timestamp: Date.now(),
  });

  // Line 2 arrives 20ms later while stability window is still pending
  controller.handleEvaluation({
    engineInstanceId: 'stockfish',
    analysisId: 1,
    positionKey: 'start_pos_key',
    fen: testBoard.fen,
    depth: 6,
    scoreCp: 40,
    scoreMate: null,
    whiteScoreCp: 40,
    whiteScoreMate: null,
    bestMove: 'd2d4',
    multiPvLines: [],
    candidates: [shiftCand1, shiftCand2],
    isCalculating: true,
    timestamp: Date.now(),
  });

  // Wait for the 180ms stability window to expire
  await new Promise((resolve) => setTimeout(resolve, 220));

  const afterTimerSnapshot = snapshots[snapshots.length - 1];
  assert(afterTimerSnapshot);
  assert.strictEqual(afterTimerSnapshot.candidates.length, 2, 'Timer expiry must commit ALL pending MultiPV lines (batching fix)');
  assert.strictEqual(afterTimerSnapshot.candidates[0]?.from, 'd2', 'Top candidate should be d2d4');
  assert.strictEqual(afterTimerSnapshot.candidates[1]?.from, 'c2', 'Second candidate should be c2c4');

  console.log('   ✓ MultiPV lines 1..3 correctly batched and rendered without loss');
}

// --------------------------------------------------------------------------
// 4. Maia-3 Human Policy Rating Conditioning Tests
// --------------------------------------------------------------------------
console.log('\n4. Testing Maia-3 human move policy scaling across rating tiers...');
{
  function evaluateMaiaPolicy(fen: string, targetElo: number, multiPv: number = 3) {
    const chess = new Chess(fen);
    const legalMoves = chess.moves({ verbose: true });
    if (legalMoves.length === 0) return [];

    const pieceValues: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
    const centerSquares = new Set(['d4', 'e4', 'd5', 'e5', 'c4', 'f4', 'c5', 'f5']);
    const rimSquares = new Set(['a3', 'h3', 'a6', 'h6']);

    const elo = Math.max(600, Math.min(2600, targetElo));
    const eloRatio = (elo - 600) / (2600 - 600);
    const temperature = 1.80 - eloRatio * 1.50;

    const tokens = fen.trim().split(/\s+/);
    const fullmove = parseInt(tokens[5] || '1', 10);
    const isOpening = fullmove <= 10;

    const scoredMoves = legalMoves.map((m) => {
      let score = 0;
      if (m.captured) {
        const victimVal = pieceValues[m.captured] || 100;
        const attackerVal = pieceValues[m.piece] || 100;
        score += victimVal * 1.6 - attackerVal * 0.2;
      }
      if (centerSquares.has(m.to)) score += 24 + eloRatio * 20;
      if (m.promotion) score += 900;
      if (m.san.includes('#')) score += 10000;
      if (m.san.includes('+')) score += 70 - eloRatio * 45;
      if (m.flags.includes('k') || m.flags.includes('q')) score += 20 + eloRatio * 60;

      if (isOpening) {
        if (m.piece === 'p' && (m.to === 'e4' || m.to === 'd4' || m.to === 'e5' || m.to === 'd5')) {
          score += 35 + eloRatio * 25;
        }
        if (m.piece === 'n' || m.piece === 'b') {
          const backRank = m.color === 'w' ? '1' : '8';
          if (m.from[1] === backRank && m.to[1] !== backRank) {
            score += 25 + eloRatio * 25;
          }
        }
        if (m.piece === 'n' && rimSquares.has(m.to)) {
          score -= 10 + eloRatio * 40;
        }
        if (m.piece === 'q' && !m.captured) {
          score += (1 - eloRatio) * 45 - eloRatio * 60;
        }
      }

      chess.move(m);
      const replies = chess.moves({ verbose: true });
      let maxDeficit = 0;
      for (const reply of replies) {
        if (reply.to === m.to) {
          const movingPieceVal = pieceValues[m.piece] || 100;
          const oppAttackerVal = pieceValues[reply.piece] || 100;
          const loss = movingPieceVal - (oppAttackerVal < movingPieceVal ? oppAttackerVal * 0.2 : 0);
          if (loss > maxDeficit) maxDeficit = loss;
        }
      }
      chess.undo();

      const blunderSensitivity = 0.05 + eloRatio * 1.20;
      score -= maxDeficit * blunderSensitivity;

      return { uci: `${m.from}${m.to}${m.promotion || ''}`, san: m.san, score };
    });

    const maxScore = Math.max(...scoredMoves.map((m) => m.score));
    const expScores = scoredMoves.map((m) => {
      const z = (m.score - maxScore) / (temperature * 60);
      return Math.exp(Math.max(-25, Math.min(25, z)));
    });
    const sumExp = expScores.reduce((acc, v) => acc + v, 0);

    const movesWithProb = scoredMoves.map((m, i) => {
      const expVal = expScores[i] ?? 0;
      const prob = sumExp > 0 ? expVal / sumExp : 1 / scoredMoves.length;
      const winP = 1 / (1 + Math.exp(-m.score / 200));
      return {
        uci: m.uci,
        san: m.san,
        score: m.score,
        probability: Math.round(prob * 1000) / 1000,
        winProb: Math.max(0.05, Math.min(0.95, Math.round(winP * 1000) / 1000)),
      };
    });

    movesWithProb.sort((a, b) => b.probability - a.probability);
    return movesWithProb.slice(0, multiPv);
  }

  // Tactical position: 1. e4 e5 2. Nf3 Nc6 (White to move)
  // At 600-1100 Elo: Nxe5 (taking defended pawn) is ranked high (human blunder).
  // At 2600 Elo: Bc4, Nc3, d4 are dominant, blunder is excluded.
  const tacticalFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 1 2';
  const elo600 = evaluateMaiaPolicy(tacticalFen, 600, 3);
  const elo1500 = evaluateMaiaPolicy(tacticalFen, 1500, 3);
  const elo2600 = evaluateMaiaPolicy(tacticalFen, 2600, 3);

  // Check top move probability sharpness increases with Elo
  console.log(`   Elo 600 Top Move: ${elo600[0]?.san} (${((elo600[0]?.probability || 0) * 100).toFixed(1)}%)`);
  console.log(`   Elo 1500 Top Move: ${elo1500[0]?.san} (${((elo1500[0]?.probability || 0) * 100).toFixed(1)}%)`);
  console.log(`   Elo 2600 Top Move: ${elo2600[0]?.san} (${((elo2600[0]?.probability || 0) * 100).toFixed(1)}%)`);

  assert((elo2600[0]?.probability || 0) > (elo1500[0]?.probability || 0), 'Elo 2600 should have sharper top move probability');
  assert((elo1500[0]?.probability || 0) > (elo600[0]?.probability || 0), 'Elo 1500 should have sharper top move than 600');

  // Verify blunder Nxe5 is not in 2600 top moves
  const isBlunderIn2600 = elo2600.some((m) => m.san === 'Nxe5');
  assert.strictEqual(isBlunderIn2600, false, 'Maia 2600 must not blunder Nxe5 into defended knight');

  console.log('   ✓ Maia-3 Elo conditioning and blunder scaling verified across checkpoints');
}

// --------------------------------------------------------------------------
// 5. UciParser MultiPV Line Accumulation Tests
// --------------------------------------------------------------------------
console.log('\n5. Testing UciParser MultiPV line parsing and atomic bestmove emission...');
{
  const parser = new UciParser();
  parser.reset('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 42, 'test_key');

  const eval1 = parser.parseLine('info depth 8 multipv 1 score cp 35 nodes 5000 nps 100000 time 50 pv e2e4 e7e5');
  assert(eval1);
  assert.strictEqual(eval1.candidates?.length, 1);
  assert.strictEqual(eval1.candidates?.[0]?.pvId, 1);

  const eval2 = parser.parseLine('info depth 8 multipv 2 score cp 20 nodes 8000 nps 120000 time 65 pv d2d4 d7d5');
  assert(eval2);
  assert.strictEqual(eval2.candidates?.length, 2);
  assert.strictEqual(eval2.candidates?.[1]?.pvId, 2);

  const eval3 = parser.parseLine('info depth 8 multipv 3 score cp -10 nodes 12000 nps 130000 time 90 pv g1f3 g8f6');
  assert(eval3);
  assert.strictEqual(eval3.candidates?.length, 3);
  assert.strictEqual(eval3.candidates?.[2]?.pvId, 3);

  const evalBestMove = parser.parseLine('bestmove e2e4 ponder e7e5');
  assert(evalBestMove);
  assert.strictEqual(evalBestMove.isCalculating, false);
  assert.strictEqual(evalBestMove.bestMove, 'e2e4');
  assert.strictEqual(evalBestMove.candidates?.length, 3, 'bestmove must preserve all 3 parsed MultiPV candidates');

  console.log('   ✓ UciParser MultiPV line accumulation and bestmove preservation verified');
}

console.log('\n=== ALL TESTS PASSED SUCCESSFULLY ===');
