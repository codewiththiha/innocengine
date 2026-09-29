import { EngineRegistry } from '../engine-registry';
import type { AnalysisRequest, IEngineRunner, RunnerHost } from './types';

/**
 * An imported `.wasm` on its own has no way to reach the extension: a UCI
 * engine talks over `printf`, and in a bare WebAssembly module that output goes
 * nowhere without the loader its build produced. Rather than reporting a worker
 * as ready and then never producing a move, this runner inspects the module and
 * says precisely what is missing.
 */
export class CustomWasmRunner implements IEngineRunner {
  public readonly id: string;
  public readonly name: string;

  private readonly host: RunnerHost;

  constructor(id: string, name: string, host: RunnerHost) {
    this.id = id;
    this.name = name;
    this.host = host;
  }

  public async init(): Promise<void> {
    this.host.onStatus('loading', `Inspecting ${this.name}...`);

    try {
      const bytes = await EngineRegistry.getEngineWasmBytes(this.id);
      if (!bytes) {
        throw new Error('the stored binary is missing');
      }

      const module = await WebAssembly.compile(bytes);
      const exports = WebAssembly.Module.exports(module).map((entry) => entry.name);
      const hasDriver = exports.includes('_uci_command') || exports.includes('uci_command');
      const hasMemory = exports.includes('memory');

      if (!hasDriver || !hasMemory) {
        const missing = [!hasDriver && 'a UCI entry point', !hasMemory && 'exported memory']
          .filter(Boolean)
          .join(' and ');
        throw new Error(`the module does not export ${missing}`);
      }

      this.host.onStatus(
        'error',
        `${this.name} cannot be driven by the extension: its output needs the ` +
          'JavaScript loader from its build, which a bare .wasm does not carry.'
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'the binary could not be read';
      this.host.onStatus('error', `${this.name} could not be loaded: ${reason}`);
    }

  }

  public analyze(_request: AnalysisRequest): void {
    this.host.onStatus('error', `${this.name} is not runnable; pick a built-in engine.`);
  }

  public stop(): void {
    // Nothing is ever searching.
  }

  public destroy(): void {
    // Nothing to release: the module was never instantiated.
  }
}
