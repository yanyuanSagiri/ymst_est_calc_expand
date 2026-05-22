# 通常模式 vs 三幕公演模式 — 算分逻辑深度对比

## 一、概述

| 维度 | 通常（试音/排位） | 三幕公演（TripleCast） |
|------|-------------------|----------------------|
| calcType 值 | `"normal"` / `"highscore"` | `"triple"` |
| 编队管理器 | `PartyManager`（1 个队伍） | `TripleCastManager`（3 个独立队伍） |
| 时间轴数量 | 1 条 `SenseNotation` | 3 条独立 `SenseNotation`（可不同） |
| 计算轮次 | 单次 pass | Pass1 + 3 轮 Jacobi 迭代 |
| 跨轴依赖 | 无 | 有（ScoreGainOnScore 百分比加分互相耦合） |
| 计算类型 | `Normal` 或 `Highscore` | 统一使用 `Normal` |

---

## 二、编队与数据结构

### 2.1 通常模式

```
PartyManager
  └── parties[] → Party
        ├── characters[5]    // 5 张角色卡
        ├── posters[5]       // 5 张海报
        ├── accessories[5]   // 5 个饰品
        └── leader           // 队长（1人）
```

- 只有 **1 个编队**
- 1 条时间轴（通过 `senseNoteSelect` 下拉框选择）
- 计算结果渲染到 `this.calcResult` DOM 容器

### 2.2 三幕公演模式

```
TripleCastManager
  ├── axes[0] → { notationId, party: Party }   // 轴1 (マチネ)
  ├── axes[1] → { notationId, party: Party }   // 轴2 (ジュルネ)
  └── axes[2] → { notationId, party: Party }   // 轴3 (ソワレ)
```

- **3 个独立编队**，各自有完整角色/海报/饰品/队长
- 3 条独立的时间轴（`notationId` 可以不同，分别来自 `GameDb.TripleCast` 数据）
- 每轴有独立的计算结果容器 `calcResults[axisIdx]`

---

## 三、基础分（BaseScore）计算

两种模式的基础分计算逻辑 **完全一致**，都经过以下流程：

### 3.1 属性计算流水线

```
初始值(initial) → 加成计算 → 最终值(final)
```

1. **初始值**：从角色卡面数据 `statFinal` 获得（含等级、剧情阅读、开花等）
2. **被动效果叠加**：
   - 相册效果（album）
   - 演员效果（actor，来自队长 LeaderSense）
   - 海报效果（poster）
   - 饰品效果（accessory）
   - 其他效果（other，含 HighScoreBuff、剧场等级等）
3. **百分比加成叠加**：各来源的百分比加成（上限 200%/项），加上数值加成
4. **额外加成**：时间轴效果中的单项加成（buffAfterCalc）
5. **最终值** = `finalBeforeBuff × buffAfterCalc` 的演技力乘算

### 3.2 基础分公式

```
baseScore[i] = floor( floor(finalTotal × statExtra / 100) × 10 × (1 + baseScoreUp/10000) × coef[i] )
```

其中 `coef` = `[0.95, 0.97, 1.00, 1.05]` 对应4个评价等级

`baseScore[3]`（coef=1.05）被用作后续模拟的基准分。

---

## 四、Live 模拟流程

### 4.1 模拟器初始化

`LiveSimulator` 在 `ScoreCalculator` 构造时创建：

```javascript
this.liveSim = new LiveSimulator(this, notationId);
```

初始化状态包括：
- `senseTiming`：从 `GameDb.SenseNotation[id].Details` 排序得到的时间节点列表
- `starActCurrent[6]`：当前持有的各类型光数量
- `holdingLights` / `holdingStockLights`：持有光队列
- `activeBuff`：当前生效的增益效果（sense/starAct 分开）
- `scoreTimeline`：得分时间线（关键，三幕公演的跨轴计算依赖此数据）

### 4.2 Sense 发动（trySense）

每个时间节点（`TimingSecond`, `Position`）到来时：

