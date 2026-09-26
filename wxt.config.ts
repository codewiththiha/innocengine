import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Chess Engine AI Overlay',
    description: 'Educational tool for real-time Stockfish analysis and board move square highlights on Chess.com.',
    version: '1.0.0',
    permissions: ['storage', 'activeTab', 'tabs', 'offscreen'],
    host_permissions: ['*://*.chess.com/*', 'https://huggingface.co/*', 'https://raw.githubusercontent.com/*'],
    action: {
      default_title: 'Chess AI Overlay Settings',
      default_popup: 'popup.html',
    },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    web_accessible_resources: [
      {
        resources: [
          'stockfish.js',
          'stockfish.wasm',
          'stockfish.wasm.js',
          'engine/stockfish.js',
          'engine/stockfish.wasm',
          'engine/stockfish.wasm.js',
          'engine/patricia/*',
          'icon/*.png',
        ],
        matches: ['*://*.chess.com/*'],
      },
    ],
  },
});
