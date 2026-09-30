import type { EngineCandidate, EngineEvaluation, EngineSettings } from './types';

interface ColorDefinition {
  primary: string;
  sourceFill: (opacity: number) => string;
  targetFill: (opacity: number) => string;
  stroke: (opacity: number) => string;
  arrow: string;
  markerId: string;
}

const PALETTES: Record<number, ColorDefinition> = {
  1: {
    primary: '#b08a4a',
    sourceFill: (op) => `rgba(176, 138, 74, ${op * 0.55})`,
    targetFill: (op) => `rgba(176, 138, 74, ${op})`,
    stroke: (op) => `rgba(120, 92, 48, ${Math.min(1.0, op + 0.5)})`,
    arrow: '#b08a4a',
    markerId: 'ai-marker-pv1',
  },
  2: {
    primary: '#6b7b8d',
    sourceFill: (op) => `rgba(107, 123, 141, ${op * 0.55})`,
    targetFill: (op) => `rgba(107, 123, 141, ${op})`,
    stroke: (op) => `rgba(80, 95, 115, ${Math.min(1.0, op + 0.5)})`,
    arrow: '#6b7b8d',
    markerId: 'ai-marker-pv2',
  },
  3: {
    primary: '#8b7aa8',
    sourceFill: (op) => `rgba(139, 122, 168, ${op * 0.55})`,
    targetFill: (op) => `rgba(139, 122, 168, ${op})`,
    stroke: (op) => `rgba(95, 80, 130, ${Math.min(1.0, op + 0.5)})`,
    arrow: '#8b7aa8',
    markerId: 'ai-marker-pv3',
  },
  4: {
    primary: '#a06b6b',
    sourceFill: (op) => `rgba(160, 107, 107, ${op * 0.55})`,
    targetFill: (op) => `rgba(160, 107, 107, ${op})`,
    stroke: (op) => `rgba(120, 75, 75, ${Math.min(1.0, op + 0.5)})`,
    arrow: '#a06b6b',
    markerId: 'ai-marker-pv4',
  },
  5: {
    primary: '#6b9a9e',
    sourceFill: (op) => `rgba(107, 154, 158, ${op * 0.55})`,
    targetFill: (op) => `rgba(107, 154, 158, ${op})`,
    stroke: (op) => `rgba(70, 120, 125, ${Math.min(1.0, op + 0.5)})`,
    arrow: '#6b9a9e',
    markerId: 'ai-marker-pv5',
  },
};

const BOOK_COLOR: ColorDefinition = {
  primary: '#7a9265',
  sourceFill: (op) => `rgba(122, 146, 101, ${op * 0.55})`,
  targetFill: (op) => `rgba(122, 146, 101, ${op})`,
  stroke: (op) => `rgba(80, 105, 60, ${Math.min(1.0, op + 0.5)})`,
  arrow: '#7a9265',
  markerId: 'ai-marker-book',
};

