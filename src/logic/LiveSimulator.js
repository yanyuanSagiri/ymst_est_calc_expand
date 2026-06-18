import GameDb from "../db/GameDb";
import ConstText from "../db/ConstText";
import Effect from "../effect/Effect";

import _ from "../createElement";
import ScoreBonusType from "./ScoreBonusType";
import { SenseTypeInternalEnum } from "../db/Enum";
import removeAllChilds from "../removeAllChilds";
import ScoreCalculator from "./ScoreCalculator";

export default class LiveSimulator {
  /**
   * @type {ScoreCalculator}
   */
  calc;
  /**
   * @type {number[]}
   * @description sense发动冷却
   */
  senseCt;
  senseTiming;
  /**
   * @type {number[]}
   * @description sense上次发动时间
   */
  lastSenseTime;
  skipSense;
  /**
   * @type {number}
   * @description 基础分（海报按当前分加分计算用，反正在不拿谱面的情况下算不准，为了简化计算只存stella分数）
   */
  baseScore;
  starActRequirements;
  starActCurrent;
  life;
  lifeGuardCount;
  pGauge;
  pGaugeLimit;
  pGaugeBonus;
  phase;
  phaseLog;
  pendingActions;
  currentTiming;
  lastSenseTiming;
  activeBuff;
  senseExtraAmount;
  senseExtraLights;
  overflownLightCount;
  newLightCurrentStep;
  wrongLightToSpAmount;
  holdingLights;
  holdingStockLights;
  maxStockCount;
  stockType;
  performanceDuplicateUp;
  combinationSenseList;
  isDuringCombinationSense;
  scoreIsInaccurate;
  senseScoreIndex;
  starActScoreIndex;
  static saDelayLastTiming;

  constructor(calc, notationId) {
    this.calc = calc;
    this.senseBox = calc.extra.senseBoxRef || root.senseBox;
    const id =
      notationId !== undefined ? notationId : root.senseNoteSelect.value | 0;
    this.senseTiming = GameDb.SenseNotation[id];
    if (!this.senseTiming) throw new Error("Sense timeline not found");
    this.senseTiming = this.senseTiming.Details.slice();
    this.senseTiming.sort((a, b) => a.TimingSecond - b.TimingSecond);
    this.skipSense = new Array(5).fill(false);
    this.baseScore = 0;
    this.life = 1000;
    this.lifeGuardCount = 0;
    this.pGauge = 0;
    this.pGaugeLimit = 1000;
    this.pGaugeBonus = [0, 0, 0, 0, 0];
    this.phase = ConstText.get("LIVE_PHASE_START");
    this.phaseLog = [];
    this.pendingActions = [];
    this.currentTiming = 0;
    this.lastSenseTiming =
      this.senseTiming[this.senseTiming.length - 1].TimingSecond;
    this.activeBuff = { sense: [], starAct: [] };
    this.starActCurrent = [0, 0, 0, 0, 0, 0];
    this.senseExtraAmount = [0, 0, 0, 0, 0];
    this.senseExtraLights = [[], [], [], [], []];
    this.overflownLightCount = 0;
    this.newLightCurrentStep = new Array(5)
      .fill(0)
      .map((_) => new Array(5).fill(0));
    this.wrongLightToSpAmount = [0, 0, 0, 0, 0];
    this.holdingLights = [];
    this.holdingStockLights = [];
    this.maxStockCount = 0;
    this.stockType = -1;
    this.starActRequiredCount = 0;
    this.performanceDuplicateUp = [0, 0, 0, 0, 0];
    this.combinationSenseList = [[], [], [], [], []];
    this.isDuringCombinationSense = false;
    this.scoreIsInaccurate = false;
    this.senseScoreIndex = [[], [], [], [], []];
    this.starActScoreIndex = [];
    this.scoreTimeline = [];
  }
  prepare(node) {
    this.applyPendingActions();
    if (this.senseBox && this.senseBox.children.length >= 5) {
      Array.from(
        this.senseBox.querySelectorAll(".sense-add-light,.staract-line"),
      ).forEach((i) => i.remove());
    }
    this.senseCt = this.calc.members.map((chara) =>
      chara ? chara.senseAll.map((i) => i.ct) : 0,
    );
    this.lastSenseTime = this.calc.members.map((chara) =>
      chara?.senseAll.map(() => -Infinity),
    );
    for (let i = 0; i < 5; i++) {
      const startExtraLight = [];
      this.newLightCurrentStep[i].forEach((amount, lightType) => {
        for (let j = 0; j < amount; j++) {
          startExtraLight.push(SenseTypeInternalEnum[lightType]);
        }
      });
      if (
        this.senseBox &&
        this.senseBox.children[i] &&
        this.senseBox.children[i].children[0] &&
        this.senseBox.children[i].children[0].children[0]
      ) {
        const container = this.senseBox.children[i].children[0].children[0];
        removeAllChilds(container);
        if (startExtraLight.length) {
          container.style.marginTop = `calc(50% - 3px - ${startExtraLight.length * 5}px)`;
          startExtraLight.forEach((lightType) => {
            container.appendChild(
              _("div", {
                className: "sense-add-light",
                "data-sense-type": lightType.toLowerCase(),
                style: { position: "initial" },
              }),
            );
          });
        }
      }

      // combination sense
      const combinationSenseEffects =
        this.calc.members[i].sense.getCombinationSenseEffects(this);
      combinationSenseEffects.forEach((combinationSenseEffect) => {
        const conditionMap = combinationSenseEffect.Conditions.reduce(
          (acc, cur) => {
            acc[cur.Condition] = cur.Value;
            return acc;
          },
          {},
        );
        const distance = conditionMap.NeighborPosition;
        const targetCharaId = conditionMap.CharacterBase;
        const top = Math.max(0, i - distance);
        const bottom = Math.min(4, i + distance);
        for (let j = top; j <= bottom; j++) {
          if (j === i) continue;
          if (this.calc.members[j].isCharacterBaseId(targetCharaId)) {
            this.combinationSenseList[j].push(i);
          }
        }
      });
    }
    let lights = this.getHoldingLightsElement();
    if (this.tryStarAct()) {
      this.phase = ConstText.get("LIVE_PHASE_START_WITH_STARACT");
      this.resetCurrentLights();
    }
    node?.appendChild(
      _("details", { className: "live-log-phase odd-row" }, [
        _("summary", {}, [
          _("text", this.phase),
          _("br"),
          lights,
          this.getPGaugeProgressElement(),
          this.getLifeGaugeElement(),
        ]),
        _("text", this.phaseLog.join("\n")),
      ]),
    );

    this._oddRow = false;
    this._saLastTiming = -1;
  }

