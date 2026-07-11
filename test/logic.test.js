import GameDb from '../src/db/GameDb';
import CharacterData from '../src/character/CharacterData';
import CharacterStarRankData from '../src/character/CharacterStarRankData';
import AccessoryData from '../src/accessory/AccessoryData';
import ScoreCalculator from '../src/logic/ScoreCalculator';
import ScoreCalculationType from '../src/logic/ScoreCalculationType';
import StatBonusType from '../src/logic/StatBonusType';
import StatBonus from '../src/logic/StatBonus';

/* global global jest describe test expect beforeAll */
global.window = global
global.location = { protocol: 'file:' }
jest.setTimeout(60000)

beforeAll(async () => {
  // 逻辑测试不需要初始化完整 UI，也避免把 Web Worker 的 import.meta
  // 带进 Jest 的 CommonJS 执行环境。
  window.root = {
    appState: {
      characterStarRank: new CharacterStarRankData(),
      highScoreBuffManager: { currentActiveEffects: () => [] },
      theaterLevel: { getEffects: () => [] },
    },
    calcType: 'normal',
    senseBox: null,
    senseNoteSelect: { value: 1 },
    addWarningMessage: () => {},
  };
  await GameDb.load();
})

describe('Logic tests', () => {
  test('db is loaded', () => {
    expect(GameDb.CharacterBase[101]?.Id).toBe(101);
  })

  // 430200 T恤 1000120 含 Trigger，范围 None
  test('accessory trigger with range none', () => {
    const chara1 = CharacterData.fromJSON([110010, 195, 0,0,5,0])
    const chara2 = CharacterData.fromJSON([140520, 195, 1,2,5,0])
    chara1.starRank = 1
    chara2.starRank = 1
    const characters = [chara1,chara1,chara1,chara1,chara2]
    const posters = [null, null, null, null, null]
    const accessory = AccessoryData.fromJSON([430200, 10, null])
    accessory.update()
    const accessories = [null, null, null, null, accessory]
    const calc = new ScoreCalculator(characters, posters, accessories, {
      albumLevel: 0,
      albumExtra: [],
      leader: chara1,
      type: ScoreCalculationType.Normal,
      skipSimulation: true,
    })
    calc.calc(null)

    expect(calc.stat.buff[4][StatBonusType.Accessory][0][StatBonus.Vocal]).toBe(5500)

    const chara3 = CharacterData.fromJSON([110020, 195, 0,0,5,0])
    chara3.starRank = 1
    characters[4] = chara3
    const calc2 = new ScoreCalculator(characters, posters, accessories, {
      albumLevel: 0,
      albumExtra: [],
      leader: chara1,
      type: ScoreCalculationType.Normal,
      skipSimulation: true,
    })
    calc2.calc(null)
    expect(calc2.stat.buff[4][StatBonusType.Accessory][0][StatBonus.Vocal]).toBe(0)
  })
})
