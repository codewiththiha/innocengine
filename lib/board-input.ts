export interface PlayableMove {
  from: string;
  to: string;
  promotion?: string;
}

const FILES = 'abcdefgh';

function squareToColumn(square: string): number {
  return FILES.indexOf(square[0] ?? '');
}

function squareToRow(square: string): number {
  return 8 - Number(square[1] ?? '0');
}

/**
 * Plays a move by synthesising the pointer input a human would produce.
 *
 * Chess portals build boards from script-generated markup and listen for
 * window-level pointer events, so the square is derived from the pointer
 * coordinates rather than from element classes that change between releases.
 */
export class BoardInput {
  /** Centre of a square in viewport coordinates, honouring board orientation. */
  public static squareCentre(
    board: HTMLElement,
    square: string,
    isFlipped: boolean
  ): { x: number; y: number; size: number } | null {
    const rect = board.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const column = squareToColumn(square);
    const row = squareToRow(square);
    if (column < 0 || row < 0) return null;

    const size = rect.width / 8;
    const visualColumn = isFlipped ? 7 - column : column;
    const visualRow = isFlipped ? row : 7 - row;

    return {
      x: rect.left + visualColumn * size + size / 2,
      y: rect.top + visualRow * size + size / 2,
      size,
    };
  }

  public static play(board: HTMLElement, move: PlayableMove, isFlipped: boolean): boolean {
    const from = BoardInput.squareCentre(board, move.from, isFlipped);
    const to = BoardInput.squareCentre(board, move.to, isFlipped);
    if (!from || !to) return false;

    const target = BoardInput.dropTarget(board, from.x, from.y);
    BoardInput.press(target, from.x, from.y);
    // A short drag reads as a real gesture to boards that require movement
    // before they accept the drop.
    BoardInput.moveTo(from.x, from.y, to.x, to.y, from.size / 4);
    BoardInput.release(BoardInput.dropTarget(board, to.x, to.y), to.x, to.y);

    if (move.promotion) {
      BoardInput.choosePromotion(board, move, isFlipped);
    }

    return true;
  }

  /**
   * The element under the pointer, unless that element is part of our own UI.
   * A bubble parked over a square must not swallow the move, so those hits fall
   * back to the board element, which covers every square anyway.
   */
  private static dropTarget(board: HTMLElement, x: number, y: number): EventTarget {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!hit) return board;
    let node: HTMLElement | null = hit;
    while (node && node !== board) {
      if (node.id?.startsWith('chess-ai-')) return board;
      node = node.parentElement;
    }
    return hit;
  }

  private static press(target: EventTarget, x: number, y: number): void {
    const base = BoardInput.pointerInit(x, y);
    target.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1, isPrimary: true }));
    target.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
  }

  private static moveTo(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    steps: number
  ): void {
    const total = Math.max(1, Math.ceil(steps / 4));
    for (let step = 1; step <= total; step++) {
      const t = step / total;
      const px = fromX + (toX - fromX) * t;
      const py = fromY + (toY - fromY) * t;
      document.dispatchEvent(new PointerEvent('pointermove', BoardInput.pointerInit(px, py)));
      document.dispatchEvent(new MouseEvent('mousemove', BoardInput.pointerInit(px, py)));
    }
  }

  private static release(target: EventTarget, x: number, y: number): void {
    const base = BoardInput.pointerInit(x, y);
    target.dispatchEvent(new PointerEvent('pointerup', base));
    target.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 1 }));
    target.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }));
  }

  private static pointerInit(x: number, y: number): MouseEventInit {
    return { clientX: x, clientY: y, bubbles: true, cancelable: true, composed: true, view: window };
  }

  /**
   * Promotion is the one move that needs a second click. The picker is looked
   * up by class substring because the portal owns its markup; if the picker
   * never appears the caller simply sees no board change and stops.
   */
  private static choosePromotion(board: HTMLElement, move: PlayableMove, isFlipped: boolean): void {
    const wanted = (move.promotion ?? 'q').toLowerCase();
    const deadline = Date.now() + 700;

    const attempt = () => {
      const pickers = Array.from(
        board.querySelectorAll<HTMLElement>('[class*="promotion"], [class*="promo"]')
      ).filter((element) => BoardInput.isVisible(element));

      if (pickers.length > 0) {
        const column = squareToColumn(move.to);
        const to = BoardInput.squareCentre(board, move.to, isFlipped);
        const sameFile = pickers.filter((element) => {
          if (!to) return true;
          return Math.abs(element.getBoundingClientRect().left - to.x) <= to.size;
        });

        const pool = sameFile.length > 0 ? sameFile : pickers;
        // The picker lists queen first, so index order is the fallback when the
        // piece itself is not named in the markup.
        const byName = pool.find((element) => {
          const classes = element.className.toLowerCase();
          return classes.includes(`promotion-${wanted}`) || classes.split(/\s+/).includes(wanted);
        });
        const piece = byName ?? pool[0];
        if (piece) {
          const rect = piece.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          BoardInput.press(piece, x, y);
          BoardInput.release(piece, x, y);
          return true;
        }
      }

      if (Date.now() < deadline) {
        setTimeout(attempt, 60);
        return false;
      }
      return false;
    };

    setTimeout(attempt, 60);
  }

  private static isVisible(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.pointerEvents !== 'none';
  }
}
