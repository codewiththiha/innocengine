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
import { AdaptiveOpeningSelector } from '../lib/openings/adaptive-selector';
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

// --------------------------------------------------------------------------
// 7. Theory + Engine mode retains independent book and engine highlights
// --------------------------------------------------------------------------
console.log('\n7. Testing Theory + Engine opening comparison mode...');
{
  const snapshots: RenderSnapshot[] = [];
  const controller = new HighlightController(
    {
      ...DEFAULT_SETTINGS,
      multiPv: 1,
      opening: {
        ...DEFAULT_SETTINGS.opening,
        enabled: true,
        mode: 'parallel',
        selectedOpeningIds: ['london'],
      },
    },
    (snapshot) => snapshots.push(snapshot)
  );

  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  controller.setBoardState({
    fen: startFen,
    positionKey: 'parallel_start',
    isFlipped: false,
    turn: 'w',
    playerColor: 'w',
    controlledColor: 'auto',
    pieceMap: new Map([
      ['e2', 'P'],
      ['d2', 'P'],
    ]),
  });

  controller.handleEvaluation({
    engineInstanceId: 'stockfish',
    analysisId: 1,
    positionKey: 'parallel_start',
    fen: startFen,
    depth: 14,
    scoreCp: 20,
    scoreMate: null,
    whiteScoreCp: 20,
    whiteScoreMate: null,
    bestMove: 'e2e4',
    multiPvLines: [],
    candidates: [
      {
        pvId: 1,
        from: 'e2',
        to: 'e4',
        depth: 14,
        scoreCp: 20,
        scoreMate: null,
        pv: ['e2e4'],
      },
    ],
    isCalculating: false,
    timestamp: Date.now(),
  });

  const comparisonSnapshot = snapshots[snapshots.length - 1];
  assert(comparisonSnapshot, 'Theory + Engine must render a comparison snapshot');
  assert.strictEqual(comparisonSnapshot.candidates.length, 2, 'Comparison mode must retain the engine line and append theory');
  assert.deepStrictEqual(
    comparisonSnapshot.candidates.map((candidate) => `${candidate.from}${candidate.to}`),
    ['e2e4', 'd2d4'],
    'A safe book move must remain visible even when it does not match the engine move'
  );
  assert.strictEqual(comparisonSnapshot.candidates[0]?.isBookMove, undefined, 'Engine variation must retain its engine treatment');
  assert.strictEqual(comparisonSnapshot.candidates[1]?.isBookMove, true, 'Theory variation must retain its book treatment');

  const afterThreePlies = new Chess();
  afterThreePlies.move('e4');
  afterThreePlies.move('c5');
  afterThreePlies.move('Nf3');
  const depthLimitedSnapshots: RenderSnapshot[] = [];
  const depthLimitedController = new HighlightController(
    {
      ...DEFAULT_SETTINGS,
      multiPv: 1,
      opening: {
        ...DEFAULT_SETTINGS.opening,
        enabled: true,
        mode: 'parallel',
        maxPlies: 2,
        selectedOpeningIds: ['sicilian-najdorf'],
      },
    },
    (snapshot) => depthLimitedSnapshots.push(snapshot)
  );
  depthLimitedController.setBoardState({
    fen: afterThreePlies.fen(),
    positionKey: 'parallel_after_limit',
    isFlipped: true,
    turn: 'b',
    playerColor: 'b',
    controlledColor: 'auto',
    pieceMap: new Map([['g8', 'n']]),
  });
  depthLimitedController.handleEvaluation({
    engineInstanceId: 'stockfish',
    analysisId: 1,
    positionKey: 'parallel_after_limit',
    fen: afterThreePlies.fen(),
    depth: 14,
    scoreCp: 0,
    scoreMate: null,
    whiteScoreCp: 0,
    whiteScoreMate: null,
    bestMove: 'g8f6',
    multiPvLines: [],
    candidates: [{ pvId: 1, from: 'g8', to: 'f6', depth: 14, scoreCp: 0, scoreMate: null, pv: ['g8f6'] }],
    isCalculating: false,
    timestamp: Date.now(),
  });

  const depthLimitedSnapshot = depthLimitedSnapshots[depthLimitedSnapshots.length - 1];
  assert(depthLimitedSnapshot, 'Depth-limited comparison mode must render engine analysis');
  assert.strictEqual(depthLimitedSnapshot.candidates.length, 1, 'Theory must stop once the configured ply limit is exceeded');
  assert.strictEqual(depthLimitedSnapshot.candidates[0]?.isBookMove, undefined);

  console.log('   ✓ Theory and engine remain independent until the configured book depth');
}

