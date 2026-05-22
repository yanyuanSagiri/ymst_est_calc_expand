# 通常（试音/排位）vs 三幕公演 —— 算分逻辑深度对比

## 一、模式概览

| 维度 | 通常（Normal / Highscore） | 三幕公演（Triple Cast） |
|------|--------------------------|----------------------|
| 编队数量 | **1 支队伍**（5 人 + 5 海报 + 5 饰品） | **3 支独立队伍**（各自 5 人 + 5 海报 + 5 饰品） |
| 时间轴数量 | **1 条** SenseNotation | **3 条** SenseNotation（可各不相同） |
| 计算次数 | **单次** ScoreCalculator → LiveSimulator | **1 次独立计算 + 3 轮 Jacobi 迭代**（共 4×3=12 次 ScoreCalculator） |
| 管理器 | `PartyManager`（单编队） | `TripleCastManager`（三轴编队） |
| 跨轴交互 | 无 | 有——通过 `tripleCastScoreProvider` 实现 |
| 最终得分 | `baseScore + senseScore + starActScore` | 三轴各自的 `baseScore + senseScore + starActScore` **求和** |

---

## 二、核心计算流程

### 2.1 通常模式（Normal）

```
┌─────────────────────────────────────────────────────────┐
│                    ScoreCalculator.calc()                 │
│                                                         │
│  1. 初始化                                                │
│     - StatCalculator 计算初始面板数值                       │
│     - 应用 passiveEffects（相册/海报/饰品/剧场等级）         │
│     - 应用 LeaderSense（队长技能加成）                      │
│     - 应用 Notation Buff（时间轴 Buff）                    │
│     - 应用 HighScore Buff（高分挑战专属，仅 Highscore 模式）  │
│     - StatCalculator.calc() → finalTotal                 │
│                                                         │
│  2. 基础分计算                                             │
│     baseScore = floor(floor(finalTotal × statExtra/100)  │
│                   × 10 × (1 + baseScoreUp/10000) × coef)│
│     coef ∈ {0.95, 0.97, 1.00, 1.05}                     │
│                                                         │
│  3. LiveSimulator.runSimulation()                        │
│     → 遍历时间轴每个 timing 节点                            │
│     → 逐节点触发 Sense 发动 → 灯光收集 → StarAct 发动       │
│     → 累计 senseScore / starActScore                     │
│     → 记录 scoreTimeline                                 │
│                                                         │
│  4. 输出                                                  │
│     total = baseScore + ΣsenseScore + ΣstarActScore      │
└─────────────────────────────────────────────────────────┘
```

**关键特点：**
- 整个计算是一条**线性流程**：统计面板 → 被动效果 → 模拟演出 → 汇总得分
- `tripleCastScoreProvider` 为 `undefined`，`getScoreRightNow()` 只返回本队当前分数
- 百分比加分效果（ScoreGainOnScore）的基数 = **本队当前总分**

### 2.2 三幕公演模式（Triple Cast）