const OPPONENT_COLOR: ColorDefinition = {
  primary: '#94a3b8',
  sourceFill: (op) => `rgba(148, 163, 184, ${op * 0.3})`,
  targetFill: (op) => `rgba(148, 163, 184, ${op * 0.7})`,
  stroke: (op) => `rgba(148, 163, 184, ${op + 0.2})`,
  arrow: '#94a3b8',
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
  private playerColor: 'w' | 'b' = 'w';
  private isGameActive: boolean = true;
  private settings: EngineSettings;
  private activeCandidates: EngineCandidate[] = [];
  private currentRenderKey: string = '';
  private rafScheduled: boolean = false;
  private resizeObserver: ResizeObserver | null = null;

  constructor(board: HTMLElement, settings: EngineSettings) {
    this.board = board;
    this.settings = settings;
    this.init();
  }

  public updateSettings(settings: EngineSettings) {
    this.settings = settings;
    if (!this.isGameActive) {
      this.clearHighlights();
      if (this.evalBarContainer) this.evalBarContainer.style.display = 'none';
      if (this.hudElement) this.hudElement.style.display = 'none';
      return;
    }

    const hasHighlightsEnabled =
      (this.settings.highlightPlayerMoves ?? true) ||
      (this.settings.highlightOpponentMoves ?? false) ||
      this.settings.showHighlights;

    if (!hasHighlightsEnabled) {
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

  public setPlayerColor(color: 'w' | 'b') {
    if (this.playerColor !== color) {
      this.playerColor = color;
      if (this.hudElement) {
        const sideEl = this.hudElement.querySelector('#ai-hud-side') as HTMLElement;
        if (sideEl) {
          const effective = this.settings.controlledColor === 'auto'
            ? this.playerColor
            : this.settings.controlledColor;
          sideEl.innerText = `YOU: ${effective === 'b' ? 'BLACK' : 'WHITE'}`;
        }
      }
    }
  }

  public setGameActive(active: boolean) {
    this.isGameActive = active;
    if (!active) {
      this.clearHighlights();
      if (this.evalBarContainer) this.evalBarContainer.style.display = 'none';
      if (this.hudElement) this.hudElement.style.display = 'none';
    } else {
      if (this.evalBarContainer) {
        this.evalBarContainer.style.display = this.settings.showEvalBar ? 'flex' : 'none';
      }
      if (this.hudElement) {
        this.hudElement.style.display = this.settings.showHud ? 'flex' : 'none';
      }
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

    // Arrow markers defined with userSpaceOnUse for crisp, properly scaled arrowheads
    svg.innerHTML = `
      <defs>
        <marker id="ai-marker-pv1" viewBox="0 0 10 10" refX="7.5" refY="5" markerUnits="userSpaceOnUse" markerWidth="0.50" markerHeight="0.50" orient="auto-start-reverse">
          <path d="M 1 2 L 8 5 L 1 8 L 3.5 5 z" fill="#f59e0b" />
        </marker>
        <marker id="ai-marker-pv2" viewBox="0 0 10 10" refX="7.5" refY="5" markerUnits="userSpaceOnUse" markerWidth="0.50" markerHeight="0.50" orient="auto-start-reverse">
          <path d="M 1 2 L 8 5 L 1 8 L 3.5 5 z" fill="#3b82f6" />
        </marker>
        <marker id="ai-marker-pv3" viewBox="0 0 10 10" refX="7.5" refY="5" markerUnits="userSpaceOnUse" markerWidth="0.50" markerHeight="0.50" orient="auto-start-reverse">
          <path d="M 1 2 L 8 5 L 1 8 L 3.5 5 z" fill="#8b5cf6" />
        </marker>
        <marker id="ai-marker-pv4" viewBox="0 0 10 10" refX="7.5" refY="5" markerUnits="userSpaceOnUse" markerWidth="0.50" markerHeight="0.50" orient="auto-start-reverse">
          <path d="M 1 2 L 8 5 L 1 8 L 3.5 5 z" fill="#f43f5e" />
        </marker>
        <marker id="ai-marker-pv5" viewBox="0 0 10 10" refX="7.5" refY="5" markerUnits="userSpaceOnUse" markerWidth="0.50" markerHeight="0.50" orient="auto-start-reverse">
          <path d="M 1 2 L 8 5 L 1 8 L 3.5 5 z" fill="#06b6d4" />
        </marker>
        <marker id="ai-marker-book" viewBox="0 0 10 10" refX="7.5" refY="5" markerUnits="userSpaceOnUse" markerWidth="0.50" markerHeight="0.50" orient="auto-start-reverse">
          <path d="M 1 2 L 8 5 L 1 8 L 3.5 5 z" fill="#10b981" />
        </marker>
        <marker id="ai-marker-opp" viewBox="0 0 10 10" refX="7.5" refY="5" markerUnits="userSpaceOnUse" markerWidth="0.42" markerHeight="0.42" orient="auto-start-reverse">
          <path d="M 1 2 L 8 5 L 1 8 L 3.5 5 z" fill="#94a3b8" />
        </marker>
      </defs>
      <g id="ai-highlights-layer"></g>
      <g id="ai-connectors-layer"></g>
      <g id="ai-badges-layer"></g>
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
    hud.style.bottom = '-36px';
    hud.style.left = '0';
    hud.style.width = '100%';
    hud.style.display = this.settings.showHud ? 'flex' : 'none';
    hud.style.alignItems = 'center';
    hud.style.justifyContent = 'space-between';
    hud.style.padding = '5px 12px';
    hud.style.backgroundColor = '#16202b';
    hud.style.border = '1px solid rgba(255, 255, 255, 0.10)';
    hud.style.borderRadius = '6px';
    hud.style.color = '#cbd5e1';
    hud.style.fontFamily = 'ui-monospace, monospace';
    hud.style.fontSize = '11px';
    hud.style.zIndex = '35';

    hud.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#10b981;" id="ai-status-dot"></span>
        <span style="font-weight:700; color:#e2e8f0; font-size:10px; letter-spacing:0.5px;" id="ai-hud-engine">ENGINE</span>
        <span style="font-size:10px; padding:1px 5px; border-radius:3px; background:rgba(255,255,255,0.08); color:#94a3b8;" id="ai-hud-side">YOU: WHITE</span>
        <span style="color:#64748b; font-size:10px;" id="ai-hud-depth">d0</span>
      </div>
      <div style="display:flex; align-items:center; gap:10px;">
        <span style="color:#94a3b8; font-size:10px;" id="ai-hud-best">-</span>
        <span style="color:#38bdf8; font-weight:700;" id="ai-hud-eval">0.00</span>
      </div>
    `;

    this.board.appendChild(hud);
    this.hudElement = hud;
  }

  private attachResizeObserver() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = new ResizeObserver(() => {
      if (this.evalBarContainer && this.board) {
        this.evalBarContainer.style.height = `${this.board.clientHeight}px`;
      }
    });
    this.resizeObserver.observe(this.board);
  }

  public clearHighlights() {
    this.activeCandidates = [];
    this.currentRenderKey = '';
    if (this.svg) {
      const hlLayer = this.svg.querySelector('#ai-highlights-layer');
      const connLayer = this.svg.querySelector('#ai-connectors-layer');
      const badgeLayer = this.svg.querySelector('#ai-badges-layer');
      const contLayer = this.svg.querySelector('#ai-continuations-layer');
      if (hlLayer) hlLayer.innerHTML = '';
      if (connLayer) connLayer.innerHTML = '';
      if (badgeLayer) badgeLayer.innerHTML = '';
      if (contLayer) contLayer.innerHTML = '';
    }
  }

  public renderCandidates(candidates: EngineCandidate[]) {
    this.activeCandidates = candidates;
    if (!this.isGameActive) {
      this.clearHighlights();
      return;
    }

    const hasHighlightsEnabled =
      (this.settings.highlightPlayerMoves ?? true) ||
      (this.settings.highlightOpponentMoves ?? false) ||
      this.settings.showHighlights;

    if (!hasHighlightsEnabled || !this.svg) {
      this.clearHighlights();
      return;
    }

    const op = Math.max(0.10, Math.min(0.65, this.settings.highlighterOpacity ?? 0.28));
    const showArrows = this.settings.showArrows ?? true;
    const showCircles = this.settings.showNumberCircles ?? false;
    const squareRx = this.settings.highlightShape === 'rounded' ? 0.08 : 0;

    const newKey = `${this.isFlipped ? 'F' : 'N'}_${op}_${showArrows ? 'A' : 'N'}_${candidates
      .map((c) => `${c.pvId}:${c.from}${c.to}:${c.isBookMove ? 'bk' : ''}`)
      .join(';')}`;

    if (newKey === this.currentRenderKey) {
      return;
    }
    this.currentRenderKey = newKey;

    const hlLayer = this.svg.querySelector('#ai-highlights-layer');
    const connLayer = this.svg.querySelector('#ai-connectors-layer');
    const badgeLayer = this.svg.querySelector('#ai-badges-layer');
    const contLayer = this.svg.querySelector('#ai-continuations-layer');
    if (!hlLayer || !connLayer) return;

    hlLayer.innerHTML = '';
    connLayer.innerHTML = '';
    if (badgeLayer) badgeLayer.innerHTML = '';
    if (contLayer) contLayer.innerHTML = '';

    candidates.forEach((candidate, idx) => {
      const colorDef = candidate.isBookMove
        ? BOOK_COLOR
        : PALETTES[candidate.pvId] || PALETTES[idx + 1] || PALETTES[1] || BOOK_COLOR;

      const fromPos = this.algebraicToSvgPos(candidate.from);
      const toPos = this.algebraicToSvgPos(candidate.to);
      if (!fromPos || !toPos) return;

      // 1. Source square: Outlined ring indicating the piece to move
      const rectFrom = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rectFrom.setAttribute('x', fromPos.x.toString());
      rectFrom.setAttribute('y', fromPos.y.toString());
      rectFrom.setAttribute('width', '1');
      rectFrom.setAttribute('height', '1');
      rectFrom.setAttribute('rx', squareRx.toString());
      rectFrom.setAttribute('fill', colorDef.sourceFill(op));
      rectFrom.setAttribute('stroke', colorDef.stroke(op));
      rectFrom.setAttribute('stroke-width', '0.028');
      hlLayer.appendChild(rectFrom);

      // 2. Destination square: Prominent colored target fill
      const rectTo = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rectTo.setAttribute('x', toPos.x.toString());
      rectTo.setAttribute('y', toPos.y.toString());
      rectTo.setAttribute('width', '1');
      rectTo.setAttribute('height', '1');
      rectTo.setAttribute('rx', squareRx.toString());
      rectTo.setAttribute('fill', colorDef.targetFill(op));
      rectTo.setAttribute('stroke', colorDef.stroke(op));
      rectTo.setAttribute('stroke-width', '0.028');
      hlLayer.appendChild(rectTo);

      // 3. Move Rank Badge on Destination Square (e.g. ①, ②, B)
      if (badgeLayer && showCircles) {
        const badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const badgeCx = toPos.x + 0.82;
        const badgeCy = toPos.y + 0.18;

        const badgeCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        badgeCircle.setAttribute('cx', badgeCx.toString());
        badgeCircle.setAttribute('cy', badgeCy.toString());
        badgeCircle.setAttribute('r', '0.13');
        badgeCircle.setAttribute('fill', colorDef.primary);
        badgeCircle.setAttribute('stroke', '#ffffff');
        badgeCircle.setAttribute('stroke-width', '0.016');
        badgeG.appendChild(badgeCircle);

        const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        badgeText.setAttribute('x', badgeCx.toString());
        badgeText.setAttribute('y', (badgeCy + 0.045).toString());
        badgeText.setAttribute('font-size', '0.12');
        badgeText.setAttribute('font-weight', 'bold');
        badgeText.setAttribute('fill', '#ffffff');
        badgeText.setAttribute('text-anchor', 'middle');
        badgeText.setAttribute('font-family', 'sans-serif');
        badgeText.textContent = candidate.isBookMove ? 'B' : `${candidate.pvId || idx + 1}`;
        badgeG.appendChild(badgeText);

        badgeLayer.appendChild(badgeG);
      }

      // 4. Directional Move Arrow pointing clearly to destination square
      if (showArrows) {
        this.renderArrowLine(connLayer, fromPos, toPos, colorDef.arrow, colorDef.markerId, '0.042');
      }

      // 5. Predicted opponent reply continuation
      if (this.settings.showOpponentMoves && candidate.continuation) {
        const oppFromPos = this.algebraicToSvgPos(candidate.continuation.from);
        const oppToPos = this.algebraicToSvgPos(candidate.continuation.to);
        if (oppFromPos && oppToPos) {
          const rectOppTo = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          rectOppTo.setAttribute('x', oppToPos.x.toString());
          rectOppTo.setAttribute('y', oppToPos.y.toString());
          rectOppTo.setAttribute('width', '1');
          rectOppTo.setAttribute('height', '1');
          rectOppTo.setAttribute('rx', squareRx.toString());
          rectOppTo.setAttribute('fill', OPPONENT_COLOR.targetFill(op * 0.6));
          rectOppTo.setAttribute('stroke', OPPONENT_COLOR.stroke(op));
          rectOppTo.setAttribute('stroke-width', '0.02');
          rectOppTo.setAttribute('stroke-dasharray', '0.08 0.04');
          if (contLayer) contLayer.appendChild(rectOppTo);

          if (showArrows) {
            this.renderArrowLine(
              contLayer || connLayer,
              oppFromPos,
              oppToPos,
              OPPONENT_COLOR.arrow,
              OPPONENT_COLOR.markerId,
              '0.026',
              '0.05 0.02'
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
    width: string = '0.042',
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

    // Offset start from piece center, end right at arrowhead base
    const offsetStart = 0.26;
    const offsetEnd = 0.36;
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
    if (!this.isGameActive) return;
    if (this.rafScheduled) return;
    this.rafScheduled = true;

    requestAnimationFrame(() => {
      this.rafScheduled = false;
      if (!this.isGameActive) return;
      this.updateEvalBar(evaluation);
      this.updateHud(evaluation);
    });
  }

  private updateEvalBar(evalData: EngineEvaluation) {
    if (!this.evalBarFill || !this.evalScoreText) return;

    let evalScoreString = '—';
    let whiteWinPercent = 50;

    const isBlack = evalData.fen.split(' ')[1] === 'b';
    const whiteCp = evalData.whiteScoreCp ?? (evalData.scoreCp !== null ? (isBlack ? -evalData.scoreCp : evalData.scoreCp) : null);
    const whiteMate = evalData.whiteScoreMate ?? (evalData.scoreMate !== null ? (isBlack ? -evalData.scoreMate : evalData.scoreMate) : null);

    if (whiteMate !== null) {
      evalScoreString = `M${whiteMate > 0 ? '+' : ''}${whiteMate}`;
      whiteWinPercent = whiteMate > 0 ? 100 : 0;
    } else if (whiteCp !== null) {
      const pawns = whiteCp / 100;
      evalScoreString = `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`;
      const winP = 1 / (1 + Math.exp(-0.00368208 * whiteCp));
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
    const sideEl = this.hudElement.querySelector('#ai-hud-side') as HTMLElement;
    const engineEl = this.hudElement.querySelector('#ai-hud-engine') as HTMLElement;

    if (depthEl) {
      depthEl.innerText = (evalData.scoreCp === null && evalData.scoreMate === null)
        ? 'POLICY'
        : `d${evalData.depth || 0}`;
    }
    if (engineEl) engineEl.innerText = (evalData.engineInstanceId || 'SF').toUpperCase();

    const effectiveColor = this.settings.controlledColor === 'auto'
      ? this.playerColor
      : this.settings.controlledColor;
    if (sideEl) sideEl.innerText = `YOU: ${effectiveColor === 'b' ? 'BLACK' : 'WHITE'}`;

    if (bestEl) {
      const bookCand = this.activeCandidates.find((c) => c.isBookMove);
      if (bookCand && bookCand.bookName) {
        bestEl.innerText = `${evalData.bestMove ? this.formatUciMove(evalData.bestMove) : '-'} | 📖 ${bookCand.bookName}`;
      } else {
        bestEl.innerText = evalData.bestMove ? this.formatUciMove(evalData.bestMove) : '-';
      }
    }

    if (evalEl) {
      const isBlack = evalData.fen.split(' ')[1] === 'b';
      const whiteCp = evalData.whiteScoreCp ?? (evalData.scoreCp !== null ? (isBlack ? -evalData.scoreCp : evalData.scoreCp) : null);
      const whiteMate = evalData.whiteScoreMate ?? (evalData.scoreMate !== null ? (isBlack ? -evalData.scoreMate : evalData.scoreMate) : null);

      if (whiteMate !== null) {
        evalEl.innerText = `M${whiteMate > 0 ? '+' : ''}${whiteMate}`;
        evalEl.style.color = whiteMate > 0 ? '#38bdf8' : '#f43f5e';
      } else if (whiteCp !== null) {
        const p = (whiteCp / 100).toFixed(2);
        evalEl.innerText = `${whiteCp > 0 ? '+' : ''}${p}`;
        evalEl.style.color = whiteCp >= 0 ? '#38bdf8' : '#f87171';
      } else {
        evalEl.innerText = 'POLICY';
        evalEl.style.color = '#a78bfa';
      }
    }

    if (dotEl) {
      dotEl.style.background = evalData.isCalculating ? '#f59e0b' : '#10b981';
    }
  }

  private formatUciMove(uci: string): string {
    if (!uci || uci.length < 4) return uci;
    return `${uci.substring(0, 2)} → ${uci.substring(2, 4)}${uci.length > 4 ? `(${uci.substring(4)})` : ''}`;
  }

  private algebraicToSvgPos(square: string): { x: number; y: number } | null {
    if (!square || square.length < 2) return null;
    const file = square.charCodeAt(0) - 97;
    const rank = parseInt(square[1] || '1', 10) - 1;

    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;

    const x = this.isFlipped ? 7 - file : file;
    const y = this.isFlipped ? rank : 7 - rank;
    return { x, y };
  }

  public destroy() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.svg) this.svg.remove();
    if (this.evalBarContainer) this.evalBarContainer.remove();
    if (this.hudElement) this.hudElement.remove();
  }
}
