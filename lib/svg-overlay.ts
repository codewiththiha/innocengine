import type { EngineCandidate, EngineEvaluation, EngineSettings } from './types';

interface VariationPalette {
  fill: string;
  stroke: string;
  arrow: string;
  markerId: string;
}

const PALETTES: Record<number, VariationPalette> = {
  1: {
    fill: 'rgba(245, 158, 11, 0.18)',
    stroke: 'rgba(245, 158, 11, 0.75)',
    arrow: 'rgba(245, 158, 11, 0.85)',
    markerId: 'ai-marker-pv1',
  },
  2: {
    fill: 'rgba(59, 130, 246, 0.16)',
    stroke: 'rgba(59, 130, 246, 0.70)',
    arrow: 'rgba(59, 130, 246, 0.80)',
    markerId: 'ai-marker-pv2',
  },
  3: {
    fill: 'rgba(168, 85, 247, 0.15)',
    stroke: 'rgba(168, 85, 247, 0.65)',
    arrow: 'rgba(168, 85, 247, 0.75)',
    markerId: 'ai-marker-pv3',
  },
  4: {
    fill: 'rgba(20, 184, 166, 0.15)',
    stroke: 'rgba(20, 184, 166, 0.65)',
    arrow: 'rgba(20, 184, 166, 0.75)',
    markerId: 'ai-marker-pv4',
  },
};

const BOOK_PALETTE: VariationPalette = {
  fill: 'rgba(16, 185, 129, 0.22)',
  stroke: 'rgba(16, 185, 129, 0.85)',
  arrow: 'rgba(16, 185, 129, 0.95)',
  markerId: 'ai-marker-book',
};

const OPPONENT_ARROW_PALETTE = {
  fill: 'rgba(148, 163, 184, 0.12)',
  stroke: 'rgba(148, 163, 184, 0.45)',
  arrow: 'rgba(148, 163, 184, 0.65)',
  markerId: 'ai-marker-opp',
};

export class SvgOverlay {
  private board: HTMLElement;
  private svg: SVGSVGElement | null = null;
  private evalBarContainer: HTMLElement | null = null;
  private evalBarFill: HTMLElement | null = null;
  private evalScoreText: HTMLElement | null = null;
  private hudElement: HTMLElement | null = null;
  private isFlipped: boolean = false;
  private settings: EngineSettings;
  private activeCandidates: EngineCandidate[] = [];
  private currentRenderKey: string = '';
  private rafScheduled: boolean = false;

  constructor(board: HTMLElement, settings: EngineSettings) {
    this.board = board;
    this.settings = settings;
    this.init();
  }

  public updateSettings(settings: EngineSettings) {
    this.settings = settings;
    if (!settings.showHighlights) {
      this.clearHighlights();
    } else {
      this.currentRenderKey = '';
      this.renderCandidates(this.activeCandidates);
    }

    if (this.evalBarContainer) {
      this.evalBarContainer.style.display = settings.showEvalBar ? 'flex' : 'none';
    }
    if (this.hudElement) {
      this.hudElement.style.display = settings.showHud ? 'flex' : 'none';
    }
  }

  public setFlipped(flipped: boolean) {
    if (this.isFlipped !== flipped) {
      this.isFlipped = flipped;
      this.currentRenderKey = '';
      this.renderCandidates(this.activeCandidates);
    }
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
    svg.setAttribute('viewBox', '0 0 8 8');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '20';

    svg.innerHTML = `
      <defs>
        <marker id="ai-marker-pv1" viewBox="0 0 6 6" refX="4.5" refY="3" markerWidth="0.32" markerHeight="0.32" orient="auto-start-reverse">
          <path d="M 0 0.5 L 5 3 L 0 5.5 z" fill="rgba(245, 158, 11, 0.85)" />
        </marker>
        <marker id="ai-marker-pv2" viewBox="0 0 6 6" refX="4.5" refY="3" markerWidth="0.32" markerHeight="0.32" orient="auto-start-reverse">
          <path d="M 0 0.5 L 5 3 L 0 5.5 z" fill="rgba(59, 130, 246, 0.80)" />
        </marker>
        <marker id="ai-marker-pv3" viewBox="0 0 6 6" refX="4.5" refY="3" markerWidth="0.32" markerHeight="0.32" orient="auto-start-reverse">
          <path d="M 0 0.5 L 5 3 L 0 5.5 z" fill="rgba(168, 85, 247, 0.75)" />
        </marker>
        <marker id="ai-marker-pv4" viewBox="0 0 6 6" refX="4.5" refY="3" markerWidth="0.32" markerHeight="0.32" orient="auto-start-reverse">
          <path d="M 0 0.5 L 5 3 L 0 5.5 z" fill="rgba(20, 184, 166, 0.75)" />
        </marker>
        <marker id="ai-marker-book" viewBox="0 0 6 6" refX="4.5" refY="3" markerWidth="0.32" markerHeight="0.32" orient="auto-start-reverse">
          <path d="M 0 0.5 L 5 3 L 0 5.5 z" fill="rgba(16, 185, 129, 0.95)" />
        </marker>
        <marker id="ai-marker-opp" viewBox="0 0 6 6" refX="4.5" refY="3" markerWidth="0.26" markerHeight="0.26" orient="auto-start-reverse">
          <path d="M 0 0.5 L 5 3 L 0 5.5 z" fill="rgba(148, 163, 184, 0.65)" />
        </marker>
      </defs>
      <g id="ai-highlights-layer"></g>
      <g id="ai-connectors-layer"></g>
      <g id="ai-continuations-layer"></g>
    `;

    this.board.appendChild(svg);
    this.svg = svg;
  }

