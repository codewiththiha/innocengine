// Self-contained Web Worker hosting Patricia WASM Chess Engine in Chrome MV3 & Firefox.
// Supports native UCI protocol, dynamic Elo scaling (500–3000), and style personalities
// (Aggressive EAS 430k sacrificial, Human blunder calibration, Solid positional, Full Strength 3500+).

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
  return closestIdx + 1; // 1-based (1..20)
}

function getEloSearchBounds(elo, isFullStrength) {
  if (isFullStrength) {
    return { depth: 16, maxNodes: 0, movetime: 500 };
  }
  if (elo <= 600) {
    return { depth: 2, maxNodes: 200, movetime: 150 };
  }
  if (elo <= 800) {
    return { depth: 3, maxNodes: 600, movetime: 180 };
  }
  if (elo <= 1100) {
    return { depth: 4, maxNodes: 2000, movetime: 220 };
  }
  if (elo <= 1400) {
    return { depth: 5, maxNodes: 8000, movetime: 280 };
  }
  if (elo <= 1750) {
    return { depth: 6, maxNodes: 25000, movetime: 340 };
  }
  if (elo <= 2100) {
    return { depth: 8, maxNodes: 60000, movetime: 400 };
  }
  if (elo <= 2500) {
    return { depth: 10, maxNodes: 150000, movetime: 460 };
  }
  if (elo <= 2800) {
    return { depth: 12, maxNodes: 350000, movetime: 520 };
  }
  return { depth: 14, maxNodes: 800000, movetime: 600 };
}

let engineInstance = null;
let isReady = false;
const pendingQueue = [];

let targetElo = 2500;
let personality = 'aggressive'; // 'aggressive' | 'human' | 'solid' | 'full_strength'
let limitStrength = true;
let currentMultiPv = 1;
let currentSkillLevel = -1;
let currentFen = '';
let accumLoss = 0;

// Active search candidate lines
let currentSearchCandidates = [];

function postOutput(line) {
  self.postMessage(line);
}

