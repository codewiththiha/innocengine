import type { EngineEvaluation, EngineSettings, MoveLine } from './types';

export class SvgOverlay {
  private board: HTMLElement;
  private svg: SVGSVGElement | null = null;
  private evalBarContainer: HTMLElement | null = null;
  private evalBarFill: HTMLElement | null = null;
  private evalScoreText: HTMLElement | null = null;
  private hudElement: HTMLElement | null = null;
  private isFlipped: boolean = false;
  private settings: EngineSettings;

  constructor(board: HTMLElement, settings: EngineSettings) {
    this.board = board;
    this.settings = settings;
    this.init();
  }

  public updateSettings(settings: EngineSettings) {
    this.settings = settings;
    if (!settings.showArrows && this.svg) {
      this.clearArrows();
    }
    if (this.evalBarContainer) {
      this.evalBarContainer.style.display = settings.showEvalBar ? 'flex' : 'none';
    }
    if (this.hudElement) {
      this.hudElement.style.display = settings.showHud ? 'block' : 'none';
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
    svg.style.zIndex = '100';

    svg.innerHTML = `
      <defs>
        <filter id="ai-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000000" flood-opacity="0.6"/>
        </filter>
        <marker id="arrowhead-best" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
          <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#10b981" />
        </marker>
        <marker id="arrowhead-pv2" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#f59e0b" />
        </marker>
        <marker id="arrowhead-pv3" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#06b6d4" />
        </marker>
        <marker id="arrowhead-pv4" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#a855f7" />
        </marker>
      </defs>
      <g id="ai-highlights-layer"></g>
      <g id="ai-arrows-layer" filter="url(#ai-glow)"></g>
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
    bar.style.zIndex = '90';

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
    hud.style.bottom = '-46px';
    hud.style.left = '0';
    hud.style.right = '0';
    hud.style.display = this.settings.showHud ? 'flex' : 'none';
    hud.style.alignItems = 'center';
    hud.style.justifyContent = 'space-between';
    hud.style.padding = '8px 14px';
    hud.style.background = 'rgba(15, 23, 42, 0.90)';
    hud.style.backdropFilter = 'blur(8px)';
    hud.style.borderRadius = '8px';
    hud.style.border = '1px solid rgba(255, 255, 255, 0.12)';
    hud.style.color = '#f8fafc';
    hud.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    hud.style.fontSize = '12px';
    hud.style.boxShadow = '0 6px 18px rgba(0, 0, 0, 0.35)';
    hud.style.zIndex = '95';

    hud.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#10b981;" id="ai-status-dot"></span>
        <span style="font-weight:700; color:#38bdf8;">Stockfish 10</span>
        <span style="color:#94a3b8;" id="ai-hud-depth">Depth: -</span>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="font-weight:700; color:#e2e8f0;" id="ai-hud-best">Best: -</span>
        <span style="color:#a855f7; font-weight:600;" id="ai-hud-eval">0.00</span>
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

  public clearArrows() {
    if (!this.svg) return;
    const arrowsLayer = this.svg.querySelector('#ai-arrows-layer');
    const hlLayer = this.svg.querySelector('#ai-highlights-layer');
    if (arrowsLayer) arrowsLayer.innerHTML = '';
    if (hlLayer) hlLayer.innerHTML = '';
  }

  public renderEvaluation(evaluation: EngineEvaluation) {
    if (!this.svg) this.createSvgElement();
    if (!this.svg) return;

    this.clearArrows();

    this.updateEvalBar(evaluation);
    this.updateHud(evaluation);

    if (this.settings.showArrows && evaluation.bestMove) {
      const lines = evaluation.multiPvLines || [];
      const showMultiPv = this.settings.showMultiPv && lines.length > 1;

      if (showMultiPv) {
        for (let i = Math.min(lines.length - 1, 3); i >= 1; i--) {
          const line = lines[i];
          if (line && line.bestMove) {
            this.drawMoveArrow(line.bestMove, i + 1, line.scoreCp, line.scoreMate);
          }
        }
      }

      this.drawMoveArrow(evaluation.bestMove, 1, evaluation.scoreCp, evaluation.scoreMate);

      if (this.settings.showHighlights) {
        this.drawMoveHighlights(evaluation.bestMove);
      }
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
    if (bestEl) bestEl.innerText = `Best: ${evalData.bestMove ? this.formatUciMove(evalData.bestMove) : '-'}`;

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

  private drawMoveArrow(
    move: string,
    pvRank: number,
    _scoreCp: number | null,
    _scoreMate: number | null
  ) {
    if (!this.svg || move.length < 4) return;
    const arrowsLayer = this.svg.querySelector('#ai-arrows-layer');
    if (!arrowsLayer) return;

    const fromSquare = move.substring(0, 2);
    const toSquare = move.substring(2, 4);

    const fromCoord = this.squareToSvgCoords(fromSquare);
    const toCoord = this.squareToSvgCoords(toSquare);
    if (!fromCoord || !toCoord) return;

    const dx = toCoord.x - fromCoord.x;
    const dy = toCoord.y - fromCoord.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;

    const ux = dx / len;
    const uy = dy / len;

    const configs: Record<number, { stroke: string; marker: string; width: number; opacity: number }> = {
      1: { stroke: this.settings.arrowColor || '#10b981', marker: 'url(#arrowhead-best)', width: 22, opacity: 0.88 },
      2: { stroke: '#f59e0b', marker: 'url(#arrowhead-pv2)', width: 17, opacity: 0.72 },
      3: { stroke: '#06b6d4', marker: 'url(#arrowhead-pv3)', width: 13, opacity: 0.60 },
      4: { stroke: '#a855f7', marker: 'url(#arrowhead-pv4)', width: 11, opacity: 0.50 },
    };
    const cfg = configs[pvRank] || configs[4] || { stroke: '#10b981', marker: 'url(#arrowhead-best)', width: 16, opacity: 0.75 };

    const headOffset = 26;
    const startOffset = 10;
    const sx = fromCoord.x + ux * startOffset;
    const sy = fromCoord.y + uy * startOffset;
    const tx = toCoord.x - ux * headOffset;
    const ty = toCoord.y - uy * headOffset;

    const fromFile = fromSquare.charCodeAt(0) - 97;
    const fromRankIdx = fromSquare[1] ? parseInt(fromSquare[1], 10) - 1 : 0;
    const toFile = toSquare.charCodeAt(0) - 97;
    const toRankIdx = toSquare[1] ? parseInt(toSquare[1], 10) - 1 : 0;
    const fileDiff = Math.abs(toFile - fromFile);
    const rankDiff = Math.abs(toRankIdx - fromRankIdx);
    const isKnight = (fileDiff === 1 && rankDiff === 2) || (fileDiff === 2 && rankDiff === 1);

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    if (isKnight) {
      const midX = (fromCoord.x + toCoord.x) / 2;
      const midY = (fromCoord.y + toCoord.y) / 2;
      const perpX = -uy * 45;
      const perpY = ux * 45;
      const cx = midX + perpX;
      const cy = midY + perpY;

      path.setAttribute('d', `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`);
    } else {
      path.setAttribute('d', `M ${sx} ${sy} L ${tx} ${ty}`);
    }

    path.setAttribute('stroke', cfg.stroke);
    path.setAttribute('stroke-width', cfg.width.toString());
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-opacity', cfg.opacity.toString());
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', cfg.marker);

    arrowsLayer.appendChild(path);
  }

  private drawMoveHighlights(move: string) {
    if (!this.svg || move.length < 4) return;
    const hlLayer = this.svg.querySelector('#ai-highlights-layer');
    if (!hlLayer) return;

    const fromSquare = move.substring(0, 2);
    const toSquare = move.substring(2, 4);

    const fromCoord = this.squareToSquareBox(fromSquare);
    const toCoord = this.squareToSquareBox(toSquare);
    if (!fromCoord || !toCoord) return;

    const rectFrom = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rectFrom.setAttribute('x', fromCoord.x.toString());
    rectFrom.setAttribute('y', fromCoord.y.toString());
    rectFrom.setAttribute('width', '100');
    rectFrom.setAttribute('height', '100');
    rectFrom.setAttribute('rx', '8');
    rectFrom.setAttribute('fill', 'rgba(16, 185, 129, 0.22)');
    rectFrom.setAttribute('stroke', 'rgba(16, 185, 129, 0.6)');
    rectFrom.setAttribute('stroke-width', '3');
    hlLayer.appendChild(rectFrom);

    const rectTo = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rectTo.setAttribute('x', toCoord.x.toString());
    rectTo.setAttribute('y', toCoord.y.toString());
    rectTo.setAttribute('width', '100');
    rectTo.setAttribute('height', '100');
    rectTo.setAttribute('rx', '8');
    rectTo.setAttribute('fill', 'rgba(16, 185, 129, 0.35)');
    rectTo.setAttribute('stroke', '#10b981');
    rectTo.setAttribute('stroke-width', '4');
    hlLayer.appendChild(rectTo);
  }

  private squareToSvgCoords(square: string): { x: number; y: number } | null {
    if (square.length < 2 || !square[1]) return null;
    const file = square.charCodeAt(0) - 97;
    const rank = parseInt(square[1], 10) - 1;
    if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;

    if (!this.isFlipped) {
      return {
        x: file * 100 + 50,
        y: (7 - rank) * 100 + 50,
      };
    } else {
      return {
        x: (7 - file) * 100 + 50,
        y: rank * 100 + 50,
      };
    }
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
    if (this.svg) this.svg.remove();
    if (this.evalBarContainer) this.evalBarContainer.remove();
    if (this.hudElement) this.hudElement.remove();
  }
}
