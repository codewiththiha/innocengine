// GwayMaeGyi integration contract: worker protocol mapping, tuning profiles,
// legacy settings migration, and packaged WASM asset integrity.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const STARTPOS = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const BLACK_TO_MOVE = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';

function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    status: 'running',
    finished: false,
    depth: 6,
    selectiveDepth: 9,
    nodes: '123456',
    bestMove: 'e2e4',
    scoreCp: 35,
    mate: null,
    bestMoveNodes: '90000',
    tablebaseHits: '0',
    pv: ['e2e4', 'e7e5'],
    variations: [
      { scoreCp: 35, pv: ['e2e4', 'e7e5'] },
      { scoreCp: 12, pv: ['d2d4', 'd7d5'] },
    ],
    ...overrides,
  } as any;
}

// --------------------------------------------------------------------------
// 1. reportToEvaluation: progress reports
// --------------------------------------------------------------------------
console.log('1. Testing GwayMaeGyi progress report mapping...');
{
  const { reportToEvaluation } = await import('../lib/gwaymaegyi-protocol');
  const evaluation = reportToEvaluation(makeReport(), STARTPOS, 7, 'pos-7', 250);

  assert.strictEqual(evaluation.engineInstanceId, 'gwaymaegyi');
  assert.strictEqual(evaluation.analysisId, 7);
  assert.strictEqual(evaluation.positionKey, 'pos-7');
  assert.strictEqual(evaluation.depth, 6);
  assert.strictEqual(evaluation.scoreCp, 35);
  assert.strictEqual(evaluation.whiteScoreCp, 35, 'White to move keeps the side-relative sign');
  assert.strictEqual(evaluation.scoreMate, null);
  assert.strictEqual(evaluation.bestMove, 'e2e4');
  assert.strictEqual(evaluation.isCalculating, true, 'Unfinished reports stay calculating');
  assert.strictEqual(evaluation.nodes, 123456);
  assert.strictEqual(evaluation.nps, Math.round((123456 * 1000) / 250));
  assert.strictEqual(evaluation.timeMs, 250);

  assert.strictEqual(evaluation.multiPvLines.length, 2);
  assert.strictEqual(evaluation.multiPvLines[0]!.id, 1);
  assert.strictEqual(evaluation.multiPvLines[1]!.id, 2);
  assert.strictEqual(evaluation.multiPvLines[1]!.scoreCp, 12);

  assert.strictEqual(evaluation.candidates.length, 2);
  assert.strictEqual(`${evaluation.candidates[0]!.from}${evaluation.candidates[0]!.to}`, 'e2e4');
  assert.deepStrictEqual(evaluation.candidates[0]!.continuation, { from: 'e7', to: 'e5' });

  console.log('   ✓ progress mapping preserves lines, candidates, and telemetry');
}

// --------------------------------------------------------------------------
// 2. reportToEvaluation: black-to-move sign flip and mate handling
// --------------------------------------------------------------------------
console.log('2. Testing black-perspective scores and mate conversion...');
{
  const { reportToEvaluation } = await import('../lib/gwaymaegyi-protocol');
  const evaluation = reportToEvaluation(
    makeReport({ scoreCp: -40, variations: [{ scoreCp: -40, pv: ['d7d5'] }] }),
    BLACK_TO_MOVE,
    8,
    'pos-8',
    100
  );
  assert.strictEqual(evaluation.scoreCp, -40, 'Score stays relative to the side to move');
  assert.strictEqual(evaluation.whiteScoreCp, 40, 'Black to move flips the white-relative mirror');
  assert.strictEqual(evaluation.multiPvLines[0]!.whiteScoreCp, 40);

  // Rust mate_in(): (30000 - magnitude + 1) / 2 -> 29992 reports mate in 4
  const mateReport = reportToEvaluation(
    makeReport({
      finished: true,
      status: 'depth',
      scoreCp: 29992,
      mate: 4,
      bestMove: 'e7e8q',
      variations: [{ scoreCp: 29992, pv: ['e7e8q'] }],
    }),
    BLACK_TO_MOVE,
    9,
    'pos-9',
    30
  );
  assert.strictEqual(mateReport.scoreCp, null, 'Mate replaces the cp score like a UCI mate line');
  assert.strictEqual(mateReport.scoreMate, 4);
  assert.strictEqual(mateReport.whiteScoreMate, -4, 'Mate mirror flips for the black-perspective');
  assert.strictEqual(mateReport.multiPvLines[0]!.scoreCp, null);
  assert.strictEqual(mateReport.multiPvLines[0]!.scoreMate, 4);
  assert.strictEqual(mateReport.candidates[0]!.promotion, 'q');
  assert.strictEqual(mateReport.isCalculating, false);

  console.log('   ✓ side-relative and white-relative scores, mate, and promotion handled');
}

