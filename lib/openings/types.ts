export type OpeningCategory =
  | 'white'
  | 'black'
  | 'universal'
  | 'aggressive'
  | 'solid'
  | 'positional'
  | 'tactical'
  | 'sharp'
  | 'risky'
  | 'gambit'
  | 'trap'
  | 'meme'
  | 'weird'
  | 'fun'
  | 'chaos'
  | 'beginner'
  | 'classical'
  | 'hypermodern'
  | 'flank'
  | 'indian'
  | 'sicilian'
  | 'french'
  | 'caro-kann'
  | 'kings-pawn'
  | 'queens-pawn'
  | 'english'
  | 'dutch'
  | 'offbeat'
  | 'romantic'
  | 'system';

export type OpeningSide = 'w' | 'b' | 'any';

export interface OpeningDefinition {
  id: string;
  name: string;
  eco?: string;
  side: OpeningSide;
  categories: OpeningCategory[];
  tags?: string[];
  description?: string;
  risk: 1 | 2 | 3 | 4 | 5;
  aggression?: 1 | 2 | 3 | 4 | 5;
  weirdness?: 1 | 2 | 3 | 4 | 5;
  meme?: boolean;
  trap?: boolean;
  pgn: string;
  startFen?: string;
  maxPlies?: number;
  priority?: number;
  enabled?: boolean;
}

export interface BookPositionEntry {
  openingId: string;
  openingName: string;
  side: OpeningSide;
  fen: string;
  uci: string;
  san: string;
  ply: number;
  line: string[];
  risk: number;
  categories: OpeningCategory[];
  meme?: boolean;
  trap?: boolean;
  priority: number;
}

export type OpeningMode =
  | 'off'
  | 'hint'
  | 'coexist'
  | 'parallel'
  | 'prefer'
  | 'book-only'
  | 'adaptive';

export interface OpeningSafetyConfig {
  maxLossCp?: number;
  forbidQueenHang?: boolean;
  minEngineDepth?: number;
  maxEngineDisagreementCp?: number;
  allowRiskyOpenings?: boolean;
  allowMemeOpenings?: boolean;
}

export interface OpeningEnginePolicy {
  mode?: OpeningMode;
  maxLossCp?: number;
  minEngineDepth?: number;
  allowOffBook?: boolean;
  allowRisky?: boolean;
  allowMeme?: boolean;
}

export interface OpeningConfig {
  enabled: boolean;
  repertoireId: string;
  whiteRepertoireId?: string;
  blackRepertoireId?: string;
  selectedOpeningIds?: string[];
  mode: OpeningMode;
  maxPlies: number;
  reserveSlot?: boolean;
  categories?: OpeningCategory[];
  searchQuery?: string;
  includeMeme?: boolean;
  includeWeird?: boolean;
  maxRisk?: number;
  strictLine?: boolean;
  safety?: OpeningSafetyConfig;
  enginePolicy?: Record<string, OpeningEnginePolicy>;
}
