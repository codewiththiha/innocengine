export interface RepertoireEntry {
  move: string;
  name: string;
}

export interface RepertoireMeta {
  id: string;
  name: string;
  category: 'e4' | 'd4' | 'c4' | 'flank';
  description: string;
}

export const REPERTOIRE_LIST: RepertoireMeta[] = [
  { id: 'sicilian', name: 'Sicilian Defense', category: 'e4', description: 'Dynamic, asymmetrical response to 1.e4 with 1...c5' },
  { id: 'queens-gambit', name: "Queen's Gambit", category: 'd4', description: 'Classical battle for center starting with 1.d4 d5 2.c4' },
  { id: 'italian', name: 'Italian Game', category: 'e4', description: 'Open, tactical development beginning with 1.e4 e5 2.Nf3 Nc6 3.Bc4' },
  { id: 'ruy-lopez', name: 'Ruy Lopez (Spanish)', category: 'e4', description: 'Deep strategic battle initiated by 1.e4 e5 2.Nf3 Nc6 3.Bb5' },
  { id: 'caro-kann', name: 'Caro-Kann Defense', category: 'e4', description: 'Solid defense with 1.e4 c6 and early ...d5 counter' },
  { id: 'french', name: 'French Defense', category: 'e4', description: 'Solid pawn chain counterplay with 1.e4 e6 2.d4 d5' },
  { id: 'kings-indian', name: "King's Indian Defense", category: 'd4', description: 'Hypermodern kingside attack defense against 1.d4' },
  { id: 'london', name: 'London System', category: 'd4', description: 'Solid universal system with 1.d4 and 2.Bf4' },
  { id: 'english', name: 'English Opening', category: 'c4', description: 'Flexible flank opening with 1.c4 controlling d5' },
  { id: 'scandinavian', name: 'Scandinavian Defense', category: 'e4', description: 'Direct center challenge with 1.e4 d5' },
];

