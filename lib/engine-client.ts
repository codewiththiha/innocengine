import type { EngineEvaluation, EngineSettings } from './types';

export type EvalCallback = (evalData: EngineEvaluation) => void;
export type StatusCallback = (status: 'loading' | 'ready' | 'analyzing' | 'error', message?: string) => void;

export class EngineClient {
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
          // Only deliver if matches current FEN
          if (this.normalizeFen(evalData.fen) === this.normalizeFen(this.currentFen)) {
            this.onEvalCallbacks.forEach((cb) => cb(evalData));
          }
        } else if (message.type === 'ENGINE_STATUS') {
          this.onStatusCallbacks.forEach((cb) => cb(message.status, message.message));
        }
      }
    });
  }

  public analyze(fen: string, settings: EngineSettings) {
    this.currentFen = fen;

    // Send request to background/offscreen engine
    try {
      chrome.runtime.sendMessage({
        target: 'engine',
        type: 'ANALYZE',
        fen,
        depth: settings.depth,
        multiPv: settings.multiPv,
      });
    } catch (err) {
      console.warn('[EngineClient] Error sending analyze message to background:', err);
    }
  }

  public stop() {
    try {
      chrome.runtime.sendMessage({
        target: 'engine',
        type: 'STOP',
      });
    } catch (err) {
      console.warn('[EngineClient] Error sending stop message to background:', err);
    }
  }

  public onEvaluation(cb: EvalCallback): () => void {
    this.onEvalCallbacks.add(cb);
    return () => this.onEvalCallbacks.delete(cb);
  }

  public onStatus(cb: StatusCallback): () => void {
    this.onStatusCallbacks.add(cb);
    return () => this.onStatusCallbacks.delete(cb);
  }

  private normalizeFen(fen: string): string {
    if (!fen) return '';
    // Compare piece placement and turn
    const parts = fen.trim().split(/\s+/);
    return parts.slice(0, 2).join(' ');
  }
}
