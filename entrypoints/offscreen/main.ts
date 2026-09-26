import { UciParser } from '../../lib/uci-parser';
import type { EngineEvaluation } from '../../lib/types';

class StockfishEngineHost {
  private worker: Worker | null = null;
  private parser: UciParser;
  private isReady: boolean = false;
  private currentSenderTabId: number | undefined;
  private currentFen: string = '';
  private currentEvaluation: EngineEvaluation | null = null;
  private statusElement: HTMLElement | null = null;

  constructor() {
    this.parser = new UciParser();
    this.statusElement = document.getElementById('status');
    this.initEngine();
    this.setupRuntimeListener();
  }

  private updateStatus(text: string) {
    if (this.statusElement) {
      this.statusElement.innerText = text;
    }
    console.log(`[EngineHost] ${text}`);
  }

  private initEngine() {
    this.updateStatus('Initializing Stockfish WASM...');
    try {
      const workerUrl = chrome.runtime.getURL('engine/stockfish.wasm.js');
      this.worker = new Worker(workerUrl);

      this.worker.onmessage = (event) => {
        const line = typeof event.data === 'string' ? event.data : '';
        this.handleEngineOutput(line);
      };

      this.worker.onerror = (err) => {
        console.warn('[EngineHost] WASM worker failed, falling back to JS worker...', err);
        this.fallbackToJs();
      };

      // Send initial UCI handshake
      this.worker.postMessage('uci');
      this.worker.postMessage('isready');
      this.worker.postMessage('setoption name Hash value 32');
      this.worker.postMessage('setoption name MultiPV value 2');
    } catch (err) {
      console.error('[EngineHost] Failed to initialize worker:', err);
      this.fallbackToJs();
    }
  }

  private fallbackToJs() {
    try {
      const fallbackUrl = chrome.runtime.getURL('engine/stockfish.js');
      this.worker = new Worker(fallbackUrl);
      this.worker.onmessage = (event) => {
        const line = typeof event.data === 'string' ? event.data : '';
        this.handleEngineOutput(line);
      };
      this.worker.postMessage('uci');
      this.worker.postMessage('isready');
      this.updateStatus('Fallback Stockfish JS worker running.');
    } catch (fallbackErr) {
      this.updateStatus('Error: Failed to load Stockfish engine.');
      console.error('[EngineHost] JS Fallback also failed:', fallbackErr);
    }
  }

  private handleEngineOutput(line: string) {
    if (line === 'uciok') {
      this.isReady = true;
      this.updateStatus('Stockfish UCI Ready');
      this.broadcastStatus('ready');
      return;
    }

    if (line === 'readyok') {
      this.isReady = true;
      return;
    }

    const partialEval = this.parser.parseLine(line);
    if (partialEval && partialEval.bestMove) {
      this.currentEvaluation = {
        fen: partialEval.fen || this.currentFen,
        depth: partialEval.depth || 0,
        scoreCp: partialEval.scoreCp ?? null,
        scoreMate: partialEval.scoreMate ?? null,
        bestMove: partialEval.bestMove,
        multiPvLines: partialEval.multiPvLines || [],
        nodes: partialEval.nodes,
        nps: partialEval.nps,
        isCalculating: partialEval.isCalculating ?? true,
        timestamp: Date.now(),
      };

      // Broadcast update to content script and popup
      this.broadcastEvaluation(this.currentEvaluation);
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
            message.depth || 16,
            message.multiPv || 2,
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

  public analyzePosition(fen: string, depth: number, multiPv: number, senderTabId?: number) {
    if (!this.worker) return;

    this.currentSenderTabId = senderTabId;
    this.currentFen = fen;
    this.parser.reset(fen);

    this.updateStatus(`Analyzing FEN: ${fen.substring(0, 30)}... depth=${depth}`);

    // Halt any previous calculation
    this.worker.postMessage('stop');
    this.worker.postMessage(`setoption name MultiPV value ${multiPv}`);
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage(`go depth ${depth}`);
  }

  public stopAnalysis() {
    if (this.worker) {
      this.worker.postMessage('stop');
      this.updateStatus('Engine stopped.');
    }
  }
}

// Start host
new StockfishEngineHost();
