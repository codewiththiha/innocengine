import { Chess } from 'chess.js';

export interface RepertoireEntry {
  move: string;
  name: string;
}

export interface RepertoireMeta {
  id: string;
  name: string;
  side: 'w' | 'b';
  category: 'e4' | 'd4' | 'c4' | 'flank';
  description: string;
}

export const REPERTOIRE_LIST: RepertoireMeta[] = [
  // White Repertoires
  { id: 'london', name: 'London System', side: 'w', category: 'd4', description: 'Solid universal system for White with 1.d4, 2.Bf4, and fortress development' },
  { id: 'queens-gambit', name: "Queen's Gambit", side: 'w', category: 'd4', description: 'Classical battle for center starting with 1.d4 d5 2.c4' },
  { id: 'italian', name: 'Italian Game', side: 'w', category: 'e4', description: 'Open, classical development beginning with 1.e4 e5 2.Nf3 Nc6 3.Bc4' },
  { id: 'ruy-lopez', name: 'Ruy Lopez (Spanish)', side: 'w', category: 'e4', description: 'Deep strategic battle initiated by 1.e4 e5 2.Nf3 Nc6 3.Bb5' },
  { id: 'english', name: 'English Opening', side: 'w', category: 'c4', description: 'Flexible flank opening with 1.c4 controlling d5' },

  // Black Repertoires
  { id: 'sicilian', name: 'Sicilian Defense', side: 'b', category: 'e4', description: 'Dynamic, aggressive response to 1.e4 with 1...c5 across all White variations' },
  { id: 'caro-kann', name: 'Caro-Kann Defense', side: 'b', category: 'e4', description: 'Solid pawn structure defense with 1...c6 and 2...d5' },
  { id: 'french', name: 'French Defense', side: 'b', category: 'e4', description: 'Solid pawn chain counterplay with 1...e6 and 2...d5 against 1.e4' },
  { id: 'kings-indian', name: "King's Indian Defense", side: 'b', category: 'd4', description: 'Universal hypermodern defense against 1.d4 with ...Nf6, ...g6, ...Bg7, ...d6' },
  { id: 'scandinavian', name: 'Scandinavian Defense', side: 'b', category: 'e4', description: 'Direct center challenge with 1...d5 countering 1.e4 immediately' },
];

// System development moves for universal setups (tried in order if opponent plays off-line)
const SYSTEM_SCHEMAS: Record<string, { side: 'w' | 'b'; plan: Array<{ move: string; name: string }> }> = {
  london: {
    side: 'w',
    plan: [
      { move: 'd2d4', name: "London 1.d4" },
      { move: 'c1f4', name: "London 2.Bf4" },
      { move: 'e2e3', name: "London 3.e3" },
      { move: 'g1f3', name: "London 4.Nf3" },
      { move: 'c2c3', name: "London 5.c3" },
      { move: 'f1d3', name: "London 6.Bd3" },
      { move: 'b1d2', name: "London 7.Nbd2" },
      { move: 'e1g1', name: "London 8.O-O" },
    ],
  },
  'kings-indian': {
    side: 'b',
    plan: [
      { move: 'g8f6', name: "KID 1...Nf6" },
      { move: 'g7g6', name: "KID 2...g6" },
      { move: 'f8g7', name: "KID 3...Bg7" },
      { move: 'd7d6', name: "KID 4...d6" },
      { move: 'e8g8', name: "KID 5...O-O" },
      { move: 'e7e5', name: "KID 6...e5" },
    ],
  },
};

