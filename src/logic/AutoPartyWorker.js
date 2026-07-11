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
import {
  createAutoPartyPermutationPlan,
  resolveAutoPartyCombination,
} from "./AutoPartyPermutationPlanner.js";

ConstText.language = "zh";

const mockStarRank = new CharacterStarRankData();
globalThis.root = {
  appState: {
    characterStarRank: mockStarRank,
  },
  calcType: "normal",
  addWarningMessage: () => {},
};

const STATE = {
  isRunning: false,
  shouldStop: false,
};

self.onmessage = (e) => {
  const { type, data } = e.data;

  switch (type) {
    case "START_SEARCH":
      STATE.isRunning = true;
      STATE.shouldStop = false;
      runSearch(data).catch((err) => {
        console.error(`Worker fatal error:`, err);
        self.postMessage({
          type: "COMPLETE",
          data: { bestScore: -1, bestIndices: null, processed: 0, errors: 1 },
        });
      });
      break;
    case "STOP_SEARCH":
      STATE.shouldStop = true;
      break;
    case "GLOBAL_THRESHOLD":
      if (self._resolveThreshold) {
        self._resolveThreshold(data.threshold);
        self._resolveThreshold = null;
      }
      break;
  }
};

async function runSearch(params) {
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
    comboData,
  } = params;

  // 从 flat Uint32Array 解包组合
  let filteredCombinations = params.filteredCombinations || null;
  if (comboData) {
    const VALUES_PER_COMBO = 15;
    const comboCount = comboData.length / VALUES_PER_COMBO;
    filteredCombinations = new Array(comboCount);
    for (let i = 0; i < comboCount; i++) {
      const base = i * VALUES_PER_COMBO;
      filteredCombinations[i] = {
        charPerm: [
          comboData[base],
          comboData[base + 1],
          comboData[base + 2],
          comboData[base + 3],
          comboData[base + 4],
        ],
        posterPerm: [
          comboData[base + 5],
          comboData[base + 6],
          comboData[base + 7],
          comboData[base + 8],
          comboData[base + 9],
        ],
        accPerm: [
          comboData[base + 10],
          comboData[base + 11],
          comboData[base + 12],
          comboData[base + 13],
          comboData[base + 14],
        ],
      };
    }
    console.log(
      `Worker ${workerId}: unpacked ${comboCount} combos from flat array`,
    );
  }

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

  const highScoreEffects = (highScoreEffectData || []).map((ed) =>
    Effect.get(ed.id, ed.level),
  );

  const albumExtra = (albumExtraJson || []).map((ed) => {
    const pe = new PhotoEffectData(ed[0], ed[1], null, ed[2]);
    pe.effect = Effect.get(pe.data.EffectMasterId, pe.effectLevel);
    return pe;
  });

  const selChars = charactersJson.map((d) => {
    const c = CharacterData.fromJSON(d, null);
    c.senseAll.forEach((s) => {
      s.level = c.senselv;
    });
    if (c.awaken && c.data.AwakenStarActMasterId) {
      c.staract = new StarActData(c.data.AwakenStarActMasterId, c.bloom);
    } else {
      c.staract.level = c.bloom;
    }
    c.updateBloomBonus();
    c.resetEffects();
    c.bloomBonusEffects.forEach((effect) => {
      switch (effect.Type) {
        case "SenseRecastDown":
          return c.senseAll.forEach((i) =>
            i.recastDown.push(effect.activeEffect.Value),
          );
        case "DecreaseRequireSupportLight":
          return (c.staract.requireDecrease[0] += effect.activeEffect.Value);
        case "DecreaseRequireControlLight":
          return (c.staract.requireDecrease[1] += effect.activeEffect.Value);
        case "DecreaseRequireAmplificationLight":
          return (c.staract.requireDecrease[2] += effect.activeEffect.Value);
        case "DecreaseRequireSpecialLight":
          return (c.staract.requireDecrease[3] += effect.activeEffect.Value);
      }
    });
    return c;
  });
  const selPosters = postersJson.map((d) => {
    const p = PosterData.fromJSON(d, null);
    p.abilitiesData = Object.values(GameDb.PosterAbility).filter(
      (i) => i.PosterMasterId === p.id,
    );
    p.abilities = [];
    p.abilitiesData
      .filter((i) => i.Type === "Leader")
      .forEach((i) => {
        const ab = new PosterAbilityData(i.Id, null);
        ab.level = p.level;
        ab.release = p.release;
        p.abilities.push(ab);
      });
    p.abilitiesData
      .filter((i) => i.Type === "Normal")
      .forEach((i) => {
        const ab = new PosterAbilityData(i.Id, null);
        ab.level = p.level;
        ab.release = p.release;
        p.abilities.push(ab);
      });
    return p;
  });
  const selAccs = accessoriesJson.map((d) => {
    const acc = new AccessoryData(d[0], null);
    acc.level = d[1];
    acc.mainEffects.forEach((i) => {
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

  // GPU 预筛选的完整组合
  const characterBaseIds = selChars.map(
    (c) => c.data.CharacterBaseMasterId,
  );
  const posterRestrictGroupIds = selPosters.map(
    (p) => p.data?.OrganizeRestrictGroupId ?? 0,
  );

  let bestScore = -1;
  let bestIndices = null;
  let count = 0;
  let errorCount = 0;
  let lastReportTime = Date.now();

  if (filteredCombinations) {
    // ===== 预筛选模式：两阶段（SA 筛选 + 完整评分）=====
    const total = filteredCombinations.length;
    const chunkSize = Math.ceil(total / totalWorkers);
    const startIdx = workerId * chunkSize;
    const endIdx = Math.min(startIdx + chunkSize, total);
    const chunkTotal = endIdx - startIdx;

    console.log(
      `Worker ${workerId}: pre-filtered mode, ${chunkTotal} combinations, phase 1: SA counting`,
    );

    // 阶段 1：计算 starActCount
    const candidates = [];
    let localMaxSA = 0;

    for (let i = startIdx; i < endIdx && !STATE.shouldStop; i++) {
      const combo = filteredCombinations[i];
      const cp = combo.charPerm;
      const fullPosterIndices = combo.posterPerm;
      const ap = combo.accPerm;

      const members = cp.map((j) => selChars[j]);
      const leaderPos = cp.indexOf(leaderIdx);
      const posters = fullPosterIndices.map((j) => selPosters[j]);
      const accessories = ap.map((j) => selAccs[j]);

      try {
        const leader = members[leaderPos];
        if (!leader) {
          count++;
          continue;
        }

        const calcExtra = { ...extra, leader };
        const calc = new ScoreCalculator(
          members,
          posters,
          accessories,
          calcExtra,
        );
        LiveSimulator.saDelayLastTiming = null;
        const sa = calc.calcStarActCountOnly();

        candidates.push({ sa, combo });
        if (sa > localMaxSA) localMaxSA = sa;
      } catch (err) {
        errorCount++;
        if (errorCount <= 5)
          console.error("calcStarActCountOnly error:", err.message);
      }

      count++;
      const now = Date.now();
      if (now - lastReportTime > 200) {
        self.postMessage({
          type: "PROGRESS",
          data: {
            current: count,
            total: chunkTotal,
            bestScore: 0,
            errorCount,
            phase: "counting",
          },
        });
        lastReportTime = now;
      }
    }

    self.postMessage({
      type: "PROGRESS",
      data: {
        current: count,
        total: chunkTotal,
        bestScore: 0,
        errorCount,
        phase: "counting",
      },
    });

    // 报告本地 maxSA，等待全局阈值
    self.postMessage({
      type: "PHASE1_DONE",
      data: { maxSA: localMaxSA, candidateCount: candidates.length },
    });

    const globalThreshold = await new Promise((resolve) => {
      self._resolveThreshold = resolve;
    });

    // 阶段 2：筛选 + 完整评分
    const filtered = candidates.filter((c) => c.sa >= globalThreshold);
    count = 0;
    lastReportTime = Date.now();

    console.log(
      `Worker ${workerId}: phase 2, threshold=${globalThreshold}, scoring ${filtered.length}/${candidates.length}`,
    );

    for (const { combo } of filtered) {
      if (STATE.shouldStop) break;

      const cp = combo.charPerm;
      const fullPosterIndices = combo.posterPerm;
      const ap = combo.accPerm;

      const members = cp.map((j) => selChars[j]);
      const leaderPos = cp.indexOf(leaderIdx);
      const posters = fullPosterIndices.map((j) => selPosters[j]);
      const accessories = ap.map((j) => selAccs[j]);

      try {
        const leader = members[leaderPos];
        if (!leader) {
          count++;
          continue;
        }

        const calcExtra = { ...extra, leader };
        const calc = new ScoreCalculator(
          members,
          posters,
          accessories,
          calcExtra,
        );
        LiveSimulator.saDelayLastTiming = null;
        calc.calcPure();

        if (calc.result) {
          const totalScore =
            calc.result.totalScore ||
            calc.result.baseScore[3] +
              calc.result.senseScore.reduce((a, b) => a + b, 0) +
              calc.result.starActScore.reduce((a, b) => a + b, 0);

          if (totalScore > bestScore) {
            bestScore = totalScore;
            bestIndices = {
              charIndices: cp,
              posterIndices: fullPosterIndices,
              accIndices: ap,
            };
          }
        }
      } catch (err) {
        errorCount++;
        if (errorCount <= 5) console.error("calcPure error:", err.message);
      }

      count++;
      const now = Date.now();
      if (now - lastReportTime > 200) {
        self.postMessage({
          type: "PROGRESS",
          data: {
            current: count,
            total: filtered.length,
            bestScore,
            errorCount,
            phase: "scoring",
          },
        });
        lastReportTime = now;
      }
    }
    self.postMessage({
      type: "PROGRESS",
      data: {
        current: count,
        total: count,
        bestScore,
        errorCount,
        phase: "scoring",
      },
    });
  } else {
    // ===== CPU 模式：两阶段筛选 =====
    const plan = createAutoPartyPermutationPlan({
      characterCount: selChars.length,
      posterCount: selPosters.length,
      accessoryCount: selAccs.length,
      leaderIdx,
      leaderPosterIdx,
      constraints: params.constraints,
      characterBaseIds,
      posterRestrictGroupIds,
    });

    const total = plan.totalCombinations;
    self.postMessage({
      type: "PLAN_READY",
      data: { totalCombinations: total },
    });
    const chunkSize = Math.ceil(total / totalWorkers);
    const startIdx = Math.min(workerId * chunkSize, total);
    const endIdx = Math.min(startIdx + chunkSize, total);

    console.log(`Worker ${workerId}: CPU two-phase mode`, {
      groups: plan.groups.length,
      accessoryPermutations: plan.accessoryPermutations.length,
      total,
      chunkStart: startIdx,
      chunkEnd: endIdx,
    });

    // 两阶段筛选：第一阶段计算 starActCount，第二阶段计算完整分数
    const candidates = [];

    for (let i = startIdx; i < endIdx && !STATE.shouldStop; i++) {
      const combination = resolveAutoPartyCombination(plan, i);
      const cp = combination.charPerm;
      const pp = combination.posterPerm;
      const ap = combination.accPerm;

      const members = cp.map((j) => selChars[j]);
      const leaderPos = combination.leaderPosition;
      const posters = pp.map((j) => selPosters[j]);
      const accessories = ap.map((j) => selAccs[j]);

      try {
        const leader = members[leaderPos];
        if (!leader) {
          count++;
          continue;
        }

        const calcExtra = { ...extra, leader };
        const calc = new ScoreCalculator(
          members,
          posters,
          accessories,
          calcExtra,
        );
        LiveSimulator.saDelayLastTiming = null;
        const starActCount = calc.calcStarActCountOnly();

        candidates.push({
          starActCount,
          index: i,
        });
      } catch (err) {
        errorCount++;
        if (errorCount <= 5)
          console.error("calcStarActCountOnly error:", err.message);
      }

      count++;
      const now = Date.now();
      if (now - lastReportTime > 200) {
        self.postMessage({
          type: "PROGRESS",
          data: {
            current: count,
            total: endIdx - startIdx,
            bestScore: 0,
            errorCount,
            phase: "counting",
          },
        });
        lastReportTime = now;
      }
    }

    // 报告 maxSA 给 pool，等待全局阈值
    self.postMessage({
      type: "PROGRESS",
      data: {
        current: count,
        total: endIdx - startIdx,
        bestScore: 0,
        errorCount,
        phase: "counting",
      },
    });

    const localMaxSA = candidates.reduce(
      (m, c) => Math.max(m, c.starActCount),
      0,
    );
    self.postMessage({
      type: "PHASE1_DONE",
      data: { maxSA: localMaxSA, candidateCount: candidates.length },
    });

    // 等待 pool 广播全局阈值
    const globalThreshold = await new Promise((resolve) => {
      self._resolveThreshold = resolve;
    });

    const filtered = candidates.filter(
      (c) => c.starActCount >= globalThreshold,
    );

    count = 0;
    lastReportTime = Date.now();
    for (const candidate of filtered) {
      if (STATE.shouldStop) break;

      const combination = resolveAutoPartyCombination(plan, candidate.index);
      const cp = combination.charPerm;
      const pp = combination.posterPerm;
      const ap = combination.accPerm;

      const members = cp.map((j) => selChars[j]);
      const leaderPos = combination.leaderPosition;
      const posters = pp.map((j) => selPosters[j]);
      const accessories = ap.map((j) => selAccs[j]);

      try {
        const leader = members[leaderPos];
        if (!leader) {
          count++;
          continue;
        }

        const calcExtra = { ...extra, leader };
        const calc = new ScoreCalculator(
          members,
          posters,
          accessories,
          calcExtra,
        );
        LiveSimulator.saDelayLastTiming = null;
        calc.calcPure();

        if (calc.result) {
          const totalScore =
            calc.result.totalScore ||
            calc.result.baseScore[3] +
              calc.result.senseScore.reduce((a, b) => a + b, 0) +
              calc.result.starActScore.reduce((a, b) => a + b, 0);

          if (totalScore > bestScore) {
            bestScore = totalScore;
            bestIndices = {
              charIndices: [...cp],
              posterIndices: [...pp],
              accIndices: [...ap],
            };
          }
        }
      } catch (err) {
        errorCount++;
        if (errorCount <= 5) console.error("calcPure error:", err.message);
      }

      count++;
      const now = Date.now();
      if (now - lastReportTime > 200) {
        self.postMessage({
          type: "PROGRESS",
          data: {
            current: count,
            total: filtered.length,
            bestScore,
            errorCount,
            phase: "scoring",
          },
        });
        lastReportTime = now;
      }
    }
    self.postMessage({
      type: "PROGRESS",
      data: {
        current: count,
        total: filtered.length,
        bestScore,
        errorCount,
        phase: "scoring",
      },
    });
  }

  console.log(`Worker ${workerId}: precise search done`, {
    bestScore,
    processed: count,
    errors: errorCount,
    hasResult: !!bestIndices,
  });

  self.postMessage({
    type: "COMPLETE",
    data: {
      bestScore,
      bestIndices,
      processed: count,
      errors: errorCount,
    },
  });
  STATE.isRunning = false;
}
