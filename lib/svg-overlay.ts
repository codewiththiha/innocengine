import type { EngineEvaluation, EngineSettings } from './types';

export class SvgOverlay {
  private board: HTMLElement;
  private svg: SVGSVGElement | null = null;
  private evalBarContainer: HTMLElement | null = null;
  private evalBarFill: HTMLElement | null = null;
  private evalScoreText: HTMLElement | null = null;
  private hudElement: HTMLElement | null = null;
  private domHighlights: HTMLElement[] = [];
  private isFlipped: boolean = false;
  private settings: EngineSettings;

  constructor(board: HTMLElement, settings: EngineSettings) {
    this.board = board;
    this.settings = settings;
    this.init();
  }

  public updateSettings(settings: EngineSettings) {
    this.settings = settings;
    if (!settings.showHighlights) {
      this.clearHighlights();
    }
    if (this.evalBarContainer) {
      this.evalBarContainer.style.display = settings.showEvalBar ? 'flex' : 'none';
    }
    if (this.hudElement) {
      this.hudElement.style.display = settings.showHud ? 'flex' : 'none';
    }
  }

  public setFlipped(flipped: boolean) {
    this.isFlipped = flipped;
  }

  private init() {
    this.ensureBoardPositioning();
    this.createSvgElement();
    this.createEvalBar();
    this.createHudElement();
    this.attachResizeObserver();
  }

  private ensureBoardPositioning() {
    const computedStyle = window.getComputedStyle(this.board);
    if (computedStyle.position === 'static') {
      this.board.style.position = 'relative';
    }
  }

  private createSvgElement() {
    const existing = this.board.querySelector('#chess-ai-svg-overlay');
    if (existing) existing.remove();

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'chess-ai-svg-overlay';
    svg.setAttribute('viewBox', '0 0 800 800');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '20';

    svg.innerHTML = `
      <defs>
        <filter id="ai-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.6"/>
        </filter>
      </defs>
      <g id="ai-highlights-layer"></g>
    `;

    this.board.appendChild(svg);
    this.svg = svg;
  }

  private createEvalBar() {
    const existing = document.querySelector('#chess-ai-eval-bar');
    if (existing) existing.remove();

    const bar = document.createElement('div');
    bar.id = 'chess-ai-eval-bar';
    bar.style.position = 'absolute';
    bar.style.top = '0';
    bar.style.left = '-34px';
    bar.style.width = '24px';
    bar.style.height = '100%';
    bar.style.borderRadius = '6px';
    bar.style.overflow = 'hidden';
    bar.style.backgroundColor = '#1e293b';
    bar.style.boxShadow = '0 4px 12px rgba(0,0,0,0.4)';
    bar.style.border = '1px solid rgba(255,255,255,0.15)';
    bar.style.display = this.settings.showEvalBar ? 'flex' : 'none';
    bar.style.flexDirection = 'column-reverse';
    bar.style.zIndex = '30';

    const fill = document.createElement('div');
    fill.id = 'chess-ai-eval-fill';
    fill.style.width = '100%';
    fill.style.height = '50%';
    fill.style.backgroundColor = '#f8fafc';
    fill.style.transition = 'height 0.35s cubic-bezier(0.4, 0, 0.2, 1)';

    const score = document.createElement('div');
    score.id = 'chess-ai-eval-score';
    score.style.position = 'absolute';
    score.style.width = '100%';
    score.style.textAlign = 'center';
    score.style.fontSize = '10px';
    score.style.fontWeight = '700';
    score.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    score.style.color = '#0f172a';
    score.style.bottom = '6px';
    score.style.pointerEvents = 'none';
    score.innerText = '0.0';

    bar.appendChild(fill);
    bar.appendChild(score);
    this.board.appendChild(bar);

    this.evalBarContainer = bar;
    this.evalBarFill = fill;
    this.evalScoreText = score;
  }

