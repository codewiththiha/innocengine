import type { EngineCandidate, EngineEvaluation, EngineSettings, BoardState } from './types';
import { OpeningBook } from './opening-book';

export interface RenderSnapshot {
  candidates: EngineCandidate[];
  isCommitted: boolean;
  depth: number;
}

export type HighlightRenderCallback = (snapshot: RenderSnapshot) => void;

export class HighlightController {
  private currentBoardState: BoardState | null = null;
  private settings: EngineSettings;
  private latestEngineSnapshot: EngineEvaluation | null = null;
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
    if (this.latestEngineSnapshot) {
      this.handleEvaluation(this.latestEngineSnapshot);
    } else {
      this.broadcastCurrentState();
    }
  }

  public setBoardState(boardState: BoardState | null) {
    if (!boardState) {
      this.clear();
      return;
    }

    if (this.activePositionKey !== boardState.positionKey) {
      this.activePositionKey = boardState.positionKey;
      this.clearPendingTimer();
      this.latestEngineSnapshot = null;
      this.committedCandidates = [];
      this.broadcastCurrentState();
    }

    this.currentBoardState = boardState;
  }

  public handleEvaluation(evaluation: EngineEvaluation) {
    if (!this.settings.showHighlights) return;
    if (evaluation.positionKey !== this.activePositionKey) return;

    this.latestEngineSnapshot = evaluation;

    const validCandidates = this.validateCandidates(evaluation.candidates);
    if (validCandidates.length === 0) return;

    const displayCandidates = this.applyOpeningBook(validCandidates);
    if (displayCandidates.length === 0) return;

    // If Stockfish completed calculation (bestmove arrived), commit atomically
    if (!evaluation.isCalculating) {
      this.clearPendingTimer();
      this.committedCandidates = displayCandidates;
      this.renderCallback({
        candidates: displayCandidates,
        isCommitted: true,
        depth: evaluation.depth,
      });
      return;
    }

    // While searching: apply candidate stability window before updating visual preview
    const primaryCandidate = displayCandidates[0];
    if (!primaryCandidate) return;

    const primaryMoveKey = `${primaryCandidate.from}-${primaryCandidate.to}`;
    const now = Date.now();

    if (primaryMoveKey !== this.pendingCandidateKey) {
      this.pendingCandidateKey = primaryMoveKey;
      this.candidatePendingSince = now;

      this.clearPendingTimer();
      this.stabilityTimer = setTimeout(() => {
        if (this.pendingCandidateKey === primaryMoveKey) {
          this.committedCandidates = displayCandidates;
          this.renderCallback({
            candidates: displayCandidates,
            isCommitted: false,
            depth: evaluation.depth,
          });
        }
      }, this.STABILITY_WINDOW_MS);
    } else if (now - this.candidatePendingSince >= this.STABILITY_WINDOW_MS) {
      this.committedCandidates = displayCandidates;
      this.renderCallback({
        candidates: displayCandidates,
        isCommitted: false,
        depth: evaluation.depth,
      });
    }
  }

  private validateCandidates(candidates: EngineCandidate[]): EngineCandidate[] {
    if (!this.currentBoardState) return [];

    const turn = this.currentBoardState.turn;
    const pieceMap = this.currentBoardState.pieceMap;

    return candidates
      .filter((candidate) => {
        const piece = pieceMap.get(candidate.from);
        if (!piece) return true;

        const isWhitePiece = piece === piece.toUpperCase();
        const pieceTurn = isWhitePiece ? 'w' : 'b';

        // Root candidate must match side to move
        if (pieceTurn !== turn) {
          return false;
        }

        return true;
      })
      .map((cand) => ({
        ...cand,
        continuation: this.settings.showOpponentMoves ? cand.continuation : undefined,
      }));
  }

  private applyOpeningBook(engineCandidates: EngineCandidate[]): EngineCandidate[] {
    if (!this.settings.opening.enabled || !this.activePositionKey) {
      return engineCandidates.slice(0, Math.max(1, this.settings.multiPv));
    }

    const bookEntry = OpeningBook.lookupMove(this.activePositionKey, this.settings.opening.repertoireId);
    if (!bookEntry || !bookEntry.move || bookEntry.move.length < 4) {
      return engineCandidates.slice(0, Math.max(1, this.settings.multiPv));
    }

    const bookFrom = bookEntry.move.substring(0, 2);
    const bookTo = bookEntry.move.substring(2, 4);
    const mode = this.settings.opening.mode || 'coexist';

    if (mode === 'book-only') {
      return [
        {
          pvId: 0,
          from: bookFrom,
          to: bookTo,
          depth: 0,
          scoreCp: null,
          scoreMate: null,
          pv: [bookEntry.move],
          isBookMove: true,
          bookName: bookEntry.name,
        },
      ];
    }

    const topEngineCandidates = engineCandidates.slice(0, Math.max(1, this.settings.multiPv));
    const matchIdx = topEngineCandidates.findIndex((c) => c.from === bookFrom && c.to === bookTo);

    if (matchIdx !== -1 && topEngineCandidates[matchIdx]) {
      // Move was already suggested by the engine: tag with book metadata
      topEngineCandidates[matchIdx] = {
        ...topEngineCandidates[matchIdx],
        isBookMove: true,
        bookName: bookEntry.name,
      };

      if (mode === 'prefer' && matchIdx > 0) {
        const [matched] = topEngineCandidates.splice(matchIdx, 1);
        if (matched) topEngineCandidates.unshift(matched);
      }

      return topEngineCandidates;
    }

    // Engine top moves do not include the opening book move:
    const bookCandidate: EngineCandidate = {
      pvId: 0,
      from: bookFrom,
      to: bookTo,
      depth: 0,
      scoreCp: null,
      scoreMate: null,
      pv: [bookEntry.move],
      isBookMove: true,
      bookName: bookEntry.name,
    };

    if (mode === 'prefer') {
      // In prefer mode: Repertoire move is #1, followed by engine variations
      return [bookCandidate, ...topEngineCandidates.slice(0, Math.max(0, this.settings.multiPv - 1))];
    }

    // In coexist mode: Show both engine variations AND opening book move
    // e.g. 1 engine candidate (Amber) + 1 book candidate (Emerald) = 2 highlights
    // e.g. 3 engine candidates + 1 book candidate = 4 highlights
    return [...topEngineCandidates, bookCandidate];
  }

  private clearPendingTimer() {
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
  }

  public clear() {
    this.clearPendingTimer();
    this.latestEngineSnapshot = null;
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
