// Patricia's single-threaded WASM adapter with UCI strength and style controls.

const SKILL_LEVELS = [
  500, 800, 1000, 1200, 1300, 1400, 1500, 1600, 1700, 1800,
  1900, 2000, 2100, 2200, 2300, 2400, 2500, 2650, 2800, 3000,
];

const FULL_STRENGTH_SKILL = 21;
const MAX_MULTI_PV = 5;
const MATE_SCORE = 100000;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

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

function getEloSearchBounds(elo, isFullStrength) {
  if (isFullStrength) return { depth: 16, movetime: 500 };
  if (elo <= 600) return { depth: 2, movetime: 150 };
  if (elo <= 800) return { depth: 3, movetime: 180 };
  if (elo <= 1100) return { depth: 4, movetime: 220 };
  if (elo <= 1400) return { depth: 5, movetime: 280 };
  if (elo <= 1750) return { depth: 6, movetime: 340 };
  if (elo <= 2100) return { depth: 8, movetime: 400 };
  if (elo <= 2500) return { depth: 10, movetime: 460 };
  if (elo <= 2800) return { depth: 12, movetime: 520 };
  return { depth: 14, movetime: 600 };
}

function isUciMove(move) {
  return /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move);
}

function scoreValue(candidate) {
  if (candidate.scoreMate !== null) {
    const distance = Math.min(Math.abs(candidate.scoreMate), 999);
    return candidate.scoreMate > 0 ? MATE_SCORE - distance : -MATE_SCORE + distance;
  }
  return candidate.scoreCp ?? 0;
}

function isForcedLoss(candidate) {
  return candidate.scoreMate !== null && candidate.scoreMate < 0;
}

let engineInstance = null;
let isReady = false;
const pendingQueue = [];

let targetElo = 2500;
let personality = 'aggressive';
let limitStrength = true;
let currentMultiPv = 1;
let currentFen = '';
let currentSearchCandidates = [];

function postOutput(line) {
  self.postMessage(line);
}

function isFullStrength() {
  return !limitStrength || personality === 'full_strength';
}

function engineMultiPv() {
  return isFullStrength() ? currentMultiPv : MAX_MULTI_PV;
}

function syncEngineMultiPv() {
  engineInstance?.postMessage(`setoption name MultiPV value ${engineMultiPv()}`);
}

function extractFen(positionCommand) {
  const match = positionCommand.match(/^position\s+fen\s+(.+?)(?:\s+moves\s+|$)/);
  return match ? match[1] : '';
}

function pieceAt(square) {
  if (!currentFen) return '';

  const [placement] = currentFen.split(/\s+/, 1);
  const ranks = placement?.split('/');
  const rankIndex = 8 - Number(square[1]);
  const fileIndex = square.charCodeAt(0) - 97;
  const rank = ranks?.[rankIndex];
  if (!rank || fileIndex < 0 || fileIndex > 7) return '';

  let file = 0;
  for (const token of rank) {
    if (/\d/.test(token)) {
      file += Number(token);
      continue;
    }
    if (file === fileIndex) return token;
    file += 1;
  }
  return '';
}

function isPawnAdvance(move) {
  return pieceAt(move.substring(0, 2)).toLowerCase() === 'p';
}

function collectSearchCandidate(line) {
  const pvIndex = line.indexOf(' pv ');
  if (pvIndex === -1) return;

  const moves = line.substring(pvIndex + 4).trim().split(/\s+/).filter(Boolean);
  const bestMove = moves[0] || '';
  if (!isUciMove(bestMove)) return;

  const multiPvMatch = line.match(/\bmultipv\s+(\d+)/);
  const multiPvId = multiPvMatch ? Number(multiPvMatch[1]) : 1;
  if (!Number.isInteger(multiPvId) || multiPvId < 1 || multiPvId > MAX_MULTI_PV) return;

  const depthMatch = line.match(/\bdepth\s+(\d+)/);
  const cpMatch = line.match(/\bscore\s+cp\s+(-?\d+)/);
  const mateMatch = line.match(/\bscore\s+mate\s+(-?\d+)/);
  const candidate = {
    id: multiPvId,
    depth: depthMatch ? Number(depthMatch[1]) : 0,
    scoreCp: cpMatch ? Number(cpMatch[1]) : null,
    scoreMate: mateMatch ? Number(mateMatch[1]) : null,
    bestMove,
    pv: moves,
  };

  const existing = currentSearchCandidates[multiPvId - 1];
  if (!existing || candidate.depth >= existing.depth) {
    currentSearchCandidates[multiPvId - 1] = candidate;
  }
}

