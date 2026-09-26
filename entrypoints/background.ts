import type { EngineEvaluation, EngineCapabilities, EngineTelemetry } from '../lib/types';
import { getSettings } from '../lib/storage';
import { UnifiedEngineHost } from '../lib/unified-engine-host';

export default defineBackground(() => {
  const hasOffscreenApi = typeof chrome !== 'undefined' && !!(chrome as any).offscreen?.createDocument;
  let creatingOffscreen: Promise<void> | null = null;
  let latestEvaluation: EngineEvaluation | null = null;
  let latestCapabilities: EngineCapabilities | null = null;
  let latestTelemetry: EngineTelemetry | null = null;
  let activeChessTabId: number | undefined;

  // On Firefox / environments without chrome.offscreen, host engine runners directly in background!
  if (!hasOffscreenApi) {
    new UnifiedEngineHost();
  }

  async function hasOffscreenDocument(): Promise<boolean> {
    if (!hasOffscreenApi) return false;
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
    if (!hasOffscreenApi || (await hasOffscreenDocument())) {
      return;
    }

    if (creatingOffscreen) {
      await creatingOffscreen;
      return;
    }

    creatingOffscreen = chrome.offscreen.createDocument({
      url: chrome.runtime.getURL('offscreen.html'),
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: 'Execute Stockfish chess engine calculations off main thread',
    });

    await creatingOffscreen;
    creatingOffscreen = null;
  }

  chrome.runtime.onInstalled.addListener(async () => {
    const settings = await getSettings();
    await chrome.storage.local.set({ chess_overlay_settings: settings });
    if (hasOffscreenApi) {
      await ensureOffscreenDocument();
    }
  });

  // Forward settings updates from background service worker to offscreen document
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes['chess_overlay_settings']) {
      const newSettings = changes['chess_overlay_settings'].newValue;
      if (newSettings && hasOffscreenApi) {
        chrome.runtime.sendMessage({
          target: 'engine',
          type: 'SETTINGS_UPDATE',
          settings: newSettings,
        }).catch(() => {});
      }
    }
  });

  chrome.runtime.onMessage.addListener(
    (message: any, sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
      // 1. Target: Engine (request from Content Script or Popup)
      if (message.target === 'engine') {
        if (sender.tab?.id) {
          activeChessTabId = sender.tab.id;
        }

        if (hasOffscreenApi) {
          ensureOffscreenDocument()
            .then(() => {
              const tabId = sender.tab?.id || activeChessTabId;
              const forwarded = { ...message, senderTabId: tabId };
              chrome.runtime.sendMessage(forwarded).catch(() => {});
            })
            .catch((err: any) => {
              console.error('[Background] Failed to ensure offscreen document:', err);
            });
        }
        return false;
      }

      // 2. Target: Content (evaluation update from Offscreen or Direct Background Host)
      if (message.target === 'content') {
        if (message.type === 'EVAL_UPDATE' && message.evaluation) {
          latestEvaluation = message.evaluation;
        }

        const targetTabId = message.senderTabId || activeChessTabId;
        if (targetTabId) {
          chrome.tabs.sendMessage(targetTabId, message).catch(() => {});
        }

        chrome.tabs.query({ active: true }, (tabs: chrome.tabs.Tab[]) => {
          tabs.forEach((tab: chrome.tabs.Tab) => {
            if (tab.id && tab.id !== targetTabId) {
              chrome.tabs.sendMessage(tab.id, message).catch(() => {});
            }
          });
        });
        return false;
      }

      // 3. Target: Popup requests
      if (message.target === 'popup') {
        if (message.type === 'GET_CURRENT_EVAL') {
          sendResponse({
            evaluation: latestEvaluation,
            capabilities: latestCapabilities,
            telemetry: latestTelemetry,
          });
          return true;
        }
        if (message.type === 'ENGINE_CAPABILITIES') {
          latestCapabilities = message.capabilities;
        }
        if (message.type === 'TELEMETRY_UPDATE') {
          latestTelemetry = message.telemetry;
        }
      }

      return false;
    }
  );
});