// --------------------------------------------------------------------------
// 8. Repertoire Side Isolation (White vs Black)
// --------------------------------------------------------------------------
console.log('\n8. Testing repertoire side isolation (White vs Black openings)...');
{
  const index = new OpeningIndex(OPENING_CATALOG);

  // White start position
  const whiteStartFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const whiteSettings = {
    ...DEFAULT_SETTINGS,
    opening: {
      ...DEFAULT_SETTINGS.opening,
      enabled: true,
      mode: 'adaptive' as const,
      selectedOpeningIds: [],
    },
  };

  const whiteResolved = resolveSafeOpeningEntry(index, whiteStartFen, whiteSettings, [], 'w');
  assert(whiteResolved !== null, 'White must receive opening recommendation at start');
  assert.strictEqual(whiteResolved.side, 'w', 'Recommended opening at start must be for White');

  // Verify no Black openings indexed at start
  const allStartEntries = index.lookup(whiteStartFen);
  const blackEntriesAtStart = allStartEntries.filter((e) => e.side === 'b');
  assert.strictEqual(blackEntriesAtStart.length, 0, 'No Black openings must be indexed at White start turn');

  // Black position after 1.e4
  const chess1e4 = new Chess();
  chess1e4.move('e4');
  const blackTurnFen = chess1e4.fen();

  const blackSettings = {
    ...DEFAULT_SETTINGS,
    opening: {
      ...DEFAULT_SETTINGS.opening,
      enabled: true,
      mode: 'adaptive' as const,
      selectedOpeningIds: [],
    },
  };

  const blackResolved = resolveSafeOpeningEntry(index, blackTurnFen, blackSettings, [], 'b');
  assert(blackResolved !== null, 'Black must receive opening response to 1.e4');
  assert.strictEqual(blackResolved.side, 'b', 'Recommended response to 1.e4 must be for Black');

  // Ensure White openings (e.g. Italian, Vienna) are NEVER recommended for Black
  const blackReplies = index.lookup(blackTurnFen);
  const whiteOpeningsAsBlackReply = blackReplies.filter((e) => e.side === 'w');
  assert.strictEqual(whiteOpeningsAsBlackReply.length, 0, 'White openings must never be indexed as Black turn recommendations');

  console.log('   ✓ Perfect side isolation: White openings only for White, Black defenses only for Black');
}

// --------------------------------------------------------------------------
// 9. Opponent Turn Gating & HighlightController Role Consistency
// --------------------------------------------------------------------------
console.log('\n9. Testing HighlightController role consistency and opponent turn gating...');
{
  const snapshots: RenderSnapshot[] = [];
  const controller = new HighlightController(
    {
      ...DEFAULT_SETTINGS,
      highlightPlayerMoves: true,
      highlightOpponentMoves: false,
      opening: {
        ...DEFAULT_SETTINGS.opening,
        enabled: true,
        mode: 'adaptive',
      },
      controlledColor: 'auto',
    },
    (snapshot) => {
      snapshots.push(snapshot);
    }
  );

  // Player is Black (isFlipped = true, playerColor = 'b')
  // Turn 1: White moves first (turn = 'w' -> opponent turn)
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  controller.setBoardState({
    fen: startFen,
    positionKey: 'pos_start',
    isFlipped: true,
    turn: 'w',
    playerColor: 'b',
    controlledColor: 'auto',
    pieceMap: new Map(),
  });

  // Since it is White turn and player is Black, and highlightOpponentMoves is false:
  // Controller must NOT show opening book moves for White!
  const lastSnap = snapshots[snapshots.length - 1];
  assert(lastSnap, 'Snapshot emitted');
  assert.strictEqual(lastSnap.candidates.length, 0, 'Book moves must NOT be shown on opponent turn');

  // Now White plays 1.e4 -> it is Black turn (turn = 'b' -> player turn!)
  const chess1 = new Chess();
  chess1.move('e4');
  const fenAfterE4 = chess1.fen();

  controller.setBoardState({
    fen: fenAfterE4,
    positionKey: 'pos_after_e4',
    isFlipped: true,
    turn: 'b',
    playerColor: 'b',
    controlledColor: 'auto',
    pieceMap: new Map(),
  });

  const snapAfterE4 = snapshots[snapshots.length - 1];
  assert(snapAfterE4, 'Snapshot emitted for player turn');
  assert(snapAfterE4.candidates.length > 0, 'Player must receive candidate moves on their turn');
  assert.strictEqual(snapAfterE4.candidates[0]?.isBookMove, true, 'Repertoire move recommended for player');

  console.log('   ✓ Opponent turn book recommendations strictly gated');
}

