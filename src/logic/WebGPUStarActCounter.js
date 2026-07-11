/**
 * WebGPU 加速的 starActCount 计算模块
 *
 * 使用排列池（permutation pools）模式，避免 CPU 侧组合爆炸。
 * GPU shader 内部枚举 角色排列 × 海报排列 × 饰品排列 的完整组合，
 * 每个 GPU 线程计算一个完整组合的 starActCount。
 */

const WORKGROUP_SIZE = 256;
const CHAR_STRIDE = 42;     // 每个角色数据 42 个 u32
const EFFECT_STRIDE = 33;   // 每个海报/饰品效果数据 33 个 u32 (1 count + 8 entries × 4 fields)
const EFFECT_MAX_ENTRIES = 8; // 每个海报/饰品最多 8 条效果
const REQ_SIZE = 8;          // StarAct 需求 8 个 u32

// 基于排列池的 shader：每个线程从排列池中查找索引，内部组合
const SHADER_CODE = /* wgsl */ `
struct CharData {
  senseType: u32,
  lightCount: u32,
  ct: f32,
  // 多 Sense 类型
  numSenses: u32,
  senseType1: u32,
  lightCount1: u32,
  ct1: f32,
  senseType2: u32,
  lightCount2: u32,
  ct2: f32,
  senseType3: u32,
  lightCount3: u32,
  ct3: f32,
  senseType4: u32,
  lightCount4: u32,
  ct4: f32,
  // 被动效果额外灯光（角色自身 bloomBonus，无条件）
  extraLight0: u32,
  extraLight1: u32,
  extraLight2: u32,
  extraLight3: u32,
  extraLight4: u32,
  // Sense PreEffect/BranchEffect 额外灯光（按槽位）
  slotPreSelf0: u32,
  slotPreSelf1: u32,
  slotPreSelf2: u32,
  slotPreSelf3: u32,
  slotPreSelf4: u32,
  slotPreExtra0: u32,
  slotPreExtra1: u32,
  slotPreExtra2: u32,
  slotPreExtra3: u32,
  slotPreExtra4: u32,
  // 需求减少
  decreaseReq0: u32,
  decreaseReq1: u32,
  decreaseReq2: u32,
  decreaseReq3: u32,
  // wrongLightToSp
  wrongLightToSp: u32,
  // 角色属性（用于效果 trigger 条件检查）
  companyId1: u32,
  companyId2: u32,
  attributeId1: u32,
  attributeId2: u32,
  characterBaseId1: u32,
  characterBaseId2: u32,
}

// 海报/饰品效果数据：逐条存储，每条带 trigger 信息
// 布局：[count, field0, value0, triggerType0, triggerValue0, field1, value1, ...]
// field: 0=selfLightBonus, 1=extraLight0(Support), 2=extraLight1(Control),
//        3=extraLight2(Amplification), 4=extraLight3(Special), 5=extraLight4(Variable),
//        6=decreaseReq0, 7=decreaseReq1, 8=decreaseReq2, 9=decreaseReq3, 10=recastDown
// triggerType: 0=无条件, 1=Company, 2=Attribute, 3=SenseType, 4=CharacterBase

struct Timing {
  time: f32,
  position: u32,
}

struct StarActReq {
  req0: u32,
  req1: u32,
  req2: u32,
  req3: u32,
  req4: u32,
  stockType: u32,
  maxStockCount: u32,
  padding: u32,
}

struct Params {
  posterPermCount: u32,
  accPermCount: u32,
  posterSlots: u32,
  leaderCharIdx: u32,
  leaderPosterIdx: u32,
  timingCount: u32,
  batchOffset: u32,
  batchSize: u32,
}

@group(0) @binding(0) var<storage, read> timeline: array<Timing>;
@group(0) @binding(1) var<storage, read> charDataPool: array<CharData>;
@group(0) @binding(2) var<storage, read> posterDataPool: array<u32>;
@group(0) @binding(3) var<storage, read> accDataPool: array<u32>;
@group(0) @binding(4) var<storage, read> charPermPool: array<u32>;
@group(0) @binding(5) var<storage, read> posterPermPool: array<u32>;
@group(0) @binding(6) var<storage, read> accPermPool: array<u32>;
@group(0) @binding(7) var<storage, read> starActReqData: StarActReq;
@group(0) @binding(8) var<storage, read_write> output: array<u32>;
@group(0) @binding(9) var<uniform> params: Params;

const EFFECT_STRIDE_W: u32 = 33u; // 1 + 8 * 4
const EFFECT_MAX_ENTRIES_W: u32 = 8u;

// 读取海报/饰品效果并检查 trigger 条件
// 返回：[selfLightBonus, extraLight0-4, decreaseReq0-3, recastDown] 共 11 个值
fn readEffectsWithTrigger(
  effectPool: ptr<storage, array<u32>, read>,
  effectIdx: u32,
  cd: CharData,
) -> array<u32, 11> {
  var result: array<u32, 11> = array<u32, 11>(0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u);
  let base = effectIdx * EFFECT_STRIDE_W;
  let count = effectPool[base];
  for (var e = 0u; e < count && e < EFFECT_MAX_ENTRIES_W; e++) {
    let entryBase = base + 1u + e * 4u;
    let field = effectPool[entryBase];
    let value = effectPool[entryBase + 1u];
    let triggerType = effectPool[entryBase + 2u];
    let triggerValue = effectPool[entryBase + 3u];

    // 检查 trigger 条件
    var matches = false;
    if (triggerType == 0u) {
      matches = true; // 无条件
    } else if (triggerType == 1u) {
      // Company
      matches = (cd.companyId1 == triggerValue || cd.companyId2 == triggerValue);
    } else if (triggerType == 2u) {
      // Attribute
      matches = (cd.attributeId1 == triggerValue || cd.attributeId2 == triggerValue);
    } else if (triggerType == 3u) {
      // SenseType
      matches = (cd.senseType == triggerValue);
    } else if (triggerType == 4u) {
      // CharacterBase
      matches = (cd.characterBaseId1 == triggerValue || cd.characterBaseId2 == triggerValue);
    } else {
      matches = true; // 未知 trigger，上界估算
    }

    if (matches && field < 11u) {
      result[field] += value;
    }
  }
  return result;
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let localIdx = gid.x;
  let posterAccCount = params.posterPermCount * params.accPermCount;
  let cpLocalIdx = localIdx / posterAccCount;
  if (cpLocalIdx >= params.batchSize) { return; }
  let remainder = localIdx % posterAccCount;
  let ppIdx = remainder / params.accPermCount;
  let apIdx = remainder % params.accPermCount;
  let cpIdx = params.batchOffset + cpLocalIdx;

  // 从排列池获取角色索引
  let cpBase = cpIdx * 5u;
  var ci: array<u32, 5>;
  for (var i = 0u; i < 5u; i++) {
    ci[i] = charPermPool[cpBase + i];
  }

  // 找到队长位置
  var leaderPos = 0u;
  for (var i = 0u; i < 5u; i++) {
    if (ci[i] == params.leaderCharIdx) {
      leaderPos = i;
      break;
    }
  }

  // 构建完整的 5 位置海报索引（队长海报插入队长位置）
  var pi: array<u32, 5>;
  var ppOffset = 0u;
  for (var i = 0u; i < 5u; i++) {
    if (i == leaderPos && params.leaderPosterIdx != 0xFFFFFFFFu) {
      pi[i] = params.leaderPosterIdx;
    } else {
      pi[i] = posterPermPool[ppIdx * params.posterSlots + ppOffset];
      ppOffset++;
    }
  }

  // 从排列池获取饰品索引
  let apBase = apIdx * 5u;
  var ai: array<u32, 5>;
  for (var i = 0u; i < 5u; i++) {
    ai[i] = accPermPool[apBase + i];
  }

  // 合并每个位置的角色 + 海报 + 饰品效果
  var combinedLightCount: array<u32, 5>;
  var combinedSelfLightBonus: array<u32, 5>; // 海报+饰品的 selfLightBonus（预计算）
  var combinedSenseType: array<u32, 5>;
  var combinedCtAll: array<array<f32, 5>, 5>; // [pos][senseSlot]
  var combinedExtra: array<array<u32, 5>, 5>;

  for (var pos = 0u; pos < 5u; pos++) {
    let cd = charDataPool[ci[pos]];

    // 读取海报/饰品效果（带 trigger 检查）
    let pd = readEffectsWithTrigger(&posterDataPool, pi[pos], cd);
    let ad = readEffectsWithTrigger(&accDataPool, ai[pos], cd);
    // pd/ad: [0]=selfLightBonus, [1-5]=extraLight0-4, [6-9]=decreaseReq0-3, [10]=recastDown

    combinedSenseType[pos] = cd.senseType;
    combinedSelfLightBonus[pos] = pd[0] + ad[0]; // selfLightBonus
    combinedLightCount[pos] = cd.lightCount + combinedSelfLightBonus[pos];
    let recastDown = f32(pd[10]) + f32(ad[10]); // recastDown

    // 为每个 Sense 槽位计算独立 CT
    combinedCtAll[pos][0] = select(0.0, cd.ct - recastDown, cd.ct > recastDown);
    combinedCtAll[pos][1] = select(0.0, cd.ct1 - recastDown, cd.ct1 > recastDown);
    combinedCtAll[pos][2] = select(0.0, cd.ct2 - recastDown, cd.ct2 > recastDown);
    combinedCtAll[pos][3] = select(0.0, cd.ct3 - recastDown, cd.ct3 > recastDown);
    combinedCtAll[pos][4] = select(0.0, cd.ct4 - recastDown, cd.ct4 > recastDown);

    combinedExtra[pos][0] = cd.extraLight0 + pd[1] + ad[1]; // extraLight Support
    combinedExtra[pos][1] = cd.extraLight1 + pd[2] + ad[2]; // extraLight Control
    combinedExtra[pos][2] = cd.extraLight2 + pd[3] + ad[3]; // extraLight Amplification
    combinedExtra[pos][3] = cd.extraLight3 + pd[4] + ad[4]; // extraLight Special
    combinedExtra[pos][4] = cd.extraLight4 + pd[5] + ad[5]; // extraLight Variable

  }

  // 实际需求（starActReq 已经是 bloomBonus 处理后的最终值，不需要再减 decreaseReq）
  var req: array<u32, 5>;
  req[0] = starActReqData.req0;
  req[1] = starActReqData.req1;
  req[2] = starActReqData.req2;
  req[3] = starActReqData.req3;
  req[4] = starActReqData.req4;
  let actualRequired = req[0] + req[1] + req[2] + req[3] + req[4];
  let stockType = starActReqData.stockType;

  // 预读 wrongLightToSp（循环外使用，从队长角色读取）
  var wltspVal: u32 = charDataPool[params.leaderCharIdx].wrongLightToSp;

  // 状态
  var starActCount = 0u;
  var holdingLights = 0u;
  var current: array<u32, 5> = array<u32, 5>(0u, 0u, 0u, 0u, 0u);
  // senseExtraAmount 累积：每次 Sense 发动时 AddSenseLightSelf 永久增加 lightCount
  var senseExtraAccum: array<u32, 5> = array<u32, 5>(0u, 0u, 0u, 0u, 0u);
  // 每个角色每个 Sense 槽位的最后激活时间
  var lastTime: array<array<f32, 5>, 5> = array<array<f32, 5>, 5>(
    array<f32, 5>(-999.0, -999.0, -999.0, -999.0, -999.0),
    array<f32, 5>(-999.0, -999.0, -999.0, -999.0, -999.0),
    array<f32, 5>(-999.0, -999.0, -999.0, -999.0, -999.0),
    array<f32, 5>(-999.0, -999.0, -999.0, -999.0, -999.0),
    array<f32, 5>(-999.0, -999.0, -999.0, -999.0, -999.0),
  );

  for (var t = 0u; t < params.timingCount; t++) {
    let time = timeline[t].time;
    let pos = timeline[t].position;
    let ci2 = pos - 1u;
    if (ci2 >= 5u) { continue; }
    let cd = charDataPool[ci[ci2]];
    if (cd.numSenses == 0u) { continue; }

    // 逐槽位 CT 检查：找到第一个 CT 已冷却完毕的 Sense 槽位
    var activatedSlot: i32 = -1;
    for (var s = 0u; s < cd.numSenses; s++) {
      if (time - lastTime[ci2][s] >= combinedCtAll[ci2][s]) {
        activatedSlot = i32(s);
        break;
      }
    }

    if (activatedSlot < 0) {
      // 没有 Sense 可激活，重置灯光
      holdingLights = 0u;
      for (var i = 0u; i < 5u; i++) { current[i] = 0u; }
      continue;
    }

    // 更新激活槽位的时间
    lastTime[ci2][u32(activatedSlot)] = time;

    // 如果激活的是 None Sense（type=5），不产生灯光但 CT 已消耗（与 CPU 行为一致）
    var activatedType: u32;
    if (activatedSlot == 0) { activatedType = combinedSenseType[ci2]; }
    else if (activatedSlot == 1) { activatedType = cd.senseType1; }
    else if (activatedSlot == 2) { activatedType = cd.senseType2; }
    else if (activatedSlot == 3) { activatedType = cd.senseType3; }
    else { activatedType = cd.senseType4; }
    if (activatedType == 5u) { continue; }

    // 获取激活槽位的 PreEffect 参数
    var slotPreSelfBonus: u32;
    var slotPreExtraAmount: u32;
    if (activatedSlot == 0) {
      slotPreSelfBonus = cd.slotPreSelf0; slotPreExtraAmount = cd.slotPreExtra0;
    } else if (activatedSlot == 1) {
      slotPreSelfBonus = cd.slotPreSelf1; slotPreExtraAmount = cd.slotPreExtra1;
    } else if (activatedSlot == 2) {
      slotPreSelfBonus = cd.slotPreSelf2; slotPreExtraAmount = cd.slotPreExtra2;
    } else if (activatedSlot == 3) {
      slotPreSelfBonus = cd.slotPreSelf3; slotPreExtraAmount = cd.slotPreExtra3;
    } else {
      slotPreSelfBonus = cd.slotPreSelf4; slotPreExtraAmount = cd.slotPreExtra4;
    }

    // PreEffect 先触发：累积 senseExtraAmount（AddSenseLightSelf 永久增加 lightCount）
    senseExtraAccum[ci2] += slotPreSelfBonus;

    // lightCount = 基础值 + 累积的 senseExtraAmount
    var activeLightCount: u32;
    if (activatedSlot == 0) {
      activeLightCount = combinedLightCount[ci2];
    } else if (activatedSlot == 1) {
      activeLightCount = cd.lightCount1 + combinedSelfLightBonus[ci2];
    } else if (activatedSlot == 2) {
      activeLightCount = cd.lightCount2 + combinedSelfLightBonus[ci2];
    } else if (activatedSlot == 3) {
      activeLightCount = cd.lightCount3 + combinedSelfLightBonus[ci2];
    } else {
      activeLightCount = cd.lightCount4 + combinedSelfLightBonus[ci2];
    }
    activeLightCount += senseExtraAccum[ci2];

    // 1. 多 Sense 类型基础灯光（所有非 None 的 Sense 类型各产生 activeLightCount 盏灯）
    for (var s = 0u; s < cd.numSenses; s++) {
      var lt: u32;
      if (s == 0u) { lt = combinedSenseType[ci2]; }
      else if (s == 1u) { lt = cd.senseType1; }
      else if (s == 2u) { lt = cd.senseType2; }
      else if (s == 3u) { lt = cd.senseType3; }
      else { lt = cd.senseType4; }

      if (lt == 5u) { continue; } // 跳过 None Sense

      for (var i = 0u; i < activeLightCount; i++) {
        if (lt == 4u) {
          if (holdingLights < actualRequired) { holdingLights++; }
        } else {
          if (current[lt] < req[lt]) { holdingLights++; current[lt]++; }
          else if (stockType == 5u || stockType - 1u == lt) { }
          else if (current[4u] < req[4u]) { holdingLights++; current[4u]++; }
        }
      }
    }

    // 2. Sense PreEffect/BranchEffect 额外灯光（仅激活槽位的效果）
    var preExtraType = combinedSenseType[ci2]; // 使用激活 Sense 的类型
    if (activatedSlot == 1) { preExtraType = cd.senseType1; }
    else if (activatedSlot == 2) { preExtraType = cd.senseType2; }
    else if (activatedSlot == 3) { preExtraType = cd.senseType3; }
    else if (activatedSlot == 4) { preExtraType = cd.senseType4; }
    for (var i = 0u; i < slotPreExtraAmount; i++) {
      if (preExtraType == 4u) {
        if (holdingLights < actualRequired) { holdingLights++; }
      } else {
        if (current[preExtraType] < req[preExtraType]) { holdingLights++; current[preExtraType]++; }
        else if (stockType == 5u || stockType - 1u == preExtraType) { }
        else if (current[4u] < req[4u]) { holdingLights++; current[4u]++; }
      }
    }

    // 3. 被动效果额外灯光
    for (var et = 0u; et < 5u; et++) {
      for (var i = 0u; i < combinedExtra[ci2][et]; i++) {
        if (et == 4u) {
          if (holdingLights < actualRequired) { holdingLights++; }
        } else {
          if (current[et] < req[et]) { holdingLights++; current[et]++; }
          else if (stockType == 5u || stockType - 1u == et) { }
          else if (current[4u] < req[4u]) { holdingLights++; current[4u]++; }
        }
      }
    }

    // StarAct 检查（不含 wrongLightToSp，与 CPU calcStarActCountOnly 一致）
    if (holdingLights >= actualRequired) {
      starActCount++;
      holdingLights = 0u;
      for (var i = 0u; i < 5u; i++) { current[i] = 0u; }
    }
  }

  // 5. wrongLightToSp：模拟结束后才转换（与 CPU calcStarActCountOnly 一致）
  var wltsp = wltspVal;
  for (var et = 0u; et < 4u; et++) {
    for (var j = 0u; j < 100u && wltsp > 0u; j++) {
      if (current[et] <= req[et]) { break; }
      current[et]--;
      if (holdingLights < actualRequired) { holdingLights++; }
      wltsp--;
    }
  }
  // 最终检查：wrongLightToSp 转换后可能再触发一次 StarAct
  if (holdingLights >= actualRequired) {
    starActCount++;
  }

  output[localIdx] = starActCount;
}
`;

