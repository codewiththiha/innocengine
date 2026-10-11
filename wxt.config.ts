import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => {
    const isFirefox = browser === 'firefox';

    return {
      name: 'Chess Engine Overlay by codewiththiha',
      description: 'Real-time Stockfish & GwayMaeGyi analysis with board highlights and eval bar on Chess.com only.',
      version: '1.5.1',
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
      web_accessible_resources: [
        {
          resources: [
            'stockfish.js',
            'stockfish.wasm',
            'stockfish.wasm.js',
            'engine/stockfish.js',
            'engine/stockfish.wasm',
            'engine/stockfish.wasm.js',
            'engine/gwaymaegyi/*',
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