  processTiming(timing, node) {
    this.currentTiming = timing.TimingSecond;
    this.currentSenseType = "none";
    this.purgeExpiredBuff(timing.TimingSecond);
    this.phase = ConstText.get("LIVE_PHASE_SENSE").replace(
      "{time}",
      timing.TimingSecond,
    );
    this.phaseLog = [];
    let timelineNode = null;
    if (
      this.senseBox &&
      this.senseBox.children[timing.Position - 1] &&
      this.senseBox.children[timing.Position - 1].children[1]
    ) {
      timelineNode =
        this.senseBox.children[timing.Position - 1].children[1].children[
          this.senseTiming
            .filter((i) => i.Position === timing.Position)
            .indexOf(timing)
        ];
    }
    if (timelineNode) {
      timelineNode.classList.remove("failed");
      timelineNode.dataset.senseType = "";
    }
    if (!this.trySense(timing, timelineNode)) {
      this.phase = ConstText.get("LIVE_PHASE_SENSE_FAILED").replace(
        "{time}",
        timing.TimingSecond,
      );
      this.resetCurrentLights();

      if (timelineNode) {
        timelineNode.classList.add("failed");
      }
    }

    const lights = this.getHoldingLightsElement();
    if (this.tryStarAct()) {
      this.phase = ConstText.get("LIVE_PHASE_SENSE_WITH_STARACT").replace(
        "{time}",
        timing.TimingSecond,
      );
      this.resetCurrentLights();
      this._saLastTiming = timing.TimingSecond;
    }
    node?.appendChild(
      _(
        "details",
        { className: "live-log-phase" + (this._oddRow ? " odd-row" : "") },
        [
          _(
            "summary",
            {
              className: "sense-star",
              "data-sense-type": this.currentSenseType,
            },
            [
              _("text", this.phase),
              _("br"),
              lights,
              this.getPGaugeProgressElement(),
              this.getLifeGaugeElement(),
            ],
          ),
          _("table", {}, [
            _("tr", { style: { verticalAlign: "top" } }, [
              _("td", {}, [
                _("div", {
                  className: "spriteatlas-characters",
                  "data-id": this.calc.members[timing.Position - 1].cardIconId,
                }),
              ]),
              _("td", {}, [_("text", this.phaseLog.join("\n"))]),
            ]),
          ]),
        ],
      ),
    );

    this.scoreTimeline.push({
      time: timing.TimingSecond,
      position: timing.Position,
      cumulativeSenseScore: this.calc.result.senseScore.reduce(
        (acc, cur) => acc + cur,
        0,
      ),
      cumulativeStarActScore: this.calc.result.starActScore.reduce(
        (acc, cur) => acc + cur,
        0,
      ),
      starActCount: this.calc.result.starActCount,
    });

    this._oddRow = !this._oddRow;
  }

  finalize(node) {
    if (
      this.starActScoreIndex.length &&
      this.calc.result.starActScore[this.starActScoreIndex[0]] === 0
    ) {
      if (LiveSimulator.saDelayLastTiming) {
        if (this.senseBox) {
          [...this.senseBox.querySelectorAll(".staract-line")]
            .slice(0, -1)
            .forEach((i) => {
              i.style.filter = "grayscale(100%)";
              i.style.opacity = 0.4;
            });
        }
        LiveSimulator.saDelayLastTiming = null;
      } else if (this.starActScoreIndex.length > 1) {
        LiveSimulator.saDelayLastTiming = this._saLastTiming;
        const calc = new ScoreCalculator(
          this.calc.members,
          this.calc.posters,
          this.calc.accessories,
          this.calc.extra,
        );
        if (node) {
          calc.calc(node);
        } else {
          calc.calcPure();
          this._delayedResult = calc.result;
        }
        return true;
      }
    }
  }

  runSimulation(node) {
    this.prepare(node);
    for (const timing of this.senseTiming) {
      this.processTiming(timing, node);
    }
    return this.finalize(node);
  }
  getScoreRightNow() {
    const localScore =
      (this.baseScore * this.currentTiming) / this.lastSenseTiming +
      this.calc.result.senseScore.reduce((acc, cur) => acc + cur, 0) +
      this.calc.result.starActScore.reduce((acc, cur) => acc + cur, 0);
    const provider = this.calc.extra.tripleCastScoreProvider;
    if (provider) {
      return (
        localScore + provider(this.currentTiming)
        // -
        // (this.baseScore * this.currentTiming) / this.lastSenseTiming
      );
    }
    return localScore;
  }
  getPGaugeProgressElement() {
    return _("span", {}, [
      _("progress", {
        value: this.pGauge,
        max: this.pGaugeLimit,
        style: { width: `${(this.pGaugeLimit / 1000) * 50}px` },
      }),
      _("text", ` ${this.pGauge}/${this.pGaugeLimit}`),
    ]);
  }
  getLifeGaugeElement() {
    return _("span", { style: { marginLeft: "1em" } }, [
      _("text", ` ♥${this.life}`),
      this.lifeGuardCount > 0
        ? _("text", ` (+${this.lifeGuardCount})`)
        : new Comment("life guad conut"),
    ]);
  }
  getHoldingLightsElement() {
    const container = _("span", { className: "light-display" }, [
      _(
        "span",
        {},
        new Array(this.starActRequiredCount).fill(0).map((__, i) =>
          _("span", {
            className: "sense-star",
            "data-sense-type": this.holdingLights[i]?.toLowerCase() ?? "empty",
          }),
        ),
      ),
    ]);
    if (this.maxStockCount > 0) {
      container.appendChild(
        _(
          "span",
          { className: "stock-lights" },
          new Array(this.maxStockCount).fill(0).map((__, i) =>
            _("span", {
              className: "sense-star",
              "data-sense-type":
                this.holdingStockLights[i]?.toLowerCase() ?? "empty",
            }),
          ),
        ),
      );
    }
    return container;
  }
  setStarActRequirements(starActRequirements) {
    this.starActRequirements = starActRequirements;
    this.starActRequiredCount = starActRequirements.reduce((a, b) => a + b, 0);
  }