  private createEvalBar() {
    const existing = this.board.querySelector('#chess-ai-eval-bar');
    if (existing) existing.remove();

    const bar = document.createElement('div');
    bar.id = 'chess-ai-eval-bar';
    bar.style.position = 'absolute';
    bar.style.top = '0';
    bar.style.left = '-26px';
    bar.style.width = '18px';
    bar.style.height = '100%';
    bar.style.borderRadius = '4px';
    bar.style.overflow = 'hidden';
    bar.style.backgroundColor = '#1e293b';
    bar.style.border = '1px solid rgba(255, 255, 255, 0.12)';
    bar.style.display = this.settings.showEvalBar ? 'flex' : 'none';
    bar.style.flexDirection = 'column-reverse';
    bar.style.zIndex = '30';

    const fill = document.createElement('div');
    fill.id = 'chess-ai-eval-fill';
    fill.style.width = '100%';
    fill.style.height = '50%';
    fill.style.backgroundColor = '#f1f5f9';
    fill.style.transition = 'height 0.25s ease-out';

    const score = document.createElement('div');
    score.id = 'chess-ai-eval-score';
    score.style.position = 'absolute';
    score.style.width = '100%';
    score.style.textAlign = 'center';
    score.style.fontSize = '9px';
    score.style.fontWeight = '700';
    score.style.fontFamily = 'monospace';
    score.style.color = '#0f172a';
    score.style.bottom = '4px';
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
    const existing = this.board.querySelector('#chess-ai-hud');
    if (existing) existing.remove();

    const hud = document.createElement('div');
    hud.id = 'chess-ai-hud';
    hud.style.position = 'absolute';
    hud.style.top = '-34px';
    hud.style.left = '0';
    hud.style.right = '0';
    hud.style.display = this.settings.showHud ? 'flex' : 'none';
    hud.style.alignItems = 'center';
    hud.style.justifyContent = 'space-between';
    hud.style.padding = '4px 10px';
    hud.style.background = 'rgba(15, 23, 42, 0.88)';
    hud.style.borderRadius = '4px';
    hud.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    hud.style.color = '#cbd5e1';
    hud.style.fontFamily = 'ui-monospace, monospace';
    hud.style.fontSize = '11px';
    hud.style.zIndex = '35';

    hud.innerHTML = `
      <div style="display:flex; align-items:center; gap:6px;">
        <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:#10b981;" id="ai-status-dot"></span>
        <span style="font-weight:600; color:#e2e8f0;">STOCKFISH</span>
        <span style="color:#64748b;" id="ai-hud-depth">d0</span>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="color:#94a3b8;" id="ai-hud-best">-</span>
        <span style="color:#38bdf8; font-weight:700;" id="ai-hud-eval">0.00</span>
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
    this.activeCandidates = [];
    this.currentRenderKey = '';
    if (this.svg) {
      const hlLayer = this.svg.querySelector('#ai-highlights-layer');
      const connLayer = this.svg.querySelector('#ai-connectors-layer');
      const contLayer = this.svg.querySelector('#ai-continuations-layer');
      if (hlLayer) hlLayer.innerHTML = '';
      if (connLayer) connLayer.innerHTML = '';
      if (contLayer) contLayer.innerHTML = '';
    }
  }

  public renderCandidates(candidates: EngineCandidate[]) {
    this.activeCandidates = candidates;
    if (!this.settings.showHighlights || !this.svg) {
      return;
    }

    const newKey = `${this.isFlipped ? 'F' : 'N'}_${candidates
      .map((c) => `${c.pvId}:${c.from}${c.to}:${c.isBookMove ? 'bk' : ''}:${c.continuation ? `${c.continuation.from}${c.continuation.to}` : ''}`)
      .join(';')}`;

    if (newKey === this.currentRenderKey) {
      return;
    }
    this.currentRenderKey = newKey;

    const hlLayer = this.svg.querySelector('#ai-highlights-layer');
    const connLayer = this.svg.querySelector('#ai-connectors-layer');
    const contLayer = this.svg.querySelector('#ai-continuations-layer');
    if (!hlLayer || !connLayer) return;

    hlLayer.innerHTML = '';
    connLayer.innerHTML = '';
    if (contLayer) contLayer.innerHTML = '';

    candidates.forEach((candidate) => {
      const palette = candidate.isBookMove
        ? BOOK_PALETTE
        : PALETTES[candidate.pvId] || PALETTES[1] || BOOK_PALETTE;

      const fromPos = this.algebraicToSvgPos(candidate.from);
      const toPos = this.algebraicToSvgPos(candidate.to);
      if (!fromPos || !toPos) return;

      // Source square
      const rectFrom = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rectFrom.setAttribute('x', fromPos.x.toString());
      rectFrom.setAttribute('y', fromPos.y.toString());
      rectFrom.setAttribute('width', '1');
      rectFrom.setAttribute('height', '1');
      rectFrom.setAttribute('rx', '0.08');
      rectFrom.setAttribute('fill', palette.fill);
      rectFrom.setAttribute('stroke', palette.stroke);
      rectFrom.setAttribute('stroke-width', '0.02');
      hlLayer.appendChild(rectFrom);

      // Destination square
      const rectTo = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rectTo.setAttribute('x', toPos.x.toString());
      rectTo.setAttribute('y', toPos.y.toString());
      rectTo.setAttribute('width', '1');
      rectTo.setAttribute('height', '1');
      rectTo.setAttribute('rx', '0.08');
      rectTo.setAttribute('fill', palette.fill);
      rectTo.setAttribute('stroke', palette.stroke);
      rectTo.setAttribute('stroke-width', '0.02');
      hlLayer.appendChild(rectTo);

      // Distinguish book moves with a subtle indicator circle
      if (candidate.isBookMove) {
        const bookCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        bookCircle.setAttribute('cx', (toPos.x + 0.82).toString());
        bookCircle.setAttribute('cy', (toPos.y + 0.18).toString());
        bookCircle.setAttribute('r', '0.09');
        bookCircle.setAttribute('fill', 'rgba(16, 185, 129, 0.95)');
        hlLayer.appendChild(bookCircle);
      }

      // Primary connector arrow
      if (this.settings.showConnectors) {
        this.renderArrowLine(connLayer, fromPos, toPos, palette.arrow, palette.markerId, '0.028');
      }

      // Predicted opponent continuation
      if (this.settings.showOpponentMoves && candidate.continuation) {
        const oppFromPos = this.algebraicToSvgPos(candidate.continuation.from);
        const oppToPos = this.algebraicToSvgPos(candidate.continuation.to);
        if (oppFromPos && oppToPos) {
          const rectOppTo = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rectOppTo.setAttribute('x', oppToPos.x.toString());
          rectOppTo.setAttribute('y', oppToPos.y.toString());
          rectOppTo.setAttribute('width', '1');
          rectOppTo.setAttribute('height', '1');
          rectOppTo.setAttribute('rx', '0.08');
          rectOppTo.setAttribute('fill', OPPONENT_ARROW_PALETTE.fill);
          rectOppTo.setAttribute('stroke', OPPONENT_ARROW_PALETTE.stroke);
          rectOppTo.setAttribute('stroke-width', '0.02');
          rectOppTo.setAttribute('stroke-dasharray', '0.08 0.04');
          if (contLayer) contLayer.appendChild(rectOppTo);

          if (this.settings.showConnectors) {
            this.renderArrowLine(
              contLayer || connLayer,
              oppFromPos,
              oppToPos,
              OPPONENT_ARROW_PALETTE.arrow,
              OPPONENT_ARROW_PALETTE.markerId,
              '0.02',
              '0.04 0.02'
            );
          }
        }
      }
    });
  }

  private renderArrowLine(
    container: Element,
    from: { x: number; y: number },
    to: { x: number; y: number },
    color: string,
    markerId: string,
    width: string,
    dasharray?: string
  ) {
    const cx1 = from.x + 0.5;
    const cy1 = from.y + 0.5;
    const cx2 = to.x + 0.5;
    const cy2 = to.y + 0.5;

    const dx = cx2 - cx1;
    const dy = cy2 - cy1;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.4) return;

    const offsetStart = 0.22;
    const offsetEnd = 0.28;
    const sx = cx1 + (dx / dist) * offsetStart;
    const sy = cy1 + (dy / dist) * offsetStart;
    const ex = cx2 - (dx / dist) * offsetEnd;
    const ey = cy2 - (dy / dist) * offsetEnd;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', sx.toString());
    line.setAttribute('y1', sy.toString());
    line.setAttribute('x2', ex.toString());
    line.setAttribute('y2', ey.toString());
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', width);
    line.setAttribute('stroke-linecap', 'round');
    if (dasharray) {
      line.setAttribute('stroke-dasharray', dasharray);
    }
    line.setAttribute('marker-end', `url(#${markerId})`);
    container.appendChild(line);
  }

  public updateEvaluationMetadata(evaluation: EngineEvaluation) {
    if (this.rafScheduled) return;
    this.rafScheduled = true;

    requestAnimationFrame(() => {
      this.rafScheduled = false;
      this.updateEvalBar(evaluation);
      this.updateHud(evaluation);
    });
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
      this.evalScoreText.style.bottom = '4px';
      this.evalScoreText.style.top = 'auto';
    } else {
      this.evalScoreText.style.color = '#f1f5f9';
      this.evalScoreText.style.top = '4px';
      this.evalScoreText.style.bottom = 'auto';
    }
  }

