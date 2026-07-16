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
    expect(plan.groups.every((group) =>
      group.accessoryPermutations.length === 120)).toBe(true);
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
    expect(group.accessoryPermutations).toHaveLength(120);
    expect(group.characterPermutations.every((permutation) =>
      permutation[0] === 1 && permutation[2] === 0)).toBe(true);
    expect(group.posterPermutations.every((permutation) =>
      permutation[0] === 1 && permutation[2] === 0)).toBe(true);
    expect(group.accessoryPermutations.every((permutation) =>
      permutation[0] === 2)).toBe(true);
    expect(plan.totalCombinations).toBe(24 * 24 * 120);
  });

  test("a movable required character is aggregated with position-free required posters", () => {
    const plan = createAutoPartyPermutationPlan({
      characterCount: 6,
      posterCount: 5,
      accessoryCount: 5,
      leaderIdx: 0,
      constraints: advancedConstraints({
        leaderPosition: 0,
        characterSlots: [-1, 1, -1, -1, -1],
        characterSlotFixed: [true, false, true, true, true],
        posterSlots: [0, -1, 1, 2, 3],
        accessorySlots: [0, -1, 1, 2, 3],
      }),
      characterBaseIds: [10, 20, 30, 40, 50, 60],
    });

    expect(plan.groups).toHaveLength(1);
    const group = plan.groups[0];
    expect(group.characterPermutations).toHaveLength(96);
    expect(group.posterPermutations).toHaveLength(24);
    expect(group.accessoryPermutations).toHaveLength(1);
    expect(group.characterPermutations.every((permutation) =>
      permutation.includes(1))).toBe(true);
    expect(new Set(group.characterPermutations.map((permutation) =>
      permutation.indexOf(1)))).toEqual(new Set([1, 2, 3, 4]));
    expect(group.posterPermutations.every((permutation) =>
      [0, 1, 2, 3].every((posterIdx) => permutation.includes(posterIdx))))
      .toBe(true);
    expect(plan.totalCombinations).toBe(96 * 24);
  });

  test("poster and accessory attachments follow a movable required character", () => {
    const plan = createAutoPartyPermutationPlan({
      characterCount: 5,
      posterCount: 5,
      accessoryCount: 5,
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints: advancedConstraints({
        leaderPosition: 0,
        characterSlots: [-1, 1, -1, -1, -1],
        characterSlotFixed: [true, false, true, true, true],
        posterSlots: [-1, 1, -1, -1, 2],
        posterSlotBound: [false, true, false, false, false],
        accessorySlots: [-1, 1, -1, 2, -1],
      }),
      characterBaseIds: [10, 20, 30, 40, 50],
      posterRestrictGroupIds: [10, 20, 30, 40, 50],
    });

    expect(plan.groups).toHaveLength(3);
    expect(plan.groups.map((group) =>
      group.characterPermutations[0].indexOf(1))).toEqual([1, 2, 4]);
    for (const group of plan.groups) {
      const characterPosition = group.characterPermutations[0].indexOf(1);
      expect(group.characterPermutations.every((permutation) =>
        permutation.indexOf(1) === characterPosition)).toBe(true);
      expect(group.posterPermutations.every((permutation) =>
        permutation[characterPosition] === 1)).toBe(true);
      expect(group.accessoryPermutations.every((permutation) =>
        permutation[characterPosition] === 1)).toBe(true);
    }
    expect(plan.totalCombinations).toBe(648);
  });

  test("multiple movable rows keep each attachment with its own character", () => {
    const plan = createAutoPartyPermutationPlan({
      characterCount: 5,
      posterCount: 5,
      accessoryCount: 5,
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints: advancedConstraints({
        leaderPosition: 0,
        characterSlots: [-1, 1, 2, -1, -1],
        characterSlotFixed: [true, false, false, true, true],
        posterSlots: [-1, 1, -1, -1, -1],
        accessorySlots: [-1, -1, 2, -1, -1],
      }),
      characterBaseIds: [10, 20, 30, 40, 50],
      posterRestrictGroupIds: [10, 20, 30, 40, 50],
    });

    expect(plan.groups).toHaveLength(12);
    for (const group of plan.groups) {
      const firstCharacterPosition =
        group.characterPermutations[0].indexOf(1);
      const secondCharacterPosition =
        group.characterPermutations[0].indexOf(2);
      expect(group.posterPermutations.every((permutation) =>
        permutation[firstCharacterPosition] === 1)).toBe(true);
      expect(group.accessoryPermutations.every((permutation) =>
        permutation[secondCharacterPosition] === 2)).toBe(true);
    }
    expect(plan.totalCombinations).toBe(3456);
  });

  test("fully specified movable rows produce one unique combination per layout", () => {
    const plan = createAutoPartyPermutationPlan({
      characterCount: 5,
      posterCount: 5,
      accessoryCount: 5,
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints: advancedConstraints({
        leaderPosition: 0,
        characterSlots: [-1, 1, 2, 3, 4],
        characterSlotFixed: [true, false, false, true, true],
        posterSlots: [-1, 1, 2, 3, 4],
        accessorySlots: [0, 1, 2, 3, 4],
      }),
      characterBaseIds: [10, 20, 30, 40, 50],
      posterRestrictGroupIds: [10, 20, 30, 40, 50],
    });

    expect(plan.totalCombinations).toBe(2);
    const combinations = Array.from(
      { length: plan.totalCombinations },
      (_, index) => resolveAutoPartyCombination(plan, index),
    );
    expect(new Set(combinations.map((combination) =>
      JSON.stringify([
        combination.charPerm,
        combination.posterPerm,
        combination.accPerm,
      ]))).size).toBe(2);
    combinations.forEach((combination) => {
      for (const characterIdx of [1, 2]) {
        const position = combination.charPerm.indexOf(characterIdx);
        expect(combination.posterPerm[position]).toBe(characterIdx);
        expect(combination.accPerm[position]).toBe(characterIdx);
      }
    });
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

    expect(plan.groups.map((group) => group.leaderPosition)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(plan.groups.map((group) => group.offset)).toEqual(
      plan.groups.map((_, index) =>
        plan.groups
          .slice(0, index)
          .reduce((sum, group) => sum + group.combinationCount, 0)),
    );
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
    expect(plan.totalCombinations).toBe(24 * 24);
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
    expect(plan.groups[0].accessoryPermutations).toEqual([[0, 1, 2, 3, 4]]);
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
    expectConstraintCode(
      () => createAutoPartyPermutationPlan({
        ...common,
        constraints: advancedConstraints({
          characterSlotFixed: [true, false],
        }),
      }),
      "INVALID_CHARACTER_SLOT_FIXED",
    );
    expectConstraintCode(
      () => createAutoPartyPermutationPlan({
        ...common,
        constraints: advancedConstraints({
          characterSlotFixed: [true, false, true, true, 1],
        }),
      }),
      "INVALID_CHARACTER_SLOT_FIXED_VALUE",
    );
    expectConstraintCode(
      () => createAutoPartyPermutationPlan({
        ...common,
        constraints: advancedConstraints({
          posterSlotBound: [true, false],
        }),
      }),
      "INVALID_POSTER_SLOT_BOUND",
    );
    expectConstraintCode(
      () => createAutoPartyPermutationPlan({
        ...common,
        constraints: advancedConstraints({
          posterSlotBound: [false, false, false, false, 1],
        }),
      }),
      "INVALID_POSTER_SLOT_BOUND_VALUE",
    );
  });

  test("movable rows report when their bound items have no legal destination", () => {
    expectConstraintCode(
      () => createAutoPartyPermutationPlan({
        characterCount: 6,
        posterCount: 6,
        accessoryCount: 6,
        leaderIdx: 0,
        leaderPosterIdx: 0,
        constraints: advancedConstraints({
          leaderPosition: 0,
          characterSlots: [1, -1, -1, -1, -1],
          characterSlotFixed: [false, true, true, true, true],
          posterSlots: [1, 2, 3, 4, 5],
          posterSlotBound: [true, false, false, false, false],
          accessorySlots: [1, 2, 3, 4, 5],
        }),
        characterBaseIds: [10, 20, 30, 40, 50, 60],
        posterRestrictGroupIds: [10, 20, 30, 40, 50, 60],
      }),
      "NO_LEGAL_MOVABLE_CHARACTER_PLACEMENT",
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

  test("an explicitly unbound poster is mandatory but may occupy any position", () => {
    const plan = createAutoPartyPermutationPlan({
      characterCount: 5,
      posterCount: 6,
      accessoryCount: 5,
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints: advancedConstraints({
        leaderPosition: 0,
        characterSlots: [-1, 1, 2, 3, 4],
        posterSlots: [-1, 1, -1, -1, -1],
        posterSlotBound: [false, false, false, false, false],
        accessorySlots: [0, 1, 2, 3, 4],
      }),
      characterBaseIds: [10, 20, 30, 40, 50],
    });

    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].posterPermutations.every((permutation) =>
      permutation.includes(1))).toBe(true);
    expect(new Set(plan.groups[0].posterPermutations.map((permutation) =>
      permutation.indexOf(1)))).toEqual(new Set([1, 2, 3, 4]));
  });

  test("a bound poster without a character target is rejected", () => {
    expectConstraintCode(
      () => createAutoPartyPermutationPlan({
        characterCount: 5,
        posterCount: 5,
        accessoryCount: 5,
        leaderIdx: 0,
        constraints: advancedConstraints({
          leaderPosition: 0,
          posterSlots: [-1, 1, -1, -1, -1],
          posterSlotBound: [false, true, false, false, false],
        }),
      }),
      "POSTER_BINDING_TARGET_MISSING",
    );
  });
});

