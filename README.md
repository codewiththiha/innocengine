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

4. **React Settings Popup & Interactive Playground**:
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
Creates `.output/chess-ai-overlay-1.0.0-chrome.zip` ready for Chrome Web Store submission or distribution.

### 5. Load Extension in Chrome
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Toggle **Developer mode** in the top-right corner.
3. Click **Load unpacked** and select the `.output/chrome-mv3` folder.
4. Navigate to [Chess.com](https://www.chess.com/play/computer) and start playing!
