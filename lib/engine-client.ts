import type { EngineEvaluation, EngineSettings } from './types';

export type EvalCallback = (evalData: EngineEvaluation) => void;
export type StatusCallback = (status: 'loading' | 'ready' | 'analyzing' | 'error', message?: string) => void;

export function getPositionKey(fen: string): string {
  if (!fen) return '';
  const parts = fen.trim().split(/\s+/);
  return parts.slice(0, 4).join(' ');
}

export class EngineClient {
  private activeEngineInstanceId: string = 'stockfish';
  private activeAnalysisId: number = 0;
  private activePositionKey: string = '';
  private currentFen: string = '';
  private onEvalCallbacks: Set<EvalCallback> = new Set();
  private onStatusCallbacks: Set<StatusCallback> = new Set();
  private isListening: boolean = false;

  constructor() {
    this.setupMessageListener();
  }

  private setupMessageListener() {
    if (this.isListening) return;
    this.isListening = true;

    chrome.runtime.onMessage.addListener((message: any) => {
      if (message.target === 'content') {
        if (message.type === 'EVAL_UPDATE' && message.evaluation) {
          const evalData: EngineEvaluation = message.evaluation;

          // Reject evaluations across engine switch boundaries
          const matchesEngine = !evalData.engineInstanceId || evalData.engineInstanceId === this.activeEngineInstanceId;
          const matchesGeneration = !evalData.analysisId || evalData.analysisId === this.activeAnalysisId;
          const matchesPosition =
            !evalData.positionKey ||
            evalData.positionKey === this.activePositionKey ||
            getPositionKey(evalData.fen) === this.activePositionKey;

          if (matchesEngine && matchesGeneration && matchesPosition) {
            this.onEvalCallbacks.forEach((cb) => cb(evalData));
          } else {
            console.warn('[AI TRACE] EngineClient: Rejecting stale evaluation', {
              matchesEngine,
              matchesGeneration,
              matchesPosition,
              evalInstance: evalData.engineInstanceId,
              clientInstance: this.activeEngineInstanceId,
              evalGen: evalData.analysisId,
              clientGen: this.activeAnalysisId,
              evalPos: evalData.positionKey,
              clientPos: this.activePositionKey,
            });
          }
        } else if (message.type === 'ENGINE_STATUS') {
          this.onStatusCallbacks.forEach((cb) => cb(message.status, message.message));
        }
      }
    });
  }

  public setEngineInstanceId(engineId: string) {
    this.activeEngineInstanceId = engineId;
  }

  public analyze(fen: string, settings: EngineSettings): number {
    this.activeEngineInstanceId = settings.activeEngineId || 'stockfish';
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
      });
    } catch (err) {
      console.warn('[AI TRACE] EngineClient: Error dispatching analyze message:', err);
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
      console.warn('[AI TRACE] EngineClient: Error dispatching stop message:', err);
    }
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