// --------------------------------------------------------------------------
// 10. Specific Repertoire Filtering (White: London, Black: Sicilian)
// --------------------------------------------------------------------------
console.log('\n10. Testing specific repertoire selection filtering...');
{
  const index = new OpeningIndex(OPENING_CATALOG);
  const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  // Configure London System specifically
  const londonConfig = {
    ...DEFAULT_SETTINGS,
    opening: {
      ...DEFAULT_SETTINGS.opening,
      enabled: true,
      selectedOpeningIds: ['london'],
    },
  };

  const londonResolved = resolveSafeOpeningEntry(index, startFen, londonConfig, [], 'w');
  assert(londonResolved, 'London System must resolve');
  assert.strictEqual(londonResolved.openingId, 'london');
  assert.strictEqual(londonResolved.uci, 'd2d4');

  // Configure Sicilian Najdorf specifically for Black
  const chess = new Chess();
  chess.move('e4');
  const afterE4Fen = chess.fen();

  const sicilianConfig = {
    ...DEFAULT_SETTINGS,
    opening: {
      ...DEFAULT_SETTINGS.opening,
      enabled: true,
      selectedOpeningIds: ['sicilian-najdorf'],
    },
  };

  const sicilianResolved = resolveSafeOpeningEntry(index, afterE4Fen, sicilianConfig, [], 'b');
  assert(sicilianResolved, 'Sicilian Najdorf must resolve');
  assert.strictEqual(sicilianResolved.openingId, 'sicilian-najdorf');
  assert.strictEqual(sicilianResolved.uci, 'c7c5');

  console.log('   ✓ Explicit user repertoire selections accurately resolved');
}

// --------------------------------------------------------------------------
// 11. Adaptive selected-opening fallback
// --------------------------------------------------------------------------
console.log('\n11. Testing adaptive fallback across selected openings...');
{
  assert.strictEqual(DEFAULT_SETTINGS.opening.adaptiveSelection, true, 'Adaptive selected-opening matching must be enabled by default');

  const index = new OpeningIndex(OPENING_CATALOG);
  const selector = new AdaptiveOpeningSelector();
  const settings = {
    ...DEFAULT_SETTINGS,
    opening: {
      ...DEFAULT_SETTINGS.opening,
      enabled: true,
      mode: 'parallel' as const,
      adaptiveSelection: true,
      selectedOpeningIds: ['london', 'qgd-classical'],
    },
  };

  const game = new Chess();
  const startResolution = resolveSafeOpeningEntry(index, game.fen(), settings, [], 'w', { selector });
  assert(startResolution, 'A selected opening must resolve at the starting position');
  assert.strictEqual(startResolution.openingId, 'london', 'The safer active selected line should be preferred first');

  game.move('d4');
  game.move('d5');
  const activeLineResolution = resolveSafeOpeningEntry(index, game.fen(), settings, [], 'w', { selector });
  assert(activeLineResolution, 'The active selected line must remain available after the opponent reply');
  assert.strictEqual(activeLineResolution.openingId, 'london', 'The selector must continue the active matching line');
  assert.strictEqual(activeLineResolution.uci, 'c1f4');

  // White chooses the Queen's Gambit move instead of the active London suggestion.
  // After Black's ...e6, only the other selected line still has a matching next step.
  game.move('c4');
  game.move('e6');
  const fallbackResolution = resolveSafeOpeningEntry(index, game.fen(), settings, [], 'w', { selector });
  assert(fallbackResolution, 'A different matching selected line must be considered after a deviation');
  assert.strictEqual(fallbackResolution.openingId, 'qgd-classical');
  assert.strictEqual(fallbackResolution.uci, 'b1c3');

  console.log('   ✓ Active lines continue when valid and fall back to another selected match after a deviation');
}

