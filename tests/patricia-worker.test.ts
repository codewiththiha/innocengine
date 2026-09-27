import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

interface FakeEngine {
  commands: string[];
  emit: (line: string) => void;
  addMessageListener: (listener: (line: string) => void) => void;
  postMessage: (command: string) => void;
}

interface WorkerHarness {
  engine: FakeEngine;
  output: string[];
  send: (command: string) => void;
}

async function createWorkerHarness(randomValue: number): Promise<WorkerHarness> {
  const output: string[] = [];
  let listener: ((line: string) => void) | null = null;
  const engine: FakeEngine = {
    commands: [],
    addMessageListener(nextListener) {
      listener = nextListener;
    },
    postMessage(command) {
      this.commands.push(command);
    },
    emit(line) {
      listener?.(line);
    },
  };
  const self: {
    location: { href: string };
    postMessage: (line: string) => void;
    onmessage: ((event: { data: unknown }) => void) | null;
  } = {
    location: { href: 'chrome-extension://test/engine/patricia/patricia-worker.js' },
    postMessage(line) {
      output.push(line);
    },
    onmessage: null,
  };
  const math = Object.create(Math) as Math;
  math.random = () => randomValue;
  const source = fs.readFileSync(path.resolve('public/engine/patricia/patricia-worker.js'), 'utf8');
  const context = vm.createContext({
    self,
    Math: math,
    URL,
    console,
    importScripts: () => undefined,
    Patricia: async () => engine,
  });

  vm.runInContext(source, context, { filename: 'patricia-worker.js' });
  for (let tick = 0; tick < 10 && !listener; tick++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  assert(listener, 'Patricia worker should initialize its engine listener');
  assert(self.onmessage, 'Patricia worker should accept commands after initialization');
  return {
    engine,
    output,
    send(command) {
      self.onmessage?.({ data: command });
    },
  };
}

function beginLimitedSearch(harness: WorkerHarness, multiPv: number = 1) {
  harness.engine.commands.length = 0;
  harness.output.length = 0;
  harness.send('setoption name Personality value Human');
  harness.send('setoption name UCI_Elo value 500');
  harness.send(`setoption name MultiPV value ${multiPv}`);
  harness.send('position fen rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  harness.send('go depth 16 movetime 500');
}

console.log('=== TEST SUITE: Patricia Worker UCI Safety ===\n');

console.log('1. Restricting advertised MultiPV and adding custom options...');
{
  const harness = await createWorkerHarness(0);
  harness.engine.emit('option name MultiPV type spin default 1 min 1 max 255');
  harness.engine.emit('option name Skill_Level type spin default 21 min 1 max 21');
  harness.engine.emit('uciok');

  assert.strictEqual(
    harness.output.filter((line) => line.startsWith('option name MultiPV')).length,
    1,
    'Patricia must advertise one MultiPV option with the worker limit'
  );
  assert(harness.output.includes('option name UCI_LimitStrength type check default true'));
  assert(harness.output.includes('option name UCI_Elo type spin default 2500 min 500 max 3000'));
  assert.strictEqual(
    harness.output.filter((line) => line.startsWith('option name Skill_Level')).length,
    1,
    'The native Skill_Level option must not be duplicated'
  );
  console.log('   ✓ UCI options are bounded and non-duplicated');
}

console.log('\n2. Keeping handicapped analysis private until the chosen move...');
{
  const harness = await createWorkerHarness(0);
  beginLimitedSearch(harness);

  assert(harness.engine.commands.includes('setoption name MultiPV value 5'));
  assert.strictEqual(harness.engine.commands.at(-1), 'go depth 2 movetime 150');

  harness.engine.emit('info multipv 1 depth 2 score cp 42 pv e2e4 e7e5');
  harness.engine.emit('info multipv 2 depth 2 score cp -200 pv a2a3 e7e5');
  assert.strictEqual(harness.output.length, 0, 'Unhandicapped intermediate lines must not reach the UI');

  harness.engine.emit('bestmove e2e4');
  assert.strictEqual(harness.output.length, 2);
  assert(harness.output[0]?.includes('multipv 1 score cp 42 pv e2e4 e7e5'));
  assert.strictEqual(harness.output[1], 'bestmove e2e4');
  console.log('   ✓ Final synthetic line and bestmove stay coherent');
}

console.log('\n3. Ignoring stale lines and never selecting an immediate forced loss...');
{
  const harness = await createWorkerHarness(0.99);
  beginLimitedSearch(harness);
  harness.engine.emit('info multipv 1 depth 2 score cp 25 pv e2e4 e7e5');
  harness.engine.emit('info multipv 2 depth 1 score cp -800 pv a2a3 e7e5');
  harness.engine.emit('bestmove e2e4');
  assert.strictEqual(harness.output.at(-1), 'bestmove e2e4', 'A stale lower-depth alternative cannot be sampled');

  beginLimitedSearch(harness);
  harness.engine.emit('info multipv 1 depth 2 score cp 25 pv e2e4 e7e5');
  harness.engine.emit('info multipv 2 depth 2 score mate -1 pv f2f3 e7e5');
  harness.engine.emit('bestmove e2e4');
  assert.strictEqual(harness.output.at(-1), 'bestmove e2e4', 'A forced-loss alternative cannot be sampled');
  console.log('   ✓ Candidate selection excludes stale and forced-loss alternatives');
}

console.log('\n4. Restoring user MultiPV in full-strength mode...');
{
  const harness = await createWorkerHarness(0);
  harness.engine.commands.length = 0;
  harness.output.length = 0;
  harness.send('setoption name Personality value FullStrength');
  harness.send('setoption name MultiPV value 3');
  harness.send('position startpos');
  harness.send('go depth 18 movetime 700');

  assert.strictEqual(harness.engine.commands.at(-2), 'setoption name MultiPV value 3');
  assert.strictEqual(harness.engine.commands.at(-1), 'go depth 18 movetime 500');

  harness.engine.emit('info multipv 1 depth 18 score cp 31 pv e2e4 e7e5');
  harness.engine.emit('bestmove e2e4 ponder e7e5');
  assert.strictEqual(harness.output[0], 'info multipv 1 depth 18 score cp 31 pv e2e4 e7e5');
  assert.strictEqual(harness.output[1], 'bestmove e2e4 ponder e7e5');

  harness.engine.commands.length = 0;
  harness.send('setoption name Skill_Level value 1');
  harness.send('go depth 16 movetime 500');
  assert(harness.engine.commands.includes('setoption name Skill_Level value 1'));
  assert(harness.engine.commands.includes('setoption name MultiPV value 5'));
  assert.strictEqual(harness.engine.commands.at(-1), 'go depth 2 movetime 150');
  console.log('   ✓ Full-strength searches preserve native UCI output and exit cleanly');
}

console.log('\n=== ALL PATRICIA WORKER TESTS PASSED ===');
