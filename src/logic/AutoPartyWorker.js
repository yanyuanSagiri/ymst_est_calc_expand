import "./WorkerPolyfill.js";
import CharacterData from "../character/CharacterData.js";
import PosterData from "../poster/PosterData.js";
import PosterAbilityData from "../poster/PosterAbilityData.js";
import AccessoryData from "../accessory/AccessoryData.js";
import AccessoryEffectData from "../accessory/AccessoryEffectData.js";
import ScoreCalculator from "./ScoreCalculator.js";
import ScoreCalculationType from "./ScoreCalculationType.js";
import LiveSimulator from "./LiveSimulator.js";
import PhotoEffectData from "../manager/PhotoEffectData.js";
import Effect from "../effect/Effect.js";
import ConstText from "../db/ConstText.js";
import GameDb from "../db/GameDb.js";
import CharacterStarRankData from "../character/CharacterStarRankData.js";
import StarActData from "../character/StarActData.js";
import TheaterLevelData from "../manager/TheaterLevelData.js";

ConstText.language = 'zh';

const mockStarRank = new CharacterStarRankData();
globalThis.root = {
  appState: {
    characterStarRank: mockStarRank,
  },
  calcType: 'normal',
  addWarningMessage: () => {},
};

const STATE = {
  isRunning: false,
  shouldStop: false
};

self.onmessage = (e) => {
  const { type, data } = e.data;

  switch (type) {
    case 'START_SEARCH':
      STATE.isRunning = true;
      STATE.shouldStop = false;
      runSearch(data);
      break;
    case 'STOP_SEARCH':
      STATE.shouldStop = true;
      break;
  }
};

