import type { BoardState } from './types';

const PIECE_MAP: Record<string, string> = {
  wp: 'P',
  wn: 'N',
  wb: 'B',
  wr: 'R',
  wq: 'Q',
  wk: 'K',
  bp: 'p',
  bn: 'n',
  bb: 'b',
  br: 'r',
  bq: 'q',
  bk: 'k',
};

export class BoardParser {
  private static lastPlacement: string = '';
  private static lastTurn: 'w' | 'b' = 'w';
  private static lastGrid: string[][] | null = null;

  public static findBoardElement(): HTMLElement | null {
    const selectors = [
      'wc-chess-board',
      'chess-board',
      '#board-single',
      '#board-layout-chessboard',
      '.board',
    ];

    for (const selector of selectors) {
      const el = document.querySelector<HTMLElement>(selector);
      if (el && (el.querySelector('.piece') || el.clientWidth > 100)) {
        return el;
      }
    }
    return null;
  }

  public static isBoardFlipped(board: HTMLElement): boolean {
    // 1. Direct class or attribute on board element
    if (
      board.classList.contains('flipped') ||
      board.classList.contains('orientation-black') ||
      board.hasAttribute('flipped') ||
      board.getAttribute('orientation') === 'black' ||
      board.getAttribute('data-orientation') === 'black'
    ) {
      return true;
    }

    // 2. Ancestor container classes and attributes
    const parent = board.closest(
      '.board-layout-main, .board-container, #board-layout-chessboard, .board-layout-chessboard, .round__app, cg-wrap'
    );
    if (
      parent &&
      (parent.classList.contains('flipped') ||
        parent.classList.contains('orientation-black') ||
        parent.hasAttribute('flipped') ||
        parent.getAttribute('orientation') === 'black' ||
        parent.getAttribute('data-orientation') === 'black')
    ) {
      return true;
    }

    // 3. SVG Coordinates: Check vertical position of rank '1' vs '8'
    const coordTexts = board.querySelectorAll(
      'svg.coordinates text, text.coordinate-light, text.coordinate-dark, .coordinates text'
    );
    if (coordTexts.length > 0) {
      const boardRect = board.getBoundingClientRect();
      if (boardRect.height > 0) {
        const midY = boardRect.top + boardRect.height / 2;
        for (const text of Array.from(coordTexts)) {
          const content = text.textContent?.trim();
          if (content === '1' || content === '8') {
            const rect = text.getBoundingClientRect();
            if (rect.height > 0) {
              // If coordinate '1' is in the top half, rank 1 is on top -> board is flipped
              if (content === '1') {
                return rect.top < midY;
              }
              // If coordinate '8' is in the bottom half, rank 8 is on bottom -> board is flipped
              if (content === '8') {
                return rect.top > midY;
              }
            }
          }
        }
      }
    }

    return false;
  }

  public static isGameActive(board: HTMLElement): boolean {
    if (board?.classList?.contains('board-disabled')) {
      return false;
    }
    if (typeof document !== 'undefined') {
      const gameOverEl = document.querySelector(
        '.game-over-modal-shell-container, .game-over-modal-component, .game-over-dialog-component, .game-over-modal'
      );
      if (gameOverEl) {
        return false;
      }
    }
    return true;
  }

