export const APP_NAME = 'Chess Engine AI Overlay';
export const APP_VERSION = '1.0.0';

export interface EngineSettings {
  depth: number;
  multiPv: number;
  threads: number;
  showHighlights: boolean;
  showEvalBar: boolean;
  showHud: boolean;
  autoAnalyze: boolean;
  fromColor: string;
  toColor: string;
}

export interface MoveLine {
  id: number;
  depth: number;
  scoreCp: number | null;
  scoreMate: number | null;
  bestMove: string;
  pv: string[];
  nodes?: number;
  nps?: number;
  timeMs?: number;
}

export interface EngineEvaluation {
  fen: string;
  depth: number;
  scoreCp: number | null;
  scoreMate: number | null;
  bestMove: string | null;
  multiPvLines: MoveLine[];
  nodes?: number;
  nps?: number;
  timeMs?: number;
  isCalculating: boolean;
  timestamp: number;
}

export interface BoardState {
  fen: string;
  isFlipped: boolean;
  turn: 'w' | 'b';
  lastMoveSquares?: { from: string; to: string } | null;
  boardElement?: HTMLElement;
}

export type ExtensionMessage =
  | { target: 'engine'; type: 'ANALYZE'; fen: string; depth?: number; multiPv?: number; tabId?: number }
  | { target: 'engine'; type: 'STOP' }
  | { target: 'engine'; type: 'PING' }
  | { target: 'engine'; type: 'UPDATE_SETTINGS'; settings: Partial<EngineSettings> }
  | { target: 'content'; type: 'EVAL_UPDATE'; evaluation: EngineEvaluation }
  | { target: 'content'; type: 'ENGINE_STATUS'; status: 'loading' | 'ready' | 'analyzing' | 'error'; message?: string }
  | { target: 'content'; type: 'SETTINGS_CHANGED'; settings: EngineSettings }
  | { target: 'popup'; type: 'ENGINE_STATUS'; status: 'loading' | 'ready' | 'analyzing' | 'error'; message?: string }
  | { target: 'popup'; type: 'CURRENT_EVAL'; evaluation: EngineEvaluation | null };
