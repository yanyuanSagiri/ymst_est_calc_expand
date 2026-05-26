# ScoreCalculator.calc() 方法逻辑详解

## 概述

`calc(node)` 是分数计算器的核心方法，负责从角色/海报/饰品编队计算出最终演出分数。

`node` 参数是可选的 DOM 容器，传入时会渲染详细的计算过程面板；不传入时只计算数值（用于批量遍历优化配队）。

---

## 执行流程

### 1. 初始化与队长确定

```
calc(node) → 清空 node → 确定队长 → 重置角色效果
```

- **练习模式（Keiko）**：自动选第一个非空角色作为队长
- **其他模式**：使用 `extra.leader` 指定的队长
- 如果没有队长，直接 `return`（不计算）
- 调用 `members.forEach(i => i.resetEffects())` 重置所有角色的效果状态

---

### 2. 高分 Buff 效果（HighScoreBuff）

```javascript
root.appState.highScoreBuffManager.currentActiveEffects()
```

- 获取当前激活的高分加成效果
- 根据 `effect.Range` 判断是全员（`All`→1人）还是单人（5人遍历）
- 对每个目标检查 `canTrigger(this, idx)`，通过后 `applyEffect`，归类为 `StatBonusType.Other`

---

### 3. 相册效果（Album Effects）

分两部分处理：

#### 3.1 全局相册等级效果

```javascript
GameDb.AlbumEffect → 按 extra.albumLevel 过滤 → canTrigger → applyEffect
```

- 遍历所有相册等级效果
- 等级不足的跳过
- 通过触发条件检查后加入 `passiveEffects.album` 队列

#### 3.2 用户自定义相册照片效果（albumExtra）

```javascript
extra.albumExtra.forEach(i => { ... })
```

- 只处理 `enabled` 的照片效果
- **有角色相关触发条件**（CharacterBase/Character/Company/Attribute/SenseType/CharacterBaseGroup）：
  - 逐个角色检查 `canTrigger`
  - 找到所有匹配的角色索引
  - 如果效果 Range 是 `All`，临时改为 `Self` 逐人施加（避免重复计算）
  - 恢复原始 Range
- **无角色触发条件 / 通用触发条件**：
  - 直接加入 `passiveEffects.album` 队列

#### 3.3 统一施加相册被动效果

```javascript
passiveEffects.album.forEach(i => i.effect.applyEffect(this, i.source, StatBonusType.Album))
```

---

### 4. 角色效果处理

```javascript
members.forEach((chara, idx) => {
  chara.bloomBonusEffects → applyEffect (StatBonusType.Album)
})
```

- 设置 StarAct 需求光数
- 施加每个角色的**开花（Bloom）额外效果**
- 处理**储光型 StarAct**（StorageSenseLightCount）的特殊逻辑：
  - `maxStockCount`：最大储光数
  - `stockType`：储光类型

---

### 5. 谱面 Buff 效果（Notation Buffs）

```javascript
GameDb.SenseNotation[notationId].Buffs
```

- 仅在**非练习模式**下生效
- 遍历谱面定义的全局 Buff
- 按类型匹配目标角色：
  - `None`：全员
  - `Attribute`：属性匹配
  - `Company`：剧团匹配
  - `Character`：角色 ID 匹配
- 匹配成功后累加到 `stat.buffAfterCalc[idx]`

---

### 6. 队长 Sense 效果（Leader Sense）

```javascript
leader.leaderSense.Details.forEach(detail => { ... })
```

- 仅在**非练习模式**下生效
- 遍历队长 Sense 的每个 Detail 条目
- 对每个角色检查**分类条件**（CategoryMasterId1~5）
- 所有条件分类都匹配时：
  - 记录匹配的分类到 `memberMatchingCategories[idx]`
  - 施加效果（`StatBonusType.Actor`）

---

### 7. 海报与饰品效果

```javascript
members.forEach((_chara, idx) => {
  // 海报
  poster.abilities → 检查解锁 → 检查 Leader 类型 → 获取活跃分支 → applyEffect
  
  // 饰品
  accessory.mainEffects → 检查 FireTimingType → canTrigger → applyEffect
  accessory.randomEffect → 同上
})
```

#### 海报效果
- 遍历每个位置的海报能力
- 跳过未解锁的能力
- `Leader` 类型的能力只在队长位生效
- 获取当前活跃分支（根据 LiveSim 状态判断）
- 只处理 `Passive` 和 `StartLive` 时点效果