  applyPendingActions() {
    let action;
    while ((action = this.pendingActions.shift()) !== undefined) {
      action();
    }
  }
  addLife(amount, immediateAction = false) {
    if (!immediateAction) {
      this.pendingActions.push(() => this.addLife(amount, true));
      return;
    }
    const before = this.life;
    this.life += amount;
    this.life = Math.max(this.life, 1);
    this.phaseLog.push(
      ConstText.get("LIVE_LOG_LIFE", [before, amount, this.life]),
    );
  }
  addPGauge(amount, immediateAction = false) {
    if (!immediateAction) {
      this.pendingActions.push(() => this.addPGauge(amount, true));
      return;
    }
    const before = this.pGauge;
    this.pGauge += amount;
    this.pGauge = Math.min(this.pGauge, this.pGaugeLimit);
    this.phaseLog.push(
      ConstText.get("LIVE_LOG_PGUAGE", [
        before,
        amount,
        this.pGauge,
        this.pGaugeLimit,
      ]),
    );
  }
  addPGaugeLimit(amount, immediateAction = false) {
    if (!immediateAction) {
      this.pendingActions.push(() => this.addPGaugeLimit(amount, true));
      return;
    }
    const before = this.pGaugeLimit;
    this.pGaugeLimit += amount;
    this.phaseLog.push(
      ConstText.get("LIVE_LOG_PGUAGE_LIMIT", [
        before,
        amount,
        this.pGauge,
        this.pGaugeLimit,
      ]),
    );
  }
  addSenseLight(type, idx, amount = 1) {
    if (this.isDuringCombinationSense) return;
    let lightType;
    switch (type.toLowerCase()) {
      case "support": {
        lightType = 0;
        break;
      }
      case "control": {
        lightType = 1;
        break;
      }
      case "amplification": {
        lightType = 2;
        break;
      }
      case "special": {
        lightType = 3;
        break;
      }
      case "variable": {
        lightType = 4;
        break;
      }
      default:
        throw new Error("Unknown sense type: " + type);
    }
    let freeLightUsed = 0;
    // 持有统计
    for (let i = 0; i < amount; i++) {
      // sp光
      if (lightType === 4) {
        if (this.holdingLights.length < this.starActRequiredCount) {
          this.holdingLights.push(type);
        } else {
          this.holdingStockLights.push(type);
        }
      } else {
        if (
          this.starActCurrent[lightType] + i <
          this.starActRequirements[lightType]
        ) {
          this.holdingLights.push(type);
        } else if (this.stockType === 5 || this.stockType - 1 === lightType) {
          this.holdingStockLights.push(type);
        } else if (this.starActCurrent[5] < this.starActRequirements[4]) {
          this.holdingLights.push(type);
          this.starActCurrent[5]++;
          freeLightUsed++;
        }
      }
    }
    this.starActCurrent[lightType] += amount - freeLightUsed;
    this.newLightCurrentStep[idx][lightType] += amount;
  }
  processWrongLightToSp(idx, addedLights) {
    let wrongLightToSp = this.wrongLightToSpAmount[idx];
    for (let i = addedLights.length - 1; i >= 0; i--) {
      if (wrongLightToSp === 0) break;
      let lightType;
      switch (addedLights[i].toLowerCase()) {
        case "support": {
          lightType = 0;
          break;
        }
        case "control": {
          lightType = 1;
          break;
        }
        case "amplification": {
          lightType = 2;
          break;
        }
        case "special": {
          lightType = 3;
          break;
        }
      }
      if (lightType === undefined) continue;
      if (
        this.starActCurrent[lightType] > this.starActRequirements[lightType]
      ) {
        this.starActCurrent[lightType]--;
        this.addSenseLight("Variable", idx);
        wrongLightToSp--;
        addedLights[i] = "Variable";
      }
    }
  }
  resetCurrentLights() {
    for (let i = 0; i < 5; i++) {
      this.starActCurrent[i] = 0;
      this.newLightCurrentStep[i].fill(0);
      this.holdingLights = [];
      this.holdingStockLights = [];
    }
    this.starActCurrent[5] = 0;
    this.overflownLightCount = 0;
  }
  trySense(timing, timelineNode) {
    let idx = timing.Position - 1;
    // irh或电姬团报 跳过
    if (this.skipSense[idx]) {
      this.phaseLog.push(ConstText.get("LIVE_LOG_SENSE_SKIP"));
      return true;
    }
    let chara = this.calc.members[idx];
    if (chara.data.CharacterBaseMasterId === 102) {
      // 发动加分效果
      chara.sense.data.PreEffects.forEach((effect) => {
        effect = Effect.get(effect.EffectMasterId, chara.senselv);
        effect.applyEffect(this.calc, idx, ScoreBonusType.Sense);
      });
      chara = this.calc.members.find(
        (i) => i && i.data.CharacterBaseMasterId === 101,
      );
      if (!chara) {
        // szk发动但没有kkn时，始终失败
        this.phaseLog.push(ConstText.get("LIVE_LOG_SENSE_FAILED"));
        return false;
      }
      idx = this.calc.members.indexOf(chara);
      this.purgeExpiredBuff(timing.TimingSecond);
    }
    const ct = this.senseCt[idx];
    let activateSenseIndex = -1;
    ct.some((ct, i) => {
      const timeSinceLast = timing.TimingSecond - this.lastSenseTime[idx][i];
      if (ct > timeSinceLast) {
        return false;
      }
      activateSenseIndex = i;
      return true;
    });
    if (activateSenseIndex === -1) {
      this.phaseLog.push(ConstText.get("LIVE_LOG_SENSE_FAILED"));
      return false;
    }

    this.applySenseEffects(idx, timelineNode, activateSenseIndex);
    this.applyPendingActions();

    this.isDuringCombinationSense = true;
    for (let otherSenseIdx of this.combinationSenseList[idx]) {
      // 相邻sense发动时，附加生效本轮的加成
      this.purgeExpiredBuff(timing.TimingSecond);
      this.applySenseEffects(otherSenseIdx, timelineNode, 0);
      this.applyPendingActions();
    }
    this.isDuringCombinationSense = false;

    this.lastSenseTime[timing.Position - 1][activateSenseIndex] =
      timing.TimingSecond;

    return true;
  }