// 归约 shader：找最大值（支持任意大小输入）
const REDUCE_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;
@group(0) @binding(2) var<uniform> params: array<u32, 4>;

var<workgroup> sharedMax: array<u32, 256>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>, @builtin(workgroup_id) wid: vec3<u32>, @builtin(num_workgroups) numWg: vec3<u32>) {
  let inputLen = params[0];
  let totalThreads = numWg.x * 256u;

  // 每个线程处理多个元素（stride 循环）
  var localMax = 0u;
  for (var i = gid.x; i < inputLen; i += totalThreads) {
    if (input[i] > localMax) { localMax = input[i]; }
  }
  sharedMax[lid.x] = localMax;
  workgroupBarrier();

  for (var stride = 128u; stride > 0u; stride >>= 1u) {
    if (lid.x < stride) {
      let other = sharedMax[lid.x + stride];
      if (other > sharedMax[lid.x]) { sharedMax[lid.x] = other; }
    }
    workgroupBarrier();
  }

  if (lid.x == 0u) {
    output[wid.x] = sharedMax[0];
  }
}
`;

// 筛选 shader：标记超过阈值的候选
const FILTER_SHADER = /* wgsl */ `
@group(0) @binding(0) var<storage, read> counts: array<u32>;
@group(0) @binding(1) var<storage, read_write> flags: array<u32>;
@group(0) @binding(2) var<uniform> params: array<u32, 4>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let inputLen = params[0];
  let threshold = params[1];
  if (i >= inputLen) { return; }

  flags[i] = select(0u, 1u, counts[i] >= threshold);
}
`;

export default class WebGPUStarActCounter {
  constructor() {
    this.device = null;
    this.pipeline = null;
    this.reducePipeline = null;
    this.filterPipeline = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return true;
    try {
      if (!navigator.gpu) return false;
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return false;
      this.device = await adapter.requestDevice({
        requiredLimits: {
          maxStorageBuffersPerShaderStage: Math.max(16, adapter.limits.maxStorageBuffersPerShaderStage),
        },
      });

      const makePipeline = async (code, label) => {
        const mod = this.device.createShaderModule({ code });
        try {
          return await this.device.createComputePipelineAsync({
            layout: "auto",
            compute: { module: mod, entryPoint: "main" },
          });
        } catch (e) {
          const info = await mod.getCompilationInfo();
          const msgs = info.messages.map(m => m.message).join('\n');
          console.error(`${label} pipeline failed:`, e.message, msgs);
          return null;
        }
      };

      this.pipeline = await makePipeline(SHADER_CODE, 'Main');
      this.reducePipeline = await makePipeline(REDUCE_SHADER, 'Reduce');
      this.filterPipeline = await makePipeline(FILTER_SHADER, 'Filter');
      if (!this.pipeline || !this.reducePipeline || !this.filterPipeline) return false;

      this.initialized = true;
      return true;
    } catch (err) {
      console.error("WebGPU init failed:", err);
      return false;
    }
  }

  // ===== CPU 侧效果读取（带 trigger 检查） =====

  /**
   * 从效果条目数组中读取效果并检查 trigger 条件（CPU 版）
   * @param {Array<{field: number, value: number, triggerType: number, triggerValue: number}>} entries
   * @param {Object} cd - 角色数据（含 companyId1/2, attributeId1/2, characterBaseId1/2）
   * @returns {Object} 预求和的效果值
   */
  static readEffectsWithTriggerCPU(entries, cd) {
    const result = {
      selfLightBonus: 0, extraLightSupport: 0, extraLightControl: 0,
      extraLightAmplification: 0, extraLightSpecial: 0, extraLightVariable: 0,
      decreaseReq0: 0, decreaseReq1: 0, decreaseReq2: 0, decreaseReq3: 0, recastDown: 0,
    };
    if (!entries || !Array.isArray(entries)) return result;
    const fieldNames = [
      'selfLightBonus', 'extraLightSupport', 'extraLightControl',
      'extraLightAmplification', 'extraLightSpecial', 'extraLightVariable',
      'decreaseReq0', 'decreaseReq1', 'decreaseReq2', 'decreaseReq3', 'recastDown',
    ];
    for (const entry of entries) {
      const { field, value, triggerType, triggerValue } = entry;
      let matches = false;
      if (triggerType === 0) {
        matches = true;
      } else if (triggerType === 1) {
        matches = (cd.companyId1 === triggerValue || cd.companyId2 === triggerValue);
      } else if (triggerType === 2) {
        matches = (cd.attributeId1 === triggerValue || cd.attributeId2 === triggerValue);
      } else if (triggerType === 3) {
        matches = (cd.senseType === triggerValue);
      } else if (triggerType === 4) {
        matches = (cd.characterBaseId1 === triggerValue || cd.characterBaseId2 === triggerValue);
      } else {
        matches = true;
      }
      if (matches && field >= 0 && field < fieldNames.length) {
        result[fieldNames[field]] += value;
      }
    }
    return result;
  }

  // ===== 编码方法 =====

  /** 编码角色数据 (匹配 WGSL CharData: 42 个 u32) */
  static encodeCharData(characters) {
    const buf = new ArrayBuffer(characters.length * CHAR_STRIDE * 4);
    const view = new DataView(buf);
    for (let i = 0; i < characters.length; i++) {
      const c = characters[i];
      const b = i * CHAR_STRIDE * 4;
      // 主 Sense
      view.setUint32(b + 0, c.senseType || 0, true);
      view.setUint32(b + 4, c.lightCount || 1, true);
      view.setFloat32(b + 8, c.ct || 0, true);
      // 多 Sense 类型
      view.setUint32(b + 12, c.numSenses || 0, true);
      view.setUint32(b + 16, c.senseType1 ?? 5, true);
      view.setUint32(b + 20, c.lightCount1 || 0, true);
      view.setFloat32(b + 24, c.ct1 || 0, true);
      view.setUint32(b + 28, c.senseType2 ?? 5, true);
      view.setUint32(b + 32, c.lightCount2 || 0, true);
      view.setFloat32(b + 36, c.ct2 || 0, true);
      view.setUint32(b + 40, c.senseType3 ?? 5, true);
      view.setUint32(b + 44, c.lightCount3 || 0, true);
      view.setFloat32(b + 48, c.ct3 || 0, true);
      view.setUint32(b + 52, c.senseType4 ?? 5, true);
      view.setUint32(b + 56, c.lightCount4 || 0, true);
      view.setFloat32(b + 60, c.ct4 || 0, true);
      // 被动效果额外灯光
      view.setUint32(b + 64, c.extraLightSupport || 0, true);
      view.setUint32(b + 68, c.extraLightControl || 0, true);
      view.setUint32(b + 72, c.extraLightAmplification || 0, true);
      view.setUint32(b + 76, c.extraLightSpecial || 0, true);
      view.setUint32(b + 80, c.extraLightVariable || 0, true);
      // Sense PreEffect/BranchEffect 额外灯光（按槽位）
      view.setUint32(b + 84, c.slotPreSelf0 || 0, true);
      view.setUint32(b + 88, c.slotPreSelf1 || 0, true);
      view.setUint32(b + 92, c.slotPreSelf2 || 0, true);
      view.setUint32(b + 96, c.slotPreSelf3 || 0, true);
      view.setUint32(b + 100, c.slotPreSelf4 || 0, true);
      view.setUint32(b + 104, c.slotPreExtra0 || 0, true);
      view.setUint32(b + 108, c.slotPreExtra1 || 0, true);
      view.setUint32(b + 112, c.slotPreExtra2 || 0, true);
      view.setUint32(b + 116, c.slotPreExtra3 || 0, true);
      view.setUint32(b + 120, c.slotPreExtra4 || 0, true);
      // 需求减少
      view.setUint32(b + 124, c.decreaseReq0 || 0, true);
      view.setUint32(b + 128, c.decreaseReq1 || 0, true);
      view.setUint32(b + 132, c.decreaseReq2 || 0, true);
      view.setUint32(b + 136, c.decreaseReq3 || 0, true);
      // wrongLightToSp
      view.setUint32(b + 140, c.wrongLightToSp || 0, true);
      // 角色属性（用于效果 trigger 条件检查）
      view.setUint32(b + 144, c.companyId1 || 0, true);
      view.setUint32(b + 148, c.companyId2 || 0, true);
      view.setUint32(b + 152, c.attributeId1 || 0, true);
      view.setUint32(b + 156, c.attributeId2 || 0, true);
      view.setUint32(b + 160, c.characterBaseId1 || 0, true);
      view.setUint32(b + 164, c.characterBaseId2 || 0, true);
    }
    return new Uint8Array(buf);
  }

  /**
   * 编码海报/饰品效果数据（逐条带 trigger 信息）
   * 每个条目布局：[count, field0, value0, triggerType0, triggerValue0, ...]
   * EFFECT_STRIDE = 1 + EFFECT_MAX_ENTRIES * 4 = 33
   */
  static encodeEffectData(effectEntryArrays) {
    const buf = new ArrayBuffer(effectEntryArrays.length * EFFECT_STRIDE * 4);
    const view = new DataView(buf);
    for (let i = 0; i < effectEntryArrays.length; i++) {
      const entries = effectEntryArrays[i] || [];
      const b = i * EFFECT_STRIDE * 4;
      const count = Math.min(entries.length, EFFECT_MAX_ENTRIES);
      view.setUint32(b, count, true);
      for (let e = 0; e < count; e++) {
        const entry = entries[e];
        const eb = b + (1 + e * 4) * 4;
        view.setUint32(eb, entry.field, true);
        view.setUint32(eb + 4, entry.value, true);
        view.setUint32(eb + 8, entry.triggerType, true);
        view.setUint32(eb + 12, entry.triggerValue, true);
      }
    }
    return new Uint8Array(buf);
  }

  /** 编码时间轴数据 (2 u32 per entry: time f32 + position u32) */
  static encodeTimeline(timings) {
    const buf = new ArrayBuffer(timings.length * 8);
    const f32 = new Float32Array(buf);
    const u32 = new Uint32Array(buf);
    for (let i = 0; i < timings.length; i++) {
      f32[i * 2] = timings[i].TimingSecond;
      u32[i * 2 + 1] = timings[i].Position;
    }
    return new Uint8Array(buf);
  }

  /** 编码 StarAct 需求 (REQ_SIZE u32) */
  static encodeStarActReq(starActReq, stockType) {
    const buf = new ArrayBuffer(REQ_SIZE * 4);
    const u32 = new Uint32Array(buf);
    u32[0] = starActReq[0] || 0;
    u32[1] = starActReq[1] || 0;
    u32[2] = starActReq[2] || 0;
    u32[3] = starActReq[3] || 0;
    u32[4] = starActReq[4] || 0;
    u32[5] = stockType ?? 5;
    u32[6] = 0;
    u32[7] = 0;
    return new Uint8Array(buf);
  }

  /** 编码排列池 (flat u32 array: perms.length × permSize) */
  static encodePermPool(perms, permSize) {
    const buf = new ArrayBuffer(perms.length * permSize * 4);
    const u32 = new Uint32Array(buf);
    for (let i = 0; i < perms.length; i++) {
      for (let j = 0; j < permSize; j++) {
        u32[i * permSize + j] = perms[i][j];
      }
    }
    return new Uint8Array(buf);
  }

  /** 编码 uniform 参数 (8 u32 = 32 bytes) */
  static encodePoolParams(posterPermCount, accPermCount, posterSlots, leaderCharIdx, leaderPosterIdx, timingCount, batchOffset, batchSize) {
    const buf = new ArrayBuffer(32);
    const u32 = new Uint32Array(buf);
    u32[0] = posterPermCount;
    u32[1] = accPermCount;
    u32[2] = posterSlots;
    u32[3] = leaderCharIdx;
    u32[4] = leaderPosterIdx >= 0 ? leaderPosterIdx : 0xFFFFFFFF;
    u32[5] = timingCount;
    u32[6] = batchOffset;
    u32[7] = batchSize;
    return new Uint8Array(buf);
  }

  /**
   * CPU 端镜像 GPU shader 逻辑，用于对比调试
   * 精确复制 shader 中的每个步骤
   */
  static cpuMirrorSimulate(timeline, charDataPool, posterDataPool, accDataPool,
    charPerm, posterPerm, accPerm, posterSlots, leaderCharIdx, leaderPosterIdx, starActReq, stockType) {
    // 构建角色索引
    const ci = charPerm;
    // 找队长位置
    let leaderPos = 0;
    for (let i = 0; i < 5; i++) { if (ci[i] === leaderCharIdx) { leaderPos = i; break; } }
    // 构建海报索引
    const pi = new Array(5);
    let ppOffset = 0;
    for (let i = 0; i < 5; i++) {
      if (i === leaderPos && leaderPosterIdx >= 0) { pi[i] = leaderPosterIdx; }
      else { pi[i] = posterPerm[ppOffset++]; }
    }
    const ai = accPerm;

    // 合并效果
    const combinedLightCount = new Array(5);
    const combinedSelfLightBonus = new Array(5);
    const combinedSenseType = new Array(5);
    const combinedCtAll = Array.from({ length: 5 }, () => new Float32Array(5));
    const combinedExtra = Array.from({ length: 5 }, () => new Uint32Array(5));

    for (let pos = 0; pos < 5; pos++) {
      const cd = charDataPool[ci[pos]];
      // 读取海报/饰品效果（带 trigger 检查）
      const pd = WebGPUStarActCounter.readEffectsWithTriggerCPU(posterDataPool[pi[pos]], cd);
      const ad = WebGPUStarActCounter.readEffectsWithTriggerCPU(accDataPool[ai[pos]], cd);
      combinedSenseType[pos] = cd.senseType;
      combinedSelfLightBonus[pos] = pd.selfLightBonus + ad.selfLightBonus;
      combinedLightCount[pos] = cd.lightCount + combinedSelfLightBonus[pos];
      const recastDown = pd.recastDown + ad.recastDown;
      for (let s = 0; s < 5; s++) {
        let ct;
        if (s === 0) ct = cd.ct; else if (s === 1) ct = cd.ct1; else if (s === 2) ct = cd.ct2;
        else if (s === 3) ct = cd.ct3; else ct = cd.ct4;
        combinedCtAll[pos][s] = ct > recastDown ? ct - recastDown : 0;
      }
      combinedExtra[pos][0] = (cd.extraLightSupport || 0) + pd.extraLightSupport + ad.extraLightSupport;
      combinedExtra[pos][1] = (cd.extraLightControl || 0) + pd.extraLightControl + ad.extraLightControl;
      combinedExtra[pos][2] = (cd.extraLightAmplification || 0) + pd.extraLightAmplification + ad.extraLightAmplification;
      combinedExtra[pos][3] = (cd.extraLightSpecial || 0) + pd.extraLightSpecial + ad.extraLightSpecial;
      combinedExtra[pos][4] = (cd.extraLightVariable || 0) + pd.extraLightVariable + ad.extraLightVariable;
    }
    // starActReq 已经是 bloomBonus 处理后的最终值，不需要再减 decreaseReq
    const req = new Uint32Array(5);
    req[0] = starActReq[0] || 0;
    req[1] = starActReq[1] || 0;
    req[2] = starActReq[2] || 0;
    req[3] = starActReq[3] || 0;
    req[4] = starActReq[4] || 0;
    const actualRequired = req[0] + req[1] + req[2] + req[3] + req[4];

    // 模拟
    const lastTime = Array.from({ length: 5 }, () => new Float32Array([-999, -999, -999, -999, -999]));
    let holdingLights = 0;
    const current = new Uint32Array(5);
    let starActCount = 0;
    const senseExtraAccum = new Uint32Array(5); // 累积 senseExtraAmount

    const log = [];

    for (let t = 0; t < timeline.length; t++) {
      const time = timeline[t].TimingSecond;
      const pos = timeline[t].Position - 1;
      const cd = charDataPool[ci[pos]];
      if (cd.numSenses === 0) {
        holdingLights = 0; current.fill(0);
        continue;
      }

      // CT 检查
      let activatedSlot = -1;
      for (let s = 0; s < cd.numSenses; s++) {
        if (time - lastTime[pos][s] >= combinedCtAll[pos][s]) {
          activatedSlot = s; break;
        }
      }
      if (activatedSlot < 0) {
        holdingLights = 0; current.fill(0);
        continue;
      }

      lastTime[pos][activatedSlot] = time;

      // 检查 None
      let activatedType;
      if (activatedSlot === 0) activatedType = combinedSenseType[pos];
      else if (activatedSlot === 1) activatedType = cd.senseType1;
      else if (activatedSlot === 2) activatedType = cd.senseType2;
      else if (activatedSlot === 3) activatedType = cd.senseType3;
      else activatedType = cd.senseType4;
      if (activatedType === 5) continue;

      // lightCount
      let activeLightCount;
      let slotPreSelfBonus, slotPreExtraAmount;
      if (activatedSlot === 0) {
        slotPreSelfBonus = cd.slotPreSelf0; slotPreExtraAmount = cd.slotPreExtra0;
      } else if (activatedSlot === 1) {
        slotPreSelfBonus = cd.slotPreSelf1; slotPreExtraAmount = cd.slotPreExtra1;
      } else if (activatedSlot === 2) {
        slotPreSelfBonus = cd.slotPreSelf2; slotPreExtraAmount = cd.slotPreExtra2;
      } else if (activatedSlot === 3) {
        slotPreSelfBonus = cd.slotPreSelf3; slotPreExtraAmount = cd.slotPreExtra3;
      } else {
        slotPreSelfBonus = cd.slotPreSelf4; slotPreExtraAmount = cd.slotPreExtra4;
      }
      // PreEffect 先触发：累积 senseExtraAmount
      senseExtraAccum[pos] += slotPreSelfBonus;
      // lightCount = 基础值 + 累积的 senseExtraAmount
      if (activatedSlot === 0) {
        activeLightCount = combinedLightCount[pos];
      } else if (activatedSlot === 1) {
        activeLightCount = cd.lightCount1 + combinedSelfLightBonus[pos];
      } else if (activatedSlot === 2) {
        activeLightCount = cd.lightCount2 + combinedSelfLightBonus[pos];
      } else if (activatedSlot === 3) {
        activeLightCount = cd.lightCount3 + combinedSelfLightBonus[pos];
      } else {
        activeLightCount = cd.lightCount4 + combinedSelfLightBonus[pos];
      }
      activeLightCount += senseExtraAccum[pos];

      // Step 1: 多 Sense 基础灯光
      for (let s = 0; s < cd.numSenses; s++) {
        let lt;
        if (s === 0) lt = combinedSenseType[pos];
        else if (s === 1) lt = cd.senseType1;
        else if (s === 2) lt = cd.senseType2;
        else if (s === 3) lt = cd.senseType3;
        else lt = cd.senseType4;
        if (lt === 5) continue;
        for (let i = 0; i < activeLightCount; i++) {
          if (lt === 4) {
            if (holdingLights < actualRequired) holdingLights++;
          } else {
            if (current[lt] < req[lt]) { holdingLights++; current[lt]++; }
            else if (stockType === 5 || stockType - 1 === lt) { }
            else if (current[4] < req[4]) { holdingLights++; current[4]++; }
          }
        }
      }

      // Step 2: PreEffect 额外灯光
      let preExtraType = combinedSenseType[pos];
      if (activatedSlot === 1) preExtraType = cd.senseType1;
      else if (activatedSlot === 2) preExtraType = cd.senseType2;
      else if (activatedSlot === 3) preExtraType = cd.senseType3;
      else if (activatedSlot === 4) preExtraType = cd.senseType4;
      for (let i = 0; i < slotPreExtraAmount; i++) {
        if (preExtraType === 4) {
          if (holdingLights < actualRequired) holdingLights++;
        } else {
          if (current[preExtraType] < req[preExtraType]) { holdingLights++; current[preExtraType]++; }
          else if (stockType === 5 || stockType - 1 === preExtraType) { }
          else if (current[4] < req[4]) { holdingLights++; current[4]++; }
        }
      }

      // Step 3: 被动额外灯光
      for (let et = 0; et < 5; et++) {
        for (let i = 0; i < combinedExtra[pos][et]; i++) {
          if (et === 4) {
            if (holdingLights < actualRequired) holdingLights++;
          } else {
            if (current[et] < req[et]) { holdingLights++; current[et]++; }
            else if (stockType === 5 || stockType - 1 === et) { }
            else if (current[4] < req[4]) { holdingLights++; current[4]++; }
          }
        }
      }

      // StarAct 检查（不含 wrongLightToSp，与 CPU calcStarActCountOnly 一致）
      if (holdingLights >= actualRequired) {
        starActCount++;
        holdingLights = 0; current.fill(0);
      }

      log.push({ t, time, pos, activatedSlot, activatedType, activeLightCount, holdingLights, current: [...current], starActCount });
    }

    // wrongLightToSp：模拟结束后才转换（与 CPU calcStarActCountOnly 一致）
    let wltsp = cd.wrongLightToSp;
    for (let et = 0; et < 4; et++) {
      for (let j = 0; j < 100 && wltsp > 0; j++) {
        if (current[et] <= req[et]) break;
        current[et]--;
        if (holdingLights < actualRequired) holdingLights++;
        wltsp--;
      }
    }
    // 最终检查
    if (holdingLights >= actualRequired) {
      starActCount++;
    }

    return { starActCount, log, req: [...req], actualRequired };
  }

  // ===== 核心计算方法 =====

  /**
   * 使用排列池模式计算 starActCount（分批处理）
   *
   * GPU 内部枚举 charPerm × posterPerm × accPerm 的完整组合，
   * 每个线程计算一个组合。通过分批处理避免显存溢出。
   *
   * @param {Object} params
   * @param {Array} params.timeline - 时间轴
   * @param {Array} params.charDataPool - 角色灯光参数数组
   * @param {Array} params.posterDataPool - 海报灯光效果数组
   * @param {Array} params.accDataPool - 饰品灯光效果数组
   * @param {Array<Array<number>>} params.charPerms - 角色排列池 (每个 5 个索引)
   * @param {Array<Array<number>>} params.posterPerms - 海报排列池 (每个 posterSlots 个索引)
   * @param {Array<Array<number>>} params.accPerms - 饰品排列池 (每个 5 个索引)
   * @param {number} params.posterSlots - 每个海报排列的长度 (4 或 5)
   * @param {number} params.leaderCharIdx - 队长在角色池中的索引
   * @param {number} params.leaderPosterIdx - 队长海报在海报数据池中的索引 (-1 表示无)
   * @param {Array<number>} params.starActReq - StarAct 需求
   * @param {number} params.stockType - 存储类型 (5=不存储)
   * @param {number} [params.maxBatchOutputSize=33554432] - 每批最大输出大小 (字节)
   * @param {Function} [params.onBatchProgress] - 批次进度回调 (current, total)
   * @returns {Uint32Array} 每个组合的 starActCount
   */
  async computeWithPools({
    timeline,
    charDataPool,
    posterDataPool,
    accDataPool,
    charPerms,
    posterPerms,
    accPerms,
    posterSlots,
    leaderCharIdx,
    leaderPosterIdx = -1,
    starActReq,
    stockType = 5,
    maxBatchOutputSize = 64 * 1024 * 1024,
    onBatchProgress = null,
  }) {
    if (!this.initialized) throw new Error("Not initialized");

    const charPermCount = charPerms.length;
    const posterPermCount = posterPerms.length;
    const accPermCount = accPerms.length;
    const totalCombinations = charPermCount * posterPermCount * accPermCount;

    if (totalCombinations === 0) return new Uint32Array(0);

    // 计算批次大小（基于输出 buffer 大小限制）
    const outputPerCombo = 4; // u32 = 4 bytes
    const combosPerBatch = Math.max(1, Math.floor(maxBatchOutputSize / outputPerCombo));
    const batchSize = Math.max(1, Math.floor(combosPerBatch / (posterPermCount * accPermCount)));
    const actualBatchSize = Math.min(batchSize, charPermCount);
    const batchCount = Math.ceil(charPermCount / actualBatchSize);

    console.log(`WebGPU pool mode: ${charPermCount} charPerms × ${posterPermCount} posterPerms × ${accPermCount} accPerms = ${totalCombinations.toLocaleString()} combinations, ${batchCount} batches (batchSize=${actualBatchSize})`);

    // 编码不变的 buffer 数据
    const timelineBytes = WebGPUStarActCounter.encodeTimeline(timeline);
    const charBytes = WebGPUStarActCounter.encodeCharData(charDataPool);
    const posterBytes = WebGPUStarActCounter.encodeEffectData(posterDataPool);
    const accBytes = WebGPUStarActCounter.encodeEffectData(accDataPool);
    const charPermBytes = WebGPUStarActCounter.encodePermPool(charPerms, 5);
    const posterPermBytes = WebGPUStarActCounter.encodePermPool(posterPerms, posterSlots);
    const accPermBytes = WebGPUStarActCounter.encodePermPool(accPerms, 5);
    const reqBytes = WebGPUStarActCounter.encodeStarActReq(starActReq, stockType);

    const mkBuf = (bytes, usage) => {
      const size = Math.max(bytes.byteLength, 4);
      const b = this.device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      if (bytes.byteLength > 0) {
        this.device.queue.writeBuffer(b, 0, bytes);
      }
      return b;
    };

    // 创建固定 buffer
    const timelineBuf = mkBuf(timelineBytes, GPUBufferUsage.STORAGE);
    const charBuf = mkBuf(charBytes, GPUBufferUsage.STORAGE);
    const posterBuf = mkBuf(posterBytes, GPUBufferUsage.STORAGE);
    const accBuf = mkBuf(accBytes, GPUBufferUsage.STORAGE);
    const charPermBuf = mkBuf(charPermBytes, GPUBufferUsage.STORAGE);
    const posterPermBuf = mkBuf(posterPermBytes, GPUBufferUsage.STORAGE);
    const accPermBuf = mkBuf(accPermBytes, GPUBufferUsage.STORAGE);
    const reqBuf = mkBuf(reqBytes, GPUBufferUsage.STORAGE);

    const result = new Uint32Array(totalCombinations);

    try {
      for (let b = 0; b < batchCount; b++) {
        const batchOffset = b * actualBatchSize;
        const thisBatchSize = Math.min(actualBatchSize, charPermCount - batchOffset);
        const invocationCount = thisBatchSize * posterPermCount * accPermCount;

        // 编码本批次的 uniform 参数
        const paramsBytes = WebGPUStarActCounter.encodePoolParams(
          posterPermCount, accPermCount, posterSlots,
          leaderCharIdx, leaderPosterIdx,
          timeline.length, batchOffset, thisBatchSize
        );

        const outputBuf = this.device.createBuffer({
          size: invocationCount * 4,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
        });
        const paramsBuf = mkBuf(paramsBytes, GPUBufferUsage.UNIFORM);

        const bg = this.device.createBindGroup({
          layout: this.pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: timelineBuf } },
            { binding: 1, resource: { buffer: charBuf } },
            { binding: 2, resource: { buffer: posterBuf } },
            { binding: 3, resource: { buffer: accBuf } },
            { binding: 4, resource: { buffer: charPermBuf } },
            { binding: 5, resource: { buffer: posterPermBuf } },
            { binding: 6, resource: { buffer: accPermBuf } },
            { binding: 7, resource: { buffer: reqBuf } },
            { binding: 8, resource: { buffer: outputBuf } },
            { binding: 9, resource: { buffer: paramsBuf } },
          ],
        });

        const enc = this.device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(Math.ceil(invocationCount / WORKGROUP_SIZE));
        pass.end();

        const readBuf = this.device.createBuffer({
          size: invocationCount * 4,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        });
        enc.copyBufferToBuffer(outputBuf, 0, readBuf, 0, invocationCount * 4);
        this.device.queue.submit([enc.finish()]);

        await readBuf.mapAsync(GPUMapMode.READ);
        const batchResult = new Uint32Array(readBuf.getMappedRange().slice(0));
        readBuf.unmap();

        // 将批次结果存入全局结果
        const globalStart = batchOffset * posterPermCount * accPermCount;
        result.set(batchResult, globalStart);

        [outputBuf, paramsBuf, readBuf].forEach(buf => buf.destroy());

        if (onBatchProgress) onBatchProgress(b + 1, batchCount);
      }
    } finally {
      // 清理固定 buffer
      [timelineBuf, charBuf, posterBuf, accBuf, charPermBuf, posterPermBuf, accPermBuf, reqBuf]
        .forEach(b => { try { b.destroy(); } catch (_) {} });
    }

    return result;
  }

  /**
   * 使用排列池模式计算并筛选候选
   *
   * @param {Object} params - 同 computeWithPools 的参数
   * @param {number} [thresholdOffset=1] - 阈值偏移量 (maxCount - thresholdOffset)，值越大筛选越激进
   * @returns {{ candidates: Array<{cpIdx, ppIdx, apIdx}>, maxCount, threshold, totalCount }}
   */
  async computeFilteredPools(params, thresholdOffset = 1) {
    const { posterPerms, accPerms } = params;
    const posterPermCount = posterPerms.length;
    const accPermCount = accPerms.length;
    const counts = await this.computeWithPools(params);

    // CPU 镜像对比诊断
    {
      const { timeline, charDataPool, posterDataPool, accDataPool,
        charPerms, posterPerms, accPerms,
        posterSlots, leaderCharIdx, leaderPosterIdx = -1,
        starActReq, stockType = 5 } = params;
      const ppCount = posterPermCount, apCount = accPermCount;
      console.log(`[DIAG] counts.length=${counts.length}, ppCount=${ppCount}, apCount=${apCount}`);
      console.log(`[DIAG] counts[0..5]=[${Array.from(counts.slice(0, 6))}]`);
      // 找到 max 组合并用 CPU 镜像对比
      let maxIdx = 0;
      for (let i = 1; i < counts.length; i++) { if (counts[i] > counts[maxIdx]) maxIdx = i; }
      const maxCpIdx = Math.floor(maxIdx / (ppCount * apCount));
      const maxRemainder = maxIdx % (ppCount * apCount);
      const maxPpIdx = Math.floor(maxRemainder / apCount);
      const maxApIdx = maxRemainder % apCount;
      const maxMirror = WebGPUStarActCounter.cpuMirrorSimulate(
        timeline, charDataPool, posterDataPool, accDataPool,
        charPerms[maxCpIdx], posterPerms[maxPpIdx], accPerms[maxApIdx],
        posterSlots, leaderCharIdx, leaderPosterIdx, starActReq, stockType
      );
      console.log(`[MAX COMBO] idx=${maxIdx} cp=${maxCpIdx} pp=${maxPpIdx} ap=${maxApIdx}: GPU=${counts[maxIdx]}, CPU-Mirror=${maxMirror.starActCount}`);
      // 类型名称：Sup=0, Ctrl=1, Amp=2, Sp=3, Var=4
      console.log(`  starActReq(final): Sup=${starActReq[0]} Ctrl=${starActReq[1]} Amp=${starActReq[2]} Sp=${starActReq[3]} Var=${starActReq[4]}, stockType=${stockType}`);
      console.log(`  actualRequired=${maxMirror.actualRequired}`);
      console.log(`  CPU-Mirror step-by-step:`);
      for (const l of maxMirror.log) {
        const c = l.current;
        const isStarAct = l.starActCount > (maxMirror.log[maxMirror.log.indexOf(l) - 1]?.starActCount ?? 0);
        console.log(`    t${l.t} p${l.pos}s${l.activatedSlot} lc=${l.activeLightCount} → cur=[${c[0]},${c[1]},${c[2]},${c[3]},${c[4]}] hl=${l.holdingLights} sa=${l.starActCount}${isStarAct ? ' ★' : ''}`);
      }
      const diagCount = Math.min(3, charPerms.length);
      for (let cpIdx = 0; cpIdx < diagCount; cpIdx++) {
        const ppIdx = 0, apIdx = 0;
        const globalIdx = cpIdx * ppCount * apCount;
        const gpuVal = globalIdx < counts.length ? counts[globalIdx] : 'OOB';
        const cpuMirror = WebGPUStarActCounter.cpuMirrorSimulate(
          timeline, charDataPool, posterDataPool, accDataPool,
          charPerms[cpIdx], posterPerms[ppIdx], accPerms[apIdx],
          posterSlots, leaderCharIdx, leaderPosterIdx, starActReq, stockType
        );
        console.log(`[GPU vs CPU-Mirror] cpIdx=${cpIdx}: GPU[${globalIdx}]=${gpuVal}, CPU-Mirror=${cpuMirror.starActCount}${gpuVal !== cpuMirror.starActCount ? ' *** MISMATCH ***' : ''}`);
        if (gpuVal !== cpuMirror.starActCount) {
          console.log(`  CPU-Mirror log:`, cpuMirror.log.map(l => `t${l.t}(p${l.pos},s${l.activatedSlot},lc${l.activeLightCount},hl=${l.holdingLights},sa=${l.starActCount})`).join(' | '));
        }
      }
    }

    // 找到最大 starActCount
    let maxCount = 0;
    let maxIdx = 0;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] > maxCount) { maxCount = counts[i]; maxIdx = i; }
    }
    const threshold = Math.max(0, maxCount - thresholdOffset);
    const posterAccCount = posterPermCount * accPermCount;
    const maxCombo = maxCount > 0 ? {
      cpIdx: Math.floor(maxIdx / posterAccCount),
      ppIdx: Math.floor((maxIdx % posterAccCount) / accPermCount),
      apIdx: maxIdx % accPermCount,
    } : null;

    // 收集超过阈值的候选，映射回 (cpIdx, ppIdx, apIdx)
    const candidates = [];
    for (let i = 0; i < counts.length; i++) {
      if (counts[i] >= threshold) {
        const cpIdx = Math.floor(i / posterAccCount);
        const remainder = i % posterAccCount;
        const ppIdx = Math.floor(remainder / accPermCount);
        const apIdx = remainder % accPermCount;
        candidates.push({ cpIdx, ppIdx, apIdx });
      }
    }

    return { candidates, maxCount, threshold, totalCount: counts.length, maxCombo };
  }

  /**
   * 对按队长位置拆分的排列池使用同一个全局 SA 阈值进行筛选。
   * 固定槽位与队长海报已经写入完整五槽排列，因此无需修改 WGSL。
   *
   * @param {Object} params
   * @param {Array<{
   *   characterPermutations: Array<Array<number>>,
   *   posterPermutations: Array<Array<number>>,
   * }>} params.groups
   * @param {Array<Array<number>>} params.accessoryPermutations
   * @returns {Promise<{
   *   candidates: Array<{groupIdx:number, cpIdx:number, ppIdx:number, apIdx:number}>,
   *   maxCount: number,
   *   threshold: number,
   *   totalCount: number,
   *   maxCombo: Object|null,
   * }>}
   */
  async computeFilteredPoolGroups(params, thresholdOffset = 1) {
    const {
      groups = [],
      accessoryPermutations = [],
      onGroupProgress = null,
      ...commonParams
    } = params;

    if (groups.length === 0 || accessoryPermutations.length === 0) {
      return {
        candidates: [],
        maxCount: 0,
        threshold: 0,
        totalCount: 0,
        maxCombo: null,
      };
    }

    const groupCounts = [];
    let maxCount = 0;
    let maxCombo = null;
    let totalCount = 0;

    for (let groupIdx = 0; groupIdx < groups.length; groupIdx++) {
      const group = groups[groupIdx];
      const charPerms = group.characterPermutations || [];
      const posterPerms = group.posterPermutations || [];
      if (charPerms.length === 0 || posterPerms.length === 0) {
        groupCounts[groupIdx] = new Uint32Array(0);
        continue;
      }

      const counts = await this.computeWithPools({
        ...commonParams,
        charPerms,
        posterPerms,
        accPerms: accessoryPermutations,
        posterSlots: 5,
        // 队长海报已由排列规划器写入对应的绝对位置。
        leaderPosterIdx: -1,
      });
      groupCounts[groupIdx] = counts;
      totalCount += counts.length;

      const posterAccCount =
        posterPerms.length * accessoryPermutations.length;
      for (let i = 0; i < counts.length; i++) {
        if (counts[i] <= maxCount) continue;
        maxCount = counts[i];
        maxCombo = {
          groupIdx,
          cpIdx: Math.floor(i / posterAccCount),
          ppIdx: Math.floor(
            (i % posterAccCount) / accessoryPermutations.length,
          ),
          apIdx: i % accessoryPermutations.length,
        };
      }

      onGroupProgress?.(groupIdx + 1, groups.length);
    }

    const threshold = Math.max(0, maxCount - thresholdOffset);
    const candidates = [];
    groupCounts.forEach((counts, groupIdx) => {
      const group = groups[groupIdx];
      const posterPermCount = group.posterPermutations.length;
      const accPermCount = accessoryPermutations.length;
      const posterAccCount = posterPermCount * accPermCount;
      for (let i = 0; i < counts.length; i++) {
        if (counts[i] < threshold) continue;
        candidates.push({
          groupIdx,
          cpIdx: Math.floor(i / posterAccCount),
          ppIdx: Math.floor((i % posterAccCount) / accPermCount),
          apIdx: i % accPermCount,
        });
      }
    });

    return { candidates, maxCount, threshold, totalCount, maxCombo };
  }

  /**
   * 优化版两阶段 GPU 筛选（减少 readback 数据量）
   *
   * Pass 1: 计算 starActCount + 归约找最大值（每批只 readback 4 字节）
   * Pass 2: 用全局阈值筛选候选索引（只 readback 候选索引）
   */
  async computeFilteredPoolsFast(params, thresholdOffset = 1) {
    if (!this.initialized) throw new Error("Not initialized");
    if (!this.reducePipeline || !this.filterPipeline) {
      // 降级到普通版本
      return this.computeFilteredPools(params, thresholdOffset);
    }

    const {
      timeline, charDataPool, posterDataPool, accDataPool,
      charPerms, posterPerms, accPerms,
      posterSlots, leaderCharIdx, leaderPosterIdx = -1,
      starActReq, stockType = 5,
      maxBatchOutputSize = 64 * 1024 * 1024,
      onBatchProgress = null,
    } = params;

    const charPermCount = charPerms.length;
    const posterPermCount = posterPerms.length;
    const accPermCount = accPerms.length;
    const totalCombinations = charPermCount * posterPermCount * accPermCount;
    if (totalCombinations === 0) return { candidates: [], maxCount: 0, threshold: 0, totalCount: 0 };

    // 计算批次大小
    const combosPerBatch = Math.max(1, Math.floor(maxBatchOutputSize / 4));
    const batchSize = Math.max(1, Math.floor(combosPerBatch / (posterPermCount * accPermCount)));
    const actualBatchSize = Math.min(batchSize, charPermCount);
    const batchCount = Math.ceil(charPermCount / actualBatchSize);

    console.log(`WebGPU fast mode: ${charPermCount} charPerms × ${posterPermCount} × ${accPermCount} = ${totalCombinations.toLocaleString()}, ${batchCount} batches`);

    // 编码固定 buffer
    const mkBuf = (bytes, usage) => {
      const size = Math.max(bytes.byteLength, 4);
      const b = this.device.createBuffer({ size, usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
      if (bytes.byteLength > 0) {
        this.device.queue.writeBuffer(b, 0, bytes);
      }
      return b;
    };

    const timelineBuf = mkBuf(WebGPUStarActCounter.encodeTimeline(timeline), GPUBufferUsage.STORAGE);
    const charBuf = mkBuf(WebGPUStarActCounter.encodeCharData(charDataPool), GPUBufferUsage.STORAGE);
    const posterBuf = mkBuf(WebGPUStarActCounter.encodeEffectData(posterDataPool), GPUBufferUsage.STORAGE);
    const accBuf = mkBuf(WebGPUStarActCounter.encodeEffectData(accDataPool), GPUBufferUsage.STORAGE);
    const charPermBuf = mkBuf(WebGPUStarActCounter.encodePermPool(charPerms, 5), GPUBufferUsage.STORAGE);
    const posterPermBuf = mkBuf(WebGPUStarActCounter.encodePermPool(posterPerms, posterSlots), GPUBufferUsage.STORAGE);
    const accPermBuf = mkBuf(WebGPUStarActCounter.encodePermPool(accPerms, 5), GPUBufferUsage.STORAGE);
    const reqBuf = mkBuf(WebGPUStarActCounter.encodeStarActReq(starActReq, stockType), GPUBufferUsage.STORAGE);

    const fixedEntries = [
      { binding: 0, resource: { buffer: timelineBuf } },
      { binding: 1, resource: { buffer: charBuf } },
      { binding: 2, resource: { buffer: posterBuf } },
      { binding: 3, resource: { buffer: accBuf } },
      { binding: 4, resource: { buffer: charPermBuf } },
      { binding: 5, resource: { buffer: posterPermBuf } },
      { binding: 6, resource: { buffer: accPermBuf } },
      { binding: 7, resource: { buffer: reqBuf } },
    ];

    try {
      // ===== Pass 1: 计算 starActCount 并归约找每批最大值 =====
      const localMaxes = new Array(batchCount);
      for (let b = 0; b < batchCount; b++) {
        const batchOffset = b * actualBatchSize;
        const thisBatchSize = Math.min(actualBatchSize, charPermCount - batchOffset);
        const invocationCount = thisBatchSize * posterPermCount * accPermCount;
        const outputSize = invocationCount * 4;

        const paramsBytes = WebGPUStarActCounter.encodePoolParams(
          posterPermCount, accPermCount, posterSlots,
          leaderCharIdx, leaderPosterIdx,
          timeline.length, batchOffset, thisBatchSize
        );

        const outputBuf = this.device.createBuffer({ size: outputSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        const paramsBuf = mkBuf(paramsBytes, GPUBufferUsage.UNIFORM);

        // 归约 buffer：每个 workgroup 输出一个最大值
        const reduceWorkgroups = Math.min(256, Math.ceil(invocationCount / WORKGROUP_SIZE));
        const reduceBuf = this.device.createBuffer({ size: reduceWorkgroups * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        const reduceParamsBuf = mkBuf(new Uint8Array(new Uint32Array([invocationCount, 0, 0, 0]).buffer), GPUBufferUsage.UNIFORM);

        // Pass 1a: 计算 starActCount
        const computeBg = this.device.createBindGroup({
          layout: this.pipeline.getBindGroupLayout(0),
          entries: [...fixedEntries, { binding: 8, resource: { buffer: outputBuf } }, { binding: 9, resource: { buffer: paramsBuf } }],
        });

        // Pass 1b: 归约 (第一遍：多 workgroup)
        const reduceBg = this.device.createBindGroup({
          layout: this.reducePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: outputBuf } },
            { binding: 1, resource: { buffer: reduceBuf } },
            { binding: 2, resource: { buffer: reduceParamsBuf } },
          ],
        });

        const enc = this.device.createCommandEncoder();
        const pass1 = enc.beginComputePass();
        pass1.setPipeline(this.pipeline);
        pass1.setBindGroup(0, computeBg);
        pass1.dispatchWorkgroups(Math.ceil(invocationCount / WORKGROUP_SIZE));
        pass1.end();

        const pass2 = enc.beginComputePass();
        pass2.setPipeline(this.reducePipeline);
        pass2.setBindGroup(0, reduceBg);
        pass2.dispatchWorkgroups(reduceWorkgroups);
        pass2.end();

        // 如果 reduceWorkgroups > 1，需要第二遍归约
        let finalReduceBuf = reduceBuf;
        let finalReduceSize = reduceWorkgroups;
        let reduce2Buf = null;
        let reduce2ParamsBuf = null;
        if (reduceWorkgroups > 1) {
          reduce2Buf = this.device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
          reduce2ParamsBuf = mkBuf(new Uint8Array(new Uint32Array([reduceWorkgroups, 0, 0, 0]).buffer), GPUBufferUsage.UNIFORM);
          const reduce2Bg = this.device.createBindGroup({
            layout: this.reducePipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: reduceBuf } },
              { binding: 1, resource: { buffer: reduce2Buf } },
              { binding: 2, resource: { buffer: reduce2ParamsBuf } },
            ],
          });
          const pass3 = enc.beginComputePass();
          pass3.setPipeline(this.reducePipeline);
          pass3.setBindGroup(0, reduce2Bg);
          pass3.dispatchWorkgroups(1);
          pass3.end();
          finalReduceBuf = reduce2Buf;
          finalReduceSize = 1;
        }

        // 所有 pass 录制完成后统一提交
        const readBuf = this.device.createBuffer({ size: finalReduceSize * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        enc.copyBufferToBuffer(finalReduceBuf, 0, readBuf, 0, finalReduceSize * 4);
        this.device.queue.submit([enc.finish()]);

        await readBuf.mapAsync(GPUMapMode.READ);
        const reduceResult = new Uint32Array(readBuf.getMappedRange().slice(0));
        readBuf.unmap();

        // 在 CPU 上找这批复约结果的最大值
        let batchMax = 0;
        for (let i = 0; i < reduceResult.length; i++) {
          if (reduceResult[i] > batchMax) batchMax = reduceResult[i];
        }
        if (b === 0) console.log(`WebGPU fast Pass1 batch0: batchMax=${batchMax}, invocationCount=${invocationCount}`);
        localMaxes[b] = batchMax;

        // 保存 outputBuf 和 paramsBuf 供 Pass 2 使用
        localMaxes[b] = { max: batchMax, outputBuf, paramsBuf, invocationCount };

        // 清理临时 buffer
        [reduceBuf, reduceParamsBuf, readBuf, reduce2Buf, reduce2ParamsBuf].forEach(buf => {
          if (buf) try { buf.destroy(); } catch (_) {}
        });

        if (onBatchProgress) onBatchProgress(b + 1, batchCount * 2);
      }

      // 全局最大值
      let globalMax = 0;
      for (const item of localMaxes) {
        if (item.max > globalMax) globalMax = item.max;
      }
      const threshold = Math.max(0, globalMax - thresholdOffset);
      console.log(`WebGPU fast: globalMax=${globalMax}, threshold=${threshold}, localMaxes=[${localMaxes.map(m => m.max).join(',')}]`);

      // ===== Pass 2: 用阈值筛选候选索引 =====
      const allCandidates = [];
      const posterAccCount = posterPermCount * accPermCount;

      for (let b = 0; b < batchCount; b++) {
        const { outputBuf, invocationCount } = localMaxes[b];
        const batchOffset = b * actualBatchSize;

        // 筛选 buffer：计数器 + 候选索引
        const counterBuf = this.device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        // 初始化计数器为 0
        this.device.queue.writeBuffer(counterBuf, 0, new Uint32Array([0]));

        const maxCandidates = invocationCount; // 最坏情况
        const candidateBuf = this.device.createBuffer({ size: maxCandidates * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });

        const filterParamsBuf = mkBuf(
          new Uint8Array(new Uint32Array([invocationCount, threshold, 0, 0]).buffer),
          GPUBufferUsage.UNIFORM
        );

        const filterBg = this.device.createBindGroup({
          layout: this.filterPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: outputBuf } },
            { binding: 1, resource: { buffer: counterBuf } },
            { binding: 2, resource: { buffer: candidateBuf } },
            { binding: 3, resource: { buffer: filterParamsBuf } },
          ],
        });

        const enc = this.device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(this.filterPipeline);
        pass.setBindGroup(0, filterBg);
        pass.dispatchWorkgroups(Math.ceil(invocationCount / WORKGROUP_SIZE));
        pass.end();

        // Readback 计数器
        const countReadBuf = this.device.createBuffer({ size: 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
        enc.copyBufferToBuffer(counterBuf, 0, countReadBuf, 0, 4);
        this.device.queue.submit([enc.finish()]);

        await countReadBuf.mapAsync(GPUMapMode.READ);
        const candidateCount = new Uint32Array(countReadBuf.getMappedRange().slice(0))[0];
        countReadBuf.unmap();

        if (b === 0) console.log(`WebGPU fast Pass2 batch0: candidateCount=${candidateCount}, threshold=${threshold}`);

        if (candidateCount > 0) {
          // Readback 候选索引
          const candReadBuf = this.device.createBuffer({ size: candidateCount * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
          const enc2 = this.device.createCommandEncoder();
          enc2.copyBufferToBuffer(candidateBuf, 0, candReadBuf, 0, candidateCount * 4);
          this.device.queue.submit([enc2.finish()]);

          await candReadBuf.mapAsync(GPUMapMode.READ);
          const indices = new Uint32Array(candReadBuf.getMappedRange().slice(0));
          candReadBuf.unmap();

          // 映射回 (cpIdx, ppIdx, apIdx)
          for (let j = 0; j < indices.length; j++) {
            const globalIdx = indices[j];
            const cpIdx = Math.floor(globalIdx / posterAccCount) + batchOffset;
            const remainder = globalIdx % posterAccCount;
            const ppIdx = Math.floor(remainder / accPermCount);
            const apIdx = remainder % accPermCount;
            allCandidates.push({ cpIdx, ppIdx, apIdx });
          }
        }

        [counterBuf, candidateBuf, filterParamsBuf, countReadBuf, outputBuf, localMaxes[b].paramsBuf].forEach(buf => {
          try { buf.destroy(); } catch (_) {}
        });

        if (onBatchProgress) onBatchProgress(batchCount + b + 1, batchCount * 2);
      }

      return { candidates: allCandidates, maxCount: globalMax, threshold, totalCount: totalCombinations };

    } finally {
      [timelineBuf, charBuf, posterBuf, accBuf, charPermBuf, posterPermBuf, accPermBuf, reqBuf]
        .forEach(b => { try { b.destroy(); } catch (_) {} });
    }
  }

  // ===== 工具方法 =====

  /** 生成 k-排列 */
  static generatePermutations(n, k) {
    const results = [];
    const permute = (arr, current) => {
      if (current.length === k) { results.push(current); return; }
      for (let i = 0; i < arr.length; i++) {
        permute(arr.filter((_, j) => j !== i), [...current, arr[i]]);
      }
    };
    permute(Array.from({ length: n }, (_, i) => i), []);
    return results;
  }

  static async isSupported() {
    try {
      if (!navigator.gpu) return false;
      return !!(await navigator.gpu.requestAdapter());
    } catch { return false; }
  }

  destroy() {
    if (this.device) { this.device.destroy(); this.device = null; }
    this.pipeline = null;
    this.initialized = false;
  }
}
