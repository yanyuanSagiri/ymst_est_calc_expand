import GameDb from "../db/GameDb";
import StatCalculator from "./StatCalculator";
import ConstText from "../db/ConstText";
import StatBonus from "./StatBonus";
import StatBonusType from "./StatBonusType";
import ScoreCalculationType from "./ScoreCalculationType";
import LiveSimulator from "./LiveSimulator";
import Effect from "../effect/Effect";

import _, { CREATE_FRAGMENT } from "../createElement";
import removeAllChilds from "../removeAllChilds";
import CharacterStat from "../character/CharacterStat"

export default class ScoreCalculator {
  constructor(members, posters, accessories, extra) {
    this.members = members;
    this.posters = posters;
    this.accessories = accessories;
    this.extra = extra;
    this.passiveEffects = {
      album: [],
      poster: [],
      accessory: [],
      baseScoreUp: 0,
    };
    this.stat = new StatCalculator(this.members);

    this.properties = {
      company: [],
      attribute: [],
      companyMemberCount: {},
      companyMemberMaxCount: 0,
      attributeCount: {},
      attributeMaxCount: 0,
    };
    members.forEach((i) => {
      this.properties.company.push(i ? i.companyIdList : null);
      this.properties.attribute.push(i ? i.attributeList : null);
      i?.companyIdList.forEach((id) => {
        this.properties.companyMemberCount[id] ??= 0;
        this.properties.companyMemberCount[id]++;
      });
      i?.attributeList.forEach((id) => {
        this.properties.attributeCount[id] ??= 0;
        this.properties.attributeCount[id]++;
      });
    });
    this.properties.companyMemberMaxCount = Object.values(
      this.properties.companyMemberCount,
    ).reduce((max, c) => Math.max(max, c), 0);
    this.properties.attributeMaxCount = Object.values(
      this.properties.attributeCount,
    ).reduce((max, c) => Math.max(max, c), 0);
    // 双人卡统计所有剧团组合，取最小总剧团数
    const minimalCombinationCount = (list) => {
      const combinations = list.reduce(
        (acc, cur) => {
          const result = [];
          cur.forEach((id) => {
            acc.forEach((arr) => {
              result.push([...arr, id]);
            });
          });
          return result;
        },
        [[]],
      );
      return combinations
        .map((i) => new Set(i).size)
        .reduce((acc, cur) => Math.min(acc, cur), Infinity);
    };
    this.properties.companyCount = minimalCombinationCount(
      this.properties.company.filter((i) => i !== null),
    );
    // 双色卡两个颜色都算
    this.properties.attributeCount = new Set(
      this.properties.attribute
        .filter((i) => i !== null)
        .reduce((acc, cur) => acc.concat(cur), []),
    ).size;

    this.liveSim = new LiveSimulator(this, extra.notationId);
  }
  calc(node) {
    node && removeAllChilds(node);

    if (this.extra.type === ScoreCalculationType.Keiko) {
      this.extra.leader = this.members.find((i) => i);
    }
    const leader = this.extra.leader;
    if (!leader) {
      // 没有队长
      return;
    }
    this.liveSim.leader = leader;

    this.members.forEach((i) => i?.resetEffects());

    // highscore buff
    root.appState.highScoreBuffManager
      .currentActiveEffects()
      .forEach((effect) => {
        // 全部都是被动和开局效果
        const range = effect.Range === "All" ? 1 : 5;
        for (let idx = 0; idx < range; idx++) {
          if (!effect.canTrigger(this, idx)) return;
          effect.applyEffect(this, idx, StatBonusType.Other);
        }
      });

    const passiveEffects = this.passiveEffects;
    Object.values(GameDb.AlbumEffect)
      .reverse()
      .forEach((i) => {
        if (this.extra.albumLevel < i.Level) return;
        const effect = Effect.get(i.EffectMasterId, 1);
        if (!effect.canTrigger(this, -1)) return;
        passiveEffects.album.push({ effect, source: -1 });
      });
    const albumMemberTriggers = new Set([
      "CharacterBase",
      "Character",
      "Company",
      "Attribute",
      "SenseType",
      "CharacterBaseGroup",
    ]);
    this.extra.albumExtra.forEach((i) => {
      if (!i.enabled) return;
      const effect = i.effect;
      const hasMemberTrigger = effect.Triggers.some((t) =>
        albumMemberTriggers.has(t.Trigger),
      );
      if (hasMemberTrigger) {
        const targets = [];
        this.members.forEach((chara, idx) => {
          if (!chara) return;
          if (!effect.canTrigger(this, idx)) return;
          if (effect.FireTimingType !== "Passive" && targets.length) return;
          targets.push(idx);
        });
        if (targets.length === 0) return;
        const originalRange = effect.Range;
        if (originalRange === "All") effect.Range = "Self";
        targets.forEach((idx) =>
          effect.applyEffect(this, idx, StatBonusType.Album),
        );
        effect.Range = originalRange;
        return;
      }
      if (effect.Triggers.length === 0 || effect.canTrigger(this, -1)) {
        passiveEffects.album.push({ effect, source: -1 });
      }
    });
    passiveEffects.album.forEach((i) =>
      i.effect.applyEffect(this, i.source, StatBonusType.Album),
    );

    // chara
    this.liveSim.setStarActRequirements(leader.staract.actualRequirements);
    this.members.forEach((chara, idx) => {
      if (!chara) return;
      this.liveSim.skipSense[idx] = chara.data.CharacterBaseMasterId === 401;
      // 开花效果
      chara.bloomBonusEffects.forEach((effect) =>
        effect.applyEffect(this, idx, StatBonusType.Album),
      );

      // 海报效果
      const poster = this.posters[idx];
      poster?.abilities.forEach((ability) => {
        if (!ability.unlocked) return;
        if (ability.data.Type === "Leader" && this.members[idx] !== leader)
          return;
        const abilityEffectBranch = ability.getActiveBranch(this.liveSim);
        if (!abilityEffectBranch) return;
        abilityEffectBranch.BranchEffects.forEach((effect) => {
          effect = Effect.get(
            effect.EffectMasterId,
            ability.level + ability.release,
          );
          if (
            effect.FireTimingType !== "Passive" &&
            effect.FireTimingType !== "StartLive"
          )
            return;
          if (!effect.canTrigger(this, idx)) return;
          effect.applyEffect(this, idx, StatBonusType.Poster);
        });
      });

      // 饰品效果
      const accessory = this.accessories[idx];
      for (let effect of accessory?.mainEffects ?? []) {
        effect = effect.effect;
        if (
          effect.FireTimingType !== "Passive" &&
          effect.FireTimingType !== "StartLive"
        )
          continue;
        if (!effect.canTrigger(this, idx)) continue;
        effect.applyEffect(this, idx, StatBonusType.Accessory);
      }
      if (accessory?.randomEffect) {
        let effect = accessory.randomEffect.effect;
        if (
          effect.canTrigger(this, idx) &&
          (effect.FireTimingType === "Passive" ||
            effect.FireTimingType === "StartLive")
        ) {
          effect.applyEffect(this, idx, StatBonusType.Accessory);
        }
      }
    });
    this.liveSim.setStarActRequirements(leader.staract.actualRequirements);
    if (leader.staract.data.BranchCondition1 === "StorageSenseLightCount") {
      this.liveSim.maxStockCount =
        leader.staract.data.Branches.find((i) => i.JudgeType1 === "MoreThan")
          ?.Parameter1 ?? 0;
      this.liveSim.stockType = leader.staract.data.ConditionValue1;
    }

    if (this.extra.type !== ScoreCalculationType.Keiko) {
      const notationId =
        this.extra.notationId !== undefined
          ? this.extra.notationId
          : root.senseNoteSelect.value | 0;
      const notationBuffValue = this.members.map(_ => [0, 0, 0, 0])
      const notation = GameDb.SenseNotation[notationId];
      notation?.Buffs?.forEach((notationBuff) => {
        for (let i = 0; i < 5; i++) {
          if (!this.members[i]) continue;
          let isBuffTarget = false;
          switch (notationBuff.Type) {
            case "None": {
              isBuffTarget = true;
              break;
            }
            case "Attribute": {
              isBuffTarget = this.members[i].isCharacterAttribute(
                notationBuff.TargetValue,
              );
              break;
            }
            case "Company": {
              isBuffTarget = this.members[i].isCharacterInCompany(
                notationBuff.TargetValue,
              );
              break;
            }
            case "Character": {
              isBuffTarget = this.members[i].Id === notationBuff.TargetValue;
              break;
            }
          }
          if (notationBuff.TargetValue === undefined) {
            isBuffTarget = true;
          }
          if (isBuffTarget) {
            notationBuffValue[i][StatBonus[notationBuff.StatusType]] += notationBuff.BuffValue * 100
          }
        }
      });
      notationBuffValue.forEach((buff, i) => {
        if (!buff.some(i => i > 0)) return
        buff.forEach((buff, idx) => this.stat.buffAfterCalc[i][idx].push(buff))
      })
    }

    // leader sense
    this.memberMatchingCategories = this.members.map((_) => ({}));
    if (this.extra.type !== ScoreCalculationType.Keiko)
      leader.leaderSense.Details.forEach((detail) => {
        const effect = Effect.get(detail.EffectMasterId, 1);
        this.members.forEach((chara, idx) => {
          if (!chara) return;
          const charaCategories = chara.categories;
          const matchedCategories = [];
          for (let i = 0; i < detail.Conditions.length; i++) {
            for (let j = 1; j < 6; j++) {
              const testCategory = detail.Conditions[i][`CategoryMasterId${j}`];
              if (testCategory === undefined) break;
              if (charaCategories.indexOf(testCategory) === -1) {
                return;
              }
              matchedCategories.push(testCategory);
            }
          }

          matchedCategories.forEach(
            (category) => (this.memberMatchingCategories[idx][category] = true),
          );
          effect.applyEffect(this, idx, StatBonusType.Actor);
        });
      });

    // theater effect
    const theaterEffects = root.appState.theaterLevel.getEffects();
    theaterEffects.forEach((effect) =>
      effect.applyEffect(this, -1, StatBonusType.Theater),
    );

    let statExtra = 100;
    if (this.extra.starRankScoreBonus) {
      statExtra = 100 + this.extra.starRankScoreBonus * 30;
    }

    this.stat.calc();

    const baseScore = [0.95, 0.97, 1, 1.05].map((coef) =>
      Math.floor(
        Math.floor((this.stat.finalTotal * statExtra) / 100) *
          10 *
          (1 + passiveEffects.baseScoreUp / 10000) *
          coef,
      ),
    );
    const senseScore = [];
    const starActScore = [];

    this.result = {
      baseScore,
      senseScore,
      starActScore,
      starActCount: 0,
    };

    node?.appendChild(
      _("div", {}, [
        this.createStatDetailsTable(),
        _("span", { "data-text-key": "CALC_TOTAL_STAT" }),
        _("text", this.stat.finalTotal),
        _("br"),
        _("span", { "data-text-key": "CALC_BASE_SCORE" }),
        _(
          "text",
          `${baseScore[0]} / ${baseScore[1]} / ${baseScore[2]} / ${baseScore[3]}`,
        ),
      ]),
    );

    if (this.extra.type === ScoreCalculationType.Keiko) {
      // 250919
      // 每张卡发动一次sense，只加分
      const senseScoreNode = node?.appendChild(
        _("div", {}, [_("span", { "data-text-key": "CALC_SENSE_SCORE" })]),
      );
      const totalScoreNode = node?.appendChild(
        _("div", {}, [_("span", { "data-text-key": "CALC_TOTAL_SCORE" })]),
      );
      const senseLinesTable = node?.appendChild(_("table"));

      this.members.forEach((chara, idx) => {
        if (!chara) return;
        const multiplier = chara.sense.scoreUp;
        const finalStat = this.stat.final[idx].total;
        const score = Math.floor((finalStat * statExtra * multiplier) / 100);
        this.result.senseScore.push(score);
        senseLinesTable?.appendChild(
          _(
            "tr",
            { className: "live-log-phase" + (idx % 1 === 1 ? " odd-row" : "") },
            [
              _("td", {}, [
                _("div", {
                  className: "spriteatlas-characters",
                  "data-id": chara.cardIconId,
                }),
              ]),
              _("td", {}, [
                _(
                  "text",
                  `${finalStat} * ${statExtra}% * ${multiplier} = ${score}`,
                ),
              ]),
            ],
          ),
        );
      });

      if (!node) return;

      const finalSenseScore = this.result.senseScore.reduce(
        (acc, cur) => acc + cur,
        0,
      );
      senseScoreNode.appendChild(_("text", finalSenseScore));
      totalScoreNode.appendChild(
        _(
          "text",
          this.result.baseScore.map((i) => i + finalSenseScore).join(" / "),
        ),
      );

      ConstText.fillText();
      return;
    }

    if (this.members.some((i) => !i)) {
      return;
    }

    const senseScoreNode = node?.appendChild(
      _("div", {}, [_("span", { "data-text-key": "CALC_SENSE_SCORE" })]),
    );
    const starActScoreNode = node?.appendChild(
      _("div", {}, [_("span", { "data-text-key": "CALC_STARACT_SCORE" })]),
    );
    const totalScoreNode = node?.appendChild(
      _("div", {}, [_("span", { "data-text-key": "CALC_TOTAL_SCORE" })]),
    );

    this.liveSim.baseScore = baseScore[3];

    if (this.extra.skipSimulation) {
      this.liveSim.setStarActRequirements(leader.staract.actualRequirements);
      return;
    }

    node?.appendChild(
      _("div", {}, [
        _("div", {
          className: "spriteatlas-characters",
          "data-id": leader.cardIconId,
          style: { float: "left", margin: "0 5px 5px 0" },
        }),
        _("div", { "data-text-key": "CALC_STAR_ACT_REQUIREMENTS" }),
        ScoreCalculator.createStarActDisplay(this.liveSim.starActRequirements),
        _("div", { translate: "yes" }, [_("text", leader.leaderSense.desc)]),
        _("div", { style: { clear: "both" } }),
      ]),
    );

    const canceled = this.liveSim.runSimulation(node);
    if (canceled) return;

    let finalSenseScore = this.result.senseScore.reduce(
      (acc, cur) => acc + cur,
      0,
    );
    let finalStarActScore = this.result.starActScore.reduce(
      (acc, cur) => acc + cur,
      0,
    );
    senseScoreNode?.appendChild(_("text", finalSenseScore));
    starActScoreNode?.appendChild(
      _(
        "text",
        ConstText.get("CALC_RESULT_STARACT")
          .replace("{times}", this.result.starActCount)
          .replace("{score}", finalStarActScore),
      ),
    );
    totalScoreNode?.appendChild(
      _(
        "text",
        this.result.baseScore
          .map((i) => i + finalSenseScore + finalStarActScore)
          .join(" / "),
      ),
    );
    if (this.liveSim.scoreIsInaccurate) {
      totalScoreNode?.appendChild(_("br"));
      totalScoreNode?.appendChild(
        _("span", {
          "data-text-key": "LOG_WARNING_INACCURATE_SCORE_GAIN_ON_SCORE",
        }),
      );
    }

    ConstText.fillText();
  }
  calcPure() {
    if (this.extra.type === ScoreCalculationType.Keiko) {
      this.extra.leader = this.members.find((i) => i);
    }
    const leader = this.extra.leader;
    if (!leader) return;
    this.liveSim.leader = leader;

    this.members.forEach((i) => i?.resetEffects());

    (this.extra.highScoreEffects || []).forEach((effect) => {
      const range = effect.Range === "All" ? 1 : 5;
      for (let idx = 0; idx < range; idx++) {
        if (!effect.canTrigger(this, idx)) return;
        effect.applyEffect(this, idx, StatBonusType.Other);
      }
    });

    const passiveEffects = this.passiveEffects;
    Object.values(GameDb.AlbumEffect)
      .reverse()
      .forEach((i) => {
        if (this.extra.albumLevel < i.Level) return;
        const effect = Effect.get(i.EffectMasterId, 1);
        if (!effect.canTrigger(this, -1)) return;
        passiveEffects.album.push({ effect, source: -1 });
      });
    const albumMemberTriggers = new Set([
      "CharacterBase",
      "Character",
      "Company",
      "Attribute",
      "SenseType",
      "CharacterBaseGroup",
    ]);
    this.extra.albumExtra.forEach((i) => {
      if (!i.enabled) return;
      const effect = i.effect;
      const hasMemberTrigger = effect.Triggers.some((t) =>
        albumMemberTriggers.has(t.Trigger),
      );
      if (hasMemberTrigger) {
        const targets = [];
        this.members.forEach((chara, idx) => {
          if (!chara) return;
          if (!effect.canTrigger(this, idx)) return;
          if (effect.FireTimingType !== "Passive" && targets.length) return;
          targets.push(idx);
        });
        if (targets.length === 0) return;
        const originalRange = effect.Range;
        if (originalRange === "All") effect.Range = "Self";
        targets.forEach((idx) =>
          effect.applyEffect(this, idx, StatBonusType.Album),
        );
        effect.Range = originalRange;
        return;
      }
      if (effect.Triggers.length === 0 || effect.canTrigger(this, -1)) {
        passiveEffects.album.push({ effect, source: -1 });
      }
    });
    passiveEffects.album.forEach((i) =>
      i.effect.applyEffect(this, i.source, StatBonusType.Album),
    );

    this.liveSim.setStarActRequirements(leader.staract.actualRequirements);
    this.members.forEach((chara, idx) => {
      if (!chara) return;
      this.liveSim.skipSense[idx] = chara.data.CharacterBaseMasterId === 401;
      chara.bloomBonusEffects.forEach((effect) =>
        effect.applyEffect(this, idx, StatBonusType.Album),
      );

      const poster = this.posters[idx];
      poster?.abilities.forEach((ability) => {
        if (!ability.unlocked) return;
        if (ability.data.Type === "Leader" && this.members[idx] !== leader)
          return;
        const abilityEffectBranch = ability.getActiveBranch(this.liveSim);
        if (!abilityEffectBranch) return;
        abilityEffectBranch.BranchEffects.forEach((effect) => {
          effect = Effect.get(
            effect.EffectMasterId,
            ability.level + ability.release,
          );
          if (
            effect.FireTimingType !== "Passive" &&
            effect.FireTimingType !== "StartLive"
          )
            return;
          if (!effect.canTrigger(this, idx)) return;
          effect.applyEffect(this, idx, StatBonusType.Poster);
        });
      });

      const accessory = this.accessories[idx];
      for (let effect of accessory?.mainEffects ?? []) {
        effect = effect.effect;
        if (
          effect.FireTimingType !== "Passive" &&
          effect.FireTimingType !== "StartLive"
        )
          continue;
        if (!effect.canTrigger(this, idx)) continue;
        effect.applyEffect(this, idx, StatBonusType.Accessory);
      }
      if (accessory?.randomEffect) {
        let effect = accessory.randomEffect.effect;
        if (
          effect.canTrigger(this, idx) &&
          (effect.FireTimingType === "Passive" ||
            effect.FireTimingType === "StartLive")
        ) {
          effect.applyEffect(this, idx, StatBonusType.Accessory);
        }
      }
    });
    this.liveSim.setStarActRequirements(leader.staract.actualRequirements);
    if (leader.staract.data.BranchCondition1 === "StorageSenseLightCount") {
      this.liveSim.maxStockCount =
        leader.staract.data.Branches.find((i) => i.JudgeType1 === "MoreThan")
          ?.Parameter1 ?? 0;
      this.liveSim.stockType = leader.staract.data.ConditionValue1;
    }

    if (this.extra.type !== ScoreCalculationType.Keiko) {
      const notationId =
        this.extra.notationId !== undefined ? this.extra.notationId : 0;
      const notationBuffValue = this.members.map(_ => [0, 0, 0, 0])
      const notation = GameDb.SenseNotation[notationId];
      notation?.Buffs?.forEach((notationBuff) => {
        for (let i = 0; i < 5; i++) {
          if (!this.members[i]) continue;
          let isBuffTarget = false;
          switch (notationBuff.Type) {
            case "None": {
              isBuffTarget = true;
              break;
            }
            case "Attribute": {
              isBuffTarget = this.members[i].isCharacterAttribute(
                notationBuff.TargetValue,
              );
              break;
            }
            case "Company": {
              isBuffTarget = this.members[i].isCharacterInCompany(
                notationBuff.TargetValue,
              );
              break;
            }
            case "Character": {
              isBuffTarget = this.members[i].Id === notationBuff.TargetValue;
              break;
            }
          }
          if (notationBuff.TargetValue === undefined) isBuffTarget = true;
          if (isBuffTarget) {
            notationBuffValue[i][StatBonus[notationBuff.StatusType]] += notationBuff.BuffValue * 100
          }
        }
      });
      notationBuffValue.forEach((buff, i) => {
        if (!buff.some(i => i > 0)) return
        buff.forEach((buff, idx) => this.stat.buffAfterCalc[i][idx].push(buff))
      })
    }

    this.memberMatchingCategories = this.members.map((_) => ({}));
    if (this.extra.type !== ScoreCalculationType.Keiko)
      leader.leaderSense.Details.forEach((detail) => {
        const effect = Effect.get(detail.EffectMasterId, 1);
        this.members.forEach((chara, idx) => {
          if (!chara) return;
          const charaCategories = chara.categories;
          const matchedCategories = [];
          for (let i = 0; i < detail.Conditions.length; i++) {
            for (let j = 1; j < 6; j++) {
              const testCategory = detail.Conditions[i][`CategoryMasterId${j}`];
              if (testCategory === undefined) break;
              if (charaCategories.indexOf(testCategory) === -1) return;
              matchedCategories.push(testCategory);
            }
          }
          matchedCategories.forEach(
            (category) => (this.memberMatchingCategories[idx][category] = true),
          );
          effect.applyEffect(this, idx, StatBonusType.Actor);
        });
      });

    (this.extra.theaterEffects || []).forEach((effect) =>
      effect.applyEffect(this, -1, StatBonusType.Theater),
    );

    let statExtra = 100;
    if (this.extra.starRankScoreBonus) {
      statExtra = 100 + this.extra.starRankScoreBonus * 30;
    }

    this.stat.calc();

    const baseScore = [0.95, 0.97, 1, 1.05].map((coef) =>
      Math.floor(
        Math.floor((this.stat.finalTotal * statExtra) / 100) *
          10 *
          (1 + passiveEffects.baseScoreUp / 10000) *
          coef,
      ),
    );
    const senseScore = [];
    const starActScore = [];

    this.result = {
      baseScore,
      senseScore,
      starActScore,
      starActCount: 0,
    };

    if (this.extra.type === ScoreCalculationType.Keiko) {
      this.members.forEach((chara, idx) => {
        if (!chara) return;
        const multiplier = chara.sense.scoreUp;
        const finalStat = this.stat.final[idx].total;
        const score = Math.floor((finalStat * statExtra * multiplier) / 100);
        this.result.senseScore.push(score);
      });
      return;
    }

    if (this.members.some((i) => !i)) return;

    this.liveSim.baseScore = baseScore[3];

    if (this.extra.skipSimulation) {
      this.liveSim.setStarActRequirements(leader.staract.actualRequirements);
      return;
    }

    const canceled = this.liveSim.runSimulation(null);

    if (canceled && this.liveSim._delayedResult) {
      this.result = this.liveSim._delayedResult;
    } else {
      this.result.totalScore =
        baseScore[3] +
        this.result.senseScore.reduce((a, b) => a + b, 0) +
        this.result.starActScore.reduce((a, b) => a + b, 0);
    }
  }

