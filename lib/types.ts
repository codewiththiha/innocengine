import type { OpeningConfig as OpeningSettingsConfig } from './openings/types';

export type { OpeningConfig, OpeningMode } from './openings/types';

export const APP_NAME = 'Chess Engine AI Overlay';
export const APP_VERSION = '1.1.2';

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
  /** Patricia-only style scale, advertised by the wasm build we ship. */
  hasAggressiveness?: boolean;
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


/**
 * How the extension is allowed to play a move on its own.
 * - `instant`: move as soon as the engine has a committed candidate.
 * - `delay`: wait a fixed `delayMs`.
 * - `paced`: wait a modelled reading time derived from the position.
 */
export type AutoMoveMode = 'instant' | 'delay' | 'paced';

export interface AutoMoveSettings {
  enabled: boolean;
  mode: AutoMoveMode;
  delayMs: number;
  minThinkMs: number;
  maxThinkMs: number;
  /** Stop after this many played moves. 0 means no limit. */
  maxMoves: number;
  playFor: 'auto' | 'w' | 'b';
  /** Play only while the extension overlay is visible. */
  pauseWhenHidden: boolean;
}

export interface BubbleSettings {
  visible: boolean;
  /** Pointer position in board pixels; null keeps the default corner. */
  x: number | null;
  y: number | null;
  showAutoMoveToggle: boolean;
}

export interface EngineSettings {
  depth: number;
  multiPv: number;
  threads: number;
  hashMb: number;
  /**
   * Ceiling on engine think time per position, in milliseconds. `0` keeps each
   * engine's own calibrated budget. Lower values trade depth for an overlay
   * that updates the moment the board changes.
   */
  searchBudgetMs: number;
  /** How long a changed top move must hold before it is drawn. */
  highlightStabilityMs: number;
  /** Patricia style scale: 100 is the engine default, higher is riskier. */
  aggressiveness: number;
  /** Prefer the pthread build when the host can back SharedArrayBuffer. */
  preferThreadedEngine: boolean;
  limitStrength: boolean;
  targetElo: number;
  patriciaPersonality?: 'aggressive' | 'human' | 'full_strength' | 'solid';
  patriciaLimitStrength?: boolean;
  patriciaElo?: number;
  showHighlights: boolean;
  highlightPlayerMoves: boolean;
  highlightOpponentMoves: boolean;
  highlighterOpacity: number;
  showArrows: boolean;
  showConnectors: boolean;
  showOpponentMoves: boolean;
  showEvalBar: boolean;
  showHud: boolean;
  autoAnalyze: boolean;
  controlledColor: 'auto' | 'w' | 'b';
  activeEngineId: string;
  captureResistantOverlay: boolean;
  autoMove: AutoMoveSettings;
  bubble: BubbleSettings;
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
  /** True when the runner is executing the pthread wasm build. */
  threaded: boolean;
  /** Effective per-position think ceiling in milliseconds, 0 when uncapped. */
  budgetMs: number;
  /** Milliseconds from position change to the newest committed candidate. */
  responseMs: number;
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
      patriciaPersonality?: 'aggressive' | 'human' | 'full_strength' | 'solid';
      patriciaLimitStrength?: boolean;
      patriciaElo?: number;
      threads?: number;
      hashMb?: number;
      searchBudgetMs?: number;
      aggressiveness?: number;
      preferThreaded?: boolean;
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
  | { target: 'content'; type: 'TELEMETRY_UPDATE'; telemetry: EngineTelemetry }
  | { target: 'content'; type: 'SETTINGS_CHANGED'; settings: EngineSettings }
  | { target: 'popup'; type: 'ENGINE_CAPABILITIES'; capabilities: EngineCapabilities }
  | { target: 'popup'; type: 'INSTALLED_ENGINES'; engines: CustomEngineMeta[] }
  | { target: 'popup'; type: 'ENGINE_STATUS'; status: 'loading' | 'ready' | 'analyzing' | 'error'; message?: string }
  | { target: 'popup'; type: 'TELEMETRY_UPDATE'; telemetry: EngineTelemetry }
  | { target: 'popup'; type: 'CURRENT_EVAL'; evaluation: EngineEvaluation | null };
