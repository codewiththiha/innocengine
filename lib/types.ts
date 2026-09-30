import type { OpeningConfig as OpeningSettingsConfig } from './openings/types';

export type { OpeningConfig, OpeningMode } from './openings/types';

export const APP_NAME = 'Chess Engine AI Overlay';
export const APP_VERSION = '1.3.2';

export interface UciOption {
  name: string;
  type: 'check' | 'spin' | 'combo' | 'string' | 'button';
  default?: string | number | boolean;
  min?: number;
  max?: number;
  vars?: string[];
  value?: string | number | boolean;
}

export interface EngineCapabilities {
  id: string;
  name: string;
  author: string;
  hasElo: boolean;
  hasLimitStrength: boolean;
  hasSkillLevel: boolean;
  hasThreads: boolean;
  hasHash: boolean;
  hasDepth?: boolean;
  hasMultiPv?: boolean;
  hasPersonality?: boolean;
  eloMin?: number;
  eloMax?: number;
  eloStep?: number;
  options: Record<string, UciOption>;
}

export interface CustomEngineMeta {
  id: string;
  name: string;
  author?: string;
  sizeBytes: number;
  dateAdded: number;
  isBuiltIn?: boolean;
}


export interface EngineSettings {
  depth: number;
  multiPv: number;
  threads: number;
  hashMb: number;
  limitStrength: boolean;
  targetElo: number;
  ballmaegyiPersonality?: 'aggressive' | 'human' | 'full_strength' | 'solid';
  ballmaegyiLimitStrength?: boolean;
  ballmaegyiElo?: number;
  ballmaegyiManualDepth?: boolean;
  ballmaegyiPerformance?: 'responsive' | 'balanced' | 'deep';
  reviewEngineId?: 'stockfish' | 'ballmaegyi';
  reviewDepth?: number;
  reviewMultiPv?: number;
  autoRecordGames?: boolean;
  manualRecording?: boolean;
  autoReview?: boolean;
  showHighlights: boolean;
  highlightPlayerMoves: boolean;
  highlightOpponentMoves: boolean;
  highlighterOpacity: number;
  showArrows: boolean;
  showConnectors: boolean;
  showOpponentMoves: boolean;
  showEvalBar: boolean;
  showHud: boolean;
  showNumberCircles?: boolean;
  highlightShape?: 'square' | 'rounded';
  autoAnalyze: boolean;
  controlledColor: 'auto' | 'w' | 'b';
  activeEngineId: string;
  lastPopupTab?: string;
  captureResistantOverlay: boolean;
  opening: OpeningSettingsConfig;
  customOptions: Record<string, string | number | boolean>;
}

export interface MoveContinuation {
  from: string;
  to: string;
  san?: string;
}

export interface EngineCandidate {
  pvId: number;
  from: string;
  to: string;
  promotion?: string;
  depth: number;
  scoreCp: number | null;
  scoreMate: number | null;
  pv: string[];
  continuation?: MoveContinuation;
  isBookMove?: boolean;
  bookName?: string;
}

export interface MoveLine {
  id: number;
  depth: number;
  scoreCp: number | null;
  scoreMate: number | null;
  whiteScoreCp?: number | null;
  whiteScoreMate?: number | null;
  bestMove: string;
  pv: string[];
  nodes?: number;
  nps?: number;
  timeMs?: number;
}

export interface EngineEvaluation {
  engineInstanceId?: string;
  analysisId: number;
  positionKey: string;
  fen: string;
  depth: number;
  scoreCp: number | null;
  scoreMate: number | null;
  whiteScoreCp?: number | null;
  whiteScoreMate?: number | null;
  bestMove: string | null;
  multiPvLines: MoveLine[];
  candidates: EngineCandidate[];
  nodes?: number;
  nps?: number;
  timeMs?: number;
  isCalculating: boolean;
  timestamp: number;
}

export interface BoardState {
  fen: string;
  positionKey: string;
  placement?: string;
  isFlipped: boolean;
  turn: 'w' | 'b';
  playerColor: 'w' | 'b';
  controlledColor: 'auto' | 'w' | 'b';
  pieceMap: Map<string, string>;
  boardElement?: HTMLElement;
  isGameActive?: boolean;
  moveHistory?: string[];
}

export interface EngineTelemetry {
  nps: number;
  nodes: number;
  depth: number;
  hashMb: number;
  threads: number;
  estimatedMemoryMb: number;
  isSearching: boolean;
  history: number[];
}

export type ExtensionMessage =
  | {
      target: 'engine';
      type: 'ANALYZE';
      analysisId: number;
      positionKey: string;
      fen: string;
      depth?: number;
      multiPv?: number;
      activeEngineId?: string;
      limitStrength?: boolean;
      targetElo?: number;
      ballmaegyiPersonality?: 'aggressive' | 'human' | 'full_strength' | 'solid';
      ballmaegyiLimitStrength?: boolean;
      ballmaegyiElo?: number;
      threads?: number;
      hashMb?: number;
      tabId?: number;
      senderTabId?: number;
    }
  | { target: 'engine'; type: 'STOP'; analysisId?: number }
  | { target: 'engine'; type: 'PING' }
  | { target: 'engine'; type: 'SWITCH_ENGINE'; engineId: string }
  | { target: 'engine'; type: 'SET_OPTION'; name: string; value: string | number | boolean }
  | { target: 'engine'; type: 'UPDATE_SETTINGS'; settings: Partial<EngineSettings> }
  | { target: 'content'; type: 'EVAL_UPDATE'; evaluation: EngineEvaluation; senderTabId?: number }
  | { target: 'content'; type: 'ENGINE_STATUS'; status: 'loading' | 'ready' | 'analyzing' | 'error'; message?: string; senderTabId?: number }
  | { target: 'content'; type: 'SETTINGS_CHANGED'; settings: EngineSettings }
  | { target: 'popup'; type: 'ENGINE_CAPABILITIES'; capabilities: EngineCapabilities }
  | { target: 'popup'; type: 'INSTALLED_ENGINES'; engines: CustomEngineMeta[] }
  | { target: 'popup'; type: 'ENGINE_STATUS'; status: 'loading' | 'ready' | 'analyzing' | 'error'; message?: string }
  | { target: 'popup'; type: 'TELEMETRY_UPDATE'; telemetry: EngineTelemetry }
  | { target: 'popup'; type: 'CURRENT_EVAL'; evaluation: EngineEvaluation | null };