function currentDepthCandidates() {
  const validCandidates = currentSearchCandidates.filter(
    (candidate) => candidate && isUciMove(candidate.bestMove)
  );
  const maxDepth = Math.max(...validCandidates.map((candidate) => candidate.depth), -1);

  return validCandidates
    .filter((candidate) => candidate.depth === maxDepth)
    .sort((left, right) => left.id - right.id);
}

function chooseCandidate(sourceCandidate, candidates) {
  const alternatives = candidates.filter((candidate) => candidate !== sourceCandidate);
  const selectable = [
    sourceCandidate,
    ...alternatives.filter(
      (candidate) => isForcedLoss(sourceCandidate) || !isForcedLoss(candidate)
    ),
  ];

  if (selectable.length === 1) return sourceCandidate;

  const elo = clamp(targetElo, 500, 3000);
  const bestMoveProbability = clamp(0.12 + ((elo - 500) * 0.86) / 2500, 0.12, 0.98);
  const temperature = Math.max(25, (3100 - elo) / 8);
  const primaryScore = scoreValue(sourceCandidate);
  const alternateWeights = selectable.slice(1).map((candidate) => {
    const rawDifference = Math.max(0, primaryScore - scoreValue(candidate));
    let effectiveDifference = rawDifference;
    const move = candidate.bestMove;
    const isCastling = move === 'e1g1' || move === 'e1c1' || move === 'e8g8' || move === 'e8c8';

    if (personality === 'aggressive') {
      if (isPawnAdvance(move) || (candidate.scoreMate !== null && candidate.scoreMate > 0) || rawDifference < 60) {
        effectiveDifference = Math.max(0, rawDifference - 35);
      }
      if (isCastling && rawDifference > 0) effectiveDifference += 25;
    } else if (personality === 'solid') {
      if (isCastling) effectiveDifference = Math.max(0, rawDifference - 30);
      if (rawDifference > 60) effectiveDifference += 35;
    }

    if (elo <= 800) effectiveDifference *= 0.25;
    else if (elo <= 1400) effectiveDifference *= 0.6;

    return Math.exp(-effectiveDifference / temperature);
  });

  const alternateTotal = alternateWeights.reduce((total, weight) => total + weight, 0);
  if (alternateTotal === 0) return sourceCandidate;

  const weights = [bestMoveProbability];
  for (const weight of alternateWeights) {
    weights.push((1 - bestMoveProbability) * (weight / alternateTotal));
  }

  let value = Math.random();
  for (let index = 0; index < weights.length; index++) {
    value -= weights[index];
    if (value <= 0) return selectable[index] || sourceCandidate;
  }

  return sourceCandidate;
}

function emitCandidates(chosenCandidate, candidates) {
  const reordered = [
    chosenCandidate,
    ...candidates.filter((candidate) => candidate !== chosenCandidate),
  ];

  for (let index = 0; index < Math.min(reordered.length, currentMultiPv); index++) {
    const candidate = reordered[index];
    const score = candidate.scoreMate !== null
      ? `score mate ${candidate.scoreMate}`
      : `score cp ${candidate.scoreCp ?? 0}`;
    const seldepth = candidate.depth + 2;
    postOutput(
      `info depth ${candidate.depth} seldepth ${seldepth} multipv ${index + 1} ${score} pv ${candidate.pv.join(' ')}`
    );
  }
}

function handleBestMove(rawBestMoveLine) {
  const bestMove = rawBestMoveLine.trim().split(/\s+/)[1] || '';
  const candidates = currentDepthCandidates();
  currentSearchCandidates = [];

  if (isFullStrength() || !isUciMove(bestMove)) {
    postOutput(rawBestMoveLine);
    return;
  }

  const sourceCandidate = candidates.find((candidate) => candidate.bestMove === bestMove);
  if (!sourceCandidate) {
    postOutput(rawBestMoveLine);
    return;
  }

  const chosenCandidate = chooseCandidate(sourceCandidate, candidates);
  emitCandidates(chosenCandidate, candidates);
  postOutput(`bestmove ${chosenCandidate.bestMove}`);
}