#### 饰品效果
- 遍历主效果和随机效果
- 只处理 `Passive` 和 `StartLive` 时点效果
- 检查触发条件后施加

---

### 8. 剧场效果（Theater Effects）

```javascript
root.appState.theaterLevel.getEffects() → applyEffect (StatBonusType.Theater)
```

---

### 9. 属性计算与基础分

```javascript
this.stat.calc()  // 汇总所有加成，计算最终属性

baseScore = [0.95, 0.97, 1, 1.05].map(coef =>
  Math.floor(
    Math.floor((stat.finalTotal * statExtra) / 100)
    * 10
    * (1 + passiveEffects.baseScoreUp / 10000)
    * coef
  )
)
```

- `statExtra`：星阶加成系数（默认 100，每星阶 +30）
- `stat.finalTotal`：5 人最终演技力总和
- 基础分公式：`floor(floor(总演技力 × statExtra%) × 10 × (1 + baseScoreUp/10000) × 系数)`
- 4 个系数对应不同难度的分数倍率：`0.95 / 0.97 / 1.0 / 1.05`

---

### 10. 分支处理

#### 10.1 练习模式（Keiko）

- 每张卡发动一次 Sense，只计算加分
- `score = floor(最终演技力 × statExtra% × sense.scoreUp)`
- 不运行演出模拟
- 直接 `return`

#### 10.2 编队不完整

- 如果 `members` 中有 `null`，只输出基础分面板后 `return`

#### 10.3 跳过模拟（skipSimulation）

- 三幕公演模式使用
- 只设置 StarAct 需求，不运行模拟
- `return`

#### 10.4 正常模式

- 运行 `liveSim.runSimulation(node)` 执行完整的演出模拟
- 模拟过程中会动态计算 Sense 分和 StarAct 分
- 如果模拟被取消（saDelay 重试），直接 `return`

---

### 11. 最终结果输出

```javascript
result = {
  baseScore: [4个系数对应的基础分],
  senseScore: [各 Sense 时点的加分],
  starActScore: [各 StarAct 时点的加分],
  starActCount: StarAct 发动次数
}
```

最终总分 = `baseScore[3] + sum(senseScore) + sum(starActScore)`

---

## 数据流图

```
输入: members[5], posters[5], accessories[5], extra
  │
  ├─→ 高分Buff ──────────────────→ stat.buffAfterCalc
  ├─→ 相册等级效果 ──────────────→ passiveEffects.album
  ├─→ 相册照片效果 ──────────────→ passiveEffects.album / 直接apply
  ├─→ 角色开花效果 ──────────────→ 直接apply
  ├─→ 谱面Buff ──────────────────→ stat.buffAfterCalc
  ├─→ 队长Sense ─────────────────→ 直接apply (Actor)
  ├─→ 海报效果 ──────────────────→ 直接apply (Poster)
  ├─→ 饰品效果 ──────────────────→ 直接apply (Accessory)
  ├─→ 剧场效果 ──────────────────→ 直接apply (Theater)
  │
  ├─→ stat.calc() ───────────────→ stat.finalTotal
  │     └─ 汇总: 初始属性 + Album + Actor + Poster + Accessory + Theater + buffAfterCalc
  │
  ├─→ baseScore = f(finalTotal, statExtra, baseScoreUp)
  │
  └─→ liveSim.runSimulation()
        ├─→ senseScore (Sense 时点加分)
        ├─→ starActScore (StarAct 时点加分)
        └─→ starActCount
              
输出: result = { baseScore, senseScore, starActScore, starActCount }
```

---

## StatBonusType 分类

| 类型 | 来源 |
|------|------|
| `Other` | 高分Buff |
| `Album` | 相册等级/照片/角色开花 |
| `Actor` | 队长Sense |
| `Poster` | 海报效果 |
| `Accessory` | 饰品效果 |
| `Theater` | 剧场效果 |

---

## 关键设计要点

1. **效果施加顺序重要**：高分Buff → 相册 → 角色 → 谱面 → 队长Sense → 海报 → 饰品 → 剧场 → stat.calc()
2. **双人卡处理**：`minimalCombinationCount` 穷举所有剧团组合取最小数；属性双色都计入
3. **相册 Range=All 的特殊处理**：有角色触发条件时临时改为 `Self` 逐人施加
4. **skipSimulation**：三幕公演模式复用 ScoreCalculator 但跳过模拟阶段，只计算面板数据
5. **baseScore[3]**（1.05 系数）是通常模式的基准分，Sense/StarAct 加分以此为基础计算