  applySenseEffects(idx, timelineNode, activateSenseIndex) {
    const chara = this.calc.members[idx];
    const sense = chara.senseAll[activateSenseIndex];
    if (sense.Type === "None") return;
    sense.data.PreEffects.forEach((effect) => {
      effect = Effect.get(effect.EffectMasterId, chara.senselv);
      effect.applyEffect(this.calc, idx, ScoreBonusType.Sense);
    });
    const senseEffectBranch = sense.getActiveBranch(this);
    if (senseEffectBranch) {
      senseEffectBranch.BranchEffects.forEach((effect) => {
        effect = Effect.get(effect.EffectMasterId, chara.senselv);
        effect.isLifeGuardBranch = senseEffectBranch.isLifeGuardBranch;
        effect.applyEffect(this.calc, idx, ScoreBonusType.Sense);
      });
    }
    if (!this.isDuringCombinationSense) {
      this.currentSenseType = sense.Type.toLowerCase();
      const senseTypesOrdered = [
        sense.Type,
        ...chara.senseAll
          .filter((s, i) => i !== activateSenseIndex && s.Type !== "None")
          .map((s) => s.Type),
      ];
      const senseAddCount = sense.data.LightCount + this.senseExtraAmount[idx];
      const addedLights = new Array(senseAddCount)
        .fill(0)
        .reduce((acc) => acc.concat(senseTypesOrdered), []);
      senseTypesOrdered.forEach((i) =>
        this.addSenseLight(i, idx, senseAddCount),
      );
      for (let light of this.senseExtraLights[idx]) {
        let [addLightType, addLightAmount] = light;
        this.addSenseLight(addLightType, idx, addLightAmount);
        while (addLightAmount--) {
          addedLights.push(addLightType);
        }
      }
      this.processWrongLightToSp(idx, addedLights);
      if (timelineNode) {
        for (let i = 0; i < addedLights.length - 1; i++) {
          timelineNode.appendChild(
            _("div", {
              className: "sense-add-light",
              "data-sense-type": addedLights[i + 1].toLowerCase(),
              style: { top: `calc(100% + ${i * 8}px)` },
            }),
          );
        }
        timelineNode.dataset.senseType = addedLights[0].toLowerCase();
      }
    }
    if (sense.scoreUp) {
      let multiplier = sense.scoreUp;
      let scoreLine = multiplier;
      if (this.pGauge > 0) {
        multiplier *= 1 + this.pGauge / 1000;
        scoreLine = `${scoreLine} × ${(1 + this.pGauge / 1000).toFixed(3).replace(/0+$/, "")}`;
      }
      let extraBuffMul = 0;
      let extraBuffLine = "1";
      this.activeBuff.sense.forEach((buff) => {
        if (buff.skipCurrent) return;
        const targets = buff.targets;
        if (targets && !targets.includes(idx)) return;
        const effect = buff.effect;
        if (!effect.conditionSatified(this.calc, idx)) return;
        if (buff.isStandaloneMultiplier) {
          multiplier *= 1 + buff.bonus;
          scoreLine = `${scoreLine} × ${(1 + buff.bonus).toFixed(2)}`;
          return;
        }
        extraBuffMul += buff.bonus;
        extraBuffLine = `${extraBuffLine} + ${buff.bonus.toFixed(2)}`;
      });
      if (extraBuffMul) {
        multiplier *= 1 + extraBuffMul;
        scoreLine = `${scoreLine} × (${extraBuffLine})`;
      }
      const stat = this.calc.stat.final[idx];
      const total = stat.total * (1 + this.performanceDuplicateUp[idx] / 100);
      const score = Math.floor(total * multiplier);
      scoreLine = `${total} × ${scoreLine} = ${score}`;
      this.senseScoreIndex[idx].push(this.calc.result.senseScore.length);
      this.calc.result.senseScore.push(score);
      this.phaseLog.push(
        ConstText.get("LIVE_LOG_SENSE_SCORE").replace("{0}", scoreLine),
      );
    }

    const poster = this.calc.posters[idx];
    if (poster) {
      for (let ability of poster.abilities) {
        if (!ability.unlocked) continue;
        if (
          ability.data.Type === "Leader" &&
          this.calc.members[idx] !== this.leader
        )
          continue;
        const abilityEffectBranch = ability.getActiveBranch(this);
        if (!abilityEffectBranch) continue;
        abilityEffectBranch.BranchEffects.forEach((effect) => {
          effect = Effect.get(
            effect.EffectMasterId,
            ability.level + ability.release,
          );
          if (effect.FireTimingType !== "Sense") return;
          if (!effect.canTrigger(this.calc, idx)) return;
          effect.applyEffect(this.calc, idx, ScoreBonusType.Poster);
        });
      }
    }
    const accessory = this.calc.accessories[idx];
    if (accessory) {
      for (let effect of accessory.mainEffects) {
        effect = effect.effect;
        if (effect.FireTimingType !== "Sense") continue;
        if (!effect.canTrigger(this.calc, idx)) continue;
        effect.applyEffect(this.calc, idx, ScoreBonusType.Accessory);
      }
      if (accessory.randomEffect) {
        let effect = accessory.randomEffect.effect;
        if (
          effect.FireTimingType === "Sense" &&
          effect.canTrigger(this.calc, idx)
        ) {
          effect.applyEffect(this.calc, idx, ScoreBonusType.Accessory);
        }
      }
    }

    if (sense.gaugeUp) {
      let amount = sense.gaugeUp;
      amount *= 1 + this.pGaugeBonus[idx] / 10000;
      amount = Math.floor(amount);
      this.addPGauge(amount, true);
    }
  }
  tryStarAct() {
    if (this.holdingLights.length < this.starActRequiredCount) {
      return false;
    }
    this.overflownLightCount = this.holdingStockLights.length;
    const idx = this.calc.members.indexOf(this.leader);
    this.leader.staract.data.PreEffects.forEach((effect) => {
      effect = Effect.get(effect.EffectMasterId, this.leader.bloom);
      effect.applyEffect(this.calc, idx, ScoreBonusType.StarAct);
    });
    const staractEffectBranch = this.leader.staract.getActiveBranch(this, idx);
    if (staractEffectBranch) {
      staractEffectBranch.BranchEffects.forEach((effect) => {
        effect = Effect.get(effect.EffectMasterId, this.leader.bloom + 1);
        if (effect.Type === "PerformanceDuplicateUp") {
          effect.Range = "All";
        }
        effect.isLifeGuardBranch = staractEffectBranch.isLifeGuardBranch;
        effect.applyEffect(this.calc, idx, ScoreBonusType.StarAct);
      });
    }
    let multiplier = this.leader.staract.scoreUp;
    let scoreLine = multiplier;
    multiplier *= 1 + this.pGauge / 1000;
    scoreLine = `${scoreLine} × ${(1 + this.pGauge / 1000).toFixed(3).replace(/0+$/, "")}`;
    let extraBuffMul = 0;
    let extraBuffLine = "1";
    this.activeBuff.starAct.forEach((buff) => {
      if (buff.skipCurrent) return;
      const targets = buff.targets;
      if (targets && !targets.includes(idx)) return;
      const effect = buff.effect;
      if (!effect.conditionSatified(this.calc, idx)) return;
      if (buff.isStandaloneMultiplier) {
        multiplier *= 1 + buff.bonus;
        scoreLine = `${scoreLine} × ${(1 + buff.bonus).toFixed(2)}`;
        return;
      }
      extraBuffMul += buff.bonus;
      extraBuffLine = `${extraBuffLine} + ${buff.bonus.toFixed(2)}`;
    });
    if (extraBuffMul) {
      multiplier *= 1 + extraBuffMul;
      scoreLine = `${scoreLine} × (${extraBuffLine})`;
    }
    const stat = Math.floor(
      this.calc.stat.final.reduce(
        (acc, memberStat, idx) =>
          acc + memberStat.total * (1 + this.performanceDuplicateUp[idx] / 100),
        0,
      ),
    );
    const score = Math.floor(stat * multiplier);
    scoreLine = `${stat} × ${scoreLine} = ${score}`;
    this.starActScoreIndex.push(this.calc.result.starActScore.length);
    if (
      LiveSimulator.saDelayLastTiming &&
      this.currentTiming !== LiveSimulator.saDelayLastTiming
    ) {
      this.calc.result.starActScore.push(0);
      this.phaseLog.push(ConstText.get("LIVE_LOG_STARACT_DELAYED"));
    } else {
      this.calc.result.starActScore.push(score);
      this.phaseLog.push(
        ConstText.get("LIVE_LOG_STARACT_SCORE").replace("{0}", scoreLine),
      );
    }
    this.calc.result.starActCount++;
    const leftStyle = this.currentTiming
      ? `calc(calc(calc(100% - 40px) * ${this.currentTiming / this.lastSenseTiming}) + 19px)`
      : "-8px";
    if (
      this.senseBox &&
      this.senseBox.children[0] &&
      this.senseBox.children[0].children[1]
    ) {
      this.senseBox.children[0].children[1].appendChild(
        _("div", { className: "staract-line", style: { left: leftStyle } }),
      );
    }

    this.applyPendingActions();
    return true;
  }
  purgeExpiredBuff(time) {
    this.activeBuff.sense = this.activeBuff.sense.filter(
      (i) => ((i.skipCurrent = false), i.lastUntil >= time),
    );
    this.activeBuff.starAct = this.activeBuff.starAct.filter(
      (i) => ((i.skipCurrent = false), i.lastUntil >= time),
    );
  }