// --------------------------------------------------------------------------
// 3. reportToEvaluation: finished style-picks promote bestMove to candidates[0]
// --------------------------------------------------------------------------
console.log('3. Testing authoritative bestMove promotion on finished reports...');
{
  const { reportToEvaluation } = await import('../lib/gwaymaegyi-protocol');
  const evaluation = reportToEvaluation(
    makeReport({ finished: true, status: 'depth', bestMove: 'd2d4' }),
    STARTPOS,
    10,
    'pos-10',
    500
  );
  assert.strictEqual(evaluation.bestMove, 'd2d4');
  assert.strictEqual(
    `${evaluation.candidates[0]!.from}${evaluation.candidates[0]!.to}`,
    'd2d4',
    'Style-picked bestMove must lead candidates for the on-board highlight'
  );
  assert.strictEqual(evaluation.candidates[0]!.pvId, 1);
  assert.strictEqual(evaluation.candidates[1]!.pvId, 2);

  // A bestMove outside the listed variations is injected with engine scores.
  const injected = reportToEvaluation(
    makeReport({ finished: true, bestMove: 'g1f3', variations: [] }),
    STARTPOS,
    11,
    'pos-11',
    500
  );
  assert.strictEqual(injected.candidates.length, 1);
  assert.strictEqual(`${injected.candidates[0]!.from}${injected.candidates[0]!.to}`, 'g1f3');

  console.log('   ✓ finished reports mirror the UCI bestmove authority semantics');
}

// --------------------------------------------------------------------------
// 4. Backend selection and worker packaging paths
// --------------------------------------------------------------------------
console.log('4. Testing SIMD128 probe and worker path selection...');
{
  const { gwaymaegyiWorkerPath, supportsSimd128 } = await import('../lib/gwaymaegyi-protocol');
  assert.strictEqual(
    gwaymaegyiWorkerPath(true),
    'engine/gwaymaegyi/simd128/engine-worker.mjs'
  );
  assert.strictEqual(
    gwaymaegyiWorkerPath(false),
    'engine/gwaymaegyi/portable/engine-worker.mjs'
  );
  assert.strictEqual(typeof supportsSimd128(), 'boolean', 'Probe must never throw');
  console.log('   ✓ simd128/portable fallbacks resolve to packaged workers');
}

// --------------------------------------------------------------------------
// 5. Tuning: profiles, manual depth, and clamps
// --------------------------------------------------------------------------
console.log('5. Testing GwayMaeGyi tuning profiles and clamps...');
{
  const { getGwayMaeGyiTuning } = await import('../lib/engine-tuning');
  const { DEFAULT_SETTINGS } = await import('../lib/storage');

  const base = { ...DEFAULT_SETTINGS, activeEngineId: 'gwaymaegyi' };

  const responsive = getGwayMaeGyiTuning({ ...base, gwaymaegyiPerformance: 'responsive', gwaymaegyiElo: 1500 });
  const balanced = getGwayMaeGyiTuning({ ...base, gwaymaegyiPerformance: 'balanced', gwaymaegyiElo: 1500 });
  const deep = getGwayMaeGyiTuning({ ...base, gwaymaegyiPerformance: 'deep', gwaymaegyiElo: 1500 });
  assert(responsive.quantum < balanced.quantum && balanced.quantum < deep.quantum,
    'Larger profiles must schedule larger cooperative slices');
  assert(responsive.timeMs < balanced.timeMs && balanced.timeMs < deep.timeMs,
    'Deeper profiles must carry larger move budgets');

  // Manual depth override wins over the auto Elo table and stays under the WASM 64 cap.
  const manual = getGwayMaeGyiTuning({
    ...base,
    gwaymaegyiPersonality: 'human',
    gwaymaegyiElo: 500,
    gwaymaegyiManualDepth: true,
    depth: 30,
  });
  assert.strictEqual(manual.recommendedDepth, 24, 'Manual depth clamps to the configured ceiling');

  // Full-strength profile budgets
  const fullDeep = getGwayMaeGyiTuning({
    ...base,
    gwaymaegyiPersonality: 'full_strength',
    gwaymaegyiPerformance: 'deep',
    depth: 25,
  });
  assert.strictEqual(fullDeep.timeMs, 1200);
  assert(fullDeep.recommendedDepth <= 22 && fullDeep.recommendedDepth >= 12);
  assert.strictEqual(fullDeep.mode, 'aggressive');

  console.log('   ✓ performance profiles, manual depth, and full-strength budgets verified');
}