// --------------------------------------------------------------------------
// 12. Role Inversion Prevention & BoardParser Player Color Detection
// --------------------------------------------------------------------------
console.log('\n12. Testing BoardParser player color detection and captured piece immunity...');
{
  // Simulated DOM environment for Node testing
  const mockBottomPlayer = {
    classList: {
      contains: (cls: string) => false,
    },
    getAttribute: (attr: string) => null,
    // Captured pieces container: holds opponent pieces captured by user!
    querySelector: (sel: string) => {
      if (sel.includes('.piece.wk') || sel.includes('.piece-white')) {
        return { className: 'piece wk' };
      }
      return null;
    },
  };

  const originalDoc = (global as any).document;
  (global as any).document = {
    querySelector: (sel: string) => {
      if (sel.includes('.board-layout-player.bottom')) return mockBottomPlayer;
      return null;
    },
    querySelectorAll: () => [],
  };

  const { BoardParser } = await import('../lib/board-parser');
  const mockBoard = {
    classList: { contains: () => false },
    hasAttribute: () => false,
    getAttribute: () => null,
    closest: () => null,
    querySelectorAll: () => [],
    querySelector: () => null,
  } as any;

  // When board is flipped (isFlipped = true), user is playing Black
  // Even if captured pieces container has captured White pieces (.piece.wk), playerColor must be 'b'
  const detectedColorWhenFlipped = BoardParser.detectPlayerColor(mockBoard, true);
  assert.strictEqual(
    detectedColorWhenFlipped,
    'b',
    'Player color must be Black when board is flipped, immune to captured White pieces'
  );

  // When board is not flipped (isFlipped = false), user is playing White
  const detectedColorWhenNotFlipped = BoardParser.detectPlayerColor(mockBoard, false);
  assert.strictEqual(
    detectedColorWhenNotFlipped,
    'w',
    'Player color must be White when board is not flipped'
  );

  (global as any).document = originalDoc;
  console.log('   ✓ Captured piece immunity: Black player never flips to White upon capturing White pieces');
}

// --------------------------------------------------------------------------
// 12. Authoritative Player Color Resolution (Clock, Session, Avatar, Captures)
// --------------------------------------------------------------------------
console.log('\n12. Testing Authoritative Player Color Resolution...');
{
  const { BoardParser } = await import('../lib/board-parser');
  const originalDoc = (global as any).document;
  const originalWindow = (global as any).window;

  // Case A: Bottom clock has .clock-black -> Player is Black ('b')
  (global as any).document = {
    querySelector: (sel: string) => {
      if (sel.includes('#board-layout-player-bottom .clock-component')) {
        return {
          classList: { contains: (cls: string) => cls === 'clock-black' },
          getAttribute: () => null,
        };
      }
      return null;
    },
    querySelectorAll: () => [],
  };
  const colorFromBottomBlackClock = BoardParser.detectPlayerColor({} as any, false);
  assert.strictEqual(colorFromBottomBlackClock, 'b', 'Bottom clock-black must identify player as Black');

  // Case B: Bottom clock has .clock-white -> Player is White ('w')
  (global as any).document = {
    querySelector: (sel: string) => {
      if (sel.includes('#board-layout-player-bottom .clock-component')) {
        return {
          classList: { contains: (cls: string) => cls === 'clock-white' },
          getAttribute: () => null,
        };
      }
      return null;
    },
    querySelectorAll: () => [],
  };
  const colorFromBottomWhiteClock = BoardParser.detectPlayerColor({} as any, true);
  assert.strictEqual(colorFromBottomWhiteClock, 'w', 'Bottom clock-white must identify player as White');

  // Case C: Session username cross-check
  // Logged-in user is 'GrandmasterThiha'. Bottom tagline is 'OpponentPlayer'.
  // Top clock is .clock-black -> Player is Black ('b')
  (global as any).window = {
    context: { user: { username: 'GrandmasterThiha' } },
  };
  (global as any).document = {
    querySelector: (sel: string) => {
      if (sel.includes('user-tagline-username')) {
        return { textContent: 'OpponentPlayer' };
      }
      if (sel.includes('#board-layout-player-top .clock-component')) {
        return {
          classList: { contains: (cls: string) => cls === 'clock-black' },
          getAttribute: () => null,
        };
      }
      if (sel.includes('#board-layout-player-bottom .clock-component')) {
        return {
          classList: { contains: (cls: string) => cls === 'clock-white' },
          getAttribute: () => null,
        };
      }
      return null;
    },
    querySelectorAll: () => [],
  };
  const colorFromCrossCheck = BoardParser.detectPlayerColor({} as any, false);
  assert.strictEqual(colorFromCrossCheck, 'b', 'Mismatched bottom username must cross-check to top player clock');

  // Case D: Captured pieces container player-color="2" -> Black
  (global as any).window = undefined;
  (global as any).document = {
    querySelector: (sel: string) => {
      if (sel.includes('wc-captured-pieces')) {
        return {
          getAttribute: (attr: string) => (attr === 'player-color' ? '2' : null),
        };
      }
      return null;
    },
    querySelectorAll: () => [],
  };
  const colorFromCapturedPieces = BoardParser.detectPlayerColor({} as any, false);
  assert.strictEqual(colorFromCapturedPieces, 'b', 'Captured pieces player-color="2" must identify Black');

  // Case E: Avatar image source check (white_400.png)
  (global as any).document = {
    querySelector: (sel: string) => {
      if (sel.includes('img.avatar')) {
        return {
          getAttribute: (attr: string) => (attr === 'src' ? '/images/avatars/white_400.png' : null),
        };
      }
      return null;
    },
    querySelectorAll: () => [],
  };
  const colorFromAvatar = BoardParser.detectPlayerColor({} as any, true);
  assert.strictEqual(colorFromAvatar, 'w', 'Avatar white_400.png must identify White');

  (global as any).document = originalDoc;
  (global as any).window = originalWindow;
  console.log('   ✓ Authoritative player color resolution verified across clocks, session, captures, and avatars');
}