describe("resolveAutoPartyCombination", () => {
  test("uses the accessory pool belonging to each group", () => {
    const charPermA = [0, 1, 2, 3, 4];
    const charPermB = [1, 0, 2, 3, 4];
    const posterPerm = [0, 1, 2, 3, 4];
    const accPermA = [0, 1, 2, 3, 4];
    const accPermB = [1, 0, 2, 3, 4];
    const accPermC = [4, 3, 2, 1, 0];
    const plan = {
      groups: [
        {
          leaderPosition: 0,
          characterPermutations: [charPermA],
          posterPermutations: [posterPerm],
          accessoryPermutations: [accPermA, accPermB],
          combinationCount: 2,
          offset: 0,
        },
        {
          leaderPosition: 1,
          characterPermutations: [charPermA, charPermB],
          posterPermutations: [posterPerm],
          accessoryPermutations: [accPermC],
          combinationCount: 2,
          offset: 2,
        },
      ],
      totalCombinations: 4,
    };

    expect(resolveAutoPartyCombination(plan, 0).accPerm).toBe(accPermA);
    expect(resolveAutoPartyCombination(plan, 1).accPerm).toBe(accPermB);
    expect(resolveAutoPartyCombination(plan, 2).accPerm).toBe(accPermC);
    const last = resolveAutoPartyCombination(plan, 3);
    expect(last.groupIdx).toBe(1);
    expect(last.charPerm).toBe(charPermB);
    expect(last.accPerm).toBe(accPermC);
  });

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
    const secondGroup = resolveAutoPartyCombination(
      plan,
      plan.groups[1].offset,
    );
    const last = resolveAutoPartyCombination(plan, plan.totalCombinations - 1);

    expect(first.groupIdx).toBe(0);
    expect(first.leaderPosition).toBe(1);
    expect(secondGroup.groupIdx).toBe(1);
    expect(secondGroup.leaderPosition).toBe(2);
    expect(last.groupIdx).toBe(3);
    expect(last.leaderPosition).toBe(4);
    for (const combination of [first, secondGroup, last]) {
      expect(combination.charPerm).toHaveLength(5);
      expect(combination.posterPerm).toHaveLength(5);
      expect(combination.accPerm).toHaveLength(5);
      expect(combination.charPerm[combination.leaderPosition]).toBe(0);
      expect(combination.posterPerm[combination.leaderPosition]).toBe(0);
    }
    expect(() => resolveAutoPartyCombination(plan, -1)).toThrow(RangeError);
    expect(() => resolveAutoPartyCombination(plan, plan.totalCombinations))
      .toThrow(RangeError);
  });
});
