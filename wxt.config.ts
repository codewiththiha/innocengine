import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'Chess Engine AI Overlay',
      description: 'Educational tool for real-time Stockfish analysis and board move square highlights on Chess.com.',
      version: '1.1.2',
      permissions: isFirefox
        ? ['storage', 'activeTab', 'tabs']
        : ['storage', 'activeTab', 'tabs', 'offscreen'],
      host_permissions: ['*://*.chess.com/*', 'https://huggingface.co/*', 'https://raw.githubusercontent.com/*'],
      action: {
        default_title: 'Chess AI Overlay Settings',
        default_popup: 'popup.html',
      },
      content_security_policy: {
        extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
      },
      // Cross-origin isolation is what makes SharedArrayBuffer available, and
      // without it the pthread Patricia build silently falls back to one thread.
      // Chromium only; Firefox ignores both keys and keeps the single-threaded path.
      cross_origin_embedder_policy: isFirefox ? undefined : { value: 'require-corp' },
      cross_origin_opener_policy: isFirefox ? undefined : { value: 'same-origin' },
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
      browser_specific_settings: isFirefox
        ? {
            gecko: {
              id: 'chess-ai-overlay@innocengine.dev',
              strict_min_version: '109.0',
            },
          }
        : undefined,
    };
  },
  suppressWarnings: {
    firefoxDataCollection: true,
  },
});