```
┌──────────────────────────────────────────────────────────────┐
│                  三幕公演计算流程（4 阶段）                      │
│                                                              │
│  ════════ 阶段 1：Pass1 独立计算（无跨轴） ════════             │
│  for axisIdx in [0, 1, 2]:                                   │
│    calc = new ScoreCalculator(party, extra={                  │
│      notationId: axisNotation,                                │
│      tripleCastScoreProvider: undefined   ← 无跨轴加分         │
│    })                                                        │
│    calc.calc() → 收集 baseScore, scoreTimeline                │
│                                                              │
│  ════════ 阶段 2：构建跨轴 Provider ════════                    │
│  tripleCastPassData[i] = {                                   │
│    baseScore: axisBaseScores[i],                              │
│    lastTiming: liveSim.lastSenseTiming,                       │
│    timeline: liveSim.scoreTimeline                            │
│  }                                                           │
│                                                              │
│  buildAxisScoreFn(passData) → (time) => {                    │
│    从 timeline 插值得到 ≤time 的 cumulativeSense+StarAct      │
│    return (baseTotal × time / lastTiming) + sense + starAct  │
│  }                                                           │
│                                                              │
│  makeProvider(forAxisIdx, passData) → (time) => {            │
│    return Σ otherAxisScoreFn(time)  // 不含自身               │
│  }                                                           │
│                                                              │
│  ════════ 阶段 3：Jacobi 迭代（3 轮） ════════                 │
│  for round in [0, 1, 2]:                                     │
│    for axisIdx in [0, 1, 2]:                                 │
│      calc = new ScoreCalculator(party, extra={                │
│        notationId: axisNotation,                              │
│        tripleCastScoreProvider: makeProvider(axisIdx, passData)│
│      })                                                      │
│      calc.calc() → 收集新的 scoreTimeline                     │
│    更新 passData 为本轮新的 timelines                          │
│                                                              │
│  ════════ 阶段 4：汇总结果 ════════                            │
│  totalBaseScore = Σ axisBaseScore                            │
│  totalSenseScore = Σ axisSenseScore                          │
│  totalStarActScore = Σ axisStarActScore                      │
│  total = totalBase + totalSense + totalStarAct               │
│                                                              │
│  → 构建 mergedTimeline（按时间排序三轴事件）                     │
│  → 存入 tripleCastScores 供 UI 渲染                          │
└──────────────────────────────────────────────────────────────┘
```

---

## 三、评分公式详解

### 3.1 基础分（Base Score）

两者**公式完全相同**：

```
baseScore[i] = floor(
  floor(finalTotal × statExtra / 100)
  × 10
  × (1 + baseScoreUp / 10000)
  × coef[i]
)
```

| 变量 | 含义 | 来源 |
|------|------|------|
| `finalTotal` | 5 人最终演技力之和 | `StatCalculator.calc()` |
| `statExtra` | 星阶分数加成（100 + starRankBonus × 30） | `CharacterStarRankData` |
| `baseScoreUp` | 基础分加成（被动效果） | 相册/海报/饰品 |
| `coef` | 评价系数 | `[0.95, 0.97, 1.00, 1.05]` 对应 S/SS/SSS/SSS+ |

**注意**：`baseScore` 有 4 个值（对应 4 个评价等级），最终取哪个取决于演出评价。

### 3.2 Sense 分（Sense Score）

在 `LiveSimulator.applySenseEffects()` 中计算：

```
senseScore = floor(total × multiplier)
```

```
total = final[idx].total × (1 + performanceDuplicateUp[idx] / 100)
multiplier = sense.scoreUp
           × (1 + pGauge / 1000)
           × (1 + extraBuffMul)
           × Π(standaloneMultiplier)
```

| 变量 | 含义 |
|------|------|
| `final[idx].total` | 该成员的最终演技力（单人） |
| `sense.scoreUp` | Sense 基础倍率 |
| `pGauge` | P.ゲージ 当前值 |
| `extraBuffMul` | Sense 发动时生效的加成效果总和 |
| `standaloneMultiplier` | 独立乘区加成（如 SABoost 等） |

**三幕公演差异**：Sense 分的**计算公式不变**，但百分比加分效果的基数会因跨轴 provider 而不同（见 3.3）。

### 3.3 百分比加分（ScoreGainOnScore）—— 核心差异点

这是两种模式**唯一的算法差异**所在。

#### ScoreGainOnScore 机制

某些效果会在 Sense/StarAct 发动时产生**"当前总分 × X%"** 的额外加分：

```javascript
// ScoreGainOnScore.js
const scoreRightNow = liveSim.getScoreRightNow();
const score = floor(scoreRightNow × effect.Value / 10000);
```

#### 通常模式下的 `getScoreRightNow()`

```javascript
// LiveSimulator.getScoreRightNow()
getScoreRightNow() {
  const localScore =
    (baseScore × currentTiming) / lastSenseTiming
    + ΣsenseScore
    + ΣstarActScore;
  // provider 为 undefined，直接返回本队分
  return localScore;
}
```