function runSearch(params) {
  const {
    charactersJson,
    postersJson,
    accessoriesJson,
    leaderIdx,
    leaderPosterIdx,
    workerId,
    totalWorkers,
    starRankData,
    albumLevel,
    albumExtraJson,
    highScoreEffectData,
    theaterLevelData,
    notationId,
    gameDbData,
  } = params;

  Object.entries(starRankData).forEach(([id, rank]) => {
    mockStarRank.set(Number(id), rank);
  });

  if (gameDbData) {
    Object.entries(gameDbData).forEach(([key, value]) => {
      if (GameDb[key] !== undefined) GameDb[key] = value;
    });
  }

  const theaterLevel = TheaterLevelData.fromJSON(theaterLevelData);
  const theaterEffects = theaterLevel.getEffects();

  const highScoreEffects = (highScoreEffectData || []).map(ed => Effect.get(ed.id, ed.level));

  const albumExtra = (albumExtraJson || []).map(ed => {
    const pe = new PhotoEffectData(ed[0], ed[1], null, ed[2]);
    pe.effect = Effect.get(pe.data.EffectMasterId, pe.effectLevel);
    return pe;
  });

  const selChars = charactersJson.map(d => {
    const c = CharacterData.fromJSON(d, null);
    c.senseAll.forEach(s => { s.level = c.senselv; });
    if (c.awaken && c.data.AwakenStarActMasterId) {
      c.staract = new StarActData(c.data.AwakenStarActMasterId, c.bloom);
    } else {
      c.staract.level = c.bloom;
    }
    c.updateBloomBonus();
    c.resetEffects();
    c.bloomBonusEffects.forEach(effect => {
      switch (effect.Type) {
        case 'SenseRecastDown': return c.senseAll.forEach(i => i.recastDown.push(effect.activeEffect.Value));
        case 'DecreaseRequireSupportLight': return c.staract.requireDecrease[0] += effect.activeEffect.Value;
        case 'DecreaseRequireControlLight': return c.staract.requireDecrease[1] += effect.activeEffect.Value;
        case 'DecreaseRequireAmplificationLight': return c.staract.requireDecrease[2] += effect.activeEffect.Value;
        case 'DecreaseRequireSpecialLight': return c.staract.requireDecrease[3] += effect.activeEffect.Value;
      }
    });
    return c;
  });
  const selPosters = postersJson.map(d => {
    const p = PosterData.fromJSON(d, null);
    p.abilitiesData = Object.values(GameDb.PosterAbility).filter(i => i.PosterMasterId === p.id);
    p.abilities = [];
    p.abilitiesData.filter(i => i.Type === 'Leader').forEach(i => {
      const ab = new PosterAbilityData(i.Id, null);
      ab.level = p.level;
      ab.release = p.release;
      p.abilities.push(ab);
    });
    p.abilitiesData.filter(i => i.Type === 'Normal').forEach(i => {
      const ab = new PosterAbilityData(i.Id, null);
      ab.level = p.level;
      ab.release = p.release;
      p.abilities.push(ab);
    });
    return p;
  });
  const selAccs = accessoriesJson.map(d => {
    const acc = new AccessoryData(d[0], null);
    acc.level = d[1];
    acc.mainEffects.forEach(i => {
      i.level = acc.level;
      i.effect.level = acc.level;
    });
    if (d[2] && acc.data.RandomEffectGroups.length > 0) {
      acc.randomEffectId = String(d[2]);
      acc.randomEffect = new AccessoryEffectData(acc.randomEffectId, null);
      acc.randomEffect.level = acc.level;
      acc.randomEffect.effect.level = acc.level;
    }
    return acc;
  });

  const extra = {
    albumLevel: albumLevel || 0,
    albumExtra: albumExtra,
    leader: null,
    type: ScoreCalculationType.Normal,
    notationId: notationId !== undefined ? notationId : 0,
    highScoreEffects: highScoreEffects,
    theaterEffects: theaterEffects,
  };

  const charPerms = [];
  const permuteChars = (arr, current) => {
    if (current.length === 5) { charPerms.push(current); return; }
    for (let i = 0; i < arr.length; i++) permuteChars(arr.filter((_, j) => j !== i), [...current, arr[i]]);
  };
  permuteChars(selChars.map((_, i) => i), []);

  const posterIndices = selPosters.map((_, i) => i).filter(i => i !== leaderPosterIdx);
  const posterSlots = leaderPosterIdx === -1 ? 5 : 4;
  const posterPerms = [];
  const permutePosters = (arr, current) => {
    if (current.length === posterSlots) { posterPerms.push(current); return; }
    for (let i = 0; i < arr.length; i++) permutePosters(arr.filter((_, j) => j !== i), [...current, arr[i]]);
  };
  permutePosters(posterIndices, []);

  const accPerms = [];
  const permuteAccs = (arr, current) => {
    if (current.length === 5) { accPerms.push(current); return; }
    for (let i = 0; i < arr.length; i++) permuteAccs(arr.filter((_, j) => j !== i), [...current, arr[i]]);
  };
  permuteAccs(selAccs.map((_, i) => i), []);

  const total = charPerms.length * posterPerms.length * accPerms.length;
  const chunkSize = Math.ceil(total / totalWorkers);
  const startIdx = workerId * chunkSize;
  const endIdx = Math.min(startIdx + chunkSize, total);

  console.log(`Worker ${workerId}: precise search`, {
    charPerms: charPerms.length,
    posterPerms: posterPerms.length,
    accPerms: accPerms.length,
    total,
    chunkStart: startIdx,
    chunkEnd: endIdx,
  });

  let bestScore = -1;
  let bestIndices = null;
  let count = 0;
  let errorCount = 0;
  let lastReportTime = Date.now();

  for (let i = startIdx; i < endIdx && !STATE.shouldStop; i++) {
    const cpIdx = Math.floor(i / (posterPerms.length * accPerms.length));
    const remaining = i % (posterPerms.length * accPerms.length);
    const ppIdx = Math.floor(remaining / accPerms.length);
    const acIdx = remaining % accPerms.length;

    const cp = charPerms[cpIdx];
    const pp = posterPerms[ppIdx];
    const ap = accPerms[acIdx];

    if (!isPosterPermValid(pp, leaderPosterIdx, selPosters)) {
      count++;
      continue;
    }

    const members = cp.map(j => selChars[j]);
    const leaderPos = cp.indexOf(leaderIdx);

    const posters = pp.map(j => selPosters[j]);
    if (leaderPosterIdx >= 0) {
      posters.splice(leaderPos, 0, selPosters[leaderPosterIdx]);
    }

    const accessories = ap.map(j => selAccs[j]);

    try {
      const leader = members[leaderPos];
      if (!leader) { count++; continue; }

      const calcExtra = { ...extra, leader };
      const calc = new ScoreCalculator(members, posters, accessories, calcExtra);
      LiveSimulator.saDelayLastTiming = null;
      calc.calcPure();

      if (calc.result) {
        const totalScore = calc.result.totalScore ||
          (calc.result.baseScore[3] +
            calc.result.senseScore.reduce((a, b) => a + b, 0) +
            calc.result.starActScore.reduce((a, b) => a + b, 0));

        if (totalScore > bestScore) {
          bestScore = totalScore;
          bestIndices = { charIndices: cp, posterIndices: pp.map(j => leaderPosterIdx >= 0 && j >= leaderPosterIdx ? j + 1 : j), accIndices: ap };
        }
      }
    } catch (err) {
      errorCount++;
      if (errorCount <= 5) console.error("calcPure error:", err.message, err.stack?.split('\n')[1]);
    }

    count++;
    const now = Date.now();
    if (now - lastReportTime > 200) {
      self.postMessage({ type: 'PROGRESS', data: { current: count, total: endIdx - startIdx, bestScore, errorCount } });
      lastReportTime = now;
    }
  }

  console.log(`Worker ${workerId}: precise search done`, { bestScore, processed: count, errors: errorCount, hasResult: !!bestIndices });

  self.postMessage({
    type: 'COMPLETE',
    data: {
      bestScore,
      bestIndices,
      processed: count,
      errors: errorCount,
    }
  });
  STATE.isRunning = false;
}

function isPosterPermValid(posterPerm, leaderPosterIdx, allPosters) {
  const usedRestrictGroups = new Set();
  if (leaderPosterIdx >= 0) {
    const leaderRestrictId = allPosters[leaderPosterIdx]?.data?.OrganizeRestrictGroupId;
    if (leaderRestrictId) usedRestrictGroups.add(leaderRestrictId);
  }
  for (let i = 0; i < posterPerm.length; i++) {
    const idx = posterPerm[i];
    if (idx < 0) continue;
    const restrictId = allPosters[idx]?.data?.OrganizeRestrictGroupId;
    if (restrictId) {
      if (usedRestrictGroups.has(restrictId)) return false;
      usedRestrictGroups.add(restrictId);
    }
  }
  return true;
}
