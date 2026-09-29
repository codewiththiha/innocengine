import { PatriciaRunner } from './engines/patricia-runner';
import { StockfishRunner } from './engines/stockfish-runner';
import { MaiaRunner } from './engines/maia-runner';
import { CustomWasmRunner } from './engines/custom-wasm-runner';
import type { AnalysisRequest, EngineRunOptions, EngineStatus, IEngineRunner, RunnerHost } from './engines/types';
import type { EngineCapabilities, EngineEvaluation, EngineTelemetry } from './types';

export type { EngineRunOptions } from './engines/types';

const DEFAULT_OPTIONS: EngineRunOptions = {
  depth: 16,
  multiPv: 1,
  threads: 1,
  hashMb: 32,
  searchBudgetMs: 0,
  aggressiveness: 100,
  preferThreaded: true,
  limitStrength: false,
  targetElo: 1500,
};

const MAIA_ENGINE_PREFIX = 'maia';

/**
 * Owns the single active engine and forwards analysis between the tabs and it.
 * One engine runs at a time by design: every runner owns a worker, and the
 * board only ever needs the current position answered.
 */
export class UnifiedEngineHost implements RunnerHost {
  private activeRunner: IEngineRunner | null = null;
  private currentEngineId = 'stockfish';
  private lastRequest: AnalysisRequest | null = null;
  private lastOptions: EngineRunOptions = { ...DEFAULT_OPTIONS };

  constructor() {
    this.setupListeners();
    void this.switchEngine(this.currentEngineId);
  }

  public async switchEngine(engineId: string): Promise<void> {
    if (this.activeRunner) {
      this.activeRunner.stop();
      this.activeRunner.destroy();
      this.activeRunner = null;
    }

    this.currentEngineId = engineId;
    const runner = this.createRunner(engineId);
    this.activeRunner = runner;

    await runner.init().then(() => {
      const request = this.lastRequest;
      // Resume the position the board was on so switching engines does not
      // leave the overlay empty until the next move.
      if (request) runner.analyze(request);
    });
  }

  private createRunner(engineId: string): IEngineRunner {
    if (engineId === 'patricia') {
      return new PatriciaRunner(this, this.lastOptions.preferThreaded);
    }
    if (engineId === 'maia2') {
      return new MaiaRunner('maia2', 'Maia-2 (Unified Model)', this);
    }
    if (engineId === 'maia3') {
      return new MaiaRunner('maia3', 'Maia-3 (Chessformer)', this);
    }
    if (engineId === 'stockfish') {
      return new StockfishRunner(this);
    }
    return new CustomWasmRunner(engineId, engineId, this);
  }

