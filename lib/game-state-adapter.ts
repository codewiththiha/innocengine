import { Chess } from 'chess.js';
import { BoardParser } from './board-parser';

export interface GameState {
  fen: string;
  positionKey: string;
  turn: 'w' | 'b';
  isFlipped: boolean;
  pieceMap: Map<string, string>;
  moveHistory: string[];
  boardElement: HTMLElement;
}

export class GameStateAdapter {
  public static extractGameState(board: HTMLElement): GameState | null {
    const isFlipped = BoardParser.isBoardFlipped(board);
    const gridState = BoardParser.extractBoardState(board);
    if (!gridState) return null;

    // Attempt to reconstruct authoritative FEN by replaying move list
    const moveHistory = this.extractMoveHistoryFromDom();
    if (moveHistory.length > 0) {
      try {
        const chess = new Chess();
        let replaySuccess = true;

        for (const san of moveHistory) {
          try {
            const move = chess.move(san);
            if (!move) {
              replaySuccess = false;
              break;
            }
          } catch (_) {
            replaySuccess = false;
            break;
          }
        }

        if (replaySuccess) {
          const replayedFen = chess.fen();
          const tokens = replayedFen.split(' ');
          const positionKey = tokens.slice(0, 4).join(' ');

          // Verify piece map matches board DOM to avoid stale move-list frames
          if (this.verifyPieceMatch(chess, gridState.pieceMap)) {
            return {
              fen: replayedFen,
              positionKey,
              turn: chess.turn() as 'w' | 'b',
              isFlipped,
              pieceMap: gridState.pieceMap,
              moveHistory,
              boardElement: board,
            };
          }
        }
      } catch (_) {}
    }

    // Fallback to validated grid placement
    return {
      fen: gridState.fen,
      positionKey: gridState.positionKey,
      turn: gridState.turn,
      isFlipped,
      pieceMap: gridState.pieceMap,
      moveHistory: [],
      boardElement: board,
    };
  }

  private static extractMoveHistoryFromDom(): string[] {
    const nodes = document.querySelectorAll<HTMLElement>(
      '.move-list-row .node, vertical-move-list .node, .game-history .node, wc-move-list .node'
    );
    if (!nodes || nodes.length === 0) return [];

    const moves: string[] = [];
    nodes.forEach((node) => {
      // Clean notation text (remove glyphs, evaluation icons, checkmate tags)
      const text = node.innerText.trim();
      const match = text.match(/^[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[\+#]?|^O-O(?:-O)?[\+#]?/);
      if (match && match[0]) {
        moves.push(match[0]);
      }
    });

    return moves;
  }

  private static verifyPieceMatch(chess: Chess, pieceMap: Map<string, string>): boolean {
    const board = chess.board();
    let matches = 0;
    let totalPieces = 0;

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const sq = `${String.fromCharCode(97 + f)}${8 - r}`;
        const piece = board[r]?.[f];
        const domPiece = pieceMap.get(sq);

        if (piece) {
          totalPieces++;
          const expectedChar = piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
          if (domPiece === expectedChar) {
            matches++;
          }
        } else if (domPiece) {
          return false;
        }
      }
    }

    return totalPieces > 0 && matches === totalPieces;
  }
}
