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
  private pendingCandidates: EngineCandidate[] = [];
  private pendingDepth: number = 0;
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
    if (this.currentBoardState && this.settings.opening.enabled && this.isWithinBookDepth(this.currentBoardState.fen)) {
      const bookEntry = OpeningBook.lookupMove(
        this.currentBoardState.positionKey,
        this.settings.opening.repertoireId,
        this.currentBoardState.fen
      );
      if (bookEntry && bookEntry.move && bookEntry.move.length >= 4 && !this.latestEngineSnapshot) {
        const bookCandidate: EngineCandidate = {
          pvId: 0,
          from: bookEntry.move.substring(0, 2),
          to: bookEntry.move.substring(2, 4),
          depth: 0,
          scoreCp: 0,
          scoreMate: null,
          pv: [bookEntry.move],
          isBookMove: true,
          bookName: bookEntry.name,
        };
        this.committedCandidates = this.shouldShowForTurn() ? [bookCandidate] : [];
        this.broadcastCurrentState();
        return;
      }
    }

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

    const positionChanged = this.activePositionKey !== boardState.positionKey;
    this.currentBoardState = boardState;

    if (positionChanged) {
      this.activePositionKey = boardState.positionKey;
      this.clearPendingTimer();
      this.latestEngineSnapshot = null;
      this.pendingCandidateKey = '';
      this.pendingCandidates = [];
      this.pendingDepth = 0;

      // Immediately display opening repertoire move if available for the new position
      if (this.settings.opening.enabled && this.isWithinBookDepth(boardState.fen)) {
        const bookEntry = OpeningBook.lookupMove(boardState.positionKey, this.settings.opening.repertoireId, boardState.fen);
        if (bookEntry && bookEntry.move && bookEntry.move.length >= 4) {
          const bookCandidate: EngineCandidate = {
            pvId: 0,
            from: bookEntry.move.substring(0, 2),
            to: bookEntry.move.substring(2, 4),
            depth: 0,
            scoreCp: 0,
            scoreMate: null,
            pv: [bookEntry.move],
            isBookMove: true,
            bookName: bookEntry.name,
          };
          this.committedCandidates = this.shouldShowForTurn() ? [bookCandidate] : [];
          this.broadcastCurrentState();
          return;
        }
      }

      this.committedCandidates = [];
      this.broadcastCurrentState();
    }
  }

  public handleEvaluation(evaluation: EngineEvaluation) {
    if (!this.shouldShowForTurn()) {
      this.clearPendingTimer();
      this.committedCandidates = [];
      this.broadcastCurrentState();
      return;
    }

    if (evaluation.positionKey !== this.activePositionKey) return;

    this.latestEngineSnapshot = evaluation;

    const validCandidates = this.validateCandidates(evaluation.candidates);
    if (validCandidates.length === 0) return;

    const displayCandidates = this.applyOpeningBook(validCandidates);
    if (displayCandidates.length === 0) return;

    // Filter out premature 1-ply blunders (depth < 4) during initial alpha-beta expansion
    // Note: Maia models (maia2, maia3) operate via 1-node policy without alpha-beta search and are exempt
    const primaryCandidate = displayCandidates[0];
    if (evaluation.depth < 4 && !primaryCandidate?.isBookMove && !evaluation.engineInstanceId?.startsWith('maia')) {
      return;
    }

    // If calculation completed (bestmove arrived or maia evaluated), commit atomically
    if (!evaluation.isCalculating) {
      this.clearPendingTimer();
      this.committedCandidates = displayCandidates;
      this.pendingCandidates = displayCandidates;
      this.pendingDepth = evaluation.depth;
      this.renderCallback({
        candidates: displayCandidates,
        isCommitted: true,
        depth: evaluation.depth,
      });
      return;
    }

    if (!primaryCandidate) return;

    const primaryMoveKey = `${primaryCandidate.from}-${primaryCandidate.to}`;
    const now = Date.now();

    // If no candidates are rendered yet (e.g. freshly opened position), render immediately
    // so the user does not experience an artificial 180ms delay
    if (this.committedCandidates.length === 0) {
      this.pendingCandidateKey = primaryMoveKey;
      this.candidatePendingSince = now;
      this.pendingCandidates = displayCandidates;
      this.pendingDepth = evaluation.depth;
      this.committedCandidates = displayCandidates;
      this.renderCallback({
        candidates: displayCandidates,
        isCommitted: false,
        depth: evaluation.depth,
      });
      return;
    }

    if (primaryMoveKey !== this.pendingCandidateKey) {
      // Top move has changed: start the stability window to prevent jitter
      this.pendingCandidateKey = primaryMoveKey;
      this.candidatePendingSince = now;
      this.pendingCandidates = displayCandidates;
      this.pendingDepth = evaluation.depth;

      this.clearPendingTimer();
      this.stabilityTimer = setTimeout(() => {
        if (this.pendingCandidateKey === primaryMoveKey && this.pendingCandidates.length > 0) {
          this.committedCandidates = this.pendingCandidates;
          this.renderCallback({
            candidates: this.pendingCandidates,
            isCommitted: false,
            depth: this.pendingDepth,
          });
        }
      }, this.STABILITY_WINDOW_MS);
    } else {
      // Primary move is stable: keep pending batch updated with incoming multipv lines
      this.pendingCandidates = displayCandidates;
      this.pendingDepth = evaluation.depth;

      const windowElapsed = now - this.candidatePendingSince >= this.STABILITY_WINDOW_MS;
      const newLinesAvailable = displayCandidates.length > this.committedCandidates.length;

      // Commit immediately if stability window elapsed or additional MultiPV lines arrived
      if (windowElapsed || newLinesAvailable) {
        this.committedCandidates = displayCandidates;
        this.renderCallback({
          candidates: displayCandidates,
          isCommitted: false,
          depth: evaluation.depth,
        });
      }
    }
  }

  private shouldShowForTurn(): boolean {
    if (!this.currentBoardState) return true;
    const turn = this.currentBoardState.turn;
    const playerColor = this.settings.controlledColor === 'auto'
      ? (this.currentBoardState.playerColor || (this.currentBoardState.isFlipped ? 'b' : 'w'))
      : this.settings.controlledColor;
    const isPlayerTurn = turn === playerColor;

    if (isPlayerTurn) {
      return this.settings.highlightPlayerMoves ?? this.settings.showHighlights ?? true;
    } else {
      return this.settings.highlightOpponentMoves ?? false;
    }
  }

  private isWithinBookDepth(fen: string): boolean {
    try {
      const tokens = fen.trim().split(/\s+/);
      const fullmove = parseInt(tokens[5] || '1', 10);
      const isBlack = tokens[1] === 'b';
      const plies = (fullmove - 1) * 2 + (isBlack ? 1 : 0);
      const maxPlies = this.settings.opening.maxPlies || 12;
      return plies <= maxPlies;
    } catch (_) {
      return true;
    }
  }

  private validateCandidates(candidates: EngineCandidate[]): EngineCandidate[] {
    const currentBoard = this.currentBoardState;
    const pieceMap = currentBoard?.pieceMap;
    const turn = currentBoard?.turn;

    return candidates
      .filter((cand) => {
        if (!cand || !cand.from || cand.from.length !== 2) return false;

        // Authoritative Board Defense:
        // Ensure the candidate piece's source square actually exists on the board
        // and matches the current player's color. This permanently prevents delayed or
        // out-of-sync engine evaluations from highlighting pieces that have already moved.
        if (pieceMap && pieceMap.size > 0 && turn) {
          const piece = pieceMap.get(cand.from);
          if (!piece) {
            // Source square is vacant; the piece has already moved!
            return false;
          }
          const isWhitePiece = piece === piece.toUpperCase();
          const isExpectedWhite = turn === 'w';
          if (isWhitePiece !== isExpectedWhite) {
            // Square holds an opponent piece; invalid move for current turn!
            return false;
          }
        }

        return true;
      })
      .map((cand) => ({
        ...cand,
        continuation: this.settings.showOpponentMoves ? cand.continuation : undefined,
      }));
  }

  private applyOpeningBook(engineCandidates: EngineCandidate[]): EngineCandidate[] {
    if (
      !this.settings.opening.enabled ||
      !this.activePositionKey ||
      !this.currentBoardState ||
      !this.isWithinBookDepth(this.currentBoardState.fen)
    ) {
      return engineCandidates.slice(0, Math.max(1, this.settings.multiPv));
    }

    const bookEntry = OpeningBook.lookupMove(
      this.activePositionKey,
      this.settings.opening.repertoireId,
      this.currentBoardState.fen
    );
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
    this.pendingCandidates = [];
    this.pendingDepth = 0;
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