  /**
   * 轻量级模拟：只计算 starActCount，不计算分数
   * 用于自动配队的第一阶段筛选
   */
  runSimulationCountOnly() {
    this.prepare(null);
    for (const timing of this.senseTiming) {
      this.processTimingCountOnly(timing);
    }
    return this.calc.result.starActCount;
  }

  processTimingCountOnly(timing) {
    this.currentTiming = timing.TimingSecond;
    this.currentSenseType = "none";
    this.purgeExpiredBuff(timing.TimingSecond);
    this.phaseLog = [];

    if (!this.trySenseCountOnly(timing)) {
      this.resetCurrentLights();
    }

    if (this.tryStarActCountOnly()) {
      this.resetCurrentLights();
    }
  }

  /**
   * 轻量级 StarAct 检查：只判断灯光是否满足条件并计数，不计算分数
   * 不依赖 stat.final，因此 calcStarActCountOnly() 可以跳过 stat.calc()
   */
  tryStarActCountOnly() {
    if (this.holdingLights.length < this.starActRequiredCount) {
      return false;
    }
    this.overflownLightCount = this.holdingStockLights.length;
    const idx = this.calc.members.indexOf(this.leader);
    // 应用 StarAct 前置效果（可能影响灯光收集等机制）
    this.leader.staract.data.PreEffects.forEach((effect) => {
      effect = Effect.get(effect.EffectMasterId, this.leader.bloom);
      effect.applyEffect(this.calc, idx, ScoreBonusType.StarAct);
    });
    const staractEffectBranch = this.leader.staract.getActiveBranch(this, idx);
    if (staractEffectBranch) {
      staractEffectBranch.BranchEffects.forEach((effect) => {
        effect = Effect.get(effect.EffectMasterId, this.leader.bloom + 1);
        if (effect.Type === "PerformanceDuplicateUp") {
          effect.Range = "All";
        }
        effect.isLifeGuardBranch = staractEffectBranch.isLifeGuardBranch;
        effect.applyEffect(this.calc, idx, ScoreBonusType.StarAct);
      });
    }
    // 跳过分数计算，直接累加 starActCount
    this.starActScoreIndex.push(this.calc.result.starActScore.length);
    this.calc.result.starActScore.push(0);
    this.calc.result.starActCount++;
    this.applyPendingActions();
    return true;
  }

  trySenseCountOnly(timing) {
    let idx = timing.Position - 1;
    if (this.skipSense[idx]) {
      return true;
    }
    let chara = this.calc.members[idx];
    if (chara.data.CharacterBaseMasterId === 102) {
      chara = this.calc.members.find(
        (i) => i && i.data.CharacterBaseMasterId === 101,
      );
      if (!chara) {
        return false;
      }
      idx = this.calc.members.indexOf(chara);
      this.purgeExpiredBuff(timing.TimingSecond);
    }
    const ct = this.senseCt[idx];
    let activateSenseIndex = -1;
    ct.some((ct, i) => {
      const timeSinceLast = timing.TimingSecond - this.lastSenseTime[idx][i];
      if (ct > timeSinceLast) {
        return false;
      }
      activateSenseIndex = i;
      return true;
    });
    if (activateSenseIndex === -1) {
      return false;
    }

    this.applySenseEffectsCountOnly(idx, activateSenseIndex);

    this.isDuringCombinationSense = true;
    for (let otherSenseIdx of this.combinationSenseList[idx]) {
      this.purgeExpiredBuff(timing.TimingSecond);
      this.applySenseEffectsCountOnly(otherSenseIdx, 0);
    }
    this.isDuringCombinationSense = false;

    this.lastSenseTime[timing.Position - 1][activateSenseIndex] =
      timing.TimingSecond;

    return true;
  }

  // count-only 模式下跳过的纯分数效果类型（不影响灯光收集）
  static SCORE_ONLY_EFFECTS = new Set([
    'PerformanceUp', 'VocalUp', 'ExpressionUp', 'ConcentrationUp',
    'ScoreGainOnScore', 'ScoreGainOnPerformance', 'ScoreGainOnVocal',
    'ScoreGainOnExpression', 'ScoreGainOnConcentration', 'ScoreGainOnSenseLight',
    'PerformanceDuplicateUp',
  ]);