**基数 = 本队的当前累计总分**（基础分按时间比例 + 累计 Sense 分 + 累计 SA 分）。

#### 三幕公演下的 `getScoreRightNow()`

```javascript
getScoreRightNow() {
  const localScore = ...; // 同上
  const provider = this.calc.extra.tripleCastScoreProvider;
  if (provider) {
    return localScore + provider(this.currentTiming);
    //     ^本轴分   ^其他两轴在该时间点的分数之和
  }
  return localScore;
}
```

**基数 = 本轴当前分 + 其他两轴在同时间点的总分**。

Provider 的构建逻辑：
```javascript
// buildAxisScoreFn: 对某轴的时间线插值
(time) => {
  for (i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i].time <= time) {
      sense = timeline[i].cumulativeSenseScore;
      starAct = timeline[i].cumulativeStarActScore;
      break;
    }
  }
  return (baseTotal × time / lastTiming) + sense + starAct;
}

// makeProvider: 求其他轴在 time 时刻的分数之和
(time) => {
  sum = 0;
  for (i = 0; i < 3; i++) {
    if (i === forAxisIdx) continue; // 排除自身
    sum += otherAxisScoreFn(time);
  }
  return sum;
}
```

---

## 四、为什么三幕公演需要 Jacobi 迭代？

### 4.1 问题本质：耦合系统

在三幕公演中，百分比加分效果形成了**循环依赖**：

```
轴0 的 Sense 分 ← 依赖 → 轴1 + 轴2 的当前分
轴1 的 Sense 分 ← 依赖 → 轴0 + 轴2 的当前分
轴2 的 Sense 分 ← 依赖 → 轴0 + 轴1 的当前分
```

各轴在同一时间点的 Sense 发动会互相影响对方的加分基数。这不是简单的先后关系，而是一个**联立方程组**。

### 4.2 Jacobi 迭代法求解

采用经典的 **Jacobi 迭代法** 来逼近真实解：

```
Round 0 (Pass1):  用 0 作为其他轴的分数 → 得到初始解 x₀
Round 1 (Iter1):  用 x₀ 作为其他轴的分数 → 得到改进解 x₁
Round 2 (Iter2):  用 x₁ 作为其他轴的分数 → 得到改进解 x₂
Round 3 (Iter3):  用 x₂ 作为其他轴的分数 → 得到最终解 x₃（取此轮结果）
```

**实际观察**：经过 3 轮迭代后，分数变化已经极小（收敛），足以满足计算精度。

### 4.3 通常模式不需要迭代

通常模式只有 1 支队伍、1 条时间轴，百分比加分只依赖**自身当前分**，不存在耦合关系，**单次模拟即可得出精确结果**。

---

## 五、演技力计算（StatCalculator）—— 两者完全相同

```
StatCalculator 流程:

1. initial[i] = 角色面板数值（含等级/开花/剧情加成）

2. buff 分 5 类来源，每类含 [百分比, 固定值]：
   [0] Album（相册）
   [1] Actor（队长技能）
   [2] Poster（海报）
   [3] Accessory（饰品）
   [4] Other（其他，含时间轴 Buff / HighScore Buff）

3. 百分比上限 200%（20000/100），按优先级依次扣减

4. bonus[i] = initial[i] × buff百分比 + buff固定值

5. finalBeforeBuff = initial + totalBonus + attributeExtra

6. final = finalBeforeBuff × buffAfterCalc（时间轴效果/演出后额外加成）

7. finalTotal = Σ final[i].total（5 人之和）
```

**重要**：此部分在两种模式下**完全一致**，差异只发生在 LiveSimulator 的演出模拟阶段。

---

## 六、关键数据结构对比

### 6.1 编队结构

```
通常模式:
  PartyManager.currentParty
    ├── characters[5]
    ├── posters[5]
    ├── accessories[5]
    └── leader

三幕公演:
  TripleCastManager
    ├── axes[0].party → { characters[5], posters[5], accessories[5], leader }
    ├── axes[1].party → { characters[5], posters[5], accessories[5], leader }
    └── axes[2].party → { characters[5], posters[5], accessories[5], leader }
```

