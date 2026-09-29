# Chess Engine AI Overlay (Manifest V3 + WebAssembly + WXT)

An educational, high-performance browser extension that reads the live chessboard state on [Chess.com](https://www.chess.com) and renders real-time **Stockfish WebAssembly (WASM)** analysis, dynamic **piece move square highlights**, a live **Evaluation Bar**, and an on-board **Analysis HUD**.

Built with modern browser extension tooling: **[WXT](https://wxt.dev/)**, **React 19**, **TypeScript**, **Stockfish.js/WASM**, and **Lucide Icons**.

---

## 🎯 Key Architectural Highlights

1. **Manifest V3 Compliant (Offscreen WASM Worker)**:
   - Modern target websites like Chess.com enforce strict Content Security Policies (`script-src` and `worker-src`) that disallow creating Web Workers from extension origins inside the content script page context.
   - To bypass this cleanly and without violating Chrome Web Store policies, this extension utilizes the official **Chrome Offscreen API** (`chrome.offscreen`).
   - The engine runs inside an isolated offscreen document with native WebAssembly and Worker access, completely immune to the host page's CSP and exempt from service worker 30-second termination timeouts.
   - Supports reliable fallback to asm.js Stockfish engine if WebAssembly instantiation fails.

2. **Resilient Board DOM Parsing & FEN Extraction**:
   - Parses modern Chess.com DOM elements (`wc-chess-board`, `chess-board`).
   - Supports both `square-xy` class notation and CSS `transform: translate(x, y)` inline positioning.
   - Detects custom piece sets and piece themes dynamically.
   - Detects board orientation (`flipped` class/attribute) for playing as Black.
   - Robust turn detection using active player clocks, destination square highlights, and move-list inspection.
   - Computes castling rights dynamically.

3. **Dual-Layer Square Highlighter ("Piece in Charge" & "Move Destination")**:
   - Seamlessly integrates with Chess.com's native `.highlight` layer as well as an SVG overlay rect layer.
   - Distinct, customizable color highlighting:
     - **Piece in Charge (`from` square)**: Azure Blue highlight indicating which piece should move.
     - **Target Square (`to` square)**: Emerald Green highlight indicating the optimal destination square.
   - Clean, unobtrusive visual cue that blends natively with Chess.com's board without distracting arrows.

4. **Live Opening Bubble (draggable)**:
   - A small on-board panel names the catalogue line the current position belongs to: opening, ECO,
     how far into the line the game is, the line's next move, and how many lines pass through the
     position. It follows **both** players' moves, not just your own turns.
   - Drag it by the title bar; it is clamped inside the board, keeps its position, and collapses to a
     handle. Hideable from the bubble itself or from the popup.

5. **Paced Auto-Move**:
   - Plays the highlighted move on the live board with **instant**, **fixed-delay** or **human-like**
     timing. The human-like model is deterministic: think time is derived from the position itself, so
     the same board always takes the same time and a game is repeatable. Forced moves go instantly,
     checks and crowded middlegames take longer, and a small share of positions get a long think.
   - Selectable minimum and maximum think time, a maximum auto-move count, side selection, and pause
     while the tab is hidden. The bubble carries a Play/Stop toggle for it.
   - If the board does not register a move, auto-move stops and reports it instead of looping. There
     is no detection evasion of any kind: it performs the same input a person would and nothing to
     hide it. Use it only where automated play is permitted.

6. **React Settings Popup & Interactive Playground**:
   - Polished glassmorphism dark UI with live depth sliders (8–22 ply), highlight toggles, eval bar switch, and feature controls.
   - Settings are stored in `chrome.storage.local` with real-time reactive sync to all tabs.
   - Includes a standalone **Interactive Test Playground** (`playground.html`) with an interactive board to test engine analysis and square highlighting anywhere without opening Chess.com.

---

## 📁 Code Architecture

```
chess-ai-overlay/
├── AGENTS.md                     # Agent development rules, commit conventions & constraints
├── entrypoints/
│   ├── background.ts             # Service Worker: manages Offscreen lifecycle & message routing
│   ├── content.ts                # Injected script: observes board DOM & renders overlay
│   ├── offscreen/                # Sandboxed extension page hosting Stockfish
│   │   ├── index.html
│   │   └── main.ts               # Worker runner & UCI command state machine
│   ├── popup/                    # Extension action popup
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx               # Settings UI with sliders & square highlight toggles
│   │   └── App.css
│   └── playground/               # Full-page interactive test bench
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx               # Interactive board, preset tactics & live eval bar
│       └── App.css
├── lib/
│   ├── types.ts                  # Shared TypeScript interfaces & messages
│   ├── storage.ts                # Chrome storage helper with reactive listeners
│   ├── uci-parser.ts             # Parser for UCI info, depth, score cp/mate & PV
│   ├── board-parser.ts           # Chess.com DOM parser & FEN generator
│   ├── svg-overlay.ts            # Square highlighter, eval bar & floating HUD
│   └── engine-client.ts          # Messaging client between content script & engine
├── public/
│   └── engine/
│       ├── stockfish.wasm        # Compiled WebAssembly chess engine
│       ├── stockfish.wasm.js     # WASM loader glue
│       └── stockfish.js          # Asm.js fallback engine
├── preview-server.cjs            # Live preview HTTP server for local testing
├── package.json
├── tsconfig.json
└── wxt.config.ts                 # WXT build configuration
```

---

## 📦 Downloads & Releases

Every push to `main` builds and tests both targets in CI — Chrome MV3, Firefox MV2 and MV3, the
AMO sources archive and the XPI — so a Gecko-only break fails a push instead of a release. Pushing a
`v*` tag publishes a **GitHub Release** with the same artefacts:

| Artefact | Use |
| --- | --- |
| `*.zip` (`chrome`) | Load unpacked, or upload to the Chrome Web Store |
| `*-firefox.zip` | Upload to addons.mozilla.org |
| `*-sources.zip` | AMO source archive (required for review) |
| `releases/*.xpi` | Direct, permanent install in Firefox / Waterfox |

The release workflow also supports `workflow_dispatch`, so a failed release can be retried from the
Actions tab without deleting and re-pushing the tag.

---

## 🚀 Quickstart & Commands

### 1. Install Dependencies
```bash
npm install
```

### 2. Development Mode (Hot-Reloading)
```bash
npm run dev
```
Automatically starts Vite/WXT dev mode, watches files, and reloads changes instantly.

### 3. Build Production Extension
```bash
npm run build
```
Compiles TypeScript, processes assets, bundles WebAssembly, and outputs the final extension to `.output/chrome-mv3`.

### 4. Create Production Zip Package
```bash
npm run zip
```
Creates `.output/chess-ai-overlay-1.2.1-chrome.zip` ready for Chrome Web Store submission or distribution.

### 5. Multi-Browser Support: Mozilla Firefox & Waterfox
The extension is fully compatible with Mozilla Firefox and Waterfox (both Manifest V2 and Manifest V3):
- **Chrome Engine Execution**: Uses `chrome.offscreen` document to bypass service worker WASM limitations.
- **Firefox & Waterfox Engine Execution**: Background script directly hosts `UnifiedEngineHost` with native WebAssembly and Web Worker support (bypassing Chromium-only `chrome.offscreen`).
- **Gecko Extension ID**: Configured with `browser_specific_settings.gecko.id: "chess-ai-overlay@innocengine.dev"`.

#### Firefox & Waterfox Build Commands:
```bash
# Build Firefox extension
npm run build:firefox

# Build Firefox MV3 specifically
npm run build:firefox:mv3

# Package Firefox zip and AMO sources archive
npm run zip:firefox

# Package valid-timestamp XPI archive for direct installation
npm run xpi:firefox

# Build and package both Chrome and Firefox simultaneously
npm run build:all
npm run zip:all
```

#### Installing in Waterfox / Firefox:

##### Method A: Temporary / Developer Mode (Recommended & Instant)
1. Open Waterfox or Firefox and navigate to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**.
3. Select `manifest.json` inside `.output/firefox-mv2/` (or `.output/firefox-mv3/`), or select `releases/chess-ai-overlay-1.2.1-firefox.xpi`.
4. Open [Chess.com](https://www.chess.com) and start playing!

##### Method B: Permanent Installation in Waterfox (Fixing "Cannot modify the needed file")
If you attempt to install an unsigned `.xpi` or `.zip` directly via `about:addons` > "Install Add-on From File...", Gecko browsers will reject the staging process with a modal error (`cannot modify the needed file` or `corrupt add-on`) due to signature enforcement.

To install permanently in Waterfox without signature rejection:
1. Navigate to `about:config` in your Waterfox URL bar and accept the prompt.
2. Search for `xpinstall.signatures.required` and toggle it to **`false`**.
3. Search for `extensions.experiments.enabled` and toggle it to **`true`**.
4. Open `about:addons`, click the gear icon in the top right, and choose **Install Add-on From File...**.
5. Select `releases/chess-ai-overlay-1.2.1-firefox.xpi`. It will install permanently without the modal staging error.

---

### 6. Patricia 5.1 Engine & Dynamic Personality Calibration
Patricia 5.1 is integrated with full native WebAssembly execution, supporting dynamic rating adjustment (500–3000 Elo) and distinct playstyle personalities:
- **Aggressive (EAS 430,000 Sacrificial)**: Patricia's hallmark romantic style with high draw contempt and bonuses for piece sacrifices and king attacks. Scaled dynamically to your target rating.
- **Human-Like**: Calibrated human blunder and mistake distribution modeled from CCRL and Lichess error rates. Throttles search depth (2–14 ply) and move time to match genuine human tactical vision.
- **Solid Positional**: Focuses on king safety, central pawn control, and avoids speculative sacrifices.
- **Full Strength (CCRL 3500+)**: Unrestricted grandmaster computation with maximum tactical depth.

#### Processing power (Resources tab)

A five-rung slider next to the Hash control moves search threads and think time together (1 to 4
threads, 150 to 1500 ms). Parallelism needs the pthread build, which needs `SharedArrayBuffer`, which
needs cross-origin isolation — the Chromium manifest declares it, and the **Parallel threads**
switch lets you opt out. When the host cannot back it, the runner clamps to one thread and says so
instead of offering a control that does nothing. Patricia's WASM is CPU/SIMD only; there is no GPU
backend to enable.

#### Aggressiveness

Patricia has a real sacrifice personality in the C++: a phase gate that switches to a dedicated
network once the best score passes a threshold, a position-style bonus, and draw contempt. This
release exposes it as `Aggressiveness` (25–300, default 100 = stock behaviour) across three sites in
`search.h`, with five presets that pair aggression with a suitable think time:

| Preset | Value | Think time | Intent |
| --- | --- | --- | --- |
| Solid | 60 | 240 ms | Accurate, avoids speculative sacrifices |
| Balanced | 100 | 300 ms | The engine default |
| Aggressive | 150 | 420 ms | Initiative ahead of material |
| **Bullet** | 220 | 260 ms | Fastest checkmate hunting, shortest think |
| Chaos | 300 | 500 ms | Everything the scale allows |

The control only appears when the engine's `uci` handshake actually advertises the option, so an
older engine binary falls back cleanly.

---

### 7. Load Extension in Chrome
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the `.output/chrome-mv3` folder.
4. Navigate to [Chess.com](https://www.chess.com/play/computer) and start playing!
