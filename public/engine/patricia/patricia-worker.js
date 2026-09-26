// Self-contained Web Worker hosting Patricia WASM Chess Engine in Chrome MV3.
// Compatible with both standard UCI string commands and JSON wrappers.

const SKILL_LEVELS = [
  500, 800, 1000, 1200, 1300, 1400, 1500, 1600, 1700, 1800,
  1900, 2000, 2100, 2200, 2300, 2400, 2500, 2650, 2800, 3000,
];

function eloToSkillLevel(elo) {
  let closestIdx = 0;
  let minDiff = Infinity;
  for (let i = 0; i < SKILL_LEVELS.length; i++) {
    const diff = Math.abs(SKILL_LEVELS[i] - elo);
    if (diff < minDiff) {
      minDiff = diff;
      closestIdx = i;
    }
  }
  return closestIdx + 1;
}

let engineInstance = null;
let isReady = false;
const pendingQueue = [];
let targetElo = 2500;
let limitStrength = false;

function postOutput(line) {
  self.postMessage(line);
}

async function initEngine() {
  try {
    // Single-threaded fallback works reliably across all browser contexts without crossOriginIsolated requirement
    importScripts('patricia-single.js');

    const scriptUrl = self.location.href;
    engineInstance = await Patricia({
      mainScriptUrlOrBlob: scriptUrl,
      locateFile: (p) => {
        return new URL(p, scriptUrl).href;
      },
    });

    engineInstance.addMessageListener((line) => {
      // Ensure UCI options advertised include standard UCI_LimitStrength and UCI_Elo
      if (line === 'uciok') {
        postOutput('option name UCI_LimitStrength type check default false');
        postOutput('option name UCI_Elo type spin default 2500 min 500 max 3000');
        postOutput('option name Personality type combo default Aggressive var Aggressive var Human var FullStrength var Solid');
      }
      postOutput(line);
    });

    isReady = true;

    for (const cmd of pendingQueue) {
      handleCommand(cmd);
    }
    pendingQueue.length = 0;
  } catch (err) {
    console.error('[PatriciaWorker] Init error:', err);
  }
}

function handleCommand(rawCmd) {
  if (!rawCmd || !engineInstance) return;
  const cmd = rawCmd.trim();

  // Intercept UCI_LimitStrength and UCI_Elo for standard GUI compliance
  if (cmd.startsWith('setoption name UCI_LimitStrength value')) {
    const val = cmd.split('value')[1]?.trim().toLowerCase();
    limitStrength = val === 'true';
    if (!limitStrength) {
      engineInstance.postMessage('setoption name Skill_Level value 21');
    } else {
      const skill = eloToSkillLevel(targetElo);
      engineInstance.postMessage(`setoption name Skill_Level value ${skill}`);
    }
    return;
  }

  if (cmd.startsWith('setoption name UCI_Elo value')) {
    const elo = parseInt(cmd.split('value')[1]?.trim() || '2500', 10);
    targetElo = isNaN(elo) ? 2500 : elo;
    if (limitStrength) {
      const skill = eloToSkillLevel(targetElo);
      engineInstance.postMessage(`setoption name Skill_Level value ${skill}`);
    }
    return;
  }

  if (cmd.startsWith('setoption name Personality value')) {
    const personality = cmd.split('value')[1]?.trim() || 'Aggressive';
    if (personality === 'Human') {
      limitStrength = true;
      const skill = eloToSkillLevel(targetElo);
      engineInstance.postMessage(`setoption name Skill_Level value ${skill}`);
    } else {
      limitStrength = false;
      engineInstance.postMessage('setoption name Skill_Level value 21');
    }
    return;
  }

  engineInstance.postMessage(cmd);
}

self.onmessage = (e) => {
  const data = e.data;
  const cmd = typeof data === 'string' ? data : data?.cmd;
  if (!cmd) return;

  if (!isReady || !engineInstance) {
    pendingQueue.push(cmd);
  } else {
    handleCommand(cmd);
  }
};

// Start initialisation immediately
initEngine();