// --------------------------------------------------------------------------
// 13. Authoritative Turn Detection (Clock First, Ply Count Second, Highlight Immunity)
// --------------------------------------------------------------------------
console.log('\n13. Testing Authoritative Turn Detection & Highlight Immunity...');
{
  const { BoardParser } = await import('../lib/board-parser');
  const originalDoc = (global as any).document;

  // Case A: Active clock marked with .clock-player-turn carrying .clock-black -> 'b'
  (global as any).document = {
    querySelector: (sel: string) => {
      if (sel.includes('clock-player-turn')) {
        return {
          classList: { contains: (cls: string) => cls === 'clock-black' },
        };
      }
      return null;
    },
    querySelectorAll: () => [],
  };
  const turnFromClockBlack = BoardParser.detectTurn(null, 'w');
  assert.strictEqual(turnFromClockBlack, 'b', 'Active clock-black must indicate Black turn');

  // Case B: Ply count with 5 plies -> White turn is next ('b' because 5 % 2 === 1, so Black's turn)
  // Even plies -> 'w', Odd plies -> 'b'
  (global as any).document = {
    querySelector: () => null,
    querySelectorAll: (sel: string) => {
      if (sel.includes('.main-line-ply')) {
        // 4 moves played -> 4 % 2 === 0 -> White turn ('w')
        return [{}, {}, {}, {}];
      }
      return [];
    },
  };
  const turnFrom4Plies = BoardParser.detectTurn(null, 'b');
  assert.strictEqual(turnFrom4Plies, 'w', '4 completed plies must indicate White turn');

  (global as any).document = {
    querySelector: () => null,
    querySelectorAll: (sel: string) => {
      if (sel.includes('.main-line-ply')) {
        // 5 moves played -> 5 % 2 === 1 -> Black turn ('b')
        return [{}, {}, {}, {}, {}];
      }
      return [];
    },
  };
  const turnFrom5Plies = BoardParser.detectTurn(null, 'w');
  assert.strictEqual(turnFrom5Plies, 'b', '5 completed plies must indicate Black turn');

  // Case C: Highlight Immunity
  // Native highlights on the board must NEVER change or influence detected turn!
  const mockBoardWithHighlights = {
    classList: { contains: () => false },
    querySelectorAll: (sel: string) => {
      if (sel.includes('.highlight')) {
        return [{ classList: ['highlight', 'square-52'] }, { classList: ['highlight', 'square-54'] }];
      }
      return [];
    },
  } as any;
  (global as any).document = {
    querySelector: (sel: string) => {
      if (sel.includes('clock-player-turn')) {
        return {
          classList: { contains: (cls: string) => cls === 'clock-white' },
        };
      }
      return null;
    },
    querySelectorAll: () => [],
  };
  const turnWithHighlights = BoardParser.detectTurn(mockBoardWithHighlights, 'b');
  assert.strictEqual(turnWithHighlights, 'w', 'Clicking pieces and highlights must never invert turn');

  (global as any).document = originalDoc;
  console.log('   ✓ Authoritative turn detection verified with complete highlight immunity');
}