### 6.2 计算结果结构

```
通常模式:
  calc.result = {
    baseScore: [S, SS, SSS, SSS+],
    senseScore: [s1, s2, s3, ...],
    starActScore: [sa1, sa2, ...],
    starActCount: N
  }
  total = baseScore[k] + ΣsenseScore + ΣstarActScore

三幕公演:
  tripleCastScores = {
    axes: [
      { baseScore, senseScore, starActScore, starActCount, totalScore },
      { ... },
      { ... }
    ],
    mergedTimeline: [
      { time, axisIdx, totalSense, totalStarAct, totalStarActCount, ... },
      ...
    ]
  }
  total = Σ(axes[i].baseScore) + Σ(axes[i].senseScore) + Σ(axes[i].starActScore)
```

### 6.3 Extra 参数差异

```
通��模式 extra:
  {
    albumLevel, albumExtra,
    leader,
    type: "Normal" | "Highscore",
    notationId: 由 senseNoteSelect 决定
  }

三幕公演 extra:
  {
    albumLevel, albumExtra,
    leader,
    type: "Normal",     // 三幕公演始终用 Normal 类型
    notationId: 各轴独立,
    tripleCastScoreProvider: (time) => number,  // 核心差异！
    senseBoxRef: 各轴独立的 UI 容器
  }
```

---

## 七、相册优化（handleOptimizeAlbum）差异

### 通常模式

```javascript
// 简单的贪心算法
for (step in 1..42) {
  for (each unused photo) {
    photo.enabled = true;
    score = calcTotalScore();  // 单次计算
    gain = score - currentScore;
    photo.enabled = false;
  }
  select bestGain photo → enabled = true;
}
```

### 三幕公演模式

```javascript
// 贪心算法 + 每次评估都需要完整 Jacobi 迭代
for (step in 1..42) {
  for (each unused photo) {
    photo.enabled = true;
    score = calcTripleScore();  // 1次Pass1 + 3轮Jacobi + 最终汇总
    gain = score - currentScore;
    photo.enabled = false;
  }
  select bestGain photo → enabled = true;
}
```

**注意**：三幕公演模式下每次评估候选相册都要跑完整的多轮迭代，计算量是通常模式的约 **12 倍**（3轴 × 4轮）。

---

## 八、UI 层差异

| UI 元素 | 通常模式 | 三幕公演模式 |
|---------|---------|------------|
| 时间轴选择 | 1 个下拉框 | 3 个独立下拉框（每轴一个） |
| 谱面渲染 | 1 个 senseBox | 3 个独立 senseBox |
| 编队区域 | PartyManager 容器 | 3 个 axisSection（横向排列） |
| 结果显示 | calcResult 单个容器 | 3 个 axisResults + tripleCastTotalResult |
| 队长选择 | `name="leader"` | `name="leader-triple-{axisIdx}"` |
| 拖拽换位 | 1 个 Swappable | 3 个独立 Swappable |

---

## 九、总结

```
                    通常（试音/排位）              三幕公演
                    ──────────────              ─────────
编队               1 队                          3 队独立
时间轴             1 条                          3 条独立
面板计算           完全相同                       完全相同
基础分公式         完全相同                       完全相同
Sense 分公式       完全相同                       完全相同
StarAct 分公式     完全相同                       完全相同
百分比加分基数     本队当前分                     本轴当前分 + 其他两轴当前分
计算方式           单次模拟                       Pass1 + 3轮 Jacobi 迭代
跨轴依赖           无                            有（ScoreGainOnScore 耦合）
相册优化           每次单次计算                    每次完整多轮迭代
```

**一句话总结**：三幕公演的核心特殊之处在于——百分比加分效果的基数需要参考**所有三轴在当前时刻的累计总分**，而各轴的分数又依赖于其他轴的加分结果，因此需要 Jacobi 迭代来逐步收敛到精确解。其余计算逻辑（面板统计、基础分、Sense 分、StarAct 分）在两种模式下完全一致。