1. **冷却检查**：`timing.TimingSecond - lastSenseTime >= ct` 才能发动
2. **发动 Sense 效果**（`applySenseEffects`）：
   - `PreEffects`：前驱效果
   - `BranchEffects`：主效果（根据条件分支选择）
   - **加光**：根据 `LightCount + senseExtraAmount` 添加对应类型的光
   - **Sense 加分**：`score = floor(stat.total × multiplier)`
     - `multiplier = sense.scoreUp × (1 + pGauge/1000) × (1 + buffSum)`
   - **触发光轴效果**：海报、饰品的 Sense 时点效果
   - **P 槽变化**：`gaugeUp` 效果
3. **Combination Sense**：相邻角色的连携 Sense 额外发动
4. **加入 scoreTimeline**：记录当前时刻的累积 Sense 分和 StarAct 分

### 4.3 StarAct 发动（tryStarAct）

当持有光数量 ≥ 需求光数时触发：

1. **队长 StarAct 效果**：PreEffects + BranchEffects
2. **StarAct 加分**：`score = floor(totalAllMembersStat × multiplier)`
   - `totalAllMembersStat` = 5 人最终演技力之和（含 PerformanceDuplicateUp）
   - `multiplier = staract.scoreUp × (1 + pGauge/1000) × (1 + buffSum)`
3. **光清空**：`resetCurrentLights()`
4. **加分加入 result.starActScore[]**

### 4.4 SA 推迟机制

如果第一次 StarAct 在第一时间节点就触发但加分为 0，则自动推迟到最后时间点重新模拟，以获得更高的 SA 分数。

---

## 五、核心差异：ScoreGainOnScore（百分比加分）

这是两种模式 **最关键的算法差异**。

### 5.1 效果机制

`ScoreGainOnScore` 是一种"基于当前总分的百分比加分"效果：

```javascript
// ScoreGainOnScore.js
const scoreRightNow = liveSim.getScoreRightNow();
const score = Math.floor(scoreRightNow × effect.Value / 10000);
scoreArr.push(score);  // 加入 senseScore 或 starActScore
```

### 5.2 通常模式下的 getScoreRightNow

```javascript
getScoreRightNow() {
  const localScore =
    (this.baseScore × this.currentTiming) / this.lastSenseTiming +
    this.calc.result.senseScore.reduce((acc, cur) => acc + cur, 0) +
    this.calc.result.starActScore.reduce((acc, cur) => acc + cur, 0);
  // tripleCastScoreProvider 不存在 → 直接返回 localScore
  return localScore;
}
```

**含义**：当前总分 = 基础分的线性插值 + 累积 Sense 分 + 累积 StarAct 分

百分比加分只基于 **本队的当前分数**，没有任何跨队依赖。

### 5.3 三幕公演模式下的 getScoreRightNow

```javascript
getScoreRightNow() {
  const localScore = ...; // 同上
  const provider = this.calc.extra.tripleCastScoreProvider;
  if (provider) {
    return localScore + provider(this.currentTiming);
  }
  return localScore;
}
```

**`tripleCastScoreProvider`** 是一个闭包函数，在当前时刻 `time` 返回 **其他两个轴** 在该时刻的总分：

```javascript
const makeProvider = (forAxisIdx, passData) => {
  const fns = [0,1,2].map(i =>
    i === forAxisIdx ? null : buildAxisScoreFn(passData[i])
  );
  return (time) => {
    let sum = 0;
    for (let i = 0; i < 3; i++) {
      if (i === forAxisIdx || !fns[i]) continue;
      sum += fns[i](time);
    }
    return sum;
  };
};
```

其中 `buildAxisScoreFn` 根据另一轴的 `passData` 构建一个时间→分数的查找函数：

```javascript
const buildAxisScoreFn = (passData) => {
  const baseTotal = passData.baseScore[3];  // coef=1.05 的基础分
  const lastTiming = passData.lastTiming;
  const timeline = passData.timeline;
  return (time) => {
    // 基础分线性插值 + 累积 sense + 累积 starAct
    let sense = 0, starAct = 0;
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i].time <= time) {
        sense = timeline[i].cumulativeSenseScore;
        starAct = timeline[i].cumulativeStarActScore;
        break;
      }
    }
    return (baseTotal * time) / lastTiming + sense + starAct;
  };
};
```

