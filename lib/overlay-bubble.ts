import type { BubbleSettings } from './types';

export interface BubbleContent {
  gameActive: boolean;
  openingName: string | null;
  eco?: string;
  reachedPlies: number;
  linePlies: number;
  nextSan: string | null;
  candidateLines: number;
  offBook: boolean;
  engineLabel: string;
  depth: number;
  evalText: string;
  responseMs: number;
  threaded: boolean;
  threads: number;
  hashMb: number;
  autoMoveEnabled: boolean;
  autoMoveMode: string;
  autoMovesPlayed: number;
  autoMoveLimit: number;
  /** Why auto-move stopped, when it stopped by itself. */
  autoMoveHalted: string | null;
}

export interface BubbleCallbacks {
  onToggleAutoMove(enabled: boolean): void;
  onToggleVisible(visible: boolean): void;
  onPositionChanged(x: number, y: number): void;
}

const SURFACE = '#16202b';
const INK = '#e2e8f0';
const MUTED = '#94a3b8';
const LINE = 'rgba(255, 255, 255, 0.10)';
const READY = '#10b981';
const ACCENT = '#f43f5e';

const BUBBLE_WIDTH = 244;
const HANDLE_SIZE = 26;
/** Bounded so the bubble can never cover the whole board or the site UI. */
const Z_INDEX = '34';

/**
 * A draggable status bubble pinned over the board.
 *
 * Every other injected layer is `pointer-events: none` so it cannot steal
 * clicks from the board. This one has to be an exception because it is
 * interactive, so the exception is contained: only the bubble and its collapse
 * handle accept pointer events, they are absolutely positioned inside the
 * board, and nothing else in the overlay changes.
 */
export class OverlayBubble {
  private board: HTMLElement;
  private settings: BubbleSettings;
  private readonly callbacks: BubbleCallbacks;
  private root: HTMLElement | null = null;
  private handle: HTMLElement | null = null;
  private content: BubbleContent | null = null;
  private drag: { pointerId: number; offsetX: number; offsetY: number } | null = null;
  private visible: boolean;

  constructor(board: HTMLElement, settings: BubbleSettings, callbacks: BubbleCallbacks) {
    this.board = board;
    this.settings = settings;
    this.callbacks = callbacks;
    this.visible = settings.visible;
    this.build();
  }