  private createHudElement() {
    const existing = document.querySelector('#chess-ai-hud');
    if (existing) existing.remove();

    const hud = document.createElement('div');
    hud.id = 'chess-ai-hud';
    hud.style.position = 'absolute';
    hud.style.top = '-42px'; // Position above board to avoid covering player avatar
    hud.style.left = '0';
    hud.style.right = '0';
    hud.style.display = this.settings.showHud ? 'flex' : 'none';
    hud.style.alignItems = 'center';
    hud.style.justifyContent = 'space-between';
    hud.style.padding = '8px 14px';
    hud.style.background = 'rgba(15, 23, 42, 0.92)';
    hud.style.backdropFilter = 'blur(8px)';
    hud.style.borderRadius = '8px';
    hud.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    hud.style.color = '#f8fafc';
    hud.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    hud.style.fontSize = '12px';
    hud.style.boxShadow = '0 6px 18px rgba(0, 0, 0, 0.35)';
    hud.style.zIndex = '35';

    hud.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981;" id="ai-status-dot"></span>
        <span style="font-weight:700; color:#38bdf8;">Stockfish AI</span>
        <span style="color:#94a3b8;" id="ai-hud-depth">Depth: -</span>
      </div>
      <div style="display: flex; align-items: center; gap: 14px;">
        <span style="font-weight:700; color:#e2e8f0;" id="ai-hud-best">Best Move: -</span>
        <span style="color:#a855f7; font-weight:700;" id="ai-hud-eval">0.00</span>
      </div>
    `;

    this.board.appendChild(hud);
    this.hudElement = hud;
  }

  private attachResizeObserver() {
    const ro = new ResizeObserver(() => {
      if (this.evalBarContainer && this.board) {
        this.evalBarContainer.style.height = `${this.board.clientHeight}px`;
      }
    });
    ro.observe(this.board);
  }

  public clearHighlights() {
    // 1. Clear SVG layer highlights
    if (this.svg) {
      const hlLayer = this.svg.querySelector('#ai-highlights-layer');
      if (hlLayer) hlLayer.innerHTML = '';
    }

    // 2. Clear injected DOM highlight elements
    this.domHighlights.forEach((el) => el.remove());
    this.domHighlights = [];
    const oldEls = this.board.querySelectorAll('.ai-best-move-highlight');
    oldEls.forEach((el) => el.remove());
  }

  public renderEvaluation(evaluation: EngineEvaluation) {
    if (!this.svg) this.createSvgElement();
    this.clearHighlights();

    this.updateEvalBar(evaluation);
    this.updateHud(evaluation);

    if (this.settings.showHighlights && evaluation.bestMove && evaluation.bestMove.length >= 4) {
      this.drawMoveHighlights(evaluation.bestMove);
    }
  }

  private updateEvalBar(evalData: EngineEvaluation) {
    if (!this.evalBarFill || !this.evalScoreText) return;

    let evalScoreString = '0.0';
    let whiteWinPercent = 50;

    if (evalData.scoreMate !== null) {
      evalScoreString = `M${evalData.scoreMate > 0 ? '+' : ''}${evalData.scoreMate}`;
      whiteWinPercent = evalData.scoreMate > 0 ? 100 : 0;
    } else if (evalData.scoreCp !== null) {
      const pawns = evalData.scoreCp / 100;
      evalScoreString = `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
      const winP = 1 / (1 + Math.exp(-0.00368208 * evalData.scoreCp));
      whiteWinPercent = Math.max(5, Math.min(95, Math.round(winP * 100)));
    }

    const fillPercent = this.isFlipped ? 100 - whiteWinPercent : whiteWinPercent;
    this.evalBarFill.style.height = `${fillPercent}%`;
    this.evalScoreText.innerText = evalScoreString;