// Keyed by normalized board placement + turn: "${placement} ${turn}"
const REPERTOIRE_TREES: Record<string, Record<string, RepertoireEntry>> = {
  sicilian: {
    // 1. e4
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': { move: 'e2e4', name: "King's Pawn 1.e4" },
    // 1... c5
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b': { move: 'c7c5', name: 'Sicilian Defense 1...c5' },
    // 2. Nf3
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w': { move: 'g1f3', name: 'Open Sicilian 2.Nf3' },
    // 2... d6
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b': { move: 'd7d6', name: 'Najdorf/Dragon 2...d6' },
    // 3. d4
    'rnbqkbnr/pp2pppp/3p4/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w': { move: 'd2d4', name: 'Open Sicilian 3.d4' },
    // 3... cxd4
    'rnbqkbnr/pp2pppp/3p4/2p5/3PP3/5N2/PPP2PPP/RNBQKB1R b': { move: 'c5d4', name: 'Pawn Exchange 3...cxd4' },
    // 4. Nxd4
    'rnbqkbnr/pp2pppp/3p4/8/3pP3/5N2/PPP2PPP/RNBQKB1R w': { move: 'f3d4', name: 'Recapture 4.Nxd4' },
    // 4... Nf6
    'rnbqkbnr/pp2pppp/3p4/8/3NP3/8/PPP2PPP/RNBQKB1R b': { move: 'g8f6', name: 'Develop Knight 4...Nf6' },
    // 5. Nc3
    'rnbqkb1r/pp2pppp/3p1n2/8/3NP3/8/PPP2PPP/RNBQKB1R w': { move: 'b1c3', name: 'Defend e4 5.Nc3' },
    // 5... a6 (Najdorf)
    'rnbqkb1r/pp2pppp/3p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R b': { move: 'a7a6', name: 'Najdorf Variation 5...a6' },
    // 6. Be2
    'rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w': { move: 'f1e2', name: 'Classical 6.Be2' },
  },

  'queens-gambit': {
    // 1. d4
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': { move: 'd2d4', name: "Queen's Pawn 1.d4" },
    // 1... d5
    'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b': { move: 'd7d5', name: 'Closed Game 1...d5' },
    // 2. c4
    'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w': { move: 'c2c4', name: "Queen's Gambit 2.c4" },
    // 2... e6
    'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b': { move: 'e7e6', name: 'QGD 2...e6' },
    // 3. Nc3
    'rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/8/PP2PPPP/RNBQKBNR w': { move: 'b1c3', name: 'Develop 3.Nc3' },
    // 3... Nf6
    'rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR b': { move: 'g8f6', name: 'Develop Knight 3...Nf6' },
    // 4. cxd5
    'rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w': { move: 'c4d5', name: 'Exchange 4.cxd5' },
    // 4... exd5
    'rnbqkb1r/ppp2ppp/4pn2/3P4/3P4/2N5/PP2PPPP/R1BQKBNR b': { move: 'e7e6', name: 'Recapture 4...exd5' },
    // 5. Bg5
    'rnbqkb1r/ppp2ppp/5n2/3p4/3P4/2N5/PP2PPPP/R1BQKBNR w': { move: 'c1g5', name: 'Pin Knight 5.Bg5' },
    // 5... Be7
    'rnbqkb1r/ppp2ppp/5n2/3p2B1/3P4/2N5/PP2PPPP/R2QKBNR b': { move: 'f8e7', name: 'Unpin 5...Be7' },
  },

  italian: {
    // 1. e4
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': { move: 'e2e4', name: "King's Pawn 1.e4" },
    // 1... e5
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b': { move: 'e7e5', name: 'Open Game 1...e5' },
    // 2. Nf3
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w': { move: 'g1f3', name: 'Knight Attack 2.Nf3' },
    // 2... Nc6
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b': { move: 'b8c6', name: 'Knight Defense 2...Nc6' },
    // 3. Bc4
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w': { move: 'f1c4', name: 'Italian Game 3.Bc4' },
    // 3... Bc5
    'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b': { move: 'f8c5', name: 'Giuoco Piano 3...Bc5' },
    // 4. c3
    'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w': { move: 'c2c3', name: 'Center Prep 4.c3' },
    // 4... Nf6
    'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R b': { move: 'g8f6', name: 'Counterattack 4...Nf6' },
    // 5. d3
    'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R w': { move: 'd2d3', name: 'Giuoco Pianissimo 5.d3' },
  },

  'ruy-lopez': {
    // 1. e4
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': { move: 'e2e4', name: "King's Pawn 1.e4" },
    // 1... e5
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b': { move: 'e7e5', name: 'Open Game 1...e5' },
    // 2. Nf3
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w': { move: 'g1f3', name: 'Knight Attack 2.Nf3' },
    // 2... Nc6
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b': { move: 'b8c6', name: 'Knight Defense 2...Nc6' },
    // 3. Bb5
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w': { move: 'f1b5', name: 'Ruy Lopez 3.Bb5' },
    // 3... a6
    'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b': { move: 'a7a6', name: 'Morphy Defense 3...a6' },
    // 4. Ba4
    'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w': { move: 'b5a4', name: 'Retreat 4.Ba4' },
    // 4... Nf6
    'r1bqkbnr/1ppp1ppp/p1n5/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R b': { move: 'g8f6', name: 'Develop 4...Nf6' },
    // 5. O-O
    'r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R w': { move: 'e1g1', name: 'Kingside Castle 5.O-O' },
  },

  'caro-kann': {
    // 1. e4
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': { move: 'e2e4', name: "King's Pawn 1.e4" },
    // 1... c6
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b': { move: 'c7c6', name: 'Caro-Kann 1...c6' },
    // 2. d4
    'rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w': { move: 'd2d4', name: 'Center Control 2.d4' },
    // 2... d5
    'rnbqkbnr/pp1ppppp/2p5/8/3PP3/8/PPP2PPP/RNBQKBNR b': { move: 'd7d5', name: 'Center Strike 2...d5' },
    // 3. Nc3
    'rnbqkbnr/pp2pppp/2p5/3p4/3PP3/8/PPP2PPP/RNBQKBNR w': { move: 'b1c3', name: 'Classical 3.Nc3' },
    // 3... dxe4
    'rnbqkbnr/pp2pppp/2p5/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b': { move: 'd5e4', name: 'Pawn Trade 3...dxe4' },
    // 4. Nxe4
    'rnbqkbnr/pp2pppp/2p5/8/3Pp3/2N5/PPP2PPP/R1BQKBNR w': { move: 'c3e4', name: 'Recapture 4.Nxe4' },
    // 4... Bf5
    'rnbqkbnr/pp2pppp/2p5/8/3PN3/8/PPP2PPP/R1BQKBNR b': { move: 'c8f5', name: 'Classical 4...Bf5' },
  },

  french: {
    // 1. e4
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': { move: 'e2e4', name: "King's Pawn 1.e4" },
    // 1... e6
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b': { move: 'e7e6', name: 'French Defense 1...e6' },
    // 2. d4
    'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w': { move: 'd2d4', name: 'Center Control 2.d4' },
    // 2... d5
    'rnbqkbnr/pppp1ppp/4p3/8/3PP3/8/PPP2PPP/RNBQKBNR b': { move: 'd7d5', name: 'Strike Center 2...d5' },
    // 3. Nc3
    'rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/8/PPP2PPP/RNBQKBNR w': { move: 'b1c3', name: 'Classical 3.Nc3' },
    // 3... Nf6
    'rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b': { move: 'g8f6', name: 'Classical 3...Nf6' },
    // 4. e5
    'rnbqkb1r/ppp2ppp/4pn2/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR w': { move: 'e4e5', name: 'Advance 4.e5' },
    // 4... Nfd7
    'rnbqkb1r/ppp2ppp/4pn2/3pP3/3P4/2N5/PPP2PPP/R1BQKBNR b': { move: 'f6d7', name: 'Knight Retreat 4...Nfd7' },
  },

  'kings-indian': {
    // 1. d4
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': { move: 'd2d4', name: "Queen's Pawn 1.d4" },
    // 1... Nf6
    'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b': { move: 'g8f6', name: 'Indian Defense 1...Nf6' },
    // 2. c4
    'rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR w': { move: 'c2c4', name: 'Space Advantage 2.c4' },
    // 2... g6
    'rnbqkb1r/pppppppp/5n2/8/2PP4/8/PP2PPPP/RNBQKBNR b': { move: 'g7g6', name: 'Fianchetto Prep 2...g6' },
    // 3. Nc3
    'rnbqkb1r/pppppp1p/5np1/8/2PP4/8/PP2PPPP/RNBQKBNR w': { move: 'b1c3', name: 'Center Support 3.Nc3' },
    // 3... Bg7
    'rnbqkb1r/pppppp1p/5np1/8/2PP4/2N5/PP2PPPP/R1BQKBNR b': { move: 'f8g7', name: 'Fianchetto 3...Bg7' },
    // 4. e4
    'rnbqk2r/ppppppbp/5np1/8/2PP4/2N5/PP2PPPP/R1BQKBNR w': { move: 'e2e4', name: 'Full Center 4.e4' },
    // 4... d6
    'rnbqk2r/ppppppbp/5np1/8/2PPP3/2N5/PP3PPP/R1BQKBNR b': { move: 'd7d6', name: 'Classical KID 4...d6' },
  },

  london: {
    // 1. d4
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': { move: 'd2d4', name: "Queen's Pawn 1.d4" },
    // 1... d5
    'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b': { move: 'd7d5', name: 'Closed Game 1...d5' },
    // 2. Bf4
    'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w': { move: 'c1f4', name: 'London System 2.Bf4' },
    // 2... Nf6
    'rnbqkbnr/ppp1pppp/8/3p4/3P1B2/8/PPP1PPPP/RN1QKBNR b': { move: 'g8f6', name: 'Develop 2...Nf6' },
    // 3. e3
    'rnbqkb1r/ppp1pppp/5n2/3p4/3P1B2/8/PPP1PPPP/RN1QKBNR w': { move: 'e2e3', name: 'Solid Triangle 3.e3' },
    // 3... c5
    'rnbqkb1r/ppp1pppp/5n2/3p4/3P1B2/4P3/PPP2PPP/RN1QKBNR b': { move: 'c7c5', name: 'Challenge Center 3...c5' },
    // 4. c3
    'rnbqkb1r/pp2pppp/5n2/2pp4/3P1B2/4P3/PPP2PPP/RN1QKBNR w': { move: 'c2c3', name: 'Pyramid Structure 4.c3' },
  },

  english: {
    // 1. c4
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': { move: 'c2c4', name: 'English Opening 1.c4' },
    // 1... e5
    'rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b': { move: 'e7e5', name: 'Reversed Sicilian 1...e5' },
    // 2. Nc3
    'rnbqkbnr/pppp1ppp/8/4p3/2P5/8/PP1PPPPP/RNBQKBNR w': { move: 'b1c3', name: 'Develop Knight 2.Nc3' },
    // 2... Nf6
    'rnbqkbnr/pppp1ppp/8/4p3/2P5/2N5/PP1PPPPP/R1BQKBNR b': { move: 'g8f6', name: 'Develop Knight 2...Nf6' },
    // 3. Nf3
    'rnbqkb1r/pppp1ppp/5n2/4p3/2P5/2N5/PP1PPPPP/R1BQKBNR w': { move: 'g1f3', name: 'Four Knights Prep 3.Nf3' },
    // 3... Nc6
    'rnbqkb1r/pppp1ppp/5n2/4p3/2P5/2N2N2/PP1PPPPP/R1BQKB1R b': { move: 'b8c6', name: 'Four Knights 3...Nc6' },
  },

  scandinavian: {
    // 1. e4
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w': { move: 'e2e4', name: "King's Pawn 1.e4" },
    // 1... d5
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b': { move: 'd7d5', name: 'Scandinavian 1...d5' },
    // 2. exd5
    'rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w': { move: 'e4d5', name: 'Capture Center 2.exd5' },
    // 2... Qxd5
    'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b': { move: 'd8d5', name: 'Queen Recapture 2...Qxd5' },
    // 3. Nc3
    'rnb1kbnr/ppp1pppp/8/3q4/8/8/PPPP1PPP/RNBQKBNR w': { move: 'b1c3', name: 'Attack Queen 3.Nc3' },
    // 3... Qa5
    'rnb1kbnr/ppp1pppp/8/3q4/8/2N5/PPPP1PPP/R1BQKBNR b': { move: 'd5a5', name: 'Main Line 3...Qa5' },
  },
};

export class OpeningBook {
  public static lookupMove(positionKeyOrFen: string, repertoireId: string): RepertoireEntry | null {
    if (!positionKeyOrFen || !repertoireId) return null;
    const tree = REPERTOIRE_TREES[repertoireId];
    if (!tree) return null;

    // 1. Match on normalized "${placement} ${turn}" (e.g. "rnbqkbnr/pppppppp/... w")
    const tokens = positionKeyOrFen.trim().split(/\s+/);
    if (tokens.length >= 2) {
      const normalizedKey = `${tokens[0]} ${tokens[1]}`;
      if (tree[normalizedKey]) {
        return tree[normalizedKey];
      }
    }

    // 2. Fallback to exact key
    return tree[positionKeyOrFen] || null;
  }
}
