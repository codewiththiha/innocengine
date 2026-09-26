export const APP_NAME = 'Chess Engine AI Overlay';
export const APP_VERSION = '1.1.0';

export interface EngineSettings {
  depth: number;
  multiPv: number;
  threads: number;
  showHighlights: boolean;
  showOpponentMoves: boolean;
  showConnectors: boolean;
  showEvalBar: boolean;
  showHud: boolean;
  autoAnalyze: boolean;
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
  analysisId: number;
  positionKey: string;
  fen: string;
  depth: number;
  scoreCp: number | null;
  scoreMate: number | null;
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
  isFlipped: boolean;
  turn: 'w' | 'b';
  pieceMap: Map<string, string>;
  boardElement?: HTMLElement;
}

export type ExtensionMessage =
  | { target: 'engine'; type: 'ANALYZE'; analysisId: number; positionKey: string; fen: string; depth?: number; multiPv?: number; tabId?: number }
  | { target: 'engine'; type: 'STOP'; analysisId?: number }
  | { target: 'engine'; type: 'PING' }
  | { target: 'engine'; type: 'UPDATE_SETTINGS'; settings: Partial<EngineSettings> }
  | { target: 'content'; type: 'EVAL_UPDATE'; evaluation: EngineEvaluation; senderTabId?: number }
  | { target: 'content'; type: 'ENGINE_STATUS'; status: 'loading' | 'ready' | 'analyzing' | 'error'; message?: string; senderTabId?: number }
  | { target: 'content'; type: 'SETTINGS_CHANGED'; settings: EngineSettings }
  | { target: 'popup'; type: 'ENGINE_STATUS'; status: 'loading' | 'ready' | 'analyzing' | 'error'; message?: string }
  | { target: 'popup'; type: 'CURRENT_EVAL'; evaluation: EngineEvaluation | null };