  public static detectPlayerColor(board: HTMLElement, isFlipped: boolean): 'w' | 'b' {
    if (typeof document === 'undefined') {
      return isFlipped ? 'b' : 'w';
    }

    const colorOf = (el?: Element | null): 'w' | 'b' | null => {
      if (!el) return null;
      if (el.classList.contains('clock-white') || el.classList.contains('white')) return 'w';
      if (el.classList.contains('clock-black') || el.classList.contains('black')) return 'b';
      const dataColor = el.getAttribute('data-color');
      if (dataColor === 'w' || dataColor === 'white') return 'w';
      if (dataColor === 'b' || dataColor === 'black') return 'b';
      return null;
    };

    // 1. Authoritative: Bottom player clock on Chess.com
    const bottomClock = document.querySelector(
      '#board-layout-player-bottom .clock-component, .player-bottom .clock-component, .clock-bottom, #board-layout-player-bottom [class*="clock"], .board-layout-bottom [class*="clock"]'
    );
    let myColor = colorOf(bottomClock);

    // 2. Cross-check with authenticated user session
    try {
      const session =
        (typeof window !== 'undefined' && (window as any).context?.user?.username) ||
        document.querySelector('a[data-user-activity-key="profile"]')?.getAttribute('data-user') ||
        document.querySelector('a[data-user-activity-key="profile"]')?.textContent?.trim();

      const bottomName = document.querySelector(
        '#board-layout-player-bottom [data-test-element="user-tagline-username"], .player-bottom [data-test-element="user-tagline-username"], #board-layout-player-bottom .user-username-component, .player-bottom .user-username-component'
      )?.textContent?.trim();

      if (session && bottomName && bottomName.toLowerCase() !== session.toLowerCase()) {
        const topClock = document.querySelector(
          '#board-layout-player-top .clock-component, .player-top .clock-component, .clock-top, #board-layout-player-top [class*="clock"], .board-layout-top [class*="clock"]'
        );
        const topColor = colorOf(topClock);
        if (topColor) {
          myColor = topColor;
        }
      }
    } catch (_) {}

    if (myColor) return myColor;

    // 3. Captured pieces container: player-color="1" -> White, player-color="2" -> Black
    const bottomCaptured = document.querySelector(
      '#board-layout-player-bottom wc-captured-pieces, .player-bottom wc-captured-pieces'
    );
    if (bottomCaptured) {
      const pColor = bottomCaptured.getAttribute('player-color');
      if (pColor === '1') return 'w';
      if (pColor === '2') return 'b';
    }

    // 4. Avatar image source check (white_400.png / black_400.png)
    const bottomAvatar = document.querySelector(
      '#board-layout-player-bottom img.avatar, .player-bottom img.avatar, #board-layout-player-bottom [data-test-element="user-avatar"] img, .player-bottom [data-test-element="user-avatar"] img'
    );
    if (bottomAvatar) {
      const src = bottomAvatar.getAttribute('src') || '';
      if (src.includes('white_400.png') || src.includes('white_100.png')) return 'w';
      if (src.includes('black_400.png') || src.includes('black_100.png')) return 'b';
    }

    // 5. Container data-color / class check (including legacy selectors and Lichess)
    const bottomPlayer = document.querySelector(
      '#board-layout-player-bottom, .player-bottom, .board-layout-bottom, .board-layout-player.bottom, .player-component.bottom, [data-test-element="player-bottom"], .board-player-bottom, .round__app .ruser-bottom'
    );
    if (bottomPlayer) {
      const dataColor = bottomPlayer.getAttribute('data-color');
      if (dataColor === 'w' || dataColor === 'white') return 'w';
      if (dataColor === 'b' || dataColor === 'black') return 'b';

      if (bottomPlayer.classList.contains('white')) return 'w';
      if (bottomPlayer.classList.contains('black')) return 'b';
    }

    // 6. Orientation fallback: Seated at bottom without explicit clock/user data
    return isFlipped ? 'b' : 'w';
  }

