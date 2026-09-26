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
  { id: 'queens-gambit', name: "Queen's Gambit", category: 'd4', description: 'Solid classical pawn structure starting with 1.d4 d5 2.c4' },
  { id: 'italian', name: 'Italian Game', category: 'e4', description: 'Open, tactical development beginning with 1.e4 e5 2.Nf3 Nc6 3.Bc4' },
  { id: 'ruy-lopez', name: 'Ruy Lopez (Spanish)', category: 'e4', description: 'Deep strategic battle initiated by 1.e4 e5 2.Nf3 Nc6 3.Bb5' },
  { id: 'caro-kann', name: 'Caro-Kann Defense', category: 'e4', description: 'Resilient solid defense with 1.e4 c6 and early ...d5 counter' },
  { id: 'french', name: 'French Defense', category: 'e4', description: 'Solid pawn chain counterplay with 1.e4 e6 2.d4 d5' },
  { id: 'kings-indian', name: "King's Indian Defense", category: 'd4', description: 'Hypermodern kingside attack defense against 1.d4' },
];

const REPERTOIRE_TREES: Record<string, Record<string, RepertoireEntry>> = {
  sicilian: {
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -': { move: 'e2e4', name: "King's Pawn" },
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3': { move: 'c7c5', name: 'Sicilian Defense' },
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq c6': { move: 'g1f3', name: 'Open Sicilian Prep' },
    'rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -': { move: 'd7d6', name: 'Classical/Najdorf Move' },
    'rnbqkbnr/pp2pppp/3p4/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -': { move: 'd2d4', name: 'Open Sicilian d4' },
    'rnbqkbnr/pp2pppp/3p4/2p5/3PP3/5N2/PPP2PPP/RNBQKB1R b KQkq d3': { move: 'c5d4', name: 'Sicilian Trade' },
    'rnbqkbnr/pp2pppp/3p4/8/3pP3/5N2/PPP2PPP/RNBQKB1R w KQkq -': { move: 'f3d4', name: 'Nxd4 Recapture' },
    'rnbqkbnr/pp2pppp/3p4/8/3NP3/8/PPP2PPP/RNBQKB1R b KQkq -': { move: 'g8f6', name: 'Develop Knight' },
    'rnbqkb1r/pp2pppp/3p1n2/8/3NP3/8/PPP2PPP/RNBQKB1R w KQkq -': { move: 'b1c3', name: 'Nc3 Defense' },
    'rnbqkb1r/pp2pppp/3p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R b KQkq -': { move: 'a7a6', name: 'Najdorf Variation' },
  },
  'queens-gambit': {
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -': { move: 'd2d4', name: "Queen's Pawn" },
    'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3': { move: 'd7d5', name: 'Closed Game' },
    'rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq d6': { move: 'c2c4', name: "Queen's Gambit" },
    'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq c3': { move: 'e7e6', name: 'QGD Classical' },
    'rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq -': { move: 'b1c3', name: 'Develop Knight' },
    'rnbqkbnr/ppp2ppp/4p3/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR b KQkq -': { move: 'g8f6', name: 'Develop Knight' },
    'rnbqkb1r/ppp2ppp/4pn2/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq -': { move: 'c4d5', name: 'Exchange Variation' },
    'rnbqkb1r/ppp2ppp/4pn2/3P4/3P4/2N5/PP2PPPP/R1BQKBNR b KQkq -': { move: 'e6d5', name: 'Recapture Pawn' },
    'rnbqkb1r/ppp2ppp/5n2/3p4/3P4/2N5/PP2PPPP/R1BQKBNR w KQkq -': { move: 'c1g5', name: 'Bg5 Pin' },
  },
  italian: {
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -': { move: 'e2e4', name: "King's Pawn" },
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3': { move: 'e7e5', name: 'Open Game' },
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6': { move: 'g1f3', name: 'Attack e5' },
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -': { move: 'b8c6', name: 'Defend e5' },
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -': { move: 'f1c4', name: 'Italian Game Bc4' },
    'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq -': { move: 'f8c5', name: 'Giuoco Piano' },
    'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq -': { move: 'c2c3', name: 'Main Line c3' },
    'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R b KQkq -': { move: 'g8f6', name: 'Knight to f6' },
    'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2P2N2/PP1P1PPP/RNBQK2R w KQkq -': { move: 'd2d3', name: 'Giuoco Pianissimo' },
  },
  'ruy-lopez': {
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -': { move: 'e2e4', name: "King's Pawn" },
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3': { move: 'e7e5', name: 'Open Game' },
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6': { move: 'g1f3', name: 'Attack e5' },
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq -': { move: 'b8c6', name: 'Defend e5' },
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq -': { move: 'f1b5', name: 'Ruy Lopez Bb5' },
    'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq -': { move: 'a7a6', name: 'Morphy Defense' },
    'r1bqkbnr/1ppp1ppp/p1n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq -': { move: 'b5a4', name: 'Ba4 Retreat' },
    'r1bqkbnr/1ppp1ppp/p1n5/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R b KQkq -': { move: 'g8f6', name: 'Nf6 Development' },
    'r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R w KQkq -': { move: 'e1g1', name: 'Castles' },
  },
  'caro-kann': {
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -': { move: 'e2e4', name: "King's Pawn" },
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3': { move: 'c7c6', name: 'Caro-Kann Defense' },
    'rnbqkbnr/pp1ppppp/2p5/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -': { move: 'd2d4', name: 'd4 Control' },
    'rnbqkbnr/pp1ppppp/2p5/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3': { move: 'd7d5', name: 'd5 Strike' },
    'rnbqkbnr/pp2pppp/2p5/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq d6': { move: 'b1c3', name: 'Classical Nc3' },
    'rnbqkbnr/pp2pppp/2p5/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq -': { move: 'd5e4', name: 'Pawn Trade' },
    'rnbqkbnr/pp2pppp/2p5/8/3Pn3/2N5/PPP2PPP/R1BQKBNR w KQkq -': { move: 'c3e4', name: 'Nxe4 Recapture' },
    'rnbqkbnr/pp2pppp/2p5/8/3PN3/8/PPP2PPP/R1BQKBNR b KQkq -': { move: 'c8f5', name: 'Bf5 Classical' },
  },
  french: {
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -': { move: 'e2e4', name: "King's Pawn" },
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3': { move: 'e7e6', name: 'French Defense' },
    'rnbqkbnr/pppp1ppp/4p3/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq -': { move: 'd2d4', name: 'd4 Center' },
    'rnbqkbnr/pppp1ppp/4p3/8/3PP3/8/PPP2PPP/RNBQKBNR b KQkq d3': { move: 'd7d5', name: 'd5 Counter' },
    'rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/8/PPP2PPP/RNBQKBNR w KQkq d6': { move: 'b1c3', name: 'Classical Nc3' },
    'rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq -': { move: 'g8f6', name: 'Nf6 Classical' },
    'rnbqkb1r/ppp2ppp/4pn2/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR w KQkq -': { move: 'e4e5', name: 'Advance e5' },
    'rnbqkb1r/ppp2ppp/4pn2/3pP3/3P4/2N5/PPP2PPP/R1BQKBNR b KQkq -': { move: 'f6d7', name: 'Knight Retreat' },
  },
  'kings-indian': {
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -': { move: 'd2d4', name: "Queen's Pawn" },
    'rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq d3': { move: 'g8f6', name: 'Indian Defense' },
    'rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR w KQkq -': { move: 'c2c4', name: 'c4 Space' },
    'rnbqkb1r/pppppppp/5n2/8/2PP4/8/PP2PPPP/RNBQKBNR b KQkq c3': { move: 'g7g6', name: 'Kings Indian Prep' },
    'rnbqkb1r/pppppp1p/5np1/8/2PP4/8/PP2PPPP/RNBQKBNR w KQkq -': { move: 'b1c3', name: 'Nc3 Center' },
    'rnbqkb1r/pppppp1p/5np1/8/2PP4/2N5/PP2PPPP/R1BQKBNR b KQkq -': { move: 'f8g7', name: 'Fianchetto Bishop' },
    'rnbqk2r/ppppppbp/5np1/8/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq -': { move: 'e2e4', name: 'Full Center e4' },
    'rnbqk2r/ppppppbp/5np1/8/2PPP3/2N5/PP3PPP/R1BQKBNR b KQkq e3': { move: 'd7d6', name: 'd6 Solidify' },
  },
};

export class OpeningBook {
  public static lookupMove(positionKey: string, repertoireId: string): RepertoireEntry | null {
    if (!positionKey || !repertoireId) return null;
    const tree = REPERTOIRE_TREES[repertoireId];
    if (!tree) return null;
    return tree[positionKey] || null;
  }
}