  /**
   * 轻量级计算：只计算 starActCount，不计算分数
   * 用于自动配队的第一阶段筛选
   *
   * 与 calcPure() 的区别：
   * - 不计算 Sense/StarAct 的具体分数
   * - 只跟踪灯光收集和 StarAct 触发次数
   * - 跳过评分系数（coef）和最终得分计算
   */
  calcStarActCountOnly() {
    // ===== 阶段 1：确定队长 =====
    const leader = this.extra.leader;
    if (!leader) return 0; // 没有队长则无法演出
    this.liveSim.leader = leader;

    // ===== 阶段 2：重置角色效果 =====
    this.members.forEach((i) => i?.resetEffects());

    // ===== 阶段 3：设置初始 StarAct 参数（原始值，开花效果还没应用） =====
    // 先设置好，这样开花效果里增加初始灯光的逻辑可以正常工作
    this.liveSim.setStarActRequirements(leader.staract.requirements); // 用原始值，不是 actualRequirements
    // 储存型 StarAct：设置储存上限和储存灯光类型
    if (leader.staract.data.BranchCondition1 === "StorageSenseLightCount") {
      this.liveSim.maxStockCount =
        leader.staract.data.Branches.find((i) => i.JudgeType1 === "MoreThan")
          ?.Parameter1 ?? 0;
      this.liveSim.stockType = leader.staract.data.ConditionValue1;
    }

    // ===== 阶段 4：应用所有被动效果（开花、海报、饰品） =====
    this.members.forEach((chara, idx) => {
      if (!chara) return;
      // 标记跳过 Sense 的角色（角色ID 401 = 特殊机制角色）
      this.liveSim.skipSense[idx] = chara.data.CharacterBaseMasterId === 401;

      // 开花效果
      chara.bloomBonusEffects.forEach((effect) =>
        effect.applyEffect(this, idx, StatBonusType.Album),
      );

      // 海报效果
      const poster = this.posters[idx];
      poster?.abilities.forEach((ability) => {
        if (!ability.unlocked) return;
        // 队长专属海报只对队长生效
        if (ability.data.Type === "Leader" && this.members[idx] !== leader)
          return;
        // 获取当前条件下激活的分支效果
        const abilityEffectBranch = ability.getActiveBranch(this.liveSim);
        if (!abilityEffectBranch) return;
        abilityEffectBranch.BranchEffects.forEach((effect) => {
          effect = Effect.get(
            effect.EffectMasterId,
            ability.level + ability.release,
          );
          // 只应用被动效果和演出开始效果
          if (
            effect.FireTimingType !== "Passive" &&
            effect.FireTimingType !== "StartLive"
          )
            return;
          if (!effect.canTrigger(this, idx)) return;
          effect.applyEffect(this, idx, StatBonusType.Poster);
        });
      });

      // 饰品效果
      const accessory = this.accessories[idx];
      // 主效果
      for (let effect of accessory?.mainEffects ?? []) {
        effect = effect.effect;
        if (
          effect.FireTimingType !== "Passive" &&
          effect.FireTimingType !== "StartLive"
        )
          continue;
        if (!effect.canTrigger(this, idx)) continue;
        effect.applyEffect(this, idx, StatBonusType.Accessory);
      }
      // 随机效果
      if (accessory?.randomEffect) {
        let effect = accessory.randomEffect.effect;
        if (
          effect.canTrigger(this, idx) &&
          (effect.FireTimingType === "Passive" ||
            effect.FireTimingType === "StartLive")
        ) {
          effect.applyEffect(this, idx, StatBonusType.Accessory);
        }
      }
    });

    // ===== 阶段 5：更新 StarAct 需求（现在开花效果已经修改了 requireDecrease） =====
    this.liveSim.setStarActRequirements(leader.staract.actualRequirements);

    // ===== 阶段 6：设置默认面板数值 =====
    // 不执行完整的 stat.calc()，只给 stat.final 设置默认值（全 0）
    // 部分效果（ScoreGainOnPerformance 等）在 Sense 发动时会访问 stat.final，
    // 但 count-only 模式不关注具体分数，给默认值即可避免 TypeError
    this.stat.final = this.members.map(() => CharacterStat.Zero());
    this.stat.finalTotal = 0;

    // ===== 阶段 6：初始化结果对象 =====
    // starActCount 会在演出模拟中累加
    this.result = {
      baseScore: [0, 0, 0, 0],
      senseScore: [],
      starActScore: [],
      starActCount: 0,
    };

    // ===== 阶段 7：运行轻量级演出模拟 =====
    // 只计算灯光收集和 StarAct 触发，不计算具体分数
    this.liveSim.baseScore = 0;
    return this.liveSim.runSimulationCountOnly();
  }

