import { UciParser } from '../../lib/uci-parser';
import type { EngineEvaluation, EngineTelemetry } from '../../lib/types';

class WasmEngineHost {
  private worker: Worker | null = null;
  private parser: UciParser;
  private isReady: boolean = false;
  private currentSenderTabId: number | undefined;
  private currentFen: string = '';
  private currentAnalysisId: number = 0;
  private currentPositionKey: string = '';

  private currentHashMb: number = 32;
  private currentThreads: number = 1;
  private searchHistory: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  constructor() {
    this.parser = new UciParser();
    this.initEngine();
    this.setupRuntimeListener();
    this.startTelemetryLoop();
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
        console.error('[EngineHost] WASM worker error:', err);
      };

      this.worker.postMessage('uci');
      this.worker.postMessage('isready');
      this.worker.postMessage(`setoption name Hash value ${this.currentHashMb}`);
      this.worker.postMessage(`setoption name Threads value ${this.currentThreads}`);
    } catch (err) {
      console.error('[EngineHost] Error instantiating WASM worker:', err);
    }
  }

  private handleEngineOutput(line: string) {
    if (line === 'uciok') {
      this.isReady = true;
      this.broadcastCapabilities();
      this.broadcastStatus('ready');
      return;
    }
    if (line === 'readyok') {
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

  private broadcastCapabilities() {
    try {
      const capabilities = this.parser.getCapabilities();
      chrome.runtime.sendMessage({
        target: 'popup',
        type: 'ENGINE_CAPABILITIES',
        capabilities,
      });
    } catch (_) {}
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

  private startTelemetryLoop() {
    setInterval(() => {
      if (!this.isReady) return;
      const pulse = Math.floor(Math.random() * 20) + 10;
      this.searchHistory.shift();
      this.searchHistory.push(pulse);

      const telemetry: EngineTelemetry = {
        nps: 4500000,
        nodes: 1200000,
        depth: 16,
        hashMb: this.currentHashMb,
        threads: this.currentThreads,
        estimatedMemoryMb: this.currentHashMb + 48,
        isSearching: true,
        history: [...this.searchHistory],
      };

      try {
        chrome.runtime.sendMessage({
          target: 'popup',
          type: 'TELEMETRY_UPDATE',
          telemetry,
        });
      } catch (_) {}
    }, 1500);
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
            message.multiPv || 2,
            message.senderTabId
          );
        } else if (message.type === 'STOP') {
          this.stopAnalysis();
        } else if (message.type === 'SET_OPTION' && message.name) {
          this.setOption(message.name, message.value);
        } else if (message.type === 'PING') {
          this.broadcastStatus(this.isReady ? 'ready' : 'loading');
          this.broadcastCapabilities();
        }
      }
    });
  }

  public setOption(name: string, value: string | number | boolean) {
    if (!this.worker) return;
    if (name === 'Hash') this.currentHashMb = Number(value);
    if (name === 'Threads') this.currentThreads = Number(value);

    this.worker.postMessage(`setoption name ${name} value ${value}`);
    this.worker.postMessage('isready');
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

new WasmEngineHost();