// --------------------------------------------------------------------------
// 6. Legacy storage migration: patricia/ballmaegyi → gwaymaegyi
// --------------------------------------------------------------------------
console.log('6. Testing legacy settings migration...');
{
  const legacyPayload = {
    activeEngineId: 'ballmaegyi',
    ballmaegyiPersonality: 'solid',
    ballmaegyiLimitStrength: false,
    ballmaegyiElo: 1800,
    ballmaegyiManualDepth: true,
    ballmaegyiPerformance: 'deep',
    opening: {
      enginePolicy: {
        ballmaegyi: { mode: 'adaptive', maxLossCp: 300, minEngineDepth: 2 },
      },
    },
  };

  const storageArea = {
    payload: legacyPayload as Record<string, unknown>,
    async get(key: string) {
      return { [key]: this.payload };
    },
    async set() {},
  };
  (globalThis as any).chrome = {
    storage: { local: storageArea, onChanged: { addListener() {}, removeListener() {} } },
  };

  try {
    const { getSettings } = await import('../lib/storage');
    const migrated = await getSettings();
    assert.strictEqual(migrated.activeEngineId, 'gwaymaegyi', 'ballmaegyi engine id must migrate');
    assert.strictEqual(migrated.gwaymaegyiPersonality, 'solid');
    assert.strictEqual(migrated.gwaymaegyiLimitStrength, false);
    assert.strictEqual(migrated.gwaymaegyiElo, 1800);
    assert.strictEqual(migrated.gwaymaegyiManualDepth, true);
    assert.strictEqual(migrated.gwaymaegyiPerformance, 'deep');
    assert.strictEqual(
      (migrated.opening.enginePolicy as any).gwaymaegyi?.minEngineDepth,
      2,
      'Opening engine policy must follow the engine id'
    );
    assert.strictEqual((migrated.opening.enginePolicy as any).ballmaegyi, undefined);
    assert.strictEqual((migrated as any).ballmaegyiPersonality, undefined, 'Legacy keys must be dropped');

    // The older patricia id migrates through the same path.
    storageArea.payload = { activeEngineId: 'patricia' };
    const patriciaMigrated = await getSettings();
    assert.strictEqual(patriciaMigrated.activeEngineId, 'gwaymaegyi', 'patricia engine id must migrate');

    // Fresh gwaymaegyi keys win over stale legacy keys.
    storageArea.payload = { ballmaegyiElo: 900, gwaymaegyiElo: 2400 };
    const freshWins = await getSettings();
    assert.strictEqual(freshWins.gwaymaegyiElo, 2400, 'Current keys take precedence over legacy ones');
  } finally {
    delete (globalThis as any).chrome;
  }

  console.log('   ✓ legacy ballmaegyi/patricia settings migrate without data loss');
}

// --------------------------------------------------------------------------
// 7. Packaged WASM asset integrity
// --------------------------------------------------------------------------
console.log('7. Testing packaged GwayMaeGyi asset integrity...');
{
  for (const variant of ['portable', 'simd128']) {
    const dir = path.resolve(`public/engine/gwaymaegyi/${variant}`);
    for (const file of [
      'engine-worker.mjs',
      'worker-runtime.mjs',
      'controls.mjs',
      'scheduler.mjs',
      'gwaymaegyi_wasm.js',
      'gwaymaegyi_wasm_bg.wasm',
    ]) {
      assert(fs.existsSync(path.join(dir, file)), `Missing packaged asset ${variant}/${file}`);
    }
    const workerGlue = fs.readFileSync(path.join(dir, 'engine-worker.mjs'), 'utf8');
    assert(
      workerGlue.includes("./gwaymaegyi_wasm.js"),
      `${variant}/engine-worker.mjs must import the sibling bindings`
    );
    const wasmHeader = fs.readFileSync(path.join(dir, 'gwaymaegyi_wasm_bg.wasm')).subarray(0, 4);
    assert.deepStrictEqual([...wasmHeader], [0, 97, 115, 109], `${variant} WASM magic bytes`);
    assert(fs.statSync(path.join(dir, 'gwaymaegyi_wasm_bg.wasm')).size > 1_000_000, 'WASM payload must embed the NNUE weights');
  }
  assert(fs.readFileSync(path.resolve('public/engine/gwaymaegyi/LICENSE'), 'utf8').includes('MIT'));
  assert(fs.readFileSync(path.resolve('public/engine/gwaymaegyi/MODEL-LICENSE'), 'utf8').length > 0);
  assert(fs.existsSync(path.resolve('public/engine/gwaymaegyi/SOURCE.md')), 'Provenance record must ship');

  // The retired Patricia build must not linger in the package.
  assert(!fs.existsSync(path.resolve('public/engine/ballmaegyi')), 'Retired ballmaegyi assets must be deleted');

  console.log('   ✓ both backends, bindings, licenses, and provenance are packaged');
}

console.log('\nAll GwayMaeGyi engine integration checks passed');
