import type { EngineEvaluation, EngineSettings } from './types';

export type EvalCallback = (evalData: EngineEvaluation) => void;
export type StatusCallback = (status: 'loading' | 'ready' | 'analyzing' | 'error', message?: string) => void;

export function getPositionKey(fen: string): string {
  if (!fen) return '';
  const parts = fen.trim().split(/\s+/);
  return parts.slice(0, 4).join(' ');
}

export class EngineClient {
  private activeAnalysisId: number = 0;
  private activePositionKey: string = '';
  private currentFen: string = '';
  private onEvalCallbacks: Set<EvalCallback> = new Set();
  private onStatusCallbacks: Set<StatusCallback> = new Set();
  private isListening: boolean = false;
  private readonly messageListener = (message: any) => {
    if (message.target !== 'content') return;

    if (message.type === 'EVAL_UPDATE' && message.evaluation) {
      const evalData: EngineEvaluation = message.evaluation;

      // Reject stale evaluation generations or position mismatches
      const matchesGeneration = evalData.analysisId >= this.activeAnalysisId;
      const matchesPosition =
        evalData.positionKey === this.activePositionKey ||
        getPositionKey(evalData.fen) === this.activePositionKey;

      if (matchesGeneration && matchesPosition) {
        this.onEvalCallbacks.forEach((cb) => cb(evalData));
      }
    } else if (message.type === 'ENGINE_STATUS') {
      this.onStatusCallbacks.forEach((cb) => cb(message.status, message.message));
    }
  };

  constructor() {
    this.setupMessageListener();
  }

  private setupMessageListener() {
    if (this.isListening) return;
    this.isListening = true;
    chrome.runtime.onMessage.addListener(this.messageListener);
  }

  public analyze(fen: string, settings: EngineSettings): number {
    this.activeAnalysisId++;
    this.currentFen = fen;
    this.activePositionKey = getPositionKey(fen);

    try {
      chrome.runtime.sendMessage({
        target: 'engine',
        type: 'ANALYZE',
        analysisId: this.activeAnalysisId,
        positionKey: this.activePositionKey,
        fen,
        depth: settings.depth,
        multiPv: settings.multiPv,
        activeEngineId: settings.activeEngineId,
        limitStrength: settings.limitStrength,
        targetElo: settings.targetElo,
        patriciaPersonality: settings.patriciaPersonality,
        patriciaLimitStrength: settings.patriciaLimitStrength,
        patriciaElo: settings.patriciaElo,
        threads: settings.threads,
        hashMb: settings.hashMb,
      });
    } catch (err) {
      console.warn('[EngineClient] Error dispatching analyze message:', err);
    }

    return this.activeAnalysisId;
  }

  public stop() {
    try {
      chrome.runtime.sendMessage({
        target: 'engine',
        type: 'STOP',
        analysisId: this.activeAnalysisId,
      });
    } catch (err) {
      console.warn('[EngineClient] Error dispatching stop message:', err);
    }
  }

  public destroy() {
    this.stop();
    if (this.isListening) {
      chrome.runtime.onMessage.removeListener(this.messageListener);
      this.isListening = false;
    }
    this.onEvalCallbacks.clear();
    this.onStatusCallbacks.clear();
  }

  public getActiveAnalysisId(): number {
    return this.activeAnalysisId;
  }

  public getActivePositionKey(): string {
    return this.activePositionKey;
  }

  public onEvaluation(cb: EvalCallback): () => void {
    this.onEvalCallbacks.add(cb);
    return () => this.onEvalCallbacks.delete(cb);
  }

  public onStatus(cb: StatusCallback): () => void {
    this.onStatusCallbacks.add(cb);
    return () => this.onStatusCallbacks.delete(cb);
  }
}
