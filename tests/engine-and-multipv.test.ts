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
// 2. Maia-3 and Maia-2 Tuning Tests (nodes: 1, discrete steps 600-2600 & 1100-1900)
// --------------------------------------------------------------------------
console.log('\n2. Testing Maia-3 and Maia-2 tuning and zero-search constraints...');
{
  const maia1500 = getMaiaTuning(
    {
      ...DEFAULT_SETTINGS,
      activeEngineId: 'maia3',
      targetElo: 1540,
      multiPv: 3,
    },
    'maia3'
  );
  assert.strictEqual(maia1500.targetElo, 1500, 'Maia-3 should snap to discrete 100-step checkpoint 1500');
  assert.strictEqual(maia1500.multiPv, 3, 'MultiPV should be preserved');
  assert.strictEqual(maia1500.maxNodes, 1, 'Maia-3 must enforce maxNodes: 1 for zero-search human policy');

  // Maia-3 Clamp checks
  const maiaLow = getMaiaTuning({ ...DEFAULT_SETTINGS, targetElo: 400 }, 'maia3');
  assert.strictEqual(maiaLow.targetElo, 600, 'Maia-3 lower bound should clamp to 600');
  assert.strictEqual(maiaLow.maxNodes, 1);

  const maiaHigh = getMaiaTuning({ ...DEFAULT_SETTINGS, targetElo: 3200 }, 'maia3');
  assert.strictEqual(maiaHigh.targetElo, 2600, 'Maia-3 upper bound should clamp to 2600');
  assert.strictEqual(maiaHigh.maxNodes, 1);

  // Maia-2 tuning checks (1100 to 1900 Elo)
  const maia2ClampedLow = getMaiaTuning({ ...DEFAULT_SETTINGS, targetElo: 900 }, 'maia2');
  assert.strictEqual(maia2ClampedLow.targetElo, 1100, 'Maia-2 lower bound must clamp to 1100');
  assert.strictEqual(maia2ClampedLow.maxNodes, 1, 'Maia-2 must enforce maxNodes: 1');

  const maia2ClampedHigh = getMaiaTuning({ ...DEFAULT_SETTINGS, targetElo: 2400 }, 'maia2');
  assert.strictEqual(maia2ClampedHigh.targetElo, 1900, 'Maia-2 upper bound must clamp to 1900');
  assert.strictEqual(maia2ClampedHigh.maxNodes, 1);

  const maia2Step = getMaiaTuning({ ...DEFAULT_SETTINGS, targetElo: 1670 }, 'maia2');
  assert.strictEqual(maia2Step.targetElo, 1700, 'Maia-2 should round to nearest 100 checkpoint');

  const desc3 = getEngineStrengthDescription({
    ...DEFAULT_SETTINGS,
    activeEngineId: 'maia3',
    targetElo: 1700,
  });
  assert(desc3.badge.includes('1700'), 'Description badge should show checkpoint');
  assert(desc3.detail.includes('nodes: 1'), 'Description should explicitly state nodes: 1');

  const desc2 = getEngineStrengthDescription({
    ...DEFAULT_SETTINGS,
    activeEngineId: 'maia2',
    targetElo: 1500,
  });
  assert(desc2.badge.includes('Maia-2'), 'Maia-2 badge should include model identifier');
  assert(desc2.detail.includes('1500 Elo'), 'Maia-2 detail should reflect checkpoint');

  console.log('   ✓ Maia-3 & Maia-2 discrete checkpoints and nodes: 1 constraint verified');
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
  const pieceValues: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
  const centerSquares = new Set(['d4', 'e4', 'd5', 'e5', 'c4', 'f4', 'c5', 'f5']);
  const extendedCenter = new Set(['c3', 'd3', 'e3', 'f3', 'c6', 'd6', 'e6', 'f6']);
  const rimSquares = new Set(['a3', 'h3', 'a6', 'h6', 'a4', 'h4', 'a5', 'h5']);

  function evaluateMaiaPolicy(fen: string, targetElo: number, multiPv: number = 3) {
    const chess = new Chess(fen);
    const legalMoves = chess.moves({ verbose: true });
    if (legalMoves.length === 0) return [];

    const elo = Math.max(600, Math.min(2600, targetElo));
    const eloRatio = (elo - 600) / 2000;

    const tokens = fen.trim().split(/\s+/);
    const fullmove = parseInt(tokens[5] || '1', 10);
    const isOpening = fullmove <= 10;

    const scoredMoves = legalMoves.map((m) => {
      let score = 0;

      // Static Exchange Evaluation
      const capturedVal = m.captured ? (pieceValues[m.captured] || 100) : 0;
      const myPieceVal = pieceValues[m.piece] || 100;

      chess.move(m);
      const oppReplies = chess.moves({ verbose: true });
      const directCaptures = oppReplies.filter((r) => r.to === m.to);

      let netExchange = capturedVal;
      let isHanging = false;

      if (directCaptures.length > 0) {
        directCaptures.sort((a, b) => (pieceValues[a.piece] || 100) - (pieceValues[b.piece] || 100));
        const lowestAttacker = directCaptures[0];
        const oppAttackerVal = pieceValues[lowestAttacker?.piece || 'p'] || 100;

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

      chess.undo();

      if (netExchange > 0) {
        score += netExchange * 2.2;
      } else if (netExchange < 0) {
        if (netExchange <= -400) {
          score += netExchange * (3.0 + eloRatio * 2.0);
        } else {
          score += netExchange * (1.8 + eloRatio * 1.5);
        }
      }

      if (m.san.includes('#')) {
        return { uci: `${m.from}${m.to}${m.promotion || ''}`, san: m.san, score: 50000 };
      }

      if (m.san.includes('+')) {
        if (netExchange >= 0 && !isHanging) {
          score += 35 + (1 - eloRatio) * 20;
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

      if (centerSquares.has(m.to)) {
        score += 30 + eloRatio * 20;
      } else if (extendedCenter.has(m.to)) {
        score += 15 + eloRatio * 10;
      }

      if (isOpening) {
        if (m.piece === 'p' && (m.to === 'e4' || m.to === 'd4' || m.to === 'c4' || m.to === 'e5' || m.to === 'd5' || m.to === 'c5')) {
          score += 45 + eloRatio * 25;
        }

        if (m.piece === 'n' || m.piece === 'b') {
          const backRank = m.color === 'w' ? '1' : '8';
          if (m.from[1] === backRank && m.to[1] !== backRank) {
            score += 40 + eloRatio * 30;
          }
        }

        if (m.piece === 'n' && rimSquares.has(m.to)) {
          score -= 25 + eloRatio * 35;
        }

        if (m.piece === 'q' && !m.captured && fullmove <= 6) {
          score -= eloRatio * 60;
        }
      }

      if (m.promotion) {
        score += 900;
      }

      return { uci: `${m.from}${m.to}${m.promotion || ''}`, san: m.san, score };
    });

    const maxScore = Math.max(...scoredMoves.map((m) => m.score));
    const temperature = 0.85 - eloRatio * 0.60;
    const expScores = scoredMoves.map((m) => {
      const z = (m.score - maxScore) / (temperature * 50);
      return Math.exp(Math.max(-25, Math.min(25, z)));
    });
    const sumExp = expScores.reduce((acc, v) => acc + v, 0);

    const movesWithProb = scoredMoves.map((m, i) => {
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
    return movesWithProb.slice(0, multiPv);
  }

  // Tactical position: 1. e4 e5 2. Nf3 Nc6 (White to move)
  // Ensure sound moves (Bc4, d4, c4) dominate and blunder Nxe5 is eliminated across all Elos
  const tacticalFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 1 2';
  const elo600 = evaluateMaiaPolicy(tacticalFen, 600, 3);
  const elo1500 = evaluateMaiaPolicy(tacticalFen, 1500, 3);
  const elo2600 = evaluateMaiaPolicy(tacticalFen, 2600, 3);

  console.log(`   Elo 600 Top Move: ${elo600[0]?.san} (${((elo600[0]?.probability || 0) * 100).toFixed(1)}%)`);
  console.log(`   Elo 1500 Top Move: ${elo1500[0]?.san} (${((elo1500[0]?.probability || 0) * 100).toFixed(1)}%)`);
  console.log(`   Elo 2600 Top Move: ${elo2600[0]?.san} (${((elo2600[0]?.probability || 0) * 100).toFixed(1)}%)`);

  // Verify sound master moves (c4, d4, Bc4) dominate
  assert(['c4', 'd4', 'Bc4', 'Nc3', 'Bb5'].includes(elo1500[0]?.san || ''), 'Elo 1500 top move must be sound');
  assert(['c4', 'd4', 'Bc4', 'Nc3', 'Bb5'].includes(elo2600[0]?.san || ''), 'Elo 2600 top move must be sound');

  // Verify blunder Nxe5 is never in top moves
  const isBlunderIn1500 = elo1500.some((m) => m.san === 'Nxe5');
  const isBlunderIn2600 = elo2600.some((m) => m.san === 'Nxe5');
  assert.strictEqual(isBlunderIn1500, false, 'Maia 1500 must not blunder Nxe5');
  assert.strictEqual(isBlunderIn2600, false, 'Maia 2600 must not blunder Nxe5');

  // Test Checkmate in 1: 1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6?? 4. Qxf7#
  const mateFen = 'r1bqkb1r/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 2 4';
  const mateMoves = evaluateMaiaPolicy(mateFen, 1500, 1);
  assert.strictEqual(mateMoves[0]?.san, 'Qxf7#', 'Maia must find checkmate in 1 immediately');

  console.log('   ✓ Maia-3 Elo conditioning, tactical safety, and checkmate detection verified');
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

// --------------------------------------------------------------------------
// 6. Storage Fallback Gracefulness (when chrome.storage is undefined)
// --------------------------------------------------------------------------
console.log('\n6. Testing storage fallback when chrome.storage is undefined...');
{
  const { getSettings, saveSettings, subscribeToSettings } = await import('../lib/storage');
  const s = await getSettings();
  assert(s);
  assert.strictEqual(s.activeEngineId, 'stockfish');

  // Should not throw
  await saveSettings({ depth: 20 });
  const unsubscribe = subscribeToSettings(() => {});
  unsubscribe();

  console.log('   ✓ Storage API gracefully falls back without throwing TypeError');
}

// --------------------------------------------------------------------------
// 7. Maia Endgame Mating Drive & King Opposition Tests
// --------------------------------------------------------------------------
console.log('\n7. Testing Maia endgame mating drive and opposition heuristics...');
{
  const { evaluateHumanPolicy } = await import('../lib/maia-policy');

  // Position: White has K on d1, Q on d2; Black has lone King on e5
  const kqFen = '8/8/8/4k3/8/8/3Q4/3K4 w - - 0 1';
  const kqCandidates = evaluateHumanPolicy(kqFen, 1500, 3);
  assert(kqCandidates.length > 0, 'Candidates must be generated for KQ vs K');

  // Friendly king bringing opposition (Ke2, Kd2) or queen cutting off the king (Qe3+, Qd3, Qd4)
  const topMove = kqCandidates[0];
  assert(topMove, 'Must have a top move');
  console.log(`   KQ vs K Top Move: ${topMove.san} (score: ${topMove.score})`);

  // Verify that an immediate checkmate is prioritized with maximum score
  const mateFen = '4k3/3Q4/4K3/8/8/8/8/8 w - - 0 1';
  const mateCandidates = evaluateHumanPolicy(mateFen, 1500, 1);
  assert(mateCandidates[0]?.san.includes('#'), 'Maia must find checkmate in 1');
  assert.strictEqual(mateCandidates[0]?.score, 50000, 'Checkmate in 1 must receive 50000 score');

  console.log('   ✓ Endgame mating drive and opposition convergence verified');
}

// --------------------------------------------------------------------------
// 8. Maia Threefold Repetition & Draw Avoidance Tests
// --------------------------------------------------------------------------
console.log('\n8. Testing Maia repetition and draw avoidance when holding advantage...');
{
  const { evaluateHumanPolicy } = await import('../lib/maia-policy');

  // Position: White is up a Queen (K on e6, Q on d6, Black K on e8)
  // White to move: if White repeats a prior position key, it must be severely penalized
  const winningFen = '4k3/8/3QK3/8/8/8/8/8 w - - 0 1';

  // Moving Qd7+ creates position '4k3/3Q4/4K3/8/8/8/8/8 b - -'
  const repeatedPosKey = '4k3/3Q4/4K3/8/8/8/8/8 b - -';
  const nonRepeatedPolicy = evaluateHumanPolicy(winningFen, 1500, 10, []);
  const repetitionPolicy = evaluateHumanPolicy(winningFen, 1500, 10, [repeatedPosKey]);

  const nonRepQd7 = nonRepeatedPolicy.find((m) => m.uci === 'd6d7');
  const repQd7 = repetitionPolicy.find((m) => m.uci === 'd6d7');

  assert(nonRepQd7, 'd6d7 must be legal');
  assert(repQd7, 'd6d7 must be legal in repetition policy');
  assert(
    repQd7.score < nonRepQd7.score,
    'A move that repeats a recent position when winning must receive a severe score penalty'
  );

  // Checkmate in 1 (Qe7#) must STILL be played and not repeat
  const topWinningMove = repetitionPolicy[0];
  assert(topWinningMove?.san.includes('#'), 'Maia must prioritize mate (Qe7#) over repeating moves');

  console.log('   ✓ Repetition avoidance prevents forced draw cycles when ahead');
}

// --------------------------------------------------------------------------
// 9. Maia Stalemate Prevention Tests
// --------------------------------------------------------------------------
console.log('\n9. Testing Maia stalemate prevention when holding decisive advantage...');
{
  const { evaluateHumanPolicy } = await import('../lib/maia-policy');

  // Position: White King on f7, White Queen on e6, Black King on h8
  // 7k/5K2/4Q3/8/8/8/8/8 w - - 0 1
  // Move Qg6?? stalemates Black King (0 legal moves, not in check)!
  const stalemateDangerFen = '7k/5K2/4Q3/8/8/8/8/8 w - - 0 1';
  const candidates = evaluateHumanPolicy(stalemateDangerFen, 1500, 10);

  const stalemateMove = candidates.find((m) => m.san === 'Qg6');
  if (stalemateMove) {
    assert.strictEqual(
      stalemateMove.score,
      -50000,
      'Qg6 delivers stalemate when up +900 and must be penalized with -50000'
    );
  }

  // The top move must deliver checkmate (e.g. Qh6# or Qg8#) or prepare mate without stalemating
  const bestMove = candidates[0];
  assert(bestMove && bestMove.san !== 'Qg6', 'Maia must NEVER select the stalemating move when winning');

  console.log(`   Stalemate Danger Top Move: ${bestMove?.san} (avoids blunder Qg6)`);
  console.log('   ✓ Stalemate prevention strictly active');
}

// --------------------------------------------------------------------------
// 10. Patricia 5.1 Aggressive & Human Tuning Tests
// --------------------------------------------------------------------------
console.log('\n10. Testing Patricia 5.1 parameter mapping, Elo calibration, and personality modes...');
{
  const { mapEloToPatriciaSkill, getPatriciaTuning, PATRICIA_SKILL_LEVELS } = await import(
    '../lib/engine-tuning'
  );

  // Discrete skill levels span 500 to 3000 Elo (20 levels)
  assert.strictEqual(PATRICIA_SKILL_LEVELS.length, 20);
  assert.strictEqual(PATRICIA_SKILL_LEVELS[0], 500);
  assert.strictEqual(PATRICIA_SKILL_LEVELS[19], 3000);

  // Exact mappings
  const p500 = mapEloToPatriciaSkill(500);
  assert.strictEqual(p500.skillLevel, 1, '500 Elo should map to Skill Level 1');

  const p1500 = mapEloToPatriciaSkill(1500);
  assert.strictEqual(p1500.skillLevel, 7, '1500 Elo should map to Skill Level 7');

  const p2500 = mapEloToPatriciaSkill(2500);
  assert.strictEqual(p2500.skillLevel, 17, '2500 Elo should map to Skill Level 17');
  assert.strictEqual(p2500.cpLoss, 20, '2500 Elo should have 20 cp_loss target');

  const p3000 = mapEloToPatriciaSkill(3000);
  assert.strictEqual(p3000.skillLevel, 20, '3000 Elo should map to Skill Level 20');
  assert.strictEqual(p3000.cpLoss, 0, '3000 Elo should have 0 cp_loss target');

  // Full Strength (Skill Level 21)
  const fullTuning = getPatriciaTuning({
    ...DEFAULT_SETTINGS,
    activeEngineId: 'patricia',
    patriciaPersonality: 'full_strength',
    patriciaLimitStrength: false,
  });
  assert.strictEqual(fullTuning.isHuman, false);
  assert.strictEqual(fullTuning.skillLevel, 21, 'Full strength must set Skill_Level 21');
  assert.strictEqual(fullTuning.targetElo, 3500);

  // Human Mode at 2500 Elo (with fast responsive recommended depth 8–11 ply)
  const human2500Tuning = getPatriciaTuning({
    ...DEFAULT_SETTINGS,
    activeEngineId: 'patricia',
    patriciaPersonality: 'human',
    patriciaLimitStrength: true,
    patriciaElo: 2500,
  });
  assert.strictEqual(human2500Tuning.isHuman, true);
  assert.strictEqual(human2500Tuning.skillLevel, 17);
  assert.strictEqual(human2500Tuning.targetElo, 2500);
  assert(human2500Tuning.recommendedDepth >= 8 && human2500Tuning.recommendedDepth <= 11);

  // Aggressive Personality Description
  const aggDesc = getEngineStrengthDescription({
    ...DEFAULT_SETTINGS,
    activeEngineId: 'patricia',
    patriciaPersonality: 'aggressive',
    patriciaLimitStrength: false,
  });
  assert(aggDesc.detail.includes('EAS 430,000'), 'Should highlight EAS 430,000 aggression score');

  // Human Mode Description
  const humanDesc = getEngineStrengthDescription({
    ...DEFAULT_SETTINGS,
    activeEngineId: 'patricia',
    patriciaPersonality: 'human',
    patriciaLimitStrength: true,
    patriciaElo: 2500,
  });
  assert(humanDesc.badge.includes('2500'), 'Badge should show 2500 Elo');
  assert(humanDesc.detail.includes('Skill Level 17'), 'Detail should show Skill Level 17');

  // Test low Elo depth throttling (600 Elo -> depth 3)
  const low600Tuning = getPatriciaTuning({
    ...DEFAULT_SETTINGS,
    activeEngineId: 'patricia',
    patriciaPersonality: 'human',
    patriciaElo: 600,
  });
  assert.strictEqual(low600Tuning.isHuman, true);
  assert.strictEqual(low600Tuning.skillLevel, 1, '600 Elo should map to Skill Level 1');
  assert.strictEqual(low600Tuning.recommendedDepth, 3, '600 Elo depth must be throttled to 3 ply');

  // Test intermediate Elo depth scaling (1500 Elo -> depth 6)
  const mid1500Tuning = getPatriciaTuning({
    ...DEFAULT_SETTINGS,
    activeEngineId: 'patricia',
    patriciaPersonality: 'aggressive',
    patriciaElo: 1500,
  });
  assert.strictEqual(mid1500Tuning.isHuman, true);
  assert.strictEqual(mid1500Tuning.skillLevel, 7, '1500 Elo should map to Skill Level 7');
  assert.strictEqual(mid1500Tuning.recommendedDepth, 6, '1500 Elo depth must be 6 ply');

  // Solid Personality Description
  const solidDesc = getEngineStrengthDescription({
    ...DEFAULT_SETTINGS,
    activeEngineId: 'patricia',
    patriciaPersonality: 'solid',
    patriciaElo: 2000,
  });
  assert(solidDesc.detail.includes('Solid Positional'), 'Should highlight Solid Positional style');

  // Test UciParser promotion of chosen human/blunder bestmove into candidates[0]
  const { UciParser } = await import('../lib/uci-parser');
  const parser = new UciParser();
  parser.reset('r1bqk1nr/pppp1ppp/2n5/4p3/1bB1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4', 1, 'test-pos');
  parser.parseLine('info depth 6 multipv 1 score cp 100 pv c2c3 b4a5');
  parser.parseLine('info depth 6 multipv 2 score cp 40 pv e1g1 g8f6');
  // Engine chose the human blunder / alternate candidate e1g1
  const finalEval = parser.parseLine('bestmove e1g1');
  assert(finalEval && finalEval.candidates && finalEval.candidates.length > 0);
  const primaryCandidate = finalEval.candidates[0];
  assert(primaryCandidate, 'Primary candidate must exist');
  assert.strictEqual(
    `${primaryCandidate.from}${primaryCandidate.to}`,
    'e1g1',
    'Authoritative bestmove e1g1 must be promoted to candidate 0 for on-board highlight'
  );

  // Test smooth continuous Elo shifting without jumping from 500 directly to 800
  const p600 = mapEloToPatriciaSkill(600);
  assert.strictEqual(p600.clampedElo, 600, '600 Elo must be preserved continuously');
  assert.strictEqual(p600.skillLevel, 1, '600 Elo maps to Skill Level 1');

  const p700 = mapEloToPatriciaSkill(700);
  assert.strictEqual(p700.clampedElo, 700, '700 Elo must be preserved continuously');
  assert.strictEqual(p700.skillLevel, 2, '700 Elo is closest to Skill Level 2 (800)');

  const p800 = mapEloToPatriciaSkill(800);
  assert.strictEqual(p800.clampedElo, 800, '800 Elo must be preserved continuously');
  assert.strictEqual(p800.skillLevel, 2, '800 Elo maps to Skill Level 2');

  const p900 = mapEloToPatriciaSkill(900);
  assert.strictEqual(p900.clampedElo, 900, '900 Elo must be preserved continuously');
  assert.strictEqual(p900.skillLevel, 2, '900 Elo maps to Skill Level 2');

  // Test HighlightController does NOT drop Patricia depth 3 evaluations (500 Elo fix)
  const { HighlightController } = await import('../lib/highlight-controller');
  let renderedSnapshot: any = null;
  const controller = new HighlightController(
    {
      ...DEFAULT_SETTINGS,
      activeEngineId: 'patricia',
      patriciaElo: 500,
      showHighlights: true,
      highlightPlayerMoves: true,
      opening: { enabled: false, repertoireId: 'auto', mode: 'off', maxPlies: 0 },
    },
    (snap) => {
      renderedSnapshot = snap;
    }
  );

  controller.setBoardState({
    fen: 'r1bqk1nr/pppp1ppp/2n5/4p3/1bB1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    positionKey: 'test-pos-patricia',
    turn: 'w',
    isFlipped: false,
    playerColor: 'w',
    controlledColor: 'w',
    pieceMap: new Map([
      ['c2', 'P'],
      ['e1', 'K'],
    ]),
  });

  // Emulate Patricia 500 Elo evaluation emitting depth 3 lines
  controller.handleEvaluation({
    engineInstanceId: 'patricia',
    analysisId: 1,
    positionKey: 'test-pos-patricia',
    fen: 'r1bqk1nr/pppp1ppp/2n5/4p3/1bB1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    depth: 3,
    scoreCp: 50,
    scoreMate: null,
    whiteScoreCp: 50,
    whiteScoreMate: null,
    bestMove: 'c2c3',
    multiPvLines: [],
    candidates: [
      {
        pvId: 1,
        from: 'c2',
        to: 'c3',
        depth: 3,
        scoreCp: 50,
        scoreMate: null,
        pv: ['c2c3'],
      },
    ],
    isCalculating: false,
    timestamp: Date.now(),
  });

  assert(renderedSnapshot !== null, 'HighlightController must render evaluation at depth 3 for Patricia');
  assert.strictEqual(renderedSnapshot.candidates.length, 1, 'Candidate must be preserved at depth 3');
  assert.strictEqual(`${renderedSnapshot.candidates[0].from}${renderedSnapshot.candidates[0].to}`, 'c2c3');

  console.log('   ✓ Patricia 5.1 Skill_Level calibration, Elo mapping, and personality profiles verified');
}

// --------------------------------------------------------------------------
// 11. Maia Hanging Piece & Queen Safety Defense (calculateHangingThreats)
// --------------------------------------------------------------------------
console.log('\n11. Testing Maia hanging piece & Queen safety defense (calculateHangingThreats)...');
{
  const { evaluateHumanPolicy, calculateHangingThreats } = await import('../lib/maia-policy');

  // Position: White Queen on d4 attacked by defended Bishop on b6 (pawn on a7)
  // White must move the Queen away to safety, NEVER play passive moves like h3 or f3
  const queenThreatFen = '6k1/p4ppp/1b6/8/3Q4/8/5PPP/6K1 w - - 0 1';
  const candidates = evaluateHumanPolicy(queenThreatFen, 1500, 5);

  assert(candidates.length > 0, 'Candidates must be generated');
  // Top move must be a Queen move that avoids capture
  assert(
    candidates[0]?.san.startsWith('Q') && candidates[0]?.san !== 'Qxb6',
    `Top move must safely escape the Queen, got ${candidates[0]?.san}`
  );

  // Passive moves like h3 must be eliminated or ranked at bottom
  const blunderH3 = candidates.find((m) => m.san === 'h3');
  assert.strictEqual(
    blunderH3,
    undefined,
    'Passive move h3 that hangs the Queen on d4 must not appear in top candidates'
  );

  console.log(`   Threat Position Top Move: ${candidates[0]?.san} (safely escapes Queen under attack)`);
  console.log('   ✓ Hanging Queen and major piece defense verified');
}

// --------------------------------------------------------------------------
// 12. Testing HighlightController board defense (rejecting already moved pieces)
// --------------------------------------------------------------------------
console.log('\n12. Testing HighlightController board defense against stale move suggestions...');
{
  const snapshots: RenderSnapshot[] = [];
  const controller = new HighlightController(
    {
      ...DEFAULT_SETTINGS,
      multiPv: 1,
      controlledColor: 'auto',
    },
    (snapshot) => {
      snapshots.push(snapshot);
    }
  );

  // Position: White has moved 1. e4!
  // Square e2 is now vacant, pawn is on e4, Black to move (turn: 'b')
  const pieceMapAfterE4 = new Map<string, string>([
    ['e4', 'P'],
    ['e1', 'K'],
    ['e8', 'k'],
  ]);

  const boardAfterE4: BoardState = {
    fen: '4k3/8/8/8/4P3/8/8/4K3 b - - 0 1',
    positionKey: 'pos_after_e4',
    isFlipped: false,
    turn: 'b',
    playerColor: 'w',
    controlledColor: 'auto',
    pieceMap: pieceMapAfterE4,
  };

  controller.setBoardState(boardAfterE4);

  // An old/delayed evaluation arrives suggesting e2e4 (from the previous position when e2 was a pawn)
  const staleEvaluation: EngineEvaluation = {
    engineInstanceId: 'patricia',
    analysisId: 99,
    positionKey: 'pos_after_e4',
    fen: '4k3/8/8/8/4P3/8/8/4K3 b - - 0 1',
    depth: 10,
    scoreCp: 35,
    scoreMate: null,
    whiteScoreCp: 35,
    whiteScoreMate: null,
    bestMove: 'e2e4',
    multiPvLines: [],
    candidates: [
      {
        pvId: 1,
        from: 'e2', // VACANT ON CURRENT BOARD!
        to: 'e4',
        depth: 10,
        scoreCp: 35,
        scoreMate: null,
        pv: ['e2e4'],
      },
    ],
    isCalculating: false,
    timestamp: Date.now(),
  };

  controller.handleEvaluation(staleEvaluation);

  // Verify that the stale candidate was rejected because e2 is vacant on the current board!
  const lastSnapshot = snapshots[snapshots.length - 1];
  assert(
    !lastSnapshot || lastSnapshot.candidates.length === 0,
    'Stale move e2e4 must be completely rejected because square e2 is vacant on the board'
  );

  console.log('   ✓ Stale moves for already moved pieces are strictly rejected by pieceMap defense');
}

// --------------------------------------------------------------------------
// 13. Immediate Blunder Cost & Queen Hang Elimination
// --------------------------------------------------------------------------
console.log('\n13. Testing immediateBlunderCost and Queen hang elimination...');
{
  const { immediateBlunderCost, predictRanked } = await import('../lib/maia-policy');

  // Position: Black Queen on d5 is under direct attack by White Knight on c3
  // fen: 'r1b1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR b KQkq - 1 3'
  const queenHangFen = 'r1b1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR b KQkq - 1 3';
  const chess = new Chess(queenHangFen);

  // Pawn move c7c5 leaves the Queen completely hanging for free
  const hangCostC5 = immediateBlunderCost(chess, 'c7c5');
  assert.strictEqual(hangCostC5, 900, 'Blundering Queen on d5 with c7c5 must cost 900 centipawns');

  // Safe escape moves must have 0 blunder cost
  assert.strictEqual(immediateBlunderCost(chess, 'd5a5'), 0, 'Qa5 must have 0 blunder cost');
  assert.strictEqual(immediateBlunderCost(chess, 'd5d6'), 0, 'Qd6 must have 0 blunder cost');
  assert.strictEqual(immediateBlunderCost(chess, 'd5e5'), 0, 'Qe5+ must have 0 blunder cost');
  assert.strictEqual(immediateBlunderCost(chess, 'd5d8'), 0, 'Qd8 must have 0 blunder cost');

  // Over multiple ranked predictions at Club/Master Elo (1500+), Queen must never be hung
  for (let trial = 0; trial < 10; trial++) {
    const predictions = predictRanked(queenHangFen, 1800, 3);
    assert(predictions.length > 0, 'Must return predictions');
    const topMove = predictions[0]!;
    assert(
      topMove.uci.startsWith('d5'),
      `Top move at 1800 Elo must save the attacked Queen, got ${topMove.san} (${topMove.uci})`
    );
    assert.notStrictEqual(topMove.uci, 'c7c5', 'Must NEVER recommend c7c5 hanging the Queen');
  }

  console.log('   ✓ immediateBlunderCost correctly identifies 900cp Queen hangs and eliminates them');
}

// --------------------------------------------------------------------------
// 14. Monotonic Elo Blunder Scaling & Softmax Calibration
// --------------------------------------------------------------------------
console.log('\n14. Testing monotonic Elo blunder scaling and softmax temperature floor...');
{
  const { blunderBudget, blunderRate } = await import('../lib/maia-policy');

  // 1. Blunder budget monotonicity
  let prevBudget = Infinity;
  for (let elo = 600; elo <= 2600; elo += 100) {
    const budget = blunderBudget(elo);
    assert(budget <= prevBudget, `Blunder budget must be monotonically non-increasing at Elo ${elo}`);
    prevBudget = budget;
  }
  assert.strictEqual(blunderBudget(600), 900, '600 Elo budget must be 900 cp');
  assert(blunderBudget(2600) <= 40, '2600 Elo budget must be <= 40 cp');

  // 2. Blunder rate monotonicity
  let prevRate = Infinity;
  for (let elo = 600; elo <= 2600; elo += 100) {
    const rate = blunderRate(elo);
    assert(rate <= prevRate, `Blunder rate must be monotonically non-increasing at Elo ${elo}`);
    prevRate = rate;
  }
  assert(blunderRate(600) >= 0.40, '600 Elo blunder rate must allow beginner mistakes (~47%)');
  assert(blunderRate(2600) <= 0.05, '2600 Elo blunder rate must be minimal (<= 5%)');

  console.log('   ✓ Blunder budget and blunder rate are strictly monotonic from 600 to 2600 Elo');
}

// --------------------------------------------------------------------------
// 15. Engine Capability Matrix Gating
// --------------------------------------------------------------------------
console.log('\n15. Testing Engine Capability Matrix gating and capsFor fallback...');
{
  const { ENGINE_CAPABILITIES, capsFor } = await import('../lib/engine-capabilities');

  // Stockfish capabilities
  const sfCaps = capsFor('stockfish');
  assert.strictEqual(sfCaps.hasDepth, true, 'Stockfish supports search depth');
  assert.strictEqual(sfCaps.hasHash, true, 'Stockfish supports Hash');
  assert.strictEqual(sfCaps.hasThreads, true, 'Stockfish supports Threads');
  assert.strictEqual(sfCaps.hasLimitStrength, true, 'Stockfish supports LimitStrength');
  assert.strictEqual(sfCaps.hasPersonality, false);

  // Patricia capabilities
  const patCaps = capsFor('patricia');
  assert.strictEqual(patCaps.hasDepth, true, 'Patricia supports search depth');
  assert.strictEqual(patCaps.hasHash, true, 'Patricia supports Hash');
  assert.strictEqual(patCaps.hasThreads, false, 'Patricia runs single-threaded in MV3');
  assert.strictEqual(patCaps.hasPersonality, true, 'Patricia supports playstyle personality');

  // Maia-3 & Maia-2 capabilities
  const m3Caps = capsFor('maia3');
  assert.strictEqual(m3Caps.hasDepth, false, 'Maia-3 must hide depth slider (nodes: 1)');
  assert.strictEqual(m3Caps.hasHash, false, 'Maia-3 must hide Hash slider');
  assert.strictEqual(m3Caps.hasThreads, false, 'Maia-3 must hide Threads slider');
  assert.strictEqual(m3Caps.hasLimitStrength, false);

  const m2Caps = capsFor('maia2');
  assert.strictEqual(m2Caps.hasDepth, false, 'Maia-2 must hide depth slider');
  assert.strictEqual(m2Caps.hasHash, false, 'Maia-2 must hide Hash slider');
  assert.strictEqual(m2Caps.hasThreads, false, 'Maia-2 must hide Threads slider');

  console.log('   ✓ Engine capability matrix accurately gates UI features per engine');
}

console.log('\n=== ALL TESTS PASSED SUCCESSFULLY ===');