// Tree keyed by normalized board placement + turn: "${placement} ${turn}"
const REPERTOIRE_TREES: Record<string, Record<string, RepertoireEntry>> = {
  // --------------------------------------------------------------------------
  // SICILIAN DEFENSE (Black against 1.e4)
  // --------------------------------------------------------------------------
  sicilian: {
    // 1... c5 against 1.e4
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b': { move: 'c7c5', name: 'Sicilian Defense 1...c5' },

    // Against 2.Nf3 -> 2...d6
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b': { move: 'd7d6', name: 'Najdorf/Dragon 2...d6' },
    // Against 2.Nc3 (Closed Sicilian) -> 2...Nc6
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/2N5/PPPP1PPP/R1BQKBNR b': { move: 'b8c6', name: 'Closed Sicilian 2...Nc6' },
    // Against 2.c3 (Alapin) -> 2...d5
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/2P5/PP1P1PPP/RNBQKBNR b': { move: 'd7d5', name: 'Alapin Counter 2...d5' },
    // Against 2.d4 (Smith-Morra) -> 2...cxd4
    'rnbqkbnr/pp1ppppp/8/2p5/3PP3/8/PPP2PPP/RNBQKBNR b': { move: 'c5d4', name: 'Morra Accepted 2...cxd4' },
    // Against 2.f4 (Grand Prix) -> 2...d5
    'rnbqkbnr/pp1ppppp/8/2p5/4PP2/8/PPPP2PP/RNBQKBNR b': { move: 'd7d5', name: 'Grand Prix Counter 2...d5' },
    // Against 2.Bc4 (Bowdler) -> 2...e6
    'rnbqkbnr/pp1ppppp/8/2p5/2B1P3/8/PPPP1PPP/RNBQK1NR b': { move: 'e7e6', name: 'Blunt Bishop 2...e6' },

    // Open Sicilian 3.d4 cxd4
    'rnbqkbnr/pp2pppp/3p4/2p5/3PP3/5N2/PPP2PPP/RNBQKB1R b': { move: 'c5d4', name: 'Open Sicilian 3...cxd4' },
    // 4.Nxd4 Nf6
    'rnbqkbnr/pp2pppp/3p4/8/3NP3/8/PPP2PPP/RNBQKB1R b': { move: 'g8f6', name: 'Develop Knight 4...Nf6' },
    // 5.Nc3 a6 (Najdorf)
    'rnbqkb1r/pp2pppp/3p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R b': { move: 'a7a6', name: 'Najdorf Variation 5...a6' },
    // 6.Be2 e5 (Najdorf main)
    'rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP1BPPP/R1BQK2R b': { move: 'e7e5', name: 'Najdorf Center 6...e5' },
    // 6.Be3 e5 (English Attack)
    'rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N1B3/PPP2PPP/R2QKB1R b': { move: 'e7e5', name: 'English Attack 6...e5' },
    // 6.Bg5 e6
    'rnbqkb1r/1p2pppp/p2p1n2/6B1/3NP3/2N5/PPP2PPP/R2QKB1R b': { move: 'e7e6', name: 'Najdorf Main 6...e6' },
  },

  // --------------------------------------------------------------------------
  // CARO-KANN DEFENSE (Black against 1.e4)
  // --------------------------------------------------------------------------
  'caro-kann': {
    // 1... c6
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b': { move: 'c7c6', name: 'Caro-Kann 1...c6' },
    // Against 2.d4 -> 2...d5
    'rnbqkbnr/pp1ppppp/2p5/8/3PP3/8/PPP2PPP/RNBQKBNR b': { move: 'd7d5', name: 'Caro-Kann Strike 2...d5' },
    // Against 2.Nf3 -> 2...d5
    'rnbqkbnr/pp1ppppp/2p5/8/4P3/5N2/PPPP1PPP/RNBQKB1R b': { move: 'd7d5', name: 'Two Knights 2...d5' },
    // Against 2.Nc3 -> 2...d5
    'rnbqkbnr/pp1ppppp/2p5/8/4P3/2N5/PPPP1PPP/R1BQKBNR b': { move: 'd7d5', name: 'Two Knights 2...d5' },
    // 3.e5 (Advance) -> 3...Bf5
    'rnbqkbnr/pp2pppp/2p5/3pP3/3P4/8/PPP2PPP/RNBQKBNR b': { move: 'c8f5', name: 'Advance Variation 3...Bf5' },
    // 3.exd5 cxd5 (Exchange)
    'rnbqkbnr/pp2pppp/2p5/3P4/3P4/8/PPP2PPP/RNBQKBNR b': { move: 'c6d5', name: 'Exchange Caro 3...cxd5' },
    // 3.Nc3 dxe4 (Classical)
    'rnbqkbnr/pp2pppp/2p5/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b': { move: 'd5e4', name: 'Classical 3...dxe4' },
    // 4.Nxe4 Bf5
    'rnbqkbnr/pp2pppp/2p5/8/4N3/8/PPPP1PPP/R1BQKBNR b': { move: 'c8f5', name: 'Main Line 4...Bf5' },
  },

  // --------------------------------------------------------------------------
  // FRENCH DEFENSE (Black against 1.e4)
  // --------------------------------------------------------------------------
  french: {
    // 1... e6
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b': { move: 'e7e6', name: 'French Defense 1...e6' },
    // Against 2.d4 -> 2...d5
    'rnbqkbnr/pppp1ppp/4p3/8/3PP3/8/PPP2PPP/RNBQKBNR b': { move: 'd7d5', name: 'French Center 2...d5' },
    // 3.e5 c5 (Advance)
    'rnbqkbnr/ppp2ppp/4p3/3pP3/3P4/8/PPP2PPP/RNBQKBNR b': { move: 'c7c5', name: 'Advance 3...c5' },
    // 3.Nc3 Nf6 (Classical)
    'rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b': { move: 'g8f6', name: 'Classical 3...Nf6' },
    // 3.Nd2 c5 (Tarrasch)
    'rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/8/PPPN1PPP/R1BQKBNR b': { move: 'c7c5', name: 'Tarrasch 3...c5' },
    // 3.exd5 exd5 (Exchange)
    'rnbqkbnr/ppp2ppp/4p3/3P4/3P4/8/PPP2PPP/RNBQKBNR b': { move: 'e6d5', name: 'Exchange 3...exd5' },
  },

  // --------------------------------------------------------------------------
  // KING'S INDIAN DEFENSE (Black against 1.d4)
  // --------------------------------------------------------------------------
  'kings-indian': {
    // 1... Nf6
    'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b': { move: 'g8f6', name: 'KID 1...Nf6' },
    // 2.c4 g6
    'rnbqkb1r/pppppppp/5n2/8/2PP4/8/PP2PPPP/RNBQKBNR b': { move: 'g7g6', name: 'KID Fianchetto 2...g6' },
    // 2.Nf3 g6
    'rnbqkb1r/pppppppp/5n2/8/3P4/5N2/PPP1PPPP/RNBQKB1R b': { move: 'g7g6', name: 'KID Setup 2...g6' },
    // 2.Bf4 g6 (vs London)
    'rnbqkb1r/pppppppp/5n2/8/3P1B2/8/PPP1PPPP/RN1QKBNR b': { move: 'g7g6', name: 'KID vs London 2...g6' },
    // 3.Nc3 Bg7
    'rnbqkb1r/pppppp1p/5np1/8/2PP4/2N5/PP2PPPP/R1BQKBNR b': { move: 'f8g7', name: 'KID Bishop 3...Bg7' },
    // 4.e4 d6
    'rnbqkb1r/ppppppbp/5np1/8/2PPP3/2N5/PP3PPP/R1BQKBNR b': { move: 'd7d6', name: 'KID Fortress 4...d6' },
    // 5.Nf3 O-O
    'rnbqkb1r/ppp1ppbp/3p1np1/8/2PPP3/2N2N2/PP3PPP/R1BQKB1R b': { move: 'e8g8', name: 'KID Castle 5...O-O' },
    // 6.Be2 e5
    'rnbq1rk1/ppp1ppbp/3p1np1/8/2PPP3/2N2N2/PP2BPPP/R1BQK2R b': { move: 'e7e5', name: 'KID Strike 6...e5' },
  },

  // --------------------------------------------------------------------------
  // SCANDINAVIAN DEFENSE (Black against 1.e4)
  // --------------------------------------------------------------------------
  scandinavian: {
    // 1... d5
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b': { move: 'd7d5', name: 'Scandinavian 1...d5' },
    // 2.exd5 Qxd5
    'rnbqkbnr/ppp1pppp/8/3P4/4P3/8/PPPP1PPP/RNBQKBNR b': { move: 'd8d5', name: 'Queen Recapture 2...Qxd5' },
    // 3.Nc3 Qa5
    'rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR b': { move: 'd5a5', name: 'Main Line 3...Qa5' },
    // 4.d4 Nf6
    'rnb1kbnr/ppp1pppp/8/q7/3P4/2N5/PPP2PPP/R1BQKBNR b': { move: 'g8f6', name: 'Develop 4...Nf6' },
    // 5.Nf3 c6
    'rnb1kbnr/ppp1pppp/8/q7/3P4/2N2N2/PPP2PPP/R1BQKB1R b': { move: 'c7c6', name: 'Solid Base 5...c6' },
  },

  // --------------------------------------------------------------------------
  // LONDON SYSTEM (White)
  // --------------------------------------------------------------------------
  london: {
    // 1. d4
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': { move: 'd2d4', name: "London 1.d4" },
    // 2. Bf4 against 1...d5
    'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b': { move: 'c1f4', name: 'London 2.Bf4' },
    'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w': { move: 'c1f4', name: 'London 2.Bf4' },
    // 2. Bf4 against 1...Nf6
    'rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR w': { move: 'c1f4', name: 'London vs Nf6 2.Bf4' },
    // 2. Bf4 against 1...e6
    'rnbqkbnr/pppp1ppp/4p3/8/3P4/8/PPP1PPPP/RNBQKBNR w': { move: 'c1f4', name: 'London vs e6 2.Bf4' },
    // 2. Bf4 against 1...g6
    'rnbqkbnr/pppppp1p/6p1/8/3P4/8/PPP1PPPP/RNBQKBNR w': { move: 'c1f4', name: 'London vs g6 2.Bf4' },
    // 2. Bf4 against 1...c5
    'rnbqkbnr/pp1ppppp/8/2p5/3P4/8/PPP1PPPP/RNBQKBNR w': { move: 'c1f4', name: 'London vs c5 2.Bf4' },

    // 3. e3 against 2...Nf6
    'rnbqkb1r/ppp1pppp/5n2/3p4/3P1B2/8/PPP1PPPP/RN1QKBNR w': { move: 'e2e3', name: 'London 3.e3' },
    'rnbqkb1r/pppppp1p/5np1/8/3P1B2/8/PPP1PPPP/RN1QKBNR w': { move: 'e2e3', name: 'London 3.e3' },
    'rnbqkb1r/pppp1ppp/4pn2/8/3P1B2/8/PPP1PPPP/RN1QKBNR w': { move: 'e2e3', name: 'London 3.e3' },

    // 4. c3 / 4.Nf3
    'rnbqkb1r/ppp1pp1p/5np1/3p4/3P1B2/4P3/PPP2PPP/RN1QKBNR w': { move: 'g1f3', name: 'London 4.Nf3' },
    'rnbqkb1r/ppp1pppp/5n2/3p4/3P1B2/4P3/PPP2PPP/RN1QKBNR w': { move: 'g1f3', name: 'London 4.Nf3' },
  },

  // --------------------------------------------------------------------------
  // QUEEN'S GAMBIT (White)
  // --------------------------------------------------------------------------
  'queens-gambit': {
    // 1. d4
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': { move: 'd2d4', name: "Queen's Pawn 1.d4" },
    // 2. c4 against 1...d5
    'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w': { move: 'c2c4', name: "Queen's Gambit 2.c4" },
    // 2. c4 against 1...Nf6
    'rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR w': { move: 'c2c4', name: "QG vs Indian 2.c4" },
    // 3. Nc3 against 2...e6 (QGD)
    'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b': { move: 'e7e6', name: 'QGD 2...e6' },
    'rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/8/PP2PPPP/RNBQKBNR w': { move: 'b1c3', name: 'Develop 3.Nc3' },
    // 3. Nf3 against 2...c6 (Slav)
    'rnbqkbnr/pp2pppp/2p5/3p4/2PP4/8/PP2PPPP/RNBQKBNR w': { move: 'g1f3', name: 'Slav Defense 3.Nf3' },
    // 3. Nf3 against 2...dxc4 (Accepted)
    'rnbqkbnr/ppp1pppp/8/8/2pP4/8/PP2PPPP/RNBQKBNR w': { move: 'g1f3', name: 'QGA 3.Nf3' },
    // 4. cxd5 against QGD
    'rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w': { move: 'c4d5', name: 'Exchange 4.cxd5' },
    // 4. Bg5 against 3...Nf6
    'rnbqkb1r/ppp2ppp/4pn2/3P4/3P4/2N5/PP2PPPP/R1BQKBNR b': { move: 'e6d5', name: 'Recapture 4...exd5' },
    'rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R w': { move: 'c1g5', name: 'Pin Knight 4.Bg5' },
  },

  // --------------------------------------------------------------------------
  // ITALIAN GAME (White)
  // --------------------------------------------------------------------------
  italian: {
    // 1. e4
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': { move: 'e2e4', name: "King's Pawn 1.e4" },
    // 2. Nf3 against 1...e5
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w': { move: 'g1f3', name: 'Attack e5 2.Nf3' },
    // 3. Bc4 against 2...Nc6
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b': { move: 'b8c6', name: 'Defend e5 2...Nc6' },
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w': { move: 'f1c4', name: 'Italian Game 3.Bc4' },
    // 4. c3 against 3...Bc5 (Giuoco Piano)
    'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w': { move: 'c2c3', name: 'Giuoco Piano 4.c3' },
    // 4. d3 against 3...Nf6 (Two Knights)
    'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w': { move: 'd2d3', name: 'Quiet Italian 4.d3' },
    // 5. d4 after 4.c3 Nf6
    'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R w': { move: 'd2d4', name: 'Center Strike 5.d4' },
  },

  // --------------------------------------------------------------------------
  // RUY LOPEZ (White)
  // --------------------------------------------------------------------------
  'ruy-lopez': {
    // 1. e4
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': { move: 'e2e4', name: "King's Pawn 1.e4" },
    // 2. Nf3
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w': { move: 'g1f3', name: 'Attack e5 2.Nf3' },
    // 3. Bb5 (Spanish)
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w': { move: 'f1b5', name: 'Ruy Lopez 3.Bb5' },
    // 4. Ba4 against 3...a6 (Morphy Defense)
    'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w': { move: 'b5a4', name: 'Morphy Retreat 4.Ba4' },
    // 5. O-O after 4...Nf6
    'r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R w': { move: 'e1g1', name: 'Castle 5.O-O' },
  },

  // --------------------------------------------------------------------------
  // ENGLISH OPENING (White)
  // --------------------------------------------------------------------------
  english: {
    // 1. c4
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': { move: 'c2c4', name: 'English Opening 1.c4' },
    // 2. Nc3 against 1...e5
    'rnbqkbnr/pppp1ppp/8/4p3/2P5/8/PP1PPPPP/RNBQKBNR w': { move: 'b1c3', name: 'Reversed Sicilian 2.Nc3' },
    // 2. Nc3 against 1...c5
    'rnbqkbnr/pp1ppppp/8/2p5/2P5/8/PP1PPPPP/RNBQKBNR w': { move: 'b1c3', name: 'Symmetrical 2.Nc3' },
    // 2. Nc3 against 1...Nf6
    'rnbqkb1r/pppppppp/5n2/8/2P5/8/PP1PPPPP/RNBQKBNR w': { move: 'b1c3', name: 'Anglo-Indian 2.Nc3' },
    // 3. g3
    'rnbqkb1r/pppp1ppp/5n2/4p3/2P5/2N5/PP1PPPPP/R1BQKBNR w': { move: 'g2g3', name: 'Fianchetto 3.g3' },
    // 4. Bg2
    'rnbqkb1r/pppp1ppp/5n2/4p3/2P5/2N3P1/PP1PPP1P/R1BQKBNR w': { move: 'f1g2', name: 'English Bishop 4.Bg2' },
  },
};