  applySenseEffectsCountOnly(idx, activateSenseIndex) {
    const chara = this.calc.members[idx];
    const sense = chara.senseAll[activateSenseIndex];
    if (sense.Type === "None") return;

    sense.data.PreEffects.forEach((effect) => {
      effect = Effect.get(effect.EffectMasterId, chara.senselv);
      // 跳过纯分数效果，只应用影响灯光的效果
      if (LiveSimulator.SCORE_ONLY_EFFECTS.has(effect.Type)) return;
      effect.applyEffect(this.calc, idx, ScoreBonusType.Sense);
    });
    const senseEffectBranch = sense.getActiveBranch(this);
    if (senseEffectBranch) {
      senseEffectBranch.BranchEffects.forEach((effect) => {
        effect = Effect.get(effect.EffectMasterId, chara.senselv);
        // 跳过纯分数效果
        if (LiveSimulator.SCORE_ONLY_EFFECTS.has(effect.Type)) return;
        effect.isLifeGuardBranch = senseEffectBranch.isLifeGuardBranch;
        effect.applyEffect(this.calc, idx, ScoreBonusType.Sense);
      });
    }

    if (!this.isDuringCombinationSense) {
      this.currentSenseType = sense.Type.toLowerCase();
      const senseTypesOrdered = [
        sense.Type,
        ...chara.senseAll
          .filter((s, i) => i !== activateSenseIndex && s.Type !== "None")
          .map((s) => s.Type),
      ];
      const senseAddCount = sense.data.LightCount + this.senseExtraAmount[idx];
      const addedLights = new Array(senseAddCount)
        .fill(0)
        .reduce((acc) => acc.concat(senseTypesOrdered), []);
      senseTypesOrdered.forEach((i) =>
        this.addSenseLight(i, idx, senseAddCount),
      );
      for (let light of this.senseExtraLights[idx]) {
        let [addLightType, addLightAmount] = light;
        this.addSenseLight(addLightType, idx, addLightAmount);
        while (addLightAmount--) {
          addedLights.push(addLightType);
        }
      }
      this.processWrongLightToSp(idx, addedLights);
    }
  }