async function initEngine() {
  try {
    importScripts('patricia-single.js');

    const scriptUrl = self.location.href;
    engineInstance = await Patricia({
      mainScriptUrlOrBlob: scriptUrl,
      locateFile: (file) => new URL(file, scriptUrl).href,
    });

    engineInstance.addMessageListener((line) => {
      if (line.startsWith('option name MultiPV ')) {
        postOutput('option name MultiPV type spin default 1 min 1 max 5');
        return;
      }

      if (line === 'uciok') {
        postOutput('option name UCI_LimitStrength type check default true');
        postOutput('option name UCI_Elo type spin default 2500 min 500 max 3000');
        postOutput('option name Personality type combo default Aggressive var Aggressive var Human var Solid var FullStrength');
        postOutput(line);
        return;
      }

      const isSearchInfo = line.includes(' score ') && line.includes(' pv ');
      if (isSearchInfo) {
        collectSearchCandidate(line);
        if (!isFullStrength()) return;
      }

      if (line.startsWith('bestmove')) {
        handleBestMove(line);
        return;
      }

      postOutput(line);
    });

    isReady = true;
    applyTuning();

    for (const command of pendingQueue.splice(0)) {
      handleCommand(command);
    }
  } catch (error) {
    console.error('[PatriciaWorker] Initialization failed:', error);
    postOutput('info string Patricia initialization failed');
  }
}

function optionValue(command) {
  const marker = ' value ';
  const index = command.indexOf(marker);
  return index === -1 ? '' : command.substring(index + marker.length).trim();
}

function handleCommand(rawCommand) {
  if (!rawCommand || !engineInstance) return;
  const command = rawCommand.trim();

  try {
    if (command.startsWith('setoption name UCI_LimitStrength value')) {
      limitStrength = optionValue(command).toLowerCase() === 'true';
      applyTuning();
      return;
    }

    if (command.startsWith('setoption name UCI_Elo value')) {
      const elo = parseInteger(optionValue(command));
      if (elo !== null) targetElo = clamp(elo, 500, 3000);
      applyTuning();
      return;
    }

    if (command.startsWith('setoption name Personality value')) {
      const value = optionValue(command).toLowerCase();
      if (value === 'human' || value === 'solid' || value === 'aggressive') {
        personality = value;
        limitStrength = true;
      } else if (value === 'fullstrength' || value === 'full_strength') {
        personality = 'full_strength';
        limitStrength = false;
      } else {
        personality = 'aggressive';
        limitStrength = true;
      }
      applyTuning();
      return;
    }

    if (command.startsWith('setoption name Skill_Level value')) {
      const requestedSkill = parseInteger(optionValue(command));
      if (requestedSkill !== null) {
        const skill = clamp(requestedSkill, 1, FULL_STRENGTH_SKILL);
        if (skill === FULL_STRENGTH_SKILL) {
          personality = 'full_strength';
          limitStrength = false;
        } else {
          targetElo = SKILL_LEVELS[skill - 1] || targetElo;
          if (personality === 'full_strength') personality = 'human';
          limitStrength = true;
        }
      }
      applyTuning();
      return;
    }

    if (command.startsWith('setoption name MultiPV value')) {
      const requestedMultiPv = parseInteger(optionValue(command));
      if (requestedMultiPv !== null) {
        currentMultiPv = clamp(requestedMultiPv, 1, MAX_MULTI_PV);
      }
      syncEngineMultiPv();
      return;
    }

    if (command.startsWith('position')) {
      currentFen = extractFen(command);
      currentSearchCandidates = [];
      engineInstance.postMessage(command);
      return;
    }

    if (command.startsWith('go')) {
      currentSearchCandidates = [];
      const fullStrength = isFullStrength();
      const bounds = getEloSearchBounds(targetElo, fullStrength);
      const depthMatch = command.match(/\bdepth\s+(\d+)/);
      const requestedDepth = depthMatch ? Number(depthMatch[1]) : 0;
      const depth = fullStrength
        ? requestedDepth || bounds.depth
        : Math.min(bounds.depth, requestedDepth || bounds.depth);

      // Patricia resets MultiPV during its human search path, so restore it per search.
      syncEngineMultiPv();
      engineInstance.postMessage(`go depth ${depth} movetime ${bounds.movetime}`);
      return;
    }

    if (command === 'ucinewgame') {
      currentFen = '';
      currentSearchCandidates = [];
    }

    engineInstance.postMessage(command);
  } catch (error) {
    console.warn('[PatriciaWorker] Command failed:', command, error);
  }
}

function applyTuning() {
  if (!engineInstance) return;

  const skill = isFullStrength() ? FULL_STRENGTH_SKILL : eloToSkillLevel(targetElo);
  engineInstance.postMessage(`setoption name Skill_Level value ${skill}`);
  syncEngineMultiPv();
}

self.onmessage = (event) => {
  const data = event.data;
  const command = typeof data === 'string' ? data : data?.cmd;
  if (!command) return;

  if (!isReady || !engineInstance) pendingQueue.push(command);
  else handleCommand(command);
};

initEngine();
