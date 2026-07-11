import {
  AutoPartyConstraintError,
  createAutoPartyPermutationPlan,
  resolveAutoPartyCombination,
} from "../src/logic/AutoPartyPermutationPlanner.js";

/* global describe expect test */

const emptySlots = () => [-1, -1, -1, -1, -1];

function advancedConstraints(overrides = {}) {
  return {
    mode: "advanced",
    leaderPosition: -1,
    characterSlots: emptySlots(),
    posterSlots: emptySlots(),
    accessorySlots: emptySlots(),
    ...overrides,
  };
}

function expectConstraintCode(callback, code) {
  try {
    callback();
    throw new Error("Expected an AutoPartyConstraintError");
  } catch (error) {
    expect(error).toBeInstanceOf(AutoPartyConstraintError);
    expect(error.code).toBe(code);
  }
}

describe("createAutoPartyPermutationPlan", () => {
  test("basic mode ignores advanced slots and lets the leader use every position", () => {
    const plan = createAutoPartyPermutationPlan({
      characterCount: 5,
      posterCount: 5,
      accessoryCount: 5,
      leaderIdx: 0,
      constraints: {
        mode: "basic",
        leaderPosition: 99,
        characterSlots: [99],
        posterSlots: [99],
        accessorySlots: [99],
      },
      characterBaseIds: [10, 20, 30, 40, 50],
    });

    expect(plan.groups.map((group) => group.leaderPosition)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(plan.groups.every((group) => group.characterPermutations.length === 24))
      .toBe(true);
    expect(plan.groups.every((group) => group.posterPermutations.length === 120))
      .toBe(true);
    expect(plan.accessoryPermutations).toHaveLength(120);
    expect(plan.totalCombinations).toBe(5 * 24 * 120 * 120);
  });

  test("advanced mode preserves fixed absolute slots", () => {
    const plan = createAutoPartyPermutationPlan({
      characterCount: 6,
      posterCount: 6,
      accessoryCount: 6,
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints: advancedConstraints({
        leaderPosition: 2,
        characterSlots: [1, -1, -1, -1, -1],
        posterSlots: [1, -1, -1, -1, -1],
        accessorySlots: [2, -1, -1, -1, -1],
      }),
      characterBaseIds: [10, 20, 30, 40, 50, 60],
      posterRestrictGroupIds: [10, 20, 30, 40, 50, 60],
    });

    expect(plan.groups).toHaveLength(1);
    const group = plan.groups[0];
    expect(group.leaderPosition).toBe(2);
    expect(group.characterPermutations).toHaveLength(24);
    expect(group.posterPermutations).toHaveLength(24);
    expect(plan.accessoryPermutations).toHaveLength(120);
    expect(group.characterPermutations.every((permutation) =>
      permutation[0] === 1 && permutation[2] === 0)).toBe(true);
    expect(group.posterPermutations.every((permutation) =>
      permutation[0] === 1 && permutation[2] === 0)).toBe(true);
    expect(plan.accessoryPermutations.every((permutation) =>
      permutation[0] === 2)).toBe(true);
    expect(plan.totalCombinations).toBe(24 * 24 * 120);
  });

  test("automatic leader placement excludes occupied character and poster slots", () => {
    const plan = createAutoPartyPermutationPlan({
      characterCount: 5,
      posterCount: 5,
      accessoryCount: 5,
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints: advancedConstraints({
        characterSlots: [1, -1, -1, -1, -1],
        posterSlots: [-1, 1, -1, -1, -1],
        accessorySlots: [0, 1, 2, 3, 4],
      }),
      characterBaseIds: [10, 20, 30, 40, 50],
    });

    expect(plan.groups.map((group) => group.leaderPosition)).toEqual([2, 3, 4]);
    expect(plan.groups.every((group) => group.combinationCount === 36)).toBe(
      true,
    );
    expect(plan.groups.map((group) => group.offset)).toEqual([0, 36, 72]);
    expect(plan.totalCombinations).toBe(108);
  });

  test("dynamic characters with the same primary base as the leader are filtered", () => {
    const plan = createAutoPartyPermutationPlan({
      characterCount: 6,
      posterCount: 5,
      accessoryCount: 5,
      leaderIdx: 0,
      constraints: advancedConstraints({
        leaderPosition: 0,
        posterSlots: [0, 1, 2, 3, 4],
        accessorySlots: [0, 1, 2, 3, 4],
      }),
      characterBaseIds: [10, 10, 20, 30, 40, 50],
    });

    expect(plan.groups[0].characterPermutations).toHaveLength(24);
    expect(plan.groups[0].characterPermutations.every((permutation) =>
      !permutation.includes(1))).toBe(true);
    expect(plan.totalCombinations).toBe(24);
  });

  test("dynamic posters with the leader poster restriction group are filtered", () => {
    const plan = createAutoPartyPermutationPlan({
      characterCount: 5,
      posterCount: 6,
      accessoryCount: 5,
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints: advancedConstraints({
        leaderPosition: 0,
        characterSlots: [0, 1, 2, 3, 4],
        accessorySlots: [0, 1, 2, 3, 4],
      }),
      characterBaseIds: [10, 20, 30, 40, 50],
      posterRestrictGroupIds: [10, 10, 20, 30, 40, 50],
    });

    expect(plan.groups[0].posterPermutations).toHaveLength(24);
    expect(plan.groups[0].posterPermutations.every((permutation) =>
      permutation[0] === 0 && !permutation.includes(1))).toBe(true);
    expect(plan.totalCombinations).toBe(24);
  });

  test("a valid fully fixed party produces exactly one combination", () => {
    const plan = createAutoPartyPermutationPlan({
      characterCount: 5,
      posterCount: 5,
      accessoryCount: 5,
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints: advancedConstraints({
        leaderPosition: 0,
        characterSlots: [-1, 1, 2, 3, 4],
        posterSlots: [-1, 1, 2, 3, 4],
        accessorySlots: [0, 1, 2, 3, 4],
      }),
      characterBaseIds: [10, 20, 30, 40, 50],
      posterRestrictGroupIds: [10, 20, 30, 40, 50],
    });

    expect(plan.totalCombinations).toBe(1);
    expect(plan.groups[0].characterPermutations).toEqual([[0, 1, 2, 3, 4]]);
    expect(plan.groups[0].posterPermutations).toEqual([[0, 1, 2, 3, 4]]);
    expect(plan.accessoryPermutations).toEqual([[0, 1, 2, 3, 4]]);
  });

  test("insufficient unique candidates returns an empty plan", () => {
    const plan = createAutoPartyPermutationPlan({
      characterCount: 5,
      posterCount: 5,
      accessoryCount: 5,
      leaderIdx: 0,
      constraints: advancedConstraints({
        leaderPosition: 0,
        posterSlots: [0, 1, 2, 3, 4],
        accessorySlots: [0, 1, 2, 3, 4],
      }),
      characterBaseIds: [10, 10, 20, 30, 40],
    });

    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].characterPermutations).toEqual([]);
    expect(plan.totalCombinations).toBe(0);
  });

  test("invalid fixed slots expose stable constraint error codes", () => {
    const common = {
      characterCount: 6,
      posterCount: 6,
      accessoryCount: 6,
      leaderIdx: 0,
      characterBaseIds: [10, 20, 20, 30, 40, 50],
      posterRestrictGroupIds: [0, 10, 10, 20, 30, 40],
    };

    expectConstraintCode(
      () => createAutoPartyPermutationPlan({
        ...common,
        constraints: advancedConstraints({
          characterSlots: [6, -1, -1, -1, -1],
        }),
      }),
      "FIXED_CHARACTER_OUT_OF_RANGE",
    );
    expectConstraintCode(
      () => createAutoPartyPermutationPlan({
        ...common,
        constraints: advancedConstraints({
          accessorySlots: [1, 1, -1, -1, -1],
        }),
      }),
      "DUPLICATE_FIXED_ACCESSORY",
    );
    expectConstraintCode(
      () => createAutoPartyPermutationPlan({
        ...common,
        constraints: advancedConstraints({
          characterSlots: [1, 2, -1, -1, -1],
        }),
      }),
      "DUPLICATE_CHARACTER_BASE",
    );
    expectConstraintCode(
      () => createAutoPartyPermutationPlan({
        ...common,
        constraints: advancedConstraints({
          posterSlots: [1, 2, -1, -1, -1],
        }),
      }),
      "DUPLICATE_POSTER_RESTRICT_GROUP",
    );
  });

  test("an over-constrained party reports that no leader position is legal", () => {
    expectConstraintCode(
      () => createAutoPartyPermutationPlan({
        characterCount: 6,
        posterCount: 5,
        accessoryCount: 5,
        leaderIdx: 0,
        constraints: advancedConstraints({
          characterSlots: [1, 2, 3, 4, 5],
        }),
        characterBaseIds: [10, 20, 30, 40, 50, 60],
      }),
      "NO_LEGAL_LEADER_POSITION",
    );
  });
});

