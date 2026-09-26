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
  private committedDisplayCandidates: EngineCandidate[] = [];
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
    this.recomputeAndRender(true);
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
      this.committedDisplayCandidates = [];
      this.currentBoardState = boardState;
      this.renderCallback({ candidates: [], isCommitted: true, depth: 0 });
      return;
    }

    this.currentBoardState = boardState;
  }

  public handleEvaluation(evaluation: EngineEvaluation) {
    if (!this.settings.showHighlights) return;
    if (evaluation.positionKey !== this.activePositionKey) return;

    // Preserve raw engine state immutable
    this.latestEngineSnapshot = evaluation;

    const derivedCandidates = this.deriveDisplayCandidates(evaluation.candidates);
    if (derivedCandidates.length === 0) return;

    // If calculation finished (bestmove arrived), commit atomically
    if (!evaluation.isCalculating) {
      this.clearPendingTimer();
      this.committedDisplayCandidates = derivedCandidates;
      this.renderCallback({
        candidates: derivedCandidates,
        isCommitted: true,
        depth: evaluation.depth,
      });
      return;
    }

    // While searching: apply candidate stability window before updating visual preview
    const primary = derivedCandidates[0];
    if (!primary) return;

    const primaryMoveKey = `${primary.from}-${primary.to}`;
    const now = Date.now();

    if (primaryMoveKey !== this.pendingCandidateKey) {
      this.pendingCandidateKey = primaryMoveKey;
      this.candidatePendingSince = now;

      this.clearPendingTimer();
      this.stabilityTimer = setTimeout(() => {
        if (this.pendingCandidateKey === primaryMoveKey) {
          this.committedDisplayCandidates = derivedCandidates;
          this.renderCallback({
            candidates: derivedCandidates,
            isCommitted: false,
            depth: evaluation.depth,
          });
        }
      }, this.STABILITY_WINDOW_MS);
    } else if (now - this.candidatePendingSince >= this.STABILITY_WINDOW_MS) {
      this.committedDisplayCandidates = derivedCandidates;
      this.renderCallback({
        candidates: derivedCandidates,
        isCommitted: false,
        depth: evaluation.depth,
      });
    }
  }

  private deriveDisplayCandidates(rawCandidates: EngineCandidate[]): EngineCandidate[] {
    if (!this.currentBoardState) return [];

    const effectiveControlled =
      this.settings.controlledColor === 'auto'
        ? this.currentBoardState.controlledColor
        : this.settings.controlledColor;

    const pieceMap = this.currentBoardState.pieceMap;

    let candidates: EngineCandidate[] = [];

    for (const cand of rawCandidates) {
      const piece = pieceMap.get(cand.from);
      if (!piece) continue;

      const isWhitePiece = piece === piece.toUpperCase();
      const pieceSide = isWhitePiece ? 'w' : 'b';
      const isOpponent = pieceSide !== effectiveControlled;

      // Filter opponent moves unless explicitly enabled in presentation settings
      if (!this.settings.showOpponentMoves && isOpponent) {
        continue;
      }

      candidates.push({
        ...cand,
        isOpponent,
      });
    }

    // Soft opening repertoire blending
    if (this.settings.opening.enabled && this.activePositionKey) {
      const bookEntry = OpeningBook.lookupMove(this.activePositionKey, this.settings.opening.repertoireId);
      if (bookEntry) {
        const bookFrom = bookEntry.move.substring(0, 2);
        const bookTo = bookEntry.move.substring(2, 4);

        const matchIdx = candidates.findIndex((c) => c.from === bookFrom && c.to === bookTo);
        const matched = candidates[matchIdx];
        if (matchIdx !== -1 && matched) {
          const bookCandidate: EngineCandidate = { ...matched, isBookMove: true };
          if (this.settings.opening.mode === 'prefer' && matchIdx > 0) {
            candidates.splice(matchIdx, 1);
            candidates.unshift(bookCandidate);
          } else {
            candidates[matchIdx] = bookCandidate;
          }
        } else if (this.settings.opening.mode === 'book-only') {
          candidates = [
            {
              pvId: 1,
              from: bookFrom,
              to: bookTo,
              depth: 0,
              scoreCp: 0,
              scoreMate: null,
              pv: [bookEntry.move],
              isBookMove: true,
              isOpponent: false,
            },
          ];
        }
      }
    }

    return candidates.slice(0, Math.max(1, this.settings.multiPv));
  }

  public recomputeAndRender(isCommitted: boolean = true) {
    if (!this.settings.showHighlights || !this.latestEngineSnapshot) {
      this.committedDisplayCandidates = [];
      this.renderCallback({ candidates: [], isCommitted, depth: 0 });
      return;
    }

    const derived = this.deriveDisplayCandidates(this.latestEngineSnapshot.candidates);
    this.committedDisplayCandidates = derived;
    this.renderCallback({
      candidates: derived,
      isCommitted,
      depth: this.latestEngineSnapshot.depth,
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
    this.latestEngineSnapshot = null;
    this.committedDisplayCandidates = [];
    this.pendingCandidateKey = '';
    this.renderCallback({ candidates: [], isCommitted: true, depth: 0 });
  }

  public getCommittedCandidates(): EngineCandidate[] {
    return this.committedDisplayCandidates;
  }
}
