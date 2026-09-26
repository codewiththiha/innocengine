# Chess Engine AI Overlay (Manifest V3 + WebAssembly + WXT)

An educational, high-performance browser extension that reads the live chessboard state on [Chess.com](https://www.chess.com) and renders real-time **Stockfish WebAssembly (WASM)** analysis, dynamic **SVG move arrows**, square highlights, a live **Evaluation Bar**, and an on-board **Analysis HUD**.

Built with modern browser extension tooling: **[WXT](https://wxt.dev/)**, **React 19**, **TypeScript**, **Stockfish.js/WASM**, and **Lucide Icons**.

---

## 🎯 Key Architectural Highlights

1. **Manifest V3 Compliant (Offscreen WASM Worker)**:
   - Modern target websites like Chess.com enforce strict Content Security Policies (`script-src` and `worker-src`) that disallow creating Web Workers from extension origins inside the content script page context.
   - To bypass this cleanly and without violating Chrome Web Store policies, this extension utilizes the official **Chrome Offscreen API** (`chrome.offscreen`).
   - The engine runs inside an isolated offscreen document with native WebAssembly and Worker access, completely immune to the host page's CSP and exempt from service worker 30-second termination timeouts.

2. **Resilient Board DOM Parsing & FEN Extraction**:
   - Parses modern Chess.com DOM elements (`wc-chess-board`, `chess-board`).
   - Supports both `square-xy` class notation and CSS `transform: translate(x, y)` inline positioning.
   - Detects board orientation (`flipped` class/attribute) for playing as Black.
   - Robust turn detection using active player clocks, destination square highlights, and move-list inspection.
   - Computes castling rights dynamically.

3. **SVG Visual Overlay (vs. Canvas)**:
   - Uses SVG rather than HTML5 `<canvas>` for resolution-independent, crisp vector rendering across Retina / 4K displays.
   - Includes trigonometry-based arrowhead offset calculation so arrows terminate precisely at square centers.
   - Renders smooth **quadratic Bézier curves** for Knight moves.
   - Features MultiPV support (visualizing up to 4 alternate lines with ranked colors and stroke weights).

4. **React Settings Popup & Interactive Playground**:
   - Polished glassmorphism dark UI with live depth sliders (8–25 ply), MultiPV controls, arrow color swatches, and feature toggles.
   - Settings are stored in `chrome.storage.local` with real-time reactive sync to all tabs.
   - Includes a standalone **Interactive Test Playground** (`playground.html`) with an interactive board to test engine analysis and arrow trigonometry anywhere without opening Chess.com.

---

## 📁 Code Architecture

```
chess-ai-overlay/
├── entrypoints/
│   ├── background.ts             # Service Worker: manages Offscreen lifecycle & message routing
│   ├── content.ts                # Injected script: observes board DOM & renders overlay
│   ├── offscreen/                # Sandboxed extension page hosting Stockfish
│   │   ├── index.html
│   │   └── main.ts               # Worker runner & UCI command state machine
│   ├── popup/                    # Extension action popup
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx               # Settings UI with sliders, color picker & toggles
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
│   ├── svg-overlay.ts            # SVG arrow geometry, eval bar & floating HUD
│   └── engine-client.ts          # Messaging client between content script & engine
├── public/
│   └── engine/
│       ├── stockfish.wasm        # Compiled WebAssembly chess engine (550KB)
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

### 5. Run Interactive Playground Preview
```bash
npm run preview
```
Starts the local preview server at `http://localhost:5173` serving the interactive testing playground with Stockfish WASM.

---

## 📥 Loading into Google Chrome / Chromium

1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** using the toggle switch in the upper-right corner.
3. Click **Load unpacked**.
4. Select the directory:
   ```
   /home/user/chess-ai-overlay/.output/chrome-mv3
   ```
5. Navigate to [Chess.com](https://www.chess.com) and open any game, puzzle, or analysis board.
6. The extension will automatically detect the board, initialize Stockfish, and render the move arrows, evaluation bar, and HUD!

---

## ⚙️ Settings & Configuration

Click the extension icon in Chrome's toolbar to open the settings popup:

- **Calculation Depth**: 8 to 25 ply (balanced default: 16).
- **MultiPV**: Top 1 to 4 candidate moves.
- **Arrow Color**: Emerald (`#10b981`), Cyan (`#06b6d4`), Amber (`#f59e0b`), Purple (`#a855f7`), Rose (`#f43f5e`).
- **Feature Toggles**:
  - Best Move Arrow
  - MultiPV Alternative Arrows
  - Square Highlights (Origin & Target)
  - Live Vertical Evaluation Bar
  - On-Board Analysis HUD
  - Auto-Analyze Every Move
- **Open Test Playground**: Launches `playground.html` for offline testing and tactical verification.

---

## 🧠 Technical Deep Dive: Challenges & Solutions

### 1. The MV3 Web Worker & CSP Challenge
- **Problem**: Chess.com's strict Content Security Policy forbids creating Web Workers via `blob:` or `chrome-extension:` URLs inside page-injected content scripts.
- **Solution**: The engine is hosted in an **Offscreen Document** (`chrome.offscreen`). Offscreen documents inherit the extension's execution permissions and origin, enabling Web Workers and WebAssembly to run unhindered.

### 2. Chess.com DOM Changes & Class Obfuscation
- **Problem**: Chess.com periodically alters CSS class structures (e.g. piece names, square indicators).
- **Solution**: The parser supports dual strategies:
  1. Inspecting class combinations (`.piece.wp.square-52`).
  2. Inspecting CSS `transform: translate(Xpx, Ypx)` and `translate(X%, Y%)` styles.
  3. Detecting board flipping via container attributes.

### 3. Evaluation Perspective Normalization
- **Detail**: Stockfish UCI outputs scores relative to the side to move (`score cp 50` on Black's turn means Black is up 0.50 pawns).
- **Solution**: `UciParser` normalizes evaluations to White's perspective so that the vertical evaluation bar consistently shows White advantage as positive and Black advantage as negative.