  private updateHud(evalData: EngineEvaluation) {
    if (!this.hudElement) return;

    const depthEl = this.hudElement.querySelector('#ai-hud-depth') as HTMLElement;
    const bestEl = this.hudElement.querySelector('#ai-hud-best') as HTMLElement;
    const evalEl = this.hudElement.querySelector('#ai-hud-eval') as HTMLElement;
    const dotEl = this.hudElement.querySelector('#ai-status-dot') as HTMLElement;

    if (depthEl) depthEl.innerText = `d${evalData.depth || 0}`;
    if (bestEl) {
      const bookCand = this.activeCandidates.find((c) => c.isBookMove);
      if (bookCand && bookCand.bookName) {
        bestEl.innerText = `${evalData.bestMove ? this.formatUciMove(evalData.bestMove) : '-'} | 📖 ${bookCand.bookName}`;
      } else {
        bestEl.innerText = evalData.bestMove ? this.formatUciMove(evalData.bestMove) : '-';
      }
    }

    if (evalEl) {
      if (evalData.scoreMate !== null) {
        evalEl.innerText = `M${evalData.scoreMate > 0 ? '+' : ''}${evalData.scoreMate}`;
        evalEl.style.color = '#f43f5e';
      } else if (evalData.scoreCp !== null) {
        const p = (evalData.scoreCp / 100).toFixed(2);
        evalEl.innerText = `${evalData.scoreCp > 0 ? '+' : ''}${p}`;
        evalEl.style.color = evalData.scoreCp >= 0 ? '#38bdf8' : '#cbd5e1';
      }
    }

    if (dotEl) {
      dotEl.style.background = evalData.isCalculating ? '#f59e0b' : '#10b981';
    }
  }

  private algebraicToSvgPos(square: string): { x: number; y: number } | null {
    if (!square || square.length < 2 || !square[1]) return null;
    const file = square.charCodeAt(0) - 97;
    const rank = parseInt(square[1], 10) - 1;
    if (file < 0 || file > 7 || rank < 0 || rank > 7 || isNaN(rank)) return null;

    if (!this.isFlipped) {
      return { x: file, y: 7 - rank };
    } else {
      return { x: 7 - file, y: rank };
    }
  }

  private formatUciMove(uci: string): string {
    if (!uci || uci.length < 4) return uci;
    return `${uci.substring(0, 2)} → ${uci.substring(2, 4)}`;
  }

  public destroy() {
    this.clearHighlights();
    if (this.svg) this.svg.remove();
    if (this.evalBarContainer) this.evalBarContainer.remove();
    if (this.hudElement) this.hudElement.remove();
  }
}