  private build(): void {
    const computed = window.getComputedStyle(this.board);
    if (computed.position === 'static') this.board.style.position = 'relative';

    this.board.querySelector('#chess-ai-bubble')?.remove();
    this.board.querySelector('#chess-ai-bubble-handle')?.remove();

    const root = document.createElement('div');
    root.id = 'chess-ai-bubble';
    root.style.position = 'absolute';
    root.style.width = `${BUBBLE_WIDTH}px`;
    root.style.boxSizing = 'border-box';
    root.style.padding = '8px 10px 9px';
    root.style.borderRadius = '8px';
    root.style.background = SURFACE;
    root.style.border = `1px solid ${LINE}`;
    root.style.color = INK;
    root.style.fontFamily = 'ui-monospace, monospace';
    root.style.fontSize = '11px';
    root.style.zIndex = Z_INDEX;
    root.style.pointerEvents = 'auto';
    root.style.userSelect = 'none';
    root.style.display = this.visible ? 'block' : 'none';
    root.style.willChange = 'left, top';

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    if (!reduceMotion) {
      root.style.transition = 'background 140ms ease-out, border-color 140ms ease-out';
    }

    root.innerHTML = `
      <div id="chess-ai-bubble-head" style="display:flex; align-items:center; justify-content:space-between; gap:8px; cursor:grab; margin-bottom:6px;">
        <span style="display:flex; align-items:center; gap:6px; min-width:0;">
          <span style="color:${MUTED}; font-size:10px;">::</span>
          <span id="chess-ai-bubble-name" style="font-weight:700; color:${INK}; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">No theory</span>
        </span>
        <button id="chess-ai-bubble-hide" type="button" title="Hide bubble"
          style="flex:0 0 auto; border:0; background:transparent; color:${MUTED}; font:inherit; cursor:pointer; padding:0 2px;">&times;</button>
      </div>
      <div id="chess-ai-bubble-line" style="color:${MUTED}; font-size:10px; margin-bottom:5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">-</div>
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; padding-top:5px; border-top:1px solid ${LINE};">
        <span id="chess-ai-bubble-engine" style="color:${MUTED}; font-size:10px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">-</span>
        <span id="chess-ai-bubble-eval" style="font-weight:700; color:${INK};">0.00</span>
      </div>
      <div id="chess-ai-bubble-auto-row" style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:6px; padding-top:6px; border-top:1px solid ${LINE};">
        <span id="chess-ai-bubble-auto-state" style="color:${MUTED}; font-size:10px;">Auto-move off</span>
        <button id="chess-ai-bubble-auto" type="button"
          style="flex:0 0 auto; border:1px solid ${LINE}; border-radius:5px; background:transparent; color:${INK}; font:inherit; font-size:10px; padding:2px 7px; cursor:pointer;">Play</button>
      </div>
    `;

    this.board.appendChild(root);
    this.root = root;

    const handle = document.createElement('button');
    handle.id = 'chess-ai-bubble-handle';
    handle.type = 'button';
    handle.title = 'Show the analysis bubble';
    handle.textContent = 'i';
    handle.style.position = 'absolute';
    handle.style.width = `${HANDLE_SIZE}px`;
    handle.style.height = `${HANDLE_SIZE}px`;
    handle.style.borderRadius = '50%';
    handle.style.border = `1px solid ${LINE}`;
    handle.style.background = SURFACE;
    handle.style.color = INK;
    handle.style.fontFamily = 'ui-monospace, monospace';
    handle.style.fontSize = '11px';
    handle.style.fontWeight = '700';
    handle.style.cursor = 'pointer';
    handle.style.zIndex = Z_INDEX;
    handle.style.pointerEvents = 'auto';
    handle.style.display = this.visible ? 'none' : 'block';
    this.board.appendChild(handle);
    this.handle = handle;

    this.applyPosition();

    root.querySelector('#chess-ai-bubble-hide')?.addEventListener('click', (event) => {
      event.stopPropagation();
      this.setVisible(false);
      this.callbacks.onToggleVisible(false);
    });
    handle.addEventListener('click', () => {
      this.setVisible(true);
      this.callbacks.onToggleVisible(true);
    });

    const autoButton = root.querySelector<HTMLButtonElement>('#chess-ai-bubble-auto');
    autoButton?.addEventListener('click', (event) => {
      event.stopPropagation();
      const next = !(this.content?.autoMoveEnabled ?? false);
      this.callbacks.onToggleAutoMove(next);
    });

    const head = root.querySelector<HTMLElement>('#chess-ai-bubble-head');
    head?.addEventListener('pointerdown', (event) => this.startDrag(event));
    root.addEventListener('pointermove', (event) => this.moveDrag(event));
    root.addEventListener('pointerup', (event) => this.endDrag(event));
    root.addEventListener('pointercancel', (event) => this.endDrag(event));

    if (this.content) this.render(this.content);
  }

  private startDrag(event: PointerEvent): void {
    if (!this.root) return;
    const rect = this.root.getBoundingClientRect();
    this.drag = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    const head = this.root.querySelector<HTMLElement>('#chess-ai-bubble-head');
    if (head) head.style.cursor = 'grabbing';
    event.preventDefault();
    event.stopPropagation();
  }

  private moveDrag(event: PointerEvent): void {
    if (!this.drag || event.pointerId !== this.drag.pointerId || !this.root) return;
    const boardRect = this.board.getBoundingClientRect();
    const width = this.root.offsetWidth || BUBBLE_WIDTH;
    const height = this.root.offsetHeight || 92;
    const x = Math.max(0, Math.min(boardRect.width - width, event.clientX - boardRect.left - this.drag.offsetX));
    const y = Math.max(0, Math.min(boardRect.height - height, event.clientY - boardRect.top - this.drag.offsetY));
    this.root.style.left = `${x}px`;
    this.root.style.top = `${y}px`;
    this.settings = { ...this.settings, x, y };
    event.preventDefault();
  }

  private endDrag(event: PointerEvent): void {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.drag = null;
    const head = this.root?.querySelector<HTMLElement>('#chess-ai-bubble-head');
    if (head) head.style.cursor = 'grab';
    if (this.settings.x !== null && this.settings.y !== null) {
      this.callbacks.onPositionChanged(this.settings.x, this.settings.y);
    }
  }

  private applyPosition(): void {
    if (!this.root || !this.handle) return;
    const boardRect = this.board.getBoundingClientRect();
    const width = this.root.offsetWidth || BUBBLE_WIDTH;
    const fallbackX = Math.max(0, boardRect.width - width - 6);
    const x = this.settings.x ?? Math.max(0, boardRect.width - width - 6);
    const y = this.settings.y ?? 6;
    const maxX = Math.max(0, boardRect.width - width);
    const maxY = Math.max(0, boardRect.height - (this.root.offsetHeight || 92));

    this.root.style.left = `${Math.max(0, Math.min(maxX, x))}px`;
    this.root.style.top = `${Math.max(0, Math.min(maxY, y))}px`;
    this.handle.style.left = `${this.settings.x === null ? fallbackX : Math.max(0, Math.min(maxX, x))}px`;
    this.handle.style.top = `${this.settings.y === null ? 6 : Math.max(0, Math.min(maxY, y))}px`;
  }

