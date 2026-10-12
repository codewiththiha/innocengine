# GwayMaeGyi WASM packages

GwayMaeGyi is a safe Rust 2024 chess engine (NNUE evaluation, cooperative
resumable search) that replaces the former BallMaeGyi (Patricia) Emscripten
build. These assets are verbatim build outputs of the upstream repository;
edits belong upstream.

- Upstream: <https://github.com/codewiththiha/gwaymaegyi>
- Revision: `8cba6a181265e08bdfab23284fddf36d346c8197` · updated worker-runtime publish semantics (engine search unchanged since 377b4e1).
- Toolchain: stable Rust (edition 2024), wasm-bindgen CLI 0.2.129
- Build:

```sh
cargo build --locked -p gwaymaegyi-wasm --target wasm32-unknown-unknown \
  --profile wasm-release
wasm-bindgen target/wasm32-unknown-unknown/wasm-release/gwaymaegyi_wasm.wasm \
  --target web --out-dir pkg/web
```

The `simd128/` variant rebuilds with `RUSTFLAGS='-Ctarget-feature=+simd128'`.
The runner probes `WebAssembly.validate` and falls back to `portable/`.

- Verified with upstream `tests/wasm.cjs`, `tests/wasm_search.cjs`
  (both backends, fixture-identical search), and `tests/worker.cjs`.
- Licenses: engine MIT (`LICENSE`), embedded NNUE weights (`MODEL-LICENSE`).
- Browser ceilings: 64 MiB hash, 32 MultiPV lines, depth 64,
  65,536 work units per slice. Strength labels are nominal, uncalibrated.