  /**
   * 收集角色的灯光相关参数，用于 WebGPU 预筛选计算
   * 角色需要已经完成 resetEffects() + bloomBonusEffects 的应用
   *
   * @param {CharacterData} chara - 角色数据
   * @returns {Object|null} 灯光参数
   */
  static collectLightParams(chara, teamContext) {
    if (!chara) return null;

    const senseTypeMap = {
      Support: 0,
      Control: 1,
      Amplification: 2,
      Special: 3,
      Variable: 4,
      Alternative: 4,
      None: 5,
    };

    const primarySense = chara.senseAll.find((s) => s.Type !== "None");
    if (!primarySense) {
      return {
        senseType: 4, lightCount: 0, ct: 999,
        numSenses: 0,
        senseType1: 4, lightCount1: 0, ct1: 0, senseType2: 4, lightCount2: 0, ct2: 0,
        senseType3: 4, lightCount3: 0, ct3: 0, senseType4: 4, lightCount4: 0, ct4: 0,
        extraLightSupport: 0, extraLightControl: 0, extraLightAmplification: 0,
        extraLightSpecial: 0, extraLightVariable: 0,
        slotPreSelf0: 0, slotPreSelf1: 0, slotPreSelf2: 0, slotPreSelf3: 0, slotPreSelf4: 0,
        slotPreExtra0: 0, slotPreExtra1: 0, slotPreExtra2: 0, slotPreExtra3: 0, slotPreExtra4: 0,
        decreaseReq0: 0, decreaseReq1: 0, decreaseReq2: 0, decreaseReq3: 0,
        wrongLightToSp: 0,
      };
    }

    // 遍历 chara.senseAll（包括 None Sense），与 CPU 的 CT 跟踪一致
    const allSenses = chara.senseAll;
    const senseTypes = allSenses.map((s) => senseTypeMap[s.Type] ?? 4);
    const baseLightCounts = allSenses.map((s) => s.Type === "None" ? 0 : (s.data.LightCount || 1));

    const senseType = senseTypes[0];
    let lightCount = baseLightCounts[0];
    const ct = primarySense.ct;

    // 从 bloomBonusEffects 中提取额外灯光
    let extraSelfLights = 0;
    let extraLightSupport = 0;
    let extraLightControl = 0;
    let extraLightAmplification = 0;
    let extraLightSpecial = 0;
    let extraLightVariable = 0;
    let wrongLightToSp = 0;

    chara.bloomBonusEffects.forEach((effect) => {
      switch (effect.Type) {
        case "AddSenseLightSelf":
          // AddSenseLightSelf 不检查 FireTimingType，始终生效
          extraSelfLights += effect.activeEffect.Value;
          break;
        case "AddSenseLightSupport":
          if (effect.FireTimingType === "Passive") extraLightSupport += effect.activeEffect.Value;
          break;
        case "AddSenseLightControl":
          if (effect.FireTimingType === "Passive") extraLightControl += effect.activeEffect.Value;
          break;
        case "AddSenseLightAmplification":
          if (effect.FireTimingType === "Passive") extraLightAmplification += effect.activeEffect.Value;
          break;
        case "AddSenseLightSpecial":
          if (effect.FireTimingType === "Passive") extraLightSpecial += effect.activeEffect.Value;
          break;
        case "AddSenseLightVariable":
          if (effect.FireTimingType === "Passive") extraLightVariable += effect.activeEffect.Value;
          break;
        case "ChangeWrongLightToSpLight":
          wrongLightToSp += effect.activeEffect.Value;
          break;
      }
    });

    lightCount += extraSelfLights;

    // Sense PreEffect/BranchEffect 额外灯光（每个 Sense 发动时只触发该 Sense 的效果）
    // 按 Sense 槽位存储，包括 None Sense（lightCount=0 不产生灯光但占用 CT）
    const slotPreSelf = [0, 0, 0, 0, 0];
    const slotPreExtra = [0, 0, 0, 0, 0];

    for (let si = 0; si < allSenses.length; si++) {
      const sense = allSenses[si];
      if (sense.Type === "None") continue; // None Sense 没有 PreEffects
      // PreEffects
      if (sense.data.PreEffects) {
        for (const pe of sense.data.PreEffects) {
          try {
            const effect = Effect.get(pe.EffectMasterId, chara.senselv);
            if (LiveSimulator.SCORE_ONLY_EFFECTS.has(effect.Type)) continue;
            if (effect.Type === "AddSenseLightSelf") {
              slotPreSelf[si] += effect.activeEffect.Value;
            } else if (effect.Type.startsWith("AddSenseLight")) {
              slotPreExtra[si] += effect.activeEffect.Value;
            }
          } catch (e) { /* skip unknown effects */ }
        }
      }
      // BranchEffects（根据队伍上下文精确选择分支）
      if (sense.data.Branches && sense.data.Branches.length > 0) {
        let branch;
        if (teamContext && sense.data.BranchCondition1 && sense.data.BranchCondition1 !== 'None') {
          // 精确选择：遍历分支找第一个满足条件的
          for (const b of sense.data.Branches) {
            let judgeValue;
            const condType = sense.data.BranchCondition1;
            if (condType === "LifeGuardCount") {
              judgeValue = teamContext.lifeGuardCount || 0;
            } else if (condType === "AttributeCount") {
              judgeValue = teamContext.attributeCount || 0;
            } else if (condType === "CompanyMemberCount") {
              judgeValue = teamContext.companyCounts?.[sense.data.ConditionValue1] || 0;
            } else if (condType === "CharacterBaseGroup") {
              judgeValue = teamContext.hasCharacterBase?.(sense.data.ConditionValue1) ? 1 : 0;
            } else {
              break; // 未知条件，用默认分支
            }
            let met = false;
            switch (b.JudgeType1) {
              case "Equal": met = judgeValue === b.Parameter1; break;
              case "MoreThan": met = judgeValue >= b.Parameter1; break;
              case "LessThan": met = judgeValue <= b.Parameter1; break;
            }
            if (met) { branch = b; break; }
          }
        }
        if (!branch) branch = sense.data.Branches[0];

        if (branch?.BranchEffects) {
          for (const be of branch.BranchEffects) {
            try {
              const effect = Effect.get(be.EffectMasterId, chara.senselv);
              if (LiveSimulator.SCORE_ONLY_EFFECTS.has(effect.Type)) continue;
              if (effect.Type === "AddSenseLightSelf") {
                slotPreSelf[si] += effect.activeEffect.Value;
              } else if (effect.Type.startsWith("AddSenseLight")) {
                slotPreExtra[si] += effect.activeEffect.Value;
              }
            } catch (e) { /* skip unknown effects */ }
          }
        }
      }
    }

    const req = chara.staract.requireDecrease;

    // 角色属性（用于效果条件检查）
    const companyIdList = chara.companyIdList || [];
    const attributeList = chara.attributeList || [];
    const characterBaseIdList = chara.data.SecondaryCharacterBaseMasterId
      ? [chara.data.CharacterBaseMasterId, chara.data.SecondaryCharacterBaseMasterId]
      : [chara.data.CharacterBaseMasterId];
    // Attribute 字符串→数字映射：1=Cute, 2=Cool, 3=Colorful, 4=Cheerful
    const attrStrToId = { Cute: 1, Cool: 2, Colorful: 3, Cheerful: 4 };
    const attrId1 = attrStrToId[attributeList[0]] || 0;
    const attrId2 = attrStrToId[attributeList[1]] || 0;
    // SenseType 数字映射：与 shader 中 senseTypeMap 一致 (0=Support,1=Control,2=Amplification,3=Special,4=Variable,5=None)
    // 但 Effect trigger 中 SenseTypeEnum 是 {1:Support, 2:Control, 3:Amplification, 4:Special, 9:None, 10:Alternative}
    const senseTypeId = senseType; // 已经是 0-5 的数字

    return {
      senseType,
      lightCount,
      ct,
      // 多 Sense 类型（包括 None Sense，用于 CT 跟踪）
      numSenses: allSenses.length,
      senseType1: senseTypes[1] ?? 5, lightCount1: baseLightCounts[1] ?? 0, ct1: allSenses[1]?.ct ?? 0,
      senseType2: senseTypes[2] ?? 5, lightCount2: baseLightCounts[2] ?? 0, ct2: allSenses[2]?.ct ?? 0,
      senseType3: senseTypes[3] ?? 5, lightCount3: baseLightCounts[3] ?? 0, ct3: allSenses[3]?.ct ?? 0,
      senseType4: senseTypes[4] ?? 5, lightCount4: baseLightCounts[4] ?? 0, ct4: allSenses[4]?.ct ?? 0,
      // 被动效果额外灯光
      extraLightSupport,
      extraLightControl,
      extraLightAmplification,
      extraLightSpecial,
      extraLightVariable,
      // Sense PreEffect/BranchEffect 额外灯光（按槽位）
      slotPreSelf0: slotPreSelf[0], slotPreSelf1: slotPreSelf[1],
      slotPreSelf2: slotPreSelf[2], slotPreSelf3: slotPreSelf[3], slotPreSelf4: slotPreSelf[4],
      slotPreExtra0: slotPreExtra[0], slotPreExtra1: slotPreExtra[1],
      slotPreExtra2: slotPreExtra[2], slotPreExtra3: slotPreExtra[3], slotPreExtra4: slotPreExtra[4],
      // 需求减少
      decreaseReq0: req[0] || 0,
      decreaseReq1: req[1] || 0,
      decreaseReq2: req[2] || 0,
      decreaseReq3: req[3] || 0,
      // wrongLightToSp
      wrongLightToSp,
      // 角色属性（用于效果 trigger 条件检查）
      companyId1: companyIdList[0] || 0,
      companyId2: companyIdList[1] || 0,
      attributeId1: attrId1,
      attributeId2: attrId2,
      characterBaseId1: characterBaseIdList[0] || 0,
      characterBaseId2: characterBaseIdList[1] || 0,
    };
  }

  /**
   * 批量收集所有角色的灯光参数
   * @param {Array<CharacterData>} characters
   * @returns {Array<Object>}
   */
  static collectAllLightParams(characters) {
    return characters.map((c) => LiveSimulator.collectLightParams(c)).filter(Boolean);
  }

