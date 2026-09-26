import type { EngineCandidate, EngineEvaluation, EngineSettings, BoardState } from './types';

export interface RenderSnapshot {
  candidates: EngineCandidate[];
  isCommitted: boolean;
  depth: number;
}

export type HighlightRenderCallback = (snapshot: RenderSnapshot) => void;

export class HighlightController {
  private currentBoardState: BoardState | null = null;
  private settings: EngineSettings;
  private committedCandidates: EngineCandidate[] = [];
  private candidatePendingSince: number = 0;
  private pendingCandidateKey: string = '';
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  private renderCallback: HighlightRenderCallback;
  private activePositionKey: string = '';

  private readonly STABILITY_WINDOW_MS = 180;

  constructor(settings: EngineSettings, renderCallback: HighlightRenderCallback) {
    this.settings = settings;
    this.renderCallback = renderCallback;
  }

  public updateSettings(settings: EngineSettings) {
    this.settings = settings;
    this.broadcastCurrentState();
  }

  public setBoardState(boardState: BoardState | null) {
    if (!boardState) {
      this.clear();
      return;
    }

    if (this.activePositionKey !== boardState.positionKey) {
      this.activePositionKey = boardState.positionKey;
      this.clearPendingTimer();
      this.committedCandidates = [];
      this.broadcastCurrentState();
    }

    this.currentBoardState = boardState;
  }

  public handleEvaluation(evaluation: EngineEvaluation) {
    if (!this.settings.showHighlights) return;
    if (evaluation.positionKey !== this.activePositionKey) return;

    // Filter and validate candidates with hard side-to-move gate
    const validCandidates = this.validateCandidates(evaluation.candidates);
    if (validCandidates.length === 0) return;

    const topCandidates = validCandidates.slice(0, Math.max(1, this.settings.multiPv));

    // If Stockfish completed calculation (bestmove arrived), commit atomically
    if (!evaluation.isCalculating) {
      this.clearPendingTimer();
      this.committedCandidates = topCandidates;
      this.renderCallback({
        candidates: topCandidates,
        isCommitted: true,
        depth: evaluation.depth,
      });
      return;
    }

    // While searching: apply candidate stability window before updating visual preview
    const primaryCandidate = topCandidates[0];
    if (!primaryCandidate) return;

    const primaryMoveKey = `${primaryCandidate.from}-${primaryCandidate.to}`;
    const now = Date.now();

    if (primaryMoveKey !== this.pendingCandidateKey) {
      this.pendingCandidateKey = primaryMoveKey;
      this.candidatePendingSince = now;

      this.clearPendingTimer();
      this.stabilityTimer = setTimeout(() => {
        if (this.pendingCandidateKey === primaryMoveKey) {
          this.committedCandidates = topCandidates;
          this.renderCallback({
            candidates: topCandidates,
            isCommitted: false,
            depth: evaluation.depth,
          });
        }
      }, this.STABILITY_WINDOW_MS);
    } else if (now - this.candidatePendingSince >= this.STABILITY_WINDOW_MS) {
      // Already stable: update candidate metadata without re-animating
      this.committedCandidates = topCandidates;
      this.renderCallback({
        candidates: topCandidates,
        isCommitted: false,
        depth: evaluation.depth,
      });
    }
  }

  private validateCandidates(candidates: EngineCandidate[]): EngineCandidate[] {
    if (!this.currentBoardState) return [];

    const turn = this.currentBoardState.turn;
    const pieceMap = this.currentBoardState.pieceMap;

    return candidates.filter((candidate) => {
      const piece = pieceMap.get(candidate.from);
      if (!piece) return false;

      // Invariant: source piece must match the side to move
      const isWhitePiece = piece === piece.toUpperCase();
      const pieceTurn = isWhitePiece ? 'w' : 'b';

      if (!this.settings.showOpponentMoves && pieceTurn !== turn) {
        return false;
      }

      return true;
    });
  }

  private clearPendingTimer() {
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
  }

  public clear() {
    this.clearPendingTimer();
    this.committedCandidates = [];
    this.pendingCandidateKey = '';
    this.broadcastCurrentState();
  }

  private broadcastCurrentState() {
    this.renderCallback({
      candidates: this.committedCandidates,
      isCommitted: true,
      depth: 0,
    });
  }

  public getCommittedCandidates(): EngineCandidate[] {
    return this.committedCandidates;
  }
}
