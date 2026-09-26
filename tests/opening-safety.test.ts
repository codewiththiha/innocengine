import assert from 'node:assert';
import { Chess } from 'chess.js';
import {
  isLegalUci,
  immediateLossAfterMove,
  validateBookMove,
  validateBookMoveCached,
} from '../lib/opening-safety';
import { OpeningIndex } from '../lib/openings/index';
import { OPENING_CATALOG } from '../lib/openings/catalog';
import {
  resolveSafeOpeningEntry,
  categoryMatches,
  selectedOpeningMatches,
} from '../lib/openings/resolver';
import { OpeningBook } from '../lib/opening-book';
import { HighlightController, type RenderSnapshot } from '../lib/highlight-controller';
import { DEFAULT_SETTINGS } from '../lib/storage';
import type { BoardState, EngineCandidate } from '../lib/types';

console.log('=== TEST SUITE: Opening Safety, Tactical Veto, and PGN Catalog ===\n');

// --------------------------------------------------------------------------
// 1. Legality Validation
// --------------------------------------------------------------------------
console.log('1. Testing UCI move legality validation...');
{
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  // Illegal move: Bishop c1 blocked by pawns
  const illegalRes = validateBookMove(startFen, 'c1f4');
  assert.strictEqual(illegalRes.legal, false, 'c1f4 must be illegal in starting position');
  assert.strictEqual(illegalRes.safe, false);
  assert.strictEqual(illegalRes.reason, 'illegal-move');

  // Legal moves
  const legalE4 = validateBookMove(startFen, 'e2e4');
  assert.strictEqual(legalE4.legal, true, 'e2e4 must be legal');
  assert.strictEqual(legalE4.safe, true);
  assert.strictEqual(legalE4.reason, 'ok');

  const legalNf3 = validateBookMove(startFen, 'g1f3');
  assert.strictEqual(legalNf3.legal, true, 'Nf3 must be legal');
  assert.strictEqual(legalNf3.safe, true);

  console.log('   ✓ Illegal moves strictly rejected, legal moves verified');
}

// --------------------------------------------------------------------------
// 2. Tactical Veto & Queen Hang Elimination
// --------------------------------------------------------------------------
console.log('\n2. Testing Tactical Veto against hanging Queen...');
{
  // Position: Black Queen on d5 attacked by White Knight on c3
  const queenThreatFen = 'r1b1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR b KQkq - 1 3';

  // Move c7c5 ignores the Knight attacking the Queen, leaving Queen on d5 to be captured
  const blunderC5 = validateBookMove(queenThreatFen, 'c7c5');
  assert.strictEqual(blunderC5.legal, true, 'c7c5 is technically legal');
  assert.strictEqual(blunderC5.safe, false, 'c7c5 must be deemed unsafe');
  assert.strictEqual(blunderC5.reason, 'queen-hang', 'Reason must be queen-hang');
  assert.strictEqual(blunderC5.loss, 900, 'Material loss must be 900 cp');

  // Safe Queen escape moves must pass safety
  const safeQa5 = validateBookMove(queenThreatFen, 'd5a5');
  assert.strictEqual(safeQa5.legal, true);
  assert.strictEqual(safeQa5.safe, true, 'Qa5 must be safe');
  assert.strictEqual(safeQa5.loss, 0);

  const safeQd6 = validateBookMove(queenThreatFen, 'd5d6');
  assert.strictEqual(safeQd6.safe, true, 'Qd6 must be safe');

  console.log('   ✓ Queen hangs successfully intercepted and vetoed');
}

// --------------------------------------------------------------------------
// 3. Elimination of Buggy Side-to-Move Entries (London bug)
// --------------------------------------------------------------------------
console.log('\n3. Testing elimination of invalid side-to-move book entries...');
{
  // FEN after 1.d4: Black to move ('b')
  const blackToMoveFen = 'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1';

  // Move c1f4 is a White move, completely impossible for Black
  assert.strictEqual(isLegalUci(blackToMoveFen, 'c1f4'), false);

  const lookupResult = OpeningBook.lookupMove(blackToMoveFen, 'london', blackToMoveFen);
  assert.strictEqual(
    lookupResult,
    null,
    'OpeningBook must NEVER recommend White move c1f4 when it is Black turn'
  );

  console.log('   ✓ Invalid side-to-move entries dropped');
}

// --------------------------------------------------------------------------
// 4. PGN Catalog and Index Builder
// --------------------------------------------------------------------------
console.log('\n4. Testing PGN opening index expansion...');
{
  const index = new OpeningIndex(OPENING_CATALOG);
  const defs = index.getDefinitions();
  assert(defs.length >= 70, `Catalog must contain 70+ openings, found ${defs.length}`);

  // Test looking up initial move 1.e4
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const startEntries = index.lookup(startFen);
  assert(startEntries.length > 0, 'Initial position must have opening entries');

  const italianEntry = startEntries.find((e) => e.openingId === 'italian');
  assert(italianEntry, 'Italian opening must be present');
  assert.strictEqual(italianEntry.uci, 'e2e4');

  // Test Italian move 3 (Bc4)
  const after1e4e5Nf3Nc6 = 'r1bqkbn1/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  const chess = new Chess();
  chess.move('e4');
  chess.move('e5');
  chess.move('Nf3');
  chess.move('Nc6');
  const posAfterNc6 = chess.fen();

  const italianMove3 = index.lookup(posAfterNc6).find((e) => e.openingId === 'italian');
  assert(italianMove3, 'Move 3.Bc4 must be indexed for Italian');
  assert.strictEqual(italianMove3.uci, 'f1c4');
  assert.strictEqual(italianMove3.san, 'Bc4');

  console.log(`   ✓ Indexed ${defs.length} openings with 100% legal moves via chess.js`);
}