  /**
   * 从海报能力中提取灯光相关效果（逐条带 trigger 信息）
   * @param {PosterData} poster
   * @returns {Array<{field: number, value: number, triggerType: number, triggerValue: number}>}
   */
  /**
   * 选择 Poster 能力的活跃分支
   * @param {Object} ability - PosterAbilityData
   * @param {Object} [teamContext] - { attributeCount, companyCounts: {companyId: count} }
   * @returns {Object|null} 选中的分支
   */
  static selectPosterBranch(ability, teamContext) {
    const branches = ability.data?.Branches;
    if (!branches?.length) return null;
    if (!teamContext) return branches[0];

    for (const branch of branches) {
      let conditionMet = true;
      const condType = ability.data.BranchConditionType1;
      if (condType && condType !== "None") {
        let judgeValue;
        if (condType === "AttributeCount") {
          judgeValue = teamContext.attributeCount;
        } else if (condType === "CompanyMemberCount") {
          judgeValue = teamContext.companyCounts?.[ability.data.ConditionValue1] || 0;
        } else {
          return branches[0]; // 未知条件，降级
        }
        switch (branch.JudgeType1) {
          case "Equal": conditionMet = judgeValue === branch.Parameter1; break;
          case "MoreThan": conditionMet = judgeValue >= branch.Parameter1; break;
          case "LessThan": conditionMet = judgeValue <= branch.Parameter1; break;
        }
      }
      if (conditionMet) return branch;
    }
    return branches[0];
  }

  static collectPosterLightEffects(poster, teamContext) {
    const entries = [];
    if (!poster?.abilities) return entries;

    poster.abilities.forEach((ability) => {
      if (!ability.unlocked) return;
      const branch = LiveSimulator.selectPosterBranch(ability, teamContext);
      if (!branch?.BranchEffects) return;

      branch.BranchEffects.forEach((effectData) => {
        const effect = Effect.get(effectData.EffectMasterId, ability.level + ability.release);
        if (effect.Type !== "AddSenseLightSelf" && effect.FireTimingType !== "Passive") return;
        LiveSimulator.#extractEffectEntries(effect, entries);
      });
    });

    return entries;
  }

  /**
   * 从饰品主效果中提取灯光相关效果（逐条带 trigger 信息）
   * @param {AccessoryData} accessory
   * @returns {Array<{field: number, value: number, triggerType: number, triggerValue: number}>}
   */
  static collectAccessoryLightEffects(accessory) {
    const entries = [];
    if (!accessory?.mainEffects) return entries;

    accessory.mainEffects.forEach((effectEntry) => {
      const effect = effectEntry.effect;
      if (!effect) return;
      if (effect.Type !== "AddSenseLightSelf" && effect.FireTimingType !== "Passive") return;
      LiveSimulator.#extractEffectEntries(effect, entries);
    });

    return entries;
  }

  // SenseTypeEnum trigger.Value → shader senseType 编码
  static #senseTypeTriggerToShader = { 1: 0, 2: 1, 3: 2, 4: 3, 9: 5, 10: 4 };

  /**
   * 效果类型 → field 索引映射
   * @private
   */
  static #effectTypeToField(type) {
    const fieldMap = {
      AddSenseLightSelf: 0,
      AddSenseLightSupport: 1,
      AddSenseLightControl: 2,
      AddSenseLightAmplification: 3,
      AddSenseLightSpecial: 4,
      AddSenseLightVariable: 5,
      DecreaseRequireSupportLight: 6,
      DecreaseRequireControlLight: 7,
      DecreaseRequireAmplificationLight: 8,
      DecreaseRequireSpecialLight: 9,
      SenseRecastDown: 10,
    };
    return fieldMap[type];
  }

  /**
   * 从单个 Effect 提取效果条目，带 trigger 信息
   * triggerType: 0=无条件, 1=Company, 2=Attribute, 3=SenseType, 4=CharacterBase, 5+=始终满足(上界)
   * @private
   */
  static #extractEffectEntries(effect, entries) {
    const field = LiveSimulator.#effectTypeToField(effect.Type);
    if (field === undefined) return;
    const value = effect.activeEffect?.Value || 0;
    if (value === 0) return;

    // 分析 Triggers 和 Conditions，提取可按角色检查的条件
    const triggerInfo = LiveSimulator.#analyzeTriggers(effect);
    entries.push({ field, value, triggerType: triggerInfo.type, triggerValue: triggerInfo.value });
  }

  /**
   * 分析效果的 Triggers + Conditions，提取最关键的角色级条件
   * @private
   */
  static #analyzeTriggers(effect) {
    const triggers = effect.Triggers || [];
    const conditions = effect.data?.Conditions || [];

    // 合并所有 trigger + condition，找可按角色检查的
    const allChecks = [
      ...triggers.map(t => ({ type: t.Trigger, value: t.Value })),
      ...conditions.map(c => ({ type: c.Condition, value: c.Value })),
    ];

    // 优先匹配角色级条件
    for (const check of allChecks) {
      switch (check.type) {
        case 'Company': return { type: 1, value: check.value };
        case 'Attribute': return { type: 2, value: check.value };
        case 'SenseType': {
          const shaderVal = LiveSimulator.#senseTypeTriggerToShader[check.value];
          return { type: 3, value: shaderVal !== undefined ? shaderVal : check.value };
        }
        case 'CharacterBase': return { type: 4, value: check.value };
      }
    }

    // 如果有 party-level 条件或 CharacterBaseGroup，视为始终满足（上界估算）
    // 如果无条件，type=0 表示无条件
    if (allChecks.length === 0) return { type: 0, value: 0 };

    // 有未处理的条件（CharacterBaseGroup, CompanyCount 等），上界估算
    return { type: 0, value: 0 };
  }

  /**
   * 累积单个效果到结果对象
   * @private
   */
  static #accumulateEffect(effect, result) {
    switch (effect.Type) {
      case "AddSenseLightSelf":
        result.selfLightBonus += effect.activeEffect.Value;
        break;
      case "AddSenseLightSupport":
        result.extraLightSupport += effect.activeEffect.Value;
        break;
      case "AddSenseLightControl":
        result.extraLightControl += effect.activeEffect.Value;
        break;
      case "AddSenseLightAmplification":
        result.extraLightAmplification += effect.activeEffect.Value;
        break;
      case "AddSenseLightSpecial":
        result.extraLightSpecial += effect.activeEffect.Value;
        break;
      case "AddSenseLightVariable":
        result.extraLightVariable += effect.activeEffect.Value;
        break;
      case "DecreaseRequireSupportLight":
        result.decreaseReq0 += effect.activeEffect.Value;
        break;
      case "DecreaseRequireControlLight":
        result.decreaseReq1 += effect.activeEffect.Value;
        break;
      case "DecreaseRequireAmplificationLight":
        result.decreaseReq2 += effect.activeEffect.Value;
        break;
      case "DecreaseRequireSpecialLight":
        result.decreaseReq3 += effect.activeEffect.Value;
        break;
      case "SenseRecastDown":
        result.recastDown += effect.activeEffect.Value;
        break;
    }
  }
}