  public static extractBoardState(board: HTMLElement): BoardState | null {
    const isFlipped = this.isBoardFlipped(board);
    const playerColor = this.detectPlayerColor(board, isFlipped);
    const isGameActive = this.isGameActive(board);
    const pieces = board.querySelectorAll<HTMLElement>('.piece:not([class*="ai-"])');
    if (!pieces || pieces.length === 0) {
      return null;
    }

    const grid: string[][] = Array(8)
      .fill(null)
      .map(() => Array(8).fill(''));

    const pieceMap = new Map<string, string>();
    const boardRect = board.getBoundingClientRect();
    const squareWidth = boardRect.width / 8;
    const squareHeight = boardRect.height / 8;

    pieces.forEach((pieceEl) => {
      if (pieceEl.closest('#chess-ai-svg-overlay')) return;

      let pieceType: string | null = null;
      let file: number | null = null;
      let rank: number | null = null;

      for (const cls of Array.from(pieceEl.classList)) {
        if (PIECE_MAP[cls]) {
          pieceType = PIECE_MAP[cls];
          break;
        }
      }

      if (!pieceType) {
        const pieceData = pieceEl.dataset.piece;
        if (pieceData && PIECE_MAP[pieceData]) {
          pieceType = PIECE_MAP[pieceData];
        }
      }

      if (!pieceType) return;

      for (const cls of Array.from(pieceEl.classList)) {
        const match = cls.match(/^square-(\d)(\d)$/);
        if (match && match[1] && match[2]) {
          file = parseInt(match[1], 10) - 1;
          rank = parseInt(match[2], 10) - 1;
          break;
        }
      }

      if ((file === null || rank === null) && pieceEl.style.transform && squareWidth > 0) {
        const transform = pieceEl.style.transform;
        const matchPx = transform.match(/translate\(\s*(-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px\)/);
        const matchPercent = transform.match(/translate\(\s*(-?\d+(?:\.\d+)?)%,\s*(-?\d+(?:\.\d+)?)%\)/);

        if (matchPx && matchPx[1] && matchPx[2]) {
          const col = Math.round(parseFloat(matchPx[1]) / squareWidth);
          const row = Math.round(parseFloat(matchPx[2]) / squareHeight);
          file = isFlipped ? 7 - col : col;
          rank = isFlipped ? row : 7 - row;
        } else if (matchPercent && matchPercent[1] && matchPercent[2]) {
          const col = Math.round(parseFloat(matchPercent[1]) / 100);
          const row = Math.round(parseFloat(matchPercent[2]) / 100);
          file = isFlipped ? 7 - col : col;
          rank = isFlipped ? row : 7 - row;
        }
      }

      if (file !== null && rank !== null && file >= 0 && file < 8 && rank >= 0 && rank < 8) {
        const rowArr = grid[rank];
        if (rowArr) {
          rowArr[file] = pieceType;
        }
        const sqName = `${String.fromCharCode(97 + file)}${rank + 1}`;
        pieceMap.set(sqName, pieceType);
      }
    });

    const placement = this.gridToPlacement(grid);
    const isInitialPosition = this.checkInitialPosition(grid);

    let turn: 'w' | 'b';
    if (isInitialPosition) {
      turn = 'w';
      this.lastTurn = 'w';
      this.lastPlacement = placement;
      this.lastGrid = grid.map((r) => [...r]);
    } else if (placement === this.lastPlacement && this.lastTurn) {
      // Piece selection or click without movement: retain existing turn!
      turn = this.lastTurn;
    } else {
      const movedColor = this.detectMovedColor(this.lastGrid, grid);
      if (movedColor) {
        // In chess, turns strictly alternate: if White moved, it is now Black's turn
        turn = movedColor === 'w' ? 'b' : 'w';
      } else {
        turn = this.detectTurn(board, this.lastTurn || 'w');
      }
      this.lastTurn = turn;
      this.lastPlacement = placement;
      this.lastGrid = grid.map((r) => [...r]);
    }

    const castling = this.computeCastlingRights(grid);
    const positionKey = `${placement} ${turn} ${castling} -`;
    const fen = `${positionKey} 0 1`;

    return {
      fen,
      positionKey,
      placement,
      isFlipped,
      turn,
      playerColor,
      controlledColor: 'auto',
      pieceMap,
      boardElement: board,
      isGameActive,
      moveHistory: this.extractMoveHistoryFromDom(),
    };
  }

  private static detectMovedColor(prevGrid: string[][] | null, nextGrid: string[][]): 'w' | 'b' | null {
    if (!prevGrid) return null;

    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const prevPiece = prevGrid[r]?.[f] || '';
        const nextPiece = nextGrid[r]?.[f] || '';
        if (!prevPiece && nextPiece) {
          // Destination square of quiet move or pawn advance
          return nextPiece === nextPiece.toUpperCase() ? 'w' : 'b';
        }
        if (prevPiece && nextPiece && prevPiece !== nextPiece) {
          // Destination square of a capture: replaced by capturing piece
          return nextPiece === nextPiece.toUpperCase() ? 'w' : 'b';
        }
      }
    }

