import type { EngineEvaluation, EngineSettings } from '../lib/types';
import { DEFAULT_SETTINGS, getSettings } from '../lib/storage';

export default defineBackground(() => {
  let creatingOffscreen: Promise<void> | null = null;
  let latestEvaluation: EngineEvaluation | null = null;

  async function hasOffscreenDocument(): Promise<boolean> {
    if ('getContexts' in chrome.runtime) {
      const contexts = await (chrome.runtime as any).getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
      });
      return contexts.length > 0;
    }
    const offscreenUrl = chrome.runtime.getURL('offscreen.html');
    const matchedClients = await (self as any).clients?.matchAll();
    return matchedClients ? matchedClients.some((client: any) => client.url === offscreenUrl) : false;
  }

  async function ensureOffscreenDocument() {
    if (await hasOffscreenDocument()) {
      return;
    }

    if (creatingOffscreen) {
      await creatingOffscreen;
      return;
    }

    creatingOffscreen = chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Execute Stockfish chess engine WebAssembly calculations off main thread',
    });

    await creatingOffscreen;
    creatingOffscreen = null;
  }

  // Handle extension installation
  chrome.runtime.onInstalled.addListener(async () => {
    console.log('[Background] Chess Engine AI Overlay installed.');
    const settings = await getSettings();
    await chrome.storage.local.set({ chess_overlay_settings: settings });
    await ensureOffscreenDocument();
  });

  // Message router
  chrome.runtime.onMessage.addListener((message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
    // 1. Target: Engine (sent from Content Script or Popup)
    if (message.target === 'engine') {
      ensureOffscreenDocument()
        .then(() => {
          // Pass sender tab ID to help route back if needed
          const tabId = sender.tab?.id;
          const forwarded = { ...message, senderTabId: tabId };
          chrome.runtime.sendMessage(forwarded).catch(() => {
            // Offscreen will pick it up
          });
        })
        .catch((err: any) => {
          console.error('[Background] Failed to ensure offscreen document:', err);
        });
      return false;
    }

    // 2. Target: Content (evaluation update sent from Offscreen Engine)
    if (message.target === 'content') {
      if (message.type === 'EVAL_UPDATE' && message.evaluation) {
        latestEvaluation = message.evaluation;
      }

      // Forward to specific tab if senderTabId was recorded
      if (message.senderTabId) {
        chrome.tabs.sendMessage(message.senderTabId, message).catch(() => {});
      } else {
        // Forward to all chess.com tabs
        chrome.tabs.query({ url: '*://*.chess.com/*' }, (tabs: chrome.tabs.Tab[]) => {
          tabs.forEach((tab: chrome.tabs.Tab) => {
            if (tab.id) chrome.tabs.sendMessage(tab.id, message).catch(() => {});
          });
        });
      }
      return false;
    }

    // 3. Popup requests latest evaluation
    if (message.target === 'popup' && message.type === 'GET_CURRENT_EVAL') {
      sendResponse({ evaluation: latestEvaluation });
      return true;
    }

    return false;
  });
});
