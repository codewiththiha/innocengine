import { UciParser } from '../../lib/uci-parser';
import type { EngineEvaluation } from '../../lib/types';

class StockfishEngineHost {
  private worker: Worker | null = null;
  private parser: UciParser;
  private isReady: boolean = false;
  private currentSenderTabId: number | undefined;
  private currentFen: string = '';
  private currentAnalysisId: number = 0;
  private currentPositionKey: string = '';

  constructor() {
    this.parser = new UciParser();
    this.initEngine();
    this.setupRuntimeListener();
  }

  private initEngine() {
    try {
      const workerUrl = chrome.runtime.getURL('engine/stockfish.js');
      this.worker = new Worker(workerUrl);

      this.worker.onmessage = (event: MessageEvent) => {
        const line = typeof event.data === 'string' ? event.data : '';
        this.handleEngineOutput(line);
      };

      this.worker.onerror = (err) => {
        console.error('[EngineHost] Stockfish worker failed:', err);
      };

      this.worker.postMessage('uci');
      this.worker.postMessage('isready');
      this.worker.postMessage('setoption name Hash value 32');
    } catch (err) {
      console.error('[EngineHost] Error instantiating Stockfish worker:', err);
    }
  }

  private handleEngineOutput(line: string) {
    if (line === 'uciok' || line === 'readyok') {
      this.isReady = true;
      this.broadcastStatus('ready');
      return;
    }

    const partialEval = this.parser.parseLine(line);
    if (partialEval && partialEval.bestMove) {
      const evaluation: EngineEvaluation = {
        analysisId: partialEval.analysisId || this.currentAnalysisId,
        positionKey: partialEval.positionKey || this.currentPositionKey,
        fen: partialEval.fen || this.currentFen,
        depth: partialEval.depth || 0,
        scoreCp: partialEval.scoreCp ?? null,
        scoreMate: partialEval.scoreMate ?? null,
        bestMove: partialEval.bestMove,
        multiPvLines: partialEval.multiPvLines || [],
        candidates: partialEval.candidates || [],
        nodes: partialEval.nodes,
        nps: partialEval.nps,
        timeMs: partialEval.timeMs,
        isCalculating: partialEval.isCalculating ?? true,
        timestamp: Date.now(),
      };

      this.broadcastEvaluation(evaluation);
    }
  }

  private broadcastStatus(status: 'loading' | 'ready' | 'analyzing' | 'error', message?: string) {
    try {
      chrome.runtime.sendMessage({
        target: 'content',
        type: 'ENGINE_STATUS',
        status,
        message,
        senderTabId: this.currentSenderTabId,
      });
    } catch (_) {}
  }

  private broadcastEvaluation(evaluation: EngineEvaluation) {
    try {
      chrome.runtime.sendMessage({
        target: 'content',
        type: 'EVAL_UPDATE',
        evaluation,
        senderTabId: this.currentSenderTabId,
      });
    } catch (_) {}
  }

  private setupRuntimeListener() {
    chrome.runtime.onMessage.addListener((message: any) => {
      if (message.target === 'engine') {
        if (message.type === 'ANALYZE' && message.fen) {
          this.analyzePosition(
            message.fen,
            message.analysisId || 0,
            message.positionKey || '',
            message.depth || 16,
            message.multiPv || 1,
            message.senderTabId
          );
        } else if (message.type === 'STOP') {
          this.stopAnalysis();
        } else if (message.type === 'PING') {
          this.broadcastStatus(this.isReady ? 'ready' : 'loading');
        }
      }
    });
  }

  public analyzePosition(
    fen: string,
    analysisId: number,
    positionKey: string,
    depth: number,
    multiPv: number,
    senderTabId?: number
  ) {
    if (!this.worker) return;

    this.currentSenderTabId = senderTabId;
    this.currentFen = fen;
    this.currentAnalysisId = analysisId;
    this.currentPositionKey = positionKey;
    this.parser.reset(fen, analysisId, positionKey);

    this.worker.postMessage('stop');
    this.worker.postMessage(`setoption name MultiPV value ${multiPv}`);
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage(`go depth ${depth}`);
  }

  public stopAnalysis() {
    if (this.worker) {
      this.worker.postMessage('stop');
    }
  }
}

new StockfishEngineHost();