    if (fillPercent > 50) {
      this.evalScoreText.style.color = '#0f172a';
      this.evalScoreText.style.bottom = '6px';
      this.evalScoreText.style.top = 'auto';
    } else {
      this.evalScoreText.style.color = '#f8fafc';
      this.evalScoreText.style.top = '6px';
      this.evalScoreText.style.bottom = 'auto';
    }
  }

  private updateHud(evalData: EngineEvaluation) {
    if (!this.hudElement) return;

    const depthEl = this.hudElement.querySelector('#ai-hud-depth') as HTMLElement;
    const bestEl = this.hudElement.querySelector('#ai-hud-best') as HTMLElement;
    const evalEl = this.hudElement.querySelector('#ai-hud-eval') as HTMLElement;
    const dotEl = this.hudElement.querySelector('#ai-status-dot') as HTMLElement;

    if (depthEl) depthEl.innerText = `Depth: ${evalData.depth || 0}`;
    if (bestEl) bestEl.innerText = `Move: ${evalData.bestMove ? this.formatUciMove(evalData.bestMove) : '-'}`;

    if (evalEl) {
      if (evalData.scoreMate !== null) {
        evalEl.innerText = `M${evalData.scoreMate > 0 ? '+' : ''}${evalData.scoreMate}`;
        evalEl.style.color = '#ec4899';
      } else if (evalData.scoreCp !== null) {
        const p = (evalData.scoreCp / 100).toFixed(2);
        evalEl.innerText = `${evalData.scoreCp > 0 ? '+' : ''}${p}`;
        evalEl.style.color = evalData.scoreCp >= 0 ? '#38bdf8' : '#f87171';
      }
    }

    if (dotEl) {
      dotEl.style.background = evalData.isCalculating ? '#f59e0b' : '#10b981';
    }
  }

  /**
   * Colors both the piece in charge (from square) and the destination square (to square)
   */
  private drawMoveHighlights(move: string) {
    const fromSquare = move.substring(0, 2);
    const toSquare = move.substring(2, 4);

    const fromFile = fromSquare.charCodeAt(0) - 97 + 1; // 1-8
    const fromRank = fromSquare[1] ? parseInt(fromSquare[1], 10) : 1;
    const toFile = toSquare.charCodeAt(0) - 97 + 1; // 1-8
    const toRank = toSquare[1] ? parseInt(toSquare[1], 10) : 1;

    // 1. Inject native-style DOM highlighters into wc-chess-board
    this.createDomHighlight(fromFile, fromRank, 'from');
    this.createDomHighlight(toFile, toRank, 'to');

    // 2. Render SVG overlay rects for absolute positioning guarantee
    if (this.svg) {
      const hlLayer = this.svg.querySelector('#ai-highlights-layer');
      if (hlLayer) {
        const fromCoord = this.squareToSquareBox(fromSquare);
        const toCoord = this.squareToSquareBox(toSquare);

        if (fromCoord) {
          // Origin piece in charge: vibrant azure halo with border
          const rectFrom = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rectFrom.setAttribute('x', fromCoord.x.toString());
          rectFrom.setAttribute('y', fromCoord.y.toString());
          rectFrom.setAttribute('width', '100');
          rectFrom.setAttribute('height', '100');
          rectFrom.setAttribute('rx', '8');
          rectFrom.setAttribute('fill', 'rgba(56, 189, 248, 0.40)');
          rectFrom.setAttribute('stroke', '#0284c7');
          rectFrom.setAttribute('stroke-width', '4');
          hlLayer.appendChild(rectFrom);
        }

        if (toCoord) {
          // Destination square: vibrant emerald target with solid border
          const rectTo = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rectTo.setAttribute('x', toCoord.x.toString());
          rectTo.setAttribute('y', toCoord.y.toString());
          rectTo.setAttribute('width', '100');
          rectTo.setAttribute('height', '100');
          rectTo.setAttribute('rx', '8');
          rectTo.setAttribute('fill', 'rgba(16, 185, 129, 0.45)');
          rectTo.setAttribute('stroke', '#10b981');
          rectTo.setAttribute('stroke-width', '4');
          hlLayer.appendChild(rectTo);
        }
      }
    }
  }

  private createDomHighlight(file: number, rank: number, type: 'from' | 'to') {
    const el = document.createElement('div');
    el.className = `highlight ai-best-move-highlight square-${file}${rank}`;
    el.style.position = 'absolute';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '5';
    el.style.borderRadius = '4px';

    if (type === 'from') {
      // Piece in charge square: Azure / Cyan
      el.style.backgroundColor = 'rgba(56, 189, 248, 0.55)';
      el.style.boxShadow = 'inset 0 0 0 3px #0284c7';
    } else {
      // Target destination square: Emerald Green
      el.style.backgroundColor = 'rgba(16, 185, 129, 0.55)';
      el.style.boxShadow = 'inset 0 0 0 3px #059669';
    }

    // Set fallback transform position if Chess.com square-xy CSS isn't applied
    const colIdx = this.isFlipped ? 8 - file : file - 1;
    const rowIdx = this.isFlipped ? rank - 1 : 8 - rank;
    el.style.left = `${colIdx * 12.5}%`;
    el.style.top = `${rowIdx * 12.5}%`;
    el.style.width = '12.5%';
    el.style.height = '12.5%';

    this.board.appendChild(el);
    this.domHighlights.push(el);
  }

  private squareToSquareBox(square: string): { x: number; y: number } | null {
    if (square.length < 2 || !square[1]) return null;
    const file = square.charCodeAt(0) - 97;
    const rank = parseInt(square[1], 10) - 1;
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;

    if (!this.isFlipped) {
      return {
        x: file * 100,
        y: (7 - rank) * 100,
      };
    } else {
      return {
        x: (7 - file) * 100,
        y: rank * 100,
      };
    }
  }

  private formatUciMove(uci: string): string {
    if (!uci || uci.length < 4) return uci;
    return `${uci.substring(0, 2)} → ${uci.substring(2, 4)}${uci.length > 4 ? `(${uci[4]?.toUpperCase()})` : ''}`;
  }

  public destroy() {
    this.clearHighlights();
    if (this.svg) this.svg.remove();
    if (this.evalBarContainer) this.evalBarContainer.remove();
    if (this.hudElement) this.hudElement.remove();
  }
}