  createStatDetailsTable() {
    let rowNumber;
    const buffPercentageDisplay = (stat, idx, j, type) => {
      let str = `${stat.buffFinal[idx][j][0][type] / 100}%`;
      if (stat.buffFinal[idx][j][0][type] < stat.buff[idx][j][0][type]) {
        str += ` (${stat.buff[idx][j][0][type] / 100}%)`;
      }
      return str;
    };
    return _(
      "div",
      {},
      this.members.map(
        (chara, idx) => (
          (rowNumber = 0),
          chara === null
            ? _("text", "")
            : _("details", {}, [
              _("summary", {}, [
                _("span", {
                  className: `card-attribute-${chara.attributeName}`,
                }),
                chara.secondaryAttributeName
                  ? _(CREATE_FRAGMENT, {}, [
                    _("text", "|"),
                    _("span", {
                      className: `card-attribute-${chara.secondaryAttributeName}`,
                    }),
                  ])
                  : new Comment(""),
                _(
                  "text",
                  `${chara.fullCardName} CT: ` +
                      chara.senseAll.map((i) => i.ct).join(" / "),
                ),
                _(
                  "span",
                  {},
                  Object.keys(this.memberMatchingCategories[idx]).map(
                    (category) =>
                      _("span", { className: "character-category" }, [
                        _("text", GameDb.Category[category].Name),
                      ]),
                  ),
                ),
              ]),
              _("table", { className: "stat-details" }, [
                _("thead", {}, [
                  _("tr", { className: rowNumber++ % 2 ? "odd-row" : "" }, [
                    _("th"),
                    _("th", { "data-text-key": "VOCAL" }, [
                      _("text", "歌唱力"),
                    ]),
                    _("th", { "data-text-key": "EXPRESSION" }, [
                      _("text", "表現力"),
                    ]),
                    _("th", { "data-text-key": "CONCENTRATION" }, [
                      _("text", "集中力"),
                    ]),
                    _("th", { "data-text-key": "PERFORMANCE" }, [
                      _("text", "演技力"),
                    ]),
                  ]),
                ]),
                _("tbody", {}, [
                  _("tr", { className: rowNumber++ % 2 ? "odd-row" : "" }, [
                    _("td", { "data-text-key": "CALC_TABLE_INITIAL" }, [
                      _("text", "初期値"),
                    ]),
                    _("td", { className: "stat-value" }, [
                      _("text", this.stat.initial[idx].vo),
                    ]),
                    _("td", { className: "stat-value" }, [
                      _("text", this.stat.initial[idx].ex),
                    ]),
                    _("td", { className: "stat-value" }, [
                      _("text", this.stat.initial[idx].co),
                    ]),
                    _("td", { className: "stat-value" }, [
                      _("text", this.stat.initial[idx].total),
                    ]),
                  ]),
                ]),
                _(
                  "tbody",
                  {},
                  [
                    "CALC_TABLE_ALBUM",
                    "CALC_TABLE_POSTER",
                    "CALC_TABLE_ACCESSORY",
                    "CALC_TABLE_ACTOR",
                    "CALC_TABLE_OTHER",
                  ].map((name, j) =>
                    _("tr", { className: rowNumber++ % 2 ? "odd-row" : "" }, [
                      _("td", { "data-text-key": name }, [_("text", name)]),
                      _("td", { className: "stat-value" }, [
                        _(
                          "text",
                          `${buffPercentageDisplay(this.stat, idx, j, StatBonus.Vocal)}\n+${this.stat.buffFinal[idx][j][1][StatBonus.Vocal]}\n${this.stat.bonus[idx][j].vo}`,
                        ),
                      ]),
                      _("td", { className: "stat-value" }, [
                        _(
                          "text",
                          `${buffPercentageDisplay(this.stat, idx, j, StatBonus.Expression)}\n+${this.stat.buffFinal[idx][j][1][StatBonus.Expression]}\n${this.stat.bonus[idx][j].ex}`,
                        ),
                      ]),
                      _("td", { className: "stat-value" }, [
                        _(
                          "text",
                          `${buffPercentageDisplay(this.stat, idx, j, StatBonus.Concentration)}\n+${this.stat.buffFinal[idx][j][1][StatBonus.Concentration]}\n${this.stat.bonus[idx][j].co}`,
                        ),
                      ]),
                      _("td", { className: "stat-value" }, [
                        _(
                          "text",
                          `${buffPercentageDisplay(this.stat, idx, j, StatBonus.Performance)}\n${this.stat.bonus[idx][j].total}`,
                        ),
                      ]),
                    ]),
                  ),
                ),
                _("tbody", {}, [
                  _("tr", { className: rowNumber++ % 2 ? "odd-row" : "" }, [
                    _("td", { "data-text-key": "CALC_TABLE_TOTAL_BONUS" }, [
                      _("text", "上昇合計"),
                    ]),
                    _("td", { className: "stat-value" }, [
                      _(
                        "text",
                        `${this.stat.buffFinal[idx][StatBonusType.Total][0][StatBonus.Vocal] / 100}%/${this.stat.buffLimit[idx][0][StatBonus.Vocal] / 100}%\n+${this.stat.buffFinal[idx][StatBonusType.Total][1][StatBonus.Vocal]}\n${this.stat.bonus[idx][StatBonusType.Total].vo}`,
                      ),
                    ]),
                    _("td", { className: "stat-value" }, [
                      _(
                        "text",
                        `${this.stat.buffFinal[idx][StatBonusType.Total][0][StatBonus.Expression] / 100}%/${this.stat.buffLimit[idx][0][StatBonus.Expression] / 100}%\n+${this.stat.buffFinal[idx][StatBonusType.Total][1][StatBonus.Expression]}\n${this.stat.bonus[idx][StatBonusType.Total].ex}`,
                      ),
                    ]),
                    _("td", { className: "stat-value" }, [
                      _(
                        "text",
                        `${this.stat.buffFinal[idx][StatBonusType.Total][0][StatBonus.Concentration] / 100}%/${this.stat.buffLimit[idx][0][StatBonus.Concentration] / 100}%\n+${this.stat.buffFinal[idx][StatBonusType.Total][1][StatBonus.Concentration]}\n${this.stat.bonus[idx][StatBonusType.Total].co}`,
                      ),
                    ]),
                    _("td", { className: "stat-value" }, [
                      _(
                        "text",
                        `${this.stat.buffFinal[idx][StatBonusType.Total][0][StatBonus.Performance] / 100}%/${this.stat.buffLimit[idx][0][StatBonus.Performance] / 100}%\n${this.stat.bonus[idx][StatBonusType.Total].total}`,
                      ),
                    ]),
                  ]),
                ]),
                this.stat.buffAfterCalc[idx].every((i) => i.length === 0)
                  ? new Comment("CALC_TABLE_EXTRA_UP")
                  : _("tbody", {}, [
                    _(
                      "tr",
                      { className: rowNumber++ % 2 ? "odd-row" : "" },
                      [
                        _(
                          "td",
                          { "data-text-key": "CALC_TABLE_EXTRA_UP" },
                          [_("text", "额外加成")],
                        ),
                        _("td", { className: "stat-value" }, [
                          _(
                            "text",
                            this.stat.buffAfterCalc[idx][StatBonus.Vocal]
                              .map((i) => `+${i / 100}%`)
                              .join("\n"),
                          ),
                        ]),
                        _("td", { className: "stat-value" }, [
                          _(
                            "text",
                            this.stat.buffAfterCalc[idx][
                              StatBonus.Expression
                            ]
                              .map((i) => `+${i / 100}%`)
                              .join("\n"),
                          ),
                        ]),
                        _("td", { className: "stat-value" }, [
                          _(
                            "text",
                            this.stat.buffAfterCalc[idx][
                              StatBonus.Concentration
                            ]
                              .map((i) => `+${i / 100}%`)
                              .join("\n"),
                          ),
                        ]),
                        _("td", { className: "stat-value" }, [
                          _(
                            "text",
                            this.stat.buffAfterCalc[idx][
                              StatBonus.Performance
                            ]
                              .map((i) => `+${i / 100}%`)
                              .join("\n"),
                          ),
                        ]),
                      ],
                    ),
                  ]),
                _("tbody", {}, [
                  _("tr", { className: rowNumber++ % 2 ? "odd-row" : "" }, [
                    _("td", { "data-text-key": "CALC_TABLE_FINAL_STAT" }, [
                      _("text", "最終値"),
                    ]),
                    _("td", { className: "stat-value" }, [
                      _("text", `${this.stat.final[idx].vo}`),
                    ]),
                    _("td", { className: "stat-value" }, [
                      _("text", `${this.stat.final[idx].ex}`),
                    ]),
                    _("td", { className: "stat-value" }, [
                      _("text", `${this.stat.final[idx].co}`),
                    ]),
                    _("td", { className: "stat-value" }, [
                      _("text", `${this.stat.final[idx].total}`),
                    ]),
                  ]),
                ]),
              ]),
            ])
        ),
      ),
    );
  }
  static createStarActDisplay(data, alwaysShow = false) {
    return _("span", {}, [
      _(
        "span",
        {
          className: "sense-star",
          style: { display: data[0] > 0 || alwaysShow ? "" : "none" },
          "data-sense-type": "support",
        },
        [_("text", data[0])],
      ),
      _(
        "span",
        {
          className: "sense-star",
          style: { display: data[1] > 0 || alwaysShow ? "" : "none" },
          "data-sense-type": "control",
        },
        [_("text", data[1])],
      ),
      _(
        "span",
        {
          className: "sense-star",
          style: { display: data[2] > 0 || alwaysShow ? "" : "none" },
          "data-sense-type": "amplification",
        },
        [_("text", data[2])],
      ),
      _(
        "span",
        {
          className: "sense-star",
          style: { display: data[3] > 0 || alwaysShow ? "" : "none" },
          "data-sense-type": "special",
        },
        [_("text", data[3])],
      ),
      _(
        "span",
        {
          className: "sense-star",
          style: { display: data[4] > 0 || alwaysShow ? "" : "none" },
          "data-sense-type": "variable",
        },
        [_("text", data[4])],
      ),
    ]);
  }
}