**含义**：百分比加分的计算基数 = **本轴当前分 + 其他两轴在该时刻的总分**

---

## 六、三幕公演的 Jacobi 迭代

由于百分比加分依赖其他轴的分数，而其他轴的分数又可能依赖本轴的百分比加分结果，形成了 **循环依赖**。因此采用 **Jacobi 迭代法** 逐步收敛。

### 6.1 迭代流程

```
┌─────────────────────────────────────────────────┐
│ Pass 1：独立计算（无 provider）                    │
│   轴0: calc() → scoreTimeline₀                   │
│   轴1: calc() → scoreTimeline₁                   │
│   轴2: calc() → scoreTimeline₂                   │
│   → 收集 passData = { baseScore, lastTiming,     │
│                        timeline }                │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│ Jacobi Round 0                                  │
│   轴0: calc(provider=f(轴1+轴2 的 passData))     │
│   轴1: calc(provider=f(轴0+轴2 的 passData))     │
│   轴2: calc(provider=f(轴0+轴1 的 passData))     │
│   → 用新 timeline 更新 passData                   │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│ Jacobi Round 1（同上，用 round 0 的新 passData）  │
│   → 用新 timeline 更新 passData                   │
└──────────────────────┬──────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────┐
│ Jacobi Round 2（最终轮）                          │
│   → 本轮的结果作为最终分数                         │
│   → 收集 finalTimelines[]                         │
└──────────────────────┬──────────────────────────┘
                       ▼
          汇总三轴分数，输出总分
```

### 6.2 为什么需要迭代

在三幕公演中，假设轴 A 在时刻 t₁ 触发了百分比加分效果：

- 加分 = 当前总分 × 百分比
- 当前总分 = 轴A本地分 + 轴B在t₁的分 + 轴C在t₁的分

但轴 B 和轴 C 的分数本身也可能包含百分比加分，而那些加分又取决于轴 A 的分数。

这是一个 **耦合非线性方程组**，无法单次 pass 求解。通过 Jacobi 迭代，每次用上一轮的"旧值"计算"新值"，经过 3 轮基本收敛到稳定解。

### 6.3 Provider 的时间线查找

`buildAxisScoreFn` 对传入的 `timeline` 做 **二分反向查找**（从后往前找 `time ≤ 当前时刻` 的最后一条记录），保证在任意时刻都能获取到其他轴的近似总分。

---

## 七、总分汇总对比

### 7.1 通常模式

```
总分 = baseScore + ΣsenseScore + ΣstarActScore
```

结果展示为 4 个评价等级的分数（对应 coef 0.95/0.97/1.00/1.05）。

### 7.2 三幕公演模式

```
总baseScore = Σ(baseScore_轴i), i=0,1,2   // 每轴4个等级，对应相加
总senseScore = Σ(ΣsenseScore_轴i)
总starActScore = Σ(ΣstarActScore_轴i)
总分 = 总baseScore + 总senseScore + 总starActScore
```

额外维护一个 `mergedTimeline`：将三轴的 `scoreTimeline` 按时间排序合并，记录每一时刻各轴的累积分数和跨轴总分。

---

## 八、HighScore 模式说明

HighScore 是通常模式的一个变体，区别仅在于：
- `extra.type = ScoreCalculationType.HighScoreChallenge`（但代码中实际使用 `Highscore`）
- 额外应用 `HighScoreBuffManager` 的 buff 效果（活动期间的全局加成）
- 计算流程与 Normal 完全一致

三幕公演模式不使用 HighScore buff，统一使用 `ScoreCalculationType.Normal`。

---

## 九、Keiko（稽古/练习）模式说明

Keiko 模式是通常模式的简化版：
- 每张卡只发动一次 Sense，不做完整时间轴模拟
- `leader` 自动设为第一个非空角色
- Sense 加分 = `floor(finalStat × statExtra × sense.scoreUp / 100)`
- 不计算 StarAct
- 不适用三幕公演

---

## 十、相册优化（handleOptimizeAlbum）的差异

### 通常模式

```javascript
getScore = () => {
  calc = new ScoreCalculator(party, items);
  calc.calc();
  return baseScore[0] + senseScore + starActScore;
}
```

单次计算即可得到总分。