  public updateSettings(settings: BubbleSettings): void {
    const positionChanged =
      settings.x !== this.settings.x || settings.y !== this.settings.y || settings.visible !== this.settings.visible;
    this.settings = settings;
    this.visible = settings.visible;
    if (this.root) this.root.style.display = settings.visible ? 'block' : 'none';
    if (this.handle) this.handle.style.display = settings.visible ? 'none' : 'block';
    if (this.root) {
      const autoRow = this.root.querySelector<HTMLElement>('#chess-ai-bubble-auto-row');
      if (autoRow) autoRow.style.display = settings.showAutoMoveToggle ? 'flex' : 'none';
    }
    if (positionChanged) this.applyPosition();
  }

  public setVisible(visible: boolean): void {
    this.updateSettings({ ...this.settings, visible });
  }

  public render(content: BubbleContent): void {
    this.content = content;
    if (!this.root) return;

    const root = this.root;
    root.style.borderColor = content.autoMoveEnabled ? 'rgba(244, 63, 94, 0.45)' : LINE;

    const nameEl = root.querySelector<HTMLElement>('#chess-ai-bubble-name');
    const lineEl = root.querySelector<HTMLElement>('#chess-ai-bubble-line');
    const engineEl = root.querySelector<HTMLElement>('#chess-ai-bubble-engine');
    const evalEl = root.querySelector<HTMLElement>('#chess-ai-bubble-eval');
    const autoRow = root.querySelector<HTMLElement>('#chess-ai-bubble-auto-row');
    const autoState = root.querySelector<HTMLElement>('#chess-ai-bubble-auto-state');
    const autoButton = root.querySelector<HTMLButtonElement>('#chess-ai-bubble-auto');

    if (nameEl) {
      nameEl.textContent = content.gameActive
        ? `${content.openingName ?? 'Out of theory'}${content.eco ? ` · ${content.eco}` : ''}`
        : 'No active game';
    }

    if (lineEl) {
      if (!content.gameActive) {
        lineEl.textContent = 'Waiting for the board';
      } else if (!content.openingName) {
        lineEl.textContent = 'No catalogue line matches this position';
      } else {
        const progress = `${content.reachedPlies}/${content.linePlies} plies`;
        const next = content.nextSan ? `next ${content.nextSan}` : 'line played out';
        const breadth = content.candidateLines > 1 ? ` · ${content.candidateLines} lines` : '';
        lineEl.textContent = `${progress} · ${next}${breadth}`;
      }
    }

    if (engineEl) {
      const parallel = content.threaded ? `${content.threads}t` : '1t';
      engineEl.textContent = `${content.engineLabel} d${content.depth} · ${content.hashMb}MB · ${parallel} · ${content.responseMs}ms`;
    }
    if (evalEl) evalEl.textContent = content.evalText;

    if (autoRow) autoRow.style.display = this.settings.showAutoMoveToggle ? 'flex' : 'none';
    if (autoState) {
      if (content.autoMoveEnabled && content.autoMoveHalted) {
        autoState.textContent = content.autoMoveHalted;
        autoState.style.color = ACCENT;
      } else {
        autoState.textContent = content.autoMoveEnabled
          ? `Auto ${content.autoMoveMode}${content.autoMoveLimit > 0 ? ` · ${content.autoMovesPlayed}/${content.autoMoveLimit}` : ` · ${content.autoMovesPlayed}`}`
          : 'Auto-move off';
        autoState.style.color = content.autoMoveEnabled ? ACCENT : MUTED;
      }
    }
    if (autoButton) {
      autoButton.textContent = content.autoMoveEnabled ? 'Stop' : 'Play';
      autoButton.style.borderColor = content.autoMoveEnabled ? 'rgba(244, 63, 94, 0.5)' : LINE;
      autoButton.style.color = content.autoMoveEnabled ? ACCENT : INK;
    }
    // The status dot mirrors the engine's own readiness colour.
    if (autoState && !content.autoMoveEnabled) autoState.style.color = MUTED;
    if (evalEl && !content.gameActive) evalEl.style.color = MUTED;
    else if (evalEl) evalEl.style.color = READY;
  }

  public destroy(): void {
    this.root?.remove();
    this.handle?.remove();
    this.root = null;
    this.handle = null;
    this.drag = null;
  }
}