// --------------------------------------------------------------------------
// 14. Game Lifecycle & Game-over Gating
// --------------------------------------------------------------------------
console.log('\n14. Testing Game Lifecycle & Game-over Gating...');
{
  const { BoardParser } = await import('../lib/board-parser');
  const originalDoc = (global as any).document;

  // Active board
  const activeBoard = {
    classList: { contains: (cls: string) => false },
  } as any;
  (global as any).document = {
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  assert.strictEqual(BoardParser.isGameActive(activeBoard), true, 'Standard board must be active');

  // Disabled board (board-disabled class)
  const disabledBoard = {
    classList: { contains: (cls: string) => cls === 'board-disabled' },
  } as any;
  assert.strictEqual(BoardParser.isGameActive(disabledBoard), false, 'board-disabled class must mark game inactive');

  // Game over modal present
  (global as any).document = {
    querySelector: (sel: string) => {
      if (sel.includes('game-over-modal-shell-container')) return {};
      return null;
    },
    querySelectorAll: () => [],
  };
  assert.strictEqual(BoardParser.isGameActive(activeBoard), false, 'Game over modal must mark game inactive');

  (global as any).document = originalDoc;
  console.log('   ✓ Game lifecycle and game-over gating verified');
}

// --------------------------------------------------------------------------
// 15. HighlightController Gating under Inactive Game & Flipped Black Play
// --------------------------------------------------------------------------
console.log('\n15. Testing HighlightController Gating under Inactive Game & Flipped Black Play...');
{
  const snapshots: RenderSnapshot[] = [];
  const controller = new HighlightController(
    {
      ...DEFAULT_SETTINGS,
      highlightPlayerMoves: true,
      highlightOpponentMoves: false,
      opening: {
        ...DEFAULT_SETTINGS.opening,
        enabled: true,
        mode: 'book-only',
        selectedOpeningIds: ['sicilian-najdorf'],
      },
    },
    (snapshot) => {
      snapshots.push(snapshot);
    }
  );

  // Inactive game board state (game over)
  controller.setBoardState({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    positionKey: 'game_over_pos',
    isFlipped: false,
    turn: 'w',
    playerColor: 'w',
    controlledColor: 'auto',
    pieceMap: new Map(),
    isGameActive: false,
  });

  const inactiveSnap = snapshots[snapshots.length - 1];
  assert(inactiveSnap, 'Snapshot emitted for inactive game');
  assert.strictEqual(inactiveSnap.candidates.length, 0, 'Inactive game must emit 0 candidates');

  // Black player on flipped board on White turn (opponent turn)
  controller.setBoardState({
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    positionKey: 'turn_1_white_turn',
    isFlipped: true,
    turn: 'w',
    playerColor: 'b',
    controlledColor: 'auto',
    pieceMap: new Map(),
    isGameActive: true,
  });
  const oppSnap = snapshots[snapshots.length - 1];
  assert(oppSnap, 'Snapshot emitted for opponent turn');
  assert.strictEqual(oppSnap.candidates.length, 0, 'Black player must receive 0 candidates on opponent (White) turn');

  // Black player on flipped board on Black turn (player turn after 1.e4)
  const chess = new Chess();
  chess.move('e4');
  controller.setBoardState({
    fen: chess.fen(),
    positionKey: 'turn_1_black_turn',
    isFlipped: true,
    turn: 'b',
    playerColor: 'b',
    controlledColor: 'auto',
    pieceMap: new Map(),
    isGameActive: true,
  });
  const blackPlayerSnap = snapshots[snapshots.length - 1];
  assert(blackPlayerSnap, 'Snapshot emitted for Black player turn');
  assert(blackPlayerSnap.candidates.length > 0, 'Black player must receive candidates on Black turn');
  assert.strictEqual(blackPlayerSnap.candidates[0]?.from, 'c7', 'Black plays Sicilian 1...c5');
  assert.strictEqual(blackPlayerSnap.candidates[0]?.to, 'c5');

  console.log('   ✓ Inactive game suppression and Black player flipped board gating strictly verified');
}

// --------------------------------------------------------------------------
// 16. Instant Grid-Diff Turn Transition & GameStateAdapter Passthrough
// --------------------------------------------------------------------------
console.log('\n16. Testing Instant Grid-Diff Turn Transition & GameStateAdapter Passthrough...');
{
  const { BoardParser } = await import('../lib/board-parser');
  const { GameStateAdapter } = await import('../lib/game-state-adapter');

  function makePiece(cls: string) {
    const classList = new Set(cls.split(' '));
    return {
      classList: {
        contains: (c: string) => classList.has(c),
        [Symbol.iterator]: () => classList.values(),
      },
      className: cls,
      dataset: {},
      style: {},
      closest: () => null,
    };
  }

  // Create standard starting pieces
  const whitePieces = [
    'piece wr square-11', 'piece wn square-21', 'piece wb square-31', 'piece wq square-41',
    'piece wk square-51', 'piece wb square-61', 'piece wn square-71', 'piece wr square-81',
    'piece wp square-12', 'piece wp square-22', 'piece wp square-32', 'piece wp square-42',
    'piece wp square-52', 'piece wp square-62', 'piece wp square-72', 'piece wp square-82',
  ];
  const blackPieces = [
    'piece br square-18', 'piece bn square-28', 'piece bb square-38', 'piece bq square-48',
    'piece bk square-58', 'piece bb square-68', 'piece bn square-78', 'piece br square-88',
    'piece bp square-17', 'piece bp square-27', 'piece bp square-37', 'piece bp square-47',
    'piece bp square-57', 'piece bp square-67', 'piece bp square-77', 'piece bp square-87',
  ];

  const initialPieces = [...whitePieces, ...blackPieces].map(makePiece);

  const initialBoardMock = {
    classList: { contains: () => false },
    hasAttribute: () => false,
    getAttribute: () => null,
    closest: () => null,
    getBoundingClientRect: () => ({ width: 800, height: 800 }),
    querySelectorAll: (sel: string) => (sel.includes('.piece') ? initialPieces : []),
    querySelector: () => null,
  } as any;

  const initialState = BoardParser.extractBoardState(initialBoardMock);
  assert(initialState, 'Initial board state must parse');
  assert.strictEqual(initialState.turn, 'w', 'Initial turn must be White');

  // White moves pawn from e2 (square-52) to e4 (square-54)
  const afterE4Pieces = initialPieces.map((p) => {
    if (p.className === 'piece wp square-52') {
      return makePiece('piece wp square-54');
    }
    return p;
  });

  const afterE4BoardMock = {
    classList: { contains: () => false },
    hasAttribute: () => false,
    getAttribute: () => null,
    closest: () => null,
    getBoundingClientRect: () => ({ width: 800, height: 800 }),
    querySelectorAll: (sel: string) => (sel.includes('.piece') ? afterE4Pieces : []),
    querySelector: () => null,
  } as any;

  const afterE4State = BoardParser.extractBoardState(afterE4BoardMock);
  assert(afterE4State, 'Board state after 1.e4 must parse');
  assert.strictEqual(
    afterE4State.turn,
    'b',
    'Turn must transition immediately to Black via grid diffing before clock element updates'
  );

  // Test GameStateAdapter passthrough with existingGridState
  const gameState = GameStateAdapter.extractGameState(afterE4BoardMock, afterE4State.turn, afterE4State);
  assert(gameState, 'GameState must resolve via existingGridState');
  assert.strictEqual(gameState.turn, 'b', 'GameState must preserve instantaneous Black turn');
  assert(gameState.fen.includes('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b'), 'FEN reflects 1.e4 b');

  console.log('   ✓ Instant grid-diff turn transition and GameStateAdapter passthrough verified');
}

console.log('\n=== ALL OPENING SAFETY TESTS PASSED SUCCESSFULLY ===');