export class OpeningBook {
  public static getMeta(repertoireId: string): RepertoireMeta | undefined {
    return REPERTOIRE_LIST.find((r) => r.id === repertoireId);
  }

  public static lookupMove(
    positionKeyOrFen: string,
    repertoireId: string,
    fullFen?: string
  ): RepertoireEntry | null {
    if (!positionKeyOrFen || !repertoireId) return null;

    const meta = this.getMeta(repertoireId);
    const tokens = positionKeyOrFen.trim().split(/\s+/);
    const sideToMove = tokens.length >= 2 ? tokens[1] : (fullFen ? fullFen.split(' ')[1] : 'w');

    // Repertoire check: If this repertoire is for Black, only recommend moves on Black's turn!
    // If for White, only recommend moves on White's turn!
    if (meta && meta.side !== sideToMove) {
      return null;
    }

    const tree = REPERTOIRE_TREES[repertoireId];

    // 1. Direct match on normalized "${placement} ${turn}"
    if (tree && tokens.length >= 2) {
      const normalizedKey = `${tokens[0]} ${tokens[1]}`;
      if (tree[normalizedKey]) {
        return tree[normalizedKey];
      }
    }

    // 2. Fallback to exact key match
    if (tree && tree[positionKeyOrFen]) {
      return tree[positionKeyOrFen];
    }

    // 3. Intelligent System Fallback:
    // If opponent played an unusual or non-disruptive sideline, continue the system plan!
    const system = SYSTEM_SCHEMAS[repertoireId];
    if (system && system.side === sideToMove) {
      const fenToUse = fullFen || (tokens.length >= 4 ? `${tokens.slice(0, 4).join(' ')} 0 1` : '');
      if (fenToUse) {
        try {
          const chess = new Chess(fenToUse);
          const legalMoves = chess.moves({ verbose: true });
          // Find the earliest system plan move that is legal and not hanging
          for (const item of system.plan) {
            const from = item.move.substring(0, 2);
            const to = item.move.substring(2, 4);
            const match = legalMoves.find((m) => m.from === from && m.to === to);
            if (match) {
              return item;
            }
          }
        } catch (_) {}
      }
    }

    return null;
  }
}