  private setupListeners(): void {
    chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender) => {
      if (message?.target !== 'engine') return;

      if (message.type === 'ANALYZE' && message.fen) {
        this.handleAnalyze(message, sender);
      } else if (message.type === 'STOP') {
        this.activeRunner?.stop();
      } else if (message.type === 'SWITCH_ENGINE' && message.engineId) {
        void this.switchEngine(message.engineId);
      } else if (message.type === 'SETTINGS_UPDATE' && message.settings) {
        void this.applySettings(message.settings);
      } else if (message.type === 'PING') {
        this.onStatus('ready');
      }
    });
  }

  private handleAnalyze(message: any, sender: chrome.runtime.MessageSender): void {
    const targetEngine: string = message.activeEngineId || this.currentEngineId;
    const isMaia = targetEngine.startsWith(MAIA_ENGINE_PREFIX);

    const options: EngineRunOptions = {
      depth: isMaia ? 1 : message.depth ?? this.lastOptions.depth,
      multiPv: message.multiPv ?? this.lastOptions.multiPv,
      threads: message.threads ?? this.lastOptions.threads,
      hashMb: message.hashMb ?? this.lastOptions.hashMb,
      searchBudgetMs: message.searchBudgetMs ?? this.lastOptions.searchBudgetMs,
      aggressiveness: message.aggressiveness ?? this.lastOptions.aggressiveness,
      preferThreaded: message.preferThreaded ?? this.lastOptions.preferThreaded,
      limitStrength: message.limitStrength ?? this.lastOptions.limitStrength,
      targetElo: message.targetElo ?? this.lastOptions.targetElo,
      patriciaPersonality: message.patriciaPersonality ?? this.lastOptions.patriciaPersonality,
      patriciaLimitStrength: message.patriciaLimitStrength ?? this.lastOptions.patriciaLimitStrength,
      patriciaElo: message.patriciaElo ?? this.lastOptions.patriciaElo,
      senderTabId: message.senderTabId || sender?.tab?.id,
      maxNodes: isMaia ? 1 : undefined,
    };

    const request: AnalysisRequest = {
      fen: message.fen,
      analysisId: message.analysisId || 0,
      positionKey: message.positionKey || '',
      options,
    };

    const threadedChanged = options.preferThreaded !== this.lastOptions.preferThreaded;

    this.lastRequest = request;
    this.lastOptions = options;

    if (targetEngine !== this.currentEngineId) {
      void this.switchEngine(targetEngine);
      return;
    }

    // The wasm build is chosen when the worker is created, so a change to that
    // choice can only take effect by rebuilding the runner.
    if (threadedChanged && this.currentEngineId === 'patricia') {
      void this.switchEngine(targetEngine);
      return;
    }

    this.activeRunner?.analyze(request);
  }

  private async applySettings(
    settings: Partial<EngineRunOptions> & { activeEngineId?: string; preferThreadedEngine?: boolean }
  ): Promise<void> {
    // Settings carry the flag as `preferThreadedEngine`; the run options call
    // it `preferThreaded`. Accept either so the toggle works on its own.
    const threadedPreference = settings.preferThreaded ?? settings.preferThreadedEngine;
    const previousThreaded = this.lastOptions.preferThreaded;

    this.lastOptions = {
      ...this.lastOptions,
      depth: settings.depth ?? this.lastOptions.depth,
      multiPv: settings.multiPv ?? this.lastOptions.multiPv,
      threads: settings.threads ?? this.lastOptions.threads,
      hashMb: settings.hashMb ?? this.lastOptions.hashMb,
      searchBudgetMs: settings.searchBudgetMs ?? this.lastOptions.searchBudgetMs,
      aggressiveness: settings.aggressiveness ?? this.lastOptions.aggressiveness,
      preferThreaded: threadedPreference ?? this.lastOptions.preferThreaded,
      limitStrength: settings.limitStrength ?? this.lastOptions.limitStrength,
      targetElo: settings.targetElo ?? this.lastOptions.targetElo,
      patriciaPersonality: settings.patriciaPersonality ?? this.lastOptions.patriciaPersonality,
      patriciaLimitStrength: settings.patriciaLimitStrength ?? this.lastOptions.patriciaLimitStrength,
      patriciaElo: settings.patriciaElo ?? this.lastOptions.patriciaElo,
    };

    if (settings.activeEngineId && settings.activeEngineId !== this.currentEngineId) {
      await this.switchEngine(settings.activeEngineId);
      return;
    }

    // The build is picked when the worker is created, so changing the choice
    // only takes effect by rebuilding the runner.
    if (
      threadedPreference !== undefined &&
      threadedPreference !== previousThreaded &&
      this.currentEngineId === 'patricia'
    ) {
      await this.switchEngine(this.currentEngineId);
    }
  }

  public onEvaluation(evaluation: EngineEvaluation, senderTabId?: number): void {
    this.send({ target: 'content', type: 'EVAL_UPDATE', evaluation, senderTabId });
  }

  public onStatus(status: EngineStatus, message?: string, senderTabId?: number): void {
    this.send({ target: 'content', type: 'ENGINE_STATUS', status, message, senderTabId });
  }

  public onCapabilities(capabilities: EngineCapabilities): void {
    this.send({ target: 'popup', type: 'ENGINE_CAPABILITIES', capabilities });
    this.send({ target: 'content', type: 'ENGINE_INFO', capabilities });
  }

  public onTelemetry(telemetry: EngineTelemetry): void {
    this.send({ target: 'content', type: 'TELEMETRY_UPDATE', telemetry });
    this.send({ target: 'popup', type: 'TELEMETRY_UPDATE', telemetry });
  }

  private send(payload: Record<string, unknown>): void {
    try {
      const result: unknown = chrome.runtime.sendMessage(payload);
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).catch(() => {});
      }
    } catch (_) {
      // The service worker can be torn down between messages; nothing to do.
    }
  }
}