describe("resolveAutoPartyCombination", () => {
  test("maps global indices through group offsets to full permutations", () => {
    const plan = createAutoPartyPermutationPlan({
      characterCount: 5,
      posterCount: 5,
      accessoryCount: 5,
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints: advancedConstraints({
        characterSlots: [1, -1, -1, -1, -1],
        posterSlots: [-1, 1, -1, -1, -1],
        accessorySlots: [0, 1, 2, 3, 4],
      }),
      characterBaseIds: [10, 20, 30, 40, 50],
    });

    const first = resolveAutoPartyCombination(plan, 0);
    const secondGroup = resolveAutoPartyCombination(plan, 36);
    const last = resolveAutoPartyCombination(plan, 107);

    expect(first.groupIdx).toBe(0);
    expect(first.leaderPosition).toBe(2);
    expect(secondGroup.groupIdx).toBe(1);
    expect(secondGroup.leaderPosition).toBe(3);
    expect(last.groupIdx).toBe(2);
    expect(last.leaderPosition).toBe(4);
    for (const combination of [first, secondGroup, last]) {
      expect(combination.charPerm).toHaveLength(5);
      expect(combination.posterPerm).toHaveLength(5);
      expect(combination.accPerm).toHaveLength(5);
      expect(combination.charPerm[combination.leaderPosition]).toBe(0);
      expect(combination.posterPerm[combination.leaderPosition]).toBe(0);
    }
    expect(() => resolveAutoPartyCombination(plan, -1)).toThrow(RangeError);
    expect(() => resolveAutoPartyCombination(plan, 108)).toThrow(RangeError);
  });
});