async function initEngine() {
  try {
    importScripts('patricia-single.js');

    const scriptUrl = self.location.href;
    engineInstance = await Patricia({
      mainScriptUrlOrBlob: scriptUrl,
      locateFile: (p) => {
        return new URL(p, scriptUrl).href;
      },
    });

    engineInstance.addMessageListener((line) => {
      // Intercept UCI options advertised to include standard GUI compliance
      if (line === 'uciok') {
        postOutput('option name UCI_LimitStrength type check default true');
        postOutput('option name UCI_Elo type spin default 2500 min 500 max 3000');
        postOutput('option name Personality type combo default Aggressive var Aggressive var Human var Solid var FullStrength');
        postOutput('option name Skill_Level type spin default 17 min 1 max 21');
        postOutput('option name MultiPV type spin default 1 min 1 max 5');
        postOutput(line);
        return;
      }

      // Collect candidate lines during search for personality / human blunder selection
      if (line.includes(' score ') && line.includes(' pv ')) {
        const pvMatch = line.match(/\bmultipv\s+(\d+)/);
        const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
        const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
        const depthMatch = line.match(/\bdepth\s+(\d+)/);
        const pvIndex = line.indexOf(' pv ');
        const pvStr = pvIndex !== -1 ? line.substring(pvIndex + 4).trim() : '';
        const moves = pvStr.split(/\s+/).filter(Boolean);

        if (moves.length > 0) {
          const multiPvId = pvMatch ? parseInt(pvMatch[1], 10) : 1;
          const scoreCp = cpMatch ? parseInt(cpMatch[1], 10) : 0;
          const scoreMate = mateMatch ? parseInt(mateMatch[1], 10) : null;
          const depth = depthMatch ? parseInt(depthMatch[1], 10) : 0;

          currentSearchCandidates[multiPvId - 1] = {
            id: multiPvId,
            depth,
            scoreCp,
            scoreMate,
            bestMove: moves[0],
            pv: moves,
            rawLine: line,
          };
        }

        // When in human rating handicap mode (<= 1500 Elo), suppress intermediate info lines
        // so the UI does not prematurely display the 3500-Elo top line before human selection finishes
        if (limitStrength && personality !== 'full_strength' && targetElo <= 1500) {
          return;
        }
      }

      if (line.startsWith('bestmove')) {
        handleBestMove(line);
        return;
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

function handleBestMove(rawBestMoveLine) {
  try {
    const parts = rawBestMoveLine.trim().split(/\s+/);
    const engineBestMove = parts[1] || '';

    // If full strength mode or limit strength disabled, pass the raw engine move directly
    if (!limitStrength || personality === 'full_strength' || currentSearchCandidates.length === 0) {
      postOutput(rawBestMoveLine);
      return;
    }

    // Active candidates sorted by MultiPV ID
    const validCandidates = currentSearchCandidates.filter((c) => c && c.bestMove && c.bestMove.length >= 4);
    if (validCandidates.length <= 1) {
      postOutput(rawBestMoveLine);
      return;
    }

    const primaryCandidate = validCandidates[0];
    const primaryScore = primaryCandidate.scoreCp ?? 0;
    const cpLoss = Math.max(0, 120 - Math.floor(targetElo / 25));

    const eloClamped = Math.max(500, Math.min(3000, targetElo));
    // Accuracy scaling: probability that the player identifies the top engine move
    // 500 Elo -> 12%, 800 Elo -> 22%, 1200 Elo -> 36%, 1500 Elo -> 48%, 2000 Elo -> 65%, 2500 Elo -> 82%, 3000 Elo -> 98%
    const bestMoveProbability = Math.min(0.98, Math.max(0.12, 0.12 + (eloClamped - 500) * (0.86 / 2500)));

    const remainingProb = 1.0 - bestMoveProbability;
    const temp = Math.max(25, (3100 - eloClamped) / 8);

    const altWeights = [];
    for (let i = 1; i < validCandidates.length; i++) {
      const c = validCandidates[i];
      const rawDiff = Math.max(0, primaryScore - (c.scoreCp ?? primaryScore));
      let effectiveDiff = rawDiff;

      const moveStr = c.bestMove.toLowerCase();
      const isPawnAdvance = /^[a-h][27][a-h][45]/.test(moveStr) || /^[a-h][3-6][a-h][4-7]/.test(moveStr);
      const isKingCastling = moveStr === 'e1g1' || moveStr === 'e1c1' || moveStr === 'e8g8' || moveStr === 'e8c8';
      const isCheckOrMate = c.scoreMate !== null && c.scoreMate > 0;

      if (personality === 'aggressive') {
        // Aggressive EAS 430k mode: bias towards piece thrusts, checks, pawn storms
        if (isPawnAdvance || isCheckOrMate || (c.scoreCp !== null && c.scoreCp > primaryScore - 60)) {
          effectiveDiff = Math.max(0, rawDiff - 35);
        }
        if (isKingCastling && rawDiff > 0) {
          effectiveDiff += 25;
        }
      } else if (personality === 'solid') {
        // Solid Positional mode: bias towards king safety, solid pawn structure
        if (isKingCastling) {
          effectiveDiff = Math.max(0, rawDiff - 30);
        }
        if (rawDiff > 60) {
          effectiveDiff += 35;
        }
      }

      // At low Elo (500–800), human players frequently overlook tactical inaccuracies.
      // We reduce the penalty for score difference so worse moves are authentically chosen with ~88% probability.
      if (eloClamped <= 800) {
        effectiveDiff = effectiveDiff * 0.25;
      } else if (eloClamped <= 1400) {
        effectiveDiff = effectiveDiff * 0.6;
      }

      altWeights.push(Math.exp(-effectiveDiff / temp));
    }

    const altSum = altWeights.reduce((sum, w) => sum + w, 0);
    const candidateWeights = [bestMoveProbability];
    for (let i = 0; i < altWeights.length; i++) {
      candidateWeights.push(remainingProb * (altWeights[i] / (altSum || 1)));
    }

    // Softmax sampling among candidates
    let randomVal = Math.random();
    let chosenIndex = 0;

    for (let i = 0; i < candidateWeights.length; i++) {
      randomVal -= candidateWeights[i];
      if (randomVal <= 0) {
        chosenIndex = i;
        break;
      }
    }

    const chosenCandidate = validCandidates[chosenIndex] || primaryCandidate;
    const chosenMove = chosenCandidate.bestMove;

    // Track centipawn error accumulation
    const actualMistake = Math.max(0, primaryScore - (chosenCandidate.scoreCp ?? primaryScore));
    if (actualMistake > 0) {
      accumLoss = Math.max(0, accumLoss - actualMistake + cpLoss);
    } else {
      accumLoss += cpLoss;
    }

    // Reorder candidates so the chosen move is multipv 1, followed by the remaining lines
    const reorderedCandidates = [
      chosenCandidate,
      ...validCandidates.filter((_, idx) => idx !== chosenIndex),
    ];

    for (let i = 0; i < Math.min(reorderedCandidates.length, currentMultiPv); i++) {
      const cand = reorderedCandidates[i];
      const scoreToken =
        cand.scoreMate !== null
          ? `score mate ${cand.scoreMate}`
          : `score cp ${cand.scoreCp ?? 0}`;
      postOutput(
        `info depth ${cand.depth} seldepth ${cand.depth + 2} multipv ${i + 1} ${scoreToken} pv ${cand.pv.join(' ')}`
      );
    }

    postOutput(`bestmove ${chosenMove}`);
  } catch (err) {
    console.warn('[PatriciaWorker] Error in handleBestMove:', err);
    postOutput(rawBestMoveLine);
  }
}

function handleCommand(rawCmd) {
  if (!rawCmd || !engineInstance) return;
  const cmd = rawCmd.trim();

  try {
    // UCI_LimitStrength
    if (cmd.startsWith('setoption name UCI_LimitStrength value')) {
      const val = cmd.split('value')[1]?.trim().toLowerCase();
      limitStrength = val === 'true';
      applyTuning();
      return;
    }

    // UCI_Elo
    if (cmd.startsWith('setoption name UCI_Elo value')) {
      const elo = parseInt(cmd.split('value')[1]?.trim() || '2500', 10);
      targetElo = isNaN(elo) ? 2500 : Math.max(500, Math.min(3000, elo));
      applyTuning();
      return;
    }

    // Personality
    if (cmd.startsWith('setoption name Personality value')) {
      const rawVal = cmd.split('value')[1]?.trim().toLowerCase() || 'aggressive';
      if (rawVal === 'human') personality = 'human';
      else if (rawVal === 'solid') personality = 'solid';
      else if (rawVal === 'fullstrength' || rawVal === 'full_strength') personality = 'full_strength';
      else personality = 'aggressive';

      if (personality === 'full_strength') {
        limitStrength = false;
      } else {
        limitStrength = true;
      }
      applyTuning();
      return;
    }

    // Skill_Level (1..21)
    if (cmd.startsWith('setoption name Skill_Level value')) {
      const skill = parseInt(cmd.split('value')[1]?.trim() || '21', 10);
      if (!isNaN(skill)) {
        currentSkillLevel = skill;
        if (skill === 21) {
          personality = 'full_strength';
          limitStrength = false;
        } else {
          targetElo = SKILL_LEVELS[skill - 1] || 2500;
          limitStrength = true;
        }
      }
      engineInstance.postMessage(cmd);
      return;
    }

    // MultiPV
    if (cmd.startsWith('setoption name MultiPV value')) {
      const mpv = parseInt(cmd.split('value')[1]?.trim() || '1', 10);
      if (!isNaN(mpv)) {
        currentMultiPv = Math.max(1, Math.min(5, mpv));
      }
      // For human blunder / personality selection, we keep C++ searching 5 MultiPV lines
      // so we always have alternate moves to pick from
      engineInstance.postMessage('setoption name MultiPV value 5');
      return;
    }

    // position command
    if (cmd.startsWith('position')) {
      currentFen = cmd;
      currentSearchCandidates = [];
      engineInstance.postMessage(cmd);
      return;
    }

    // go command: scale depth and nodes realistically per rating
    if (cmd.startsWith('go')) {
      currentSearchCandidates = [];

      const isFull = !limitStrength || personality === 'full_strength';
      const bounds = getEloSearchBounds(targetElo, isFull);

      // Parse user requested depth if any
      const depthMatch = cmd.match(/\bdepth\s+(\d+)/);
      const userDepth = depthMatch ? parseInt(depthMatch[1], 10) : 0;
      const effectiveDepth = isFull ? (userDepth > 0 ? userDepth : 16) : Math.min(bounds.depth, userDepth > 0 ? userDepth : bounds.depth);

      // CRITICAL FIX: Patricia C++ human.h line 11 sets thread_info.multipv = 1 on every search!
      // We must explicitly restore MultiPV 5 before every go command so alternate blunder/inaccuracy
      // candidates are generated on move 2, 3, 4, etc. instead of starving to 1 line!
      if (!isFull) {
        engineInstance.postMessage('setoption name MultiPV value 5');
      }

      // In single-threaded Patricia WASM, sending "nodes" together with "movetime" causes
      // search.h line 54 to invoke std::this_thread::sleep_for(INT32_MAX / 2) (12 days freeze).
      // Restricting via depth + movetime throttles calculation smoothly in sub-50ms without deadlocking.
      const effectiveCmd = `go depth ${effectiveDepth} movetime ${bounds.movetime}`;

      engineInstance.postMessage(effectiveCmd);
      return;
    }

    // ucinewgame
    if (cmd === 'ucinewgame') {
      accumLoss = 0;
      currentSearchCandidates = [];
      engineInstance.postMessage(cmd);
      return;
    }

    engineInstance.postMessage(cmd);
  } catch (err) {
    console.warn('[PatriciaWorker] Error executing command:', rawCmd, err);
  }
}

function applyTuning() {
  if (!engineInstance) return;
  try {
    const isFull = !limitStrength || personality === 'full_strength';
    if (isFull) {
      currentSkillLevel = 21;
      engineInstance.postMessage('setoption name Skill_Level value 21');
      engineInstance.postMessage('setoption name UCI_LimitStrength value false');
    } else {
      const skill = eloToSkillLevel(targetElo);
      currentSkillLevel = skill;
      engineInstance.postMessage(`setoption name Skill_Level value ${skill}`);
      engineInstance.postMessage('setoption name UCI_LimitStrength value true');
      engineInstance.postMessage(`setoption name UCI_Elo value ${targetElo}`);
    }
  } catch (err) {
    console.warn('[PatriciaWorker] Error applying tuning:', err);
  }
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