    return null;
  }

  private static gridToPlacement(grid: string[][]): string {
    const rows: string[] = [];
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      let rowStr = '';
      const rowArr = grid[r];
      for (let f = 0; f < 8; f++) {
        const piece = rowArr ? rowArr[f] : '';
        if (piece) {
          if (empty > 0) {
            rowStr += empty;
            empty = 0;
          }
          rowStr += piece;
        } else {
          empty++;
        }
      }
      if (empty > 0) {
        rowStr += empty;
      }
      rows.push(rowStr);
    }
    return rows.join('/');
  }

  private static checkInitialPosition(grid: string[][]): boolean {
    const startBackWhite = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
    const startBackBlack = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];

    const row0 = grid[0];
    const row1 = grid[1];
    const row6 = grid[6];
    const row7 = grid[7];
    if (!row0 || !row1 || !row6 || !row7) return false;

    for (let f = 0; f < 8; f++) {
      if (row0[f] !== startBackWhite[f] || row1[f] !== 'P') return false;
      if (row7[f] !== startBackBlack[f] || row6[f] !== 'p') return false;
    }
    for (let r = 2; r <= 5; r++) {
      const row = grid[r];
      if (!row) return false;
      for (let f = 0; f < 8; f++) {
        if (row[f] !== '') return false;
      }
    }
    return true;
  }

  private static computeCastlingRights(grid: string[][]): string {
    let rights = '';
    const row0 = grid[0];
    const row7 = grid[7];

    if (row0 && row0[4] === 'K') {
      if (row0[7] === 'R') rights += 'K';
      if (row0[0] === 'R') rights += 'Q';
    }
    if (row7 && row7[4] === 'k') {
      if (row7[7] === 'r') rights += 'k';
      if (row7[0] === 'r') rights += 'q';
    }
    return rights.length > 0 ? rights : '-';
  }

  public static extractMoveHistoryFromDom(): string[] {
    if (typeof document === 'undefined') return [];
    const nodes = document.querySelectorAll<HTMLElement>(
      'wc-simple-move-list .node.main-line-ply, .main-line-row .node.main-line-ply, .main-line-ply, vertical-move-list .node, .game-history .node, wc-move-list .node, .move-node:not(.empty)'
    );
    if (!nodes || nodes.length === 0) return [];

    const moves: string[] = [];
    nodes.forEach((node) => {
      const text = node.innerText?.trim() || node.textContent?.trim() || '';
      // Skip turn numbers ("1.", "2.") and timestamp notations ("0.9s", "1.2s", "0:15")
      if (/^\d+\.?$/.test(text) || /^\d+(\.\d+)?s$/.test(text) || /^\d+:\d+$/.test(text)) return;
      const match = text.match(/^[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[\+#]?|^O-O(?:-O)?[\+#]?/);
      if (match && match[0]) {
        moves.push(match[0]);
      }
    });

    return moves;
  }

  public static detectTurn(board?: HTMLElement | null, fallbackTurn: 'w' | 'b' = 'w'): 'w' | 'b' {
    if (typeof document === 'undefined') return fallbackTurn;

    const colorOf = (el?: Element | null): 'w' | 'b' | null => {
      if (!el) return null;
      if (el.classList.contains('clock-white') || el.classList.contains('white')) return 'w';
      if (el.classList.contains('clock-black') || el.classList.contains('black')) return 'b';
      return null;
    };

    // 1. Clock first: active clock marked with .clock-player-turn
    const activeClock = document.querySelector(
      '.clock-component.clock-player-turn, [class*="clock-player-turn"], .rclock.running, .rclock-bottom.running, .rclock-top.running'
    );
    const clockTurn = colorOf(activeClock);
    if (clockTurn) {
      return clockTurn;
    }

    // 2. Ply count second: count authoritative .main-line-ply nodes
    const plies = document.querySelectorAll(
      'wc-simple-move-list .node.main-line-ply, .main-line-row .node.main-line-ply, .move-list-row .node.main-line-ply, .main-line-ply'
    );
    if (plies.length > 0) {
      return plies.length % 2 === 0 ? 'w' : 'b';
    }

    // 3. Extracted move history fallback (Lichess or alternate move list DOM)
    const moveHistory = this.extractMoveHistoryFromDom();
    if (moveHistory.length > 0) {
      return moveHistory.length % 2 === 0 ? 'w' : 'b';
    }

    return fallbackTurn;
  }
}