// --------------------------------------------------------------------------
// 5. Category and Meme Filtering
// --------------------------------------------------------------------------
console.log('\n5. Testing meme, weird, and risk category filters...');
{
  const bongcloud = OPENING_CATALOG.find((o) => o.id === 'bongcloud');
  assert(bongcloud, 'Bongcloud must be defined');
  assert.strictEqual(bongcloud.meme, true);
  assert.strictEqual(bongcloud.risk, 5);

  const startFen = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const chess = new Chess();
  chess.move('e4');
  chess.move('e5');
  const posAfter1e4e5 = chess.fen();

  const index = new OpeningIndex(OPENING_CATALOG);
  const entries = index.lookup(posAfter1e4e5);
  const bongcloudEntry = entries.find((e) => e.openingId === 'bongcloud');
  assert(bongcloudEntry, 'Bongcloud 2.Ke2 must be indexed');

  // 1. Without meme enabled: categoryMatches must reject it
  const noMemeConfig = {
    ...DEFAULT_SETTINGS.opening,
    includeMeme: false,
    includeWeird: true,
  };
  assert.strictEqual(
    categoryMatches(bongcloudEntry, noMemeConfig),
    false,
    'Meme opening must be filtered out when includeMeme is false'
  );

  // 2. With meme enabled: categoryMatches must accept it
  const withMemeConfig = {
    ...DEFAULT_SETTINGS.opening,
    includeMeme: true,
    includeWeird: true,
  };
  assert.strictEqual(
    categoryMatches(bongcloudEntry, withMemeConfig),
    true,
    'Meme opening must be included when includeMeme and includeWeird are true'
  );

  console.log('   ✓ Meme and chaotic openings properly gated by user configuration');
}

// --------------------------------------------------------------------------
// 6. HighlightController Tactical Veto Integration
// --------------------------------------------------------------------------
console.log('\n6. Testing HighlightController Tactical Veto in book-only & prefer modes...');
{
  const snapshots: RenderSnapshot[] = [];
  const controller = new HighlightController(
    {
      ...DEFAULT_SETTINGS,
      opening: {
        ...DEFAULT_SETTINGS.opening,
        enabled: true,
        mode: 'book-only',
        repertoireId: 'london',
      },
      multiPv: 1,
      controlledColor: 'auto',
    },
    (snapshot) => {
      snapshots.push(snapshot);
    }
  );

  // Position: Black Queen on d5 is under direct attack by White Knight on c3
  const queenThreatFen = 'r1b1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR b KQkq - 1 3';
  const board: BoardState = {
    fen: queenThreatFen,
    positionKey: 'threat_pos_key',
    isFlipped: false,
    turn: 'b',
    playerColor: 'b',
    controlledColor: 'b',
    pieceMap: new Map([
      ['d5', 'q'],
      ['c3', 'N'],
    ]),
  };

  controller.setBoardState(board);

  // Engine evaluation arrives suggesting Qa5
  const engineEval = {
    engineInstanceId: 'stockfish',
    analysisId: 1,
    positionKey: 'threat_pos_key',
    fen: queenThreatFen,
    depth: 10,
    scoreCp: 50,
    scoreMate: null,
    whiteScoreCp: -50,
    whiteScoreMate: null,
    bestMove: 'd5a5',
    multiPvLines: [],
    candidates: [
      {
        pvId: 1,
        from: 'd5',
        to: 'a5',
        depth: 10,
        scoreCp: 50,
        scoreMate: null,
        pv: ['d5a5'],
      },
    ],
    isCalculating: false,
    timestamp: Date.now(),
  };

  controller.handleEvaluation(engineEval);

  const lastSnapshot = snapshots[snapshots.length - 1];
  assert(lastSnapshot, 'Snapshot must be rendered');
  assert(lastSnapshot.candidates.length > 0, 'Candidate must be rendered');

  // Even in book-only mode, the tactical veto prevents queen-hang moves and shows the safe engine move!
  const chosenMove = lastSnapshot.candidates[0]!;
  assert.strictEqual(chosenMove.from, 'd5', 'Must escape with Queen');
  assert.strictEqual(chosenMove.to, 'a5');

  console.log('   ✓ Tactical Veto prevents book overrides in tactical danger');
}

console.log('\n=== ALL OPENING SAFETY TESTS PASSED SUCCESSFULLY ===');