### 三幕公演模式

```javascript
getScore = () => {
  // 1. Pass1：3轴独立计算
  // 2. 3轮 Jacobi 迭代（带 provider）
  // 3. 最终 Pass 计算总分
  return total;
}
```

每次尝试一张新相册照片时，都需要完成完整的 **1 + 3 + 1 = 5 次** 全量计算（3 轴 × 5 次 = 15 次 ScoreCalculator 实例化）。这使得三幕公演的相册优化耗时远大于通常模式。

优化算法本身（贪心选择最大增益）两种模式一致，但每次评估分数的代价不同。

---

## 十一、数据流对比图

### 通常模式

```
PartyManager.currentParty
    │
    ▼
ScoreCalculator(members, posters, accessories, extra)
    │
    ├── StatCalculator → finalTotal → baseScore
    │
    └── LiveSimulator(notationId)
          │
          ├── 按时间线处理 Sense/StarAct
          ├── 每个节点：加分、加光、触发效果
          └── 输出 scoreTimeline + senseScore[] + starActScore[]
    
总分 = baseScore + ΣsenseScore + ΣstarActScore
```

### 三幕公演模式

```
TripleCastManager.axes[0..2].party
    │
    ▼ Pass 1（独立）
ScoreCalculator[0] → scoreTimeline[0] ─┐
ScoreCalculator[1] → scoreTimeline[1]  ├─ passData
ScoreCalculator[2] → scoreTimeline[2] ─┘
    │
    ▼ Jacobi × 3
    │  ┌─────────────────────────────────────┐
    │  │ 轴i: provider = Σ(otherAxis score)  │
    │  │ ScoreCalculator[i](provider)        │
    │  │ → 新 scoreTimeline[i]               │
    │  └─────────────────────────────────────┘
    │
    ▼ 最终汇总
mergedTimeline（按时间合并3轴）
总分 = ΣbaseScore + ΣsenseScore + ΣstarActScore（跨3轴累加）
```

---

## 十二、关键代码索引

| 功能 | 文件 | 方法/位置 |
|------|------|----------|
| 通常模式计算入口 | `RootLogic.js` | `update()` → `else` 分支 |
| 三幕公演计算入口 | `RootLogic.js` | `update()` → `triple` 分支 |
| 属性计算 | `StatCalculator.js` | `calc()` |
| 基础分公式 | `ScoreCalculator.js` | `calc()` L297-303 |
| Sense 模拟 | `LiveSimulator.js` | `trySense()` / `applySenseEffects()` |
| StarAct 模拟 | `LiveSimulator.js` | `tryStarAct()` |
| 当前总分计算 | `LiveSimulator.js` | `getScoreRightNow()` |
| 百分比加分效果 | `ScoreGainOnScore.js` | `applyEffect()` |
| Provider 构建 | `RootLogic.js` | `makeProvider()` / `buildAxisScoreFn()` |
| 相册优化（通常） | `RootLogic.js` | `handleOptimizeAlbum()` → `!isTriple` |
| 相册优化（三幕） | `RootLogic.js` | `handleOptimizeAlbum()` → `isTriple` |
| 编队管理 | `PartyManager.js` | `init()` / `changeParty()` |
| 三幕编队管理 | `TripleCastManager.js` | `init()` / `changeParty()` |

---

## 十三、总结

| 对比项 | 通常模式 | 三幕公演模式 |
|--------|---------|-------------|
| 队伍数 | 1 | 3（独立编队） |
| 时间轴 | 1 条 | 3 条（可不同） |
| 计算复杂度 | O(n) 单 pass | O(5n) 1 pass + 3 Jacobi + 1 final |
| 百分比加分基数 | 仅本队当前分 | 本队 + 其他两轴在该时刻的总分 |
| 是否需要迭代 | 否 | 是（Jacobi 收敛跨轴耦合） |
| 相册优化代价 | 每次评估 = 1 次 calc | 每次评估 = 5 次 calc × 3 轴 |
| 分数汇总 | 单队 4 档分数 | 3 队各自 4 档，合并为总分 4 档 |
| 时间线 | 单队 sense 节点 | 3 轴合并的统一时间线 |
