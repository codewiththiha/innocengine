import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Chess Engine AI Overlay',
    description: 'Educational tool for real-time Stockfish WASM analysis, SVG arrows, and board overlays on Chess.com.',
    version: '1.0.0',
    permissions: ['storage', 'activeTab', 'offscreen'],
    action: {
      default_title: 'Chess AI Overlay Settings',
      default_popup: 'popup.html',
    },
    web_accessible_resources: [
      {
        resources: [
          'engine/stockfish.js',
          'engine/stockfish.wasm',
          'engine/stockfish.wasm.js',
          'icon/*.png',
        ],
        matches: ['*://*.chess.com/*'],
      },
    ],
  },
});
