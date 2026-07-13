import {
  createPythonAutoPartyPlan,
  resolvePythonFormationRow,
} from "../src/logic/PythonAutoPartyConstraints.js";

/* global describe expect test */

const emptySlots = () => [-1, -1, -1, -1, -1];

const character = (id, nested = false) =>
  nested ? { data: { Id: id } } : { Id: id };
const poster = (id, nested = false) =>
  nested ? { data: { Id: id } } : { id };

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

describe("createPythonAutoPartyPlan", () => {
  test("basic mode omits -mc/-mp and keeps only row mapping metadata", () => {
    const plan = createPythonAutoPartyPlan({
      mode: "basic",
      characters: [character(101)],
      posters: [poster(201)],
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints: advancedConstraints({
        leaderPosition: 3,
        accessorySlots: [0, -1, -1, -1, -1],
      }),
    });

    expect(plan).toEqual({
      formationOptions: null,
      rowConstraints: {
        mode: "basic",
        leaderIdx: 0,
        leaderPosterIdx: 0,
        leaderPosition: -1,
        characterSlots: emptySlots(),
        characterSlotFixed: [true, true, true, true, true],
        posterSlots: emptySlots(),
        posterBindings: emptySlots(),
      },
      ignoredAccessoryPositions: [],
      blockingErrors: [],
    });
  });

  test("advanced auto leader builds padded character and poster pairs", () => {
    const characters = [
      character(101),
      character(102),
      character(103),
      character(104),
      character(105),
    ];
    const posters = [
      poster(201),
      poster(202),
      poster(203),
      poster(204),
      poster(205),
    ];
    const constraints = advancedConstraints({
      characterSlots: [-1, 1, -1, -1, -1],
      posterSlots: [-1, 1, -1, -1, -1],
      accessorySlots: [-1, -1, 3, -1, 4],
    });

    const plan = createPythonAutoPartyPlan({
      mode: "advanced",
      characters,
      posters,
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints,
    });

    expect(plan.formationOptions).toEqual({
      mandatoryCharacters: [101, 0, 102, 2, 0, 0, 0, 0, 0, 0],
      mandatoryPosters: [201, 101, 202, 102, 0, 0, 0, 0, 0, 0],
    });
    expect(plan.rowConstraints).toEqual({
      mode: "advanced",
      leaderIdx: 0,
      leaderPosterIdx: 0,
      leaderPosition: -1,
      characterSlots: constraints.characterSlots,
      characterSlotFixed: [true, true, true, true, true],
      posterSlots: constraints.posterSlots,
      posterBindings: [-1, 1, -1, -1, -1],
    });
    expect(plan.ignoredAccessoryPositions).toEqual([2, 4]);
    expect(plan.blockingErrors).toEqual([]);
    expect(plan.formationOptions.mandatoryCharacters).toHaveLength(10);
    expect(plan.formationOptions.mandatoryPosters).toHaveLength(10);
    expect(
      plan.formationOptions.mandatoryCharacters.every(Number.isInteger),
    ).toBe(true);
    expect(plan.formationOptions.mandatoryPosters.every(Number.isInteger)).toBe(
      true,
    );
  });

  test("fixed leader uses a 1-based position and lets a fixed poster bind it", () => {
    const plan = createPythonAutoPartyPlan({
      mode: "advanced",
      characters: [character(101), character(102)],
      posters: [poster(201), poster(202)],
      leaderIdx: 0,
      leaderPosterIdx: -1,
      constraints: advancedConstraints({
        leaderPosition: 2,
        characterSlots: [1, -1, -1, -1, -1],
        posterSlots: [-1, -1, 1, -1, -1],
      }),
    });

    expect(plan.formationOptions).toEqual({
      mandatoryCharacters: [101, 3, 102, 1, 0, 0, 0, 0, 0, 0],
      mandatoryPosters: [202, 101, 0, 0, 0, 0, 0, 0, 0, 0],
    });
    expect(plan.blockingErrors).toEqual([]);
  });

  test("unlocked characters use position zero and bind same-row posters", () => {
    const constraints = advancedConstraints({
      characterSlots: [-1, 1, 2, -1, -1],
      characterSlotFixed: [true, false, true, true, true],
      posterSlots: [-1, 1, 2, -1, -1],
      accessorySlots: [-1, 3, -1, -1, -1],
    });
    const plan = createPythonAutoPartyPlan({
      mode: "advanced",
      characters: [character(101), character(102), character(103)],
      posters: [poster(201), poster(202), poster(203)],
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints,
    });

    expect(plan.formationOptions).toEqual({
      mandatoryCharacters: [101, 0, 102, 0, 103, 3, 0, 0, 0, 0],
      mandatoryPosters: [201, 101, 202, 102, 203, 103, 0, 0, 0, 0],
    });
    expect(plan.rowConstraints.characterSlotFixed).toEqual(
      constraints.characterSlotFixed,
    );
    expect(plan.rowConstraints.posterBindings).toEqual([-1, 1, 2, -1, -1]);
    expect(plan.ignoredAccessoryPositions).toEqual([1]);
    expect(plan.blockingErrors).toEqual([]);
  });

  test("empty character rows normalize their fixed-state flag to true", () => {
    const plan = createPythonAutoPartyPlan({
      mode: "advanced",
      characters: [character(101), character(102)],
      posters: [],
      leaderIdx: 0,
      constraints: advancedConstraints({
        characterSlots: [-1, 1, -1, -1, -1],
        characterSlotFixed: [false, false, false, false, false],
      }),
    });

    expect(plan.rowConstraints.characterSlotFixed).toEqual([
      true,
      false,
      true,
      true,
      true,
    ]);
    expect(plan.formationOptions.mandatoryCharacters.slice(0, 4)).toEqual([
      101, 0, 102, 0,
    ]);
  });

  test("invalid character fixed-state arrays are rejected", () => {
    const plan = createPythonAutoPartyPlan({
      mode: "advanced",
      characters: [character(101), character(102)],
      posters: [],
      leaderIdx: 0,
      constraints: advancedConstraints({
        characterSlots: [1, -1, -1, -1, -1],
        characterSlotFixed: [false, true, true, true, 1],
      }),
    });

    expect(plan.blockingErrors).toContain(
      "角色位置固定状态必须包含 5 个布尔值",
    );
    expect(plan.formationOptions.mandatoryCharacters.slice(0, 4)).toEqual([
      101, 0, 102, 1,
    ]);
  });

  test("fixed poster without a same-position character blocks Python", () => {
    const plan = createPythonAutoPartyPlan({
      mode: "advanced",
      characters: [character(101)],
      posters: [poster(201)],
      leaderIdx: 0,
      leaderPosterIdx: -1,
      constraints: advancedConstraints({
        posterSlots: [-1, -1, -1, 0, -1],
        accessorySlots: [-1, -1, 0, -1, -1],
      }),
    });

    expect(plan.blockingErrors).toContain(
      "第 4 位的固定海报无法绑定角色，请固定同位置角色或将队长固定到该位置",
    );
    expect(plan.formationOptions.mandatoryPosters).toEqual(emptySlots().flatMap(
      () => [0, 0],
    ).slice(0, 10));
    expect(plan.ignoredAccessoryPositions).toEqual([2]);
  });

  test("candidate IDs can fall back to data.Id", () => {
    const plan = createPythonAutoPartyPlan({
      mode: "advanced",
      characters: [character(101, true), character(102, true)],
      posters: [poster(201, true), poster(202, true)],
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints: advancedConstraints({
        leaderPosition: 4,
        characterSlots: [1, -1, -1, -1, -1],
        posterSlots: [1, -1, -1, -1, -1],
      }),
    });

    expect(plan.formationOptions.mandatoryCharacters.slice(0, 4)).toEqual([
      101, 5, 102, 1,
    ]);
    expect(plan.formationOptions.mandatoryPosters.slice(0, 4)).toEqual([
      201, 101, 202, 102,
    ]);
    expect(plan.blockingErrors).toEqual([]);
  });
});

describe("resolvePythonFormationRow", () => {
  const characters = [
    character(101),
    character(102),
    character(103),
    character(104),
    character(105),
  ];
  const posters = [
    poster(201),
    poster(202),
    poster(203),
    poster(204),
    poster(205),
  ];

  test("basic mode moves one leader poster occurrence and preserves the rest", () => {
    const plan = createPythonAutoPartyPlan({
      mode: "basic",
      characters,
      posters,
      leaderIdx: 0,
      leaderPosterIdx: 0,
    });
    const resolved = resolvePythonFormationRow({
      row: [
        102, 101, 103, 104, 105,
        202, 203, 201, 204, 205,
        301, 302, 303, 304, 305,
      ],
      characters,
      posters,
      rowConstraints: plan.rowConstraints,
    });

    expect(resolved).toEqual({
      charPerm: [1, 0, 2, 3, 4],
      posterPerm: [1, 0, 2, 3, 4],
      accessoryIds: [301, 302, 303, 304, 305],
    });
    expect(new Set(resolved.posterPerm).size).toBe(5);
  });

  test("basic mode rejects rows missing the leader or leader poster", () => {
    const plan = createPythonAutoPartyPlan({
      mode: "basic",
      characters,
      posters,
      leaderIdx: 0,
      leaderPosterIdx: 0,
    });
    const baseRow = [
      102, 103, 104, 105, 102,
      201, 202, 203, 204, 205,
      301, 302, 303, 304, 305,
    ];

    expect(resolvePythonFormationRow({
      row: baseRow,
      characters,
      posters,
      rowConstraints: plan.rowConstraints,
    })).toBeNull();
    expect(resolvePythonFormationRow({
      row: [
        101, 102, 103, 104, 105,
        202, 203, 204, 205, 202,
        301, 302, 303, 304, 305,
      ],
      characters,
      posters,
      rowConstraints: plan.rowConstraints,
    })).toBeNull();
  });

  test("advanced mode preserves fixed inventory instances with duplicate IDs", () => {
    const duplicateCharacters = [
      character(101),
      character(102),
      character(102),
      character(103),
      character(104),
      character(105),
    ];
    const duplicatePosters = [
      poster(201),
      poster(202),
      poster(202),
      poster(203),
      poster(204),
      poster(205),
    ];
    const plan = createPythonAutoPartyPlan({
      mode: "advanced",
      characters: duplicateCharacters,
      posters: duplicatePosters,
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints: advancedConstraints({
        characterSlots: [2, -1, -1, -1, -1],
        posterSlots: [2, -1, -1, -1, -1],
      }),
    });
    const resolved = resolvePythonFormationRow({
      row: [
        102, 103, 101, 104, 105,
        202, 203, 201, 204, 205,
        301, 302, 303, 304, 305,
      ],
      characters: duplicateCharacters,
      posters: duplicatePosters,
      rowConstraints: plan.rowConstraints,
    });

    expect(resolved).toEqual({
      charPerm: [2, 3, 0, 4, 5],
      posterPerm: [2, 3, 0, 4, 5],
      accessoryIds: [301, 302, 303, 304, 305],
    });
  });

  test("advanced mode moves unlocked inventory instances and their bound posters", () => {
    const duplicateCharacters = [
      character(101),
      character(102),
      character(102),
      character(103),
      character(104),
      character(105),
    ];
    const duplicatePosters = [
      poster(201),
      poster(202),
      poster(202),
      poster(203),
      poster(204),
      poster(205),
    ];
    const plan = createPythonAutoPartyPlan({
      mode: "advanced",
      characters: duplicateCharacters,
      posters: duplicatePosters,
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints: advancedConstraints({
        leaderPosition: 2,
        characterSlots: [2, -1, -1, -1, -1],
        characterSlotFixed: [false, true, true, true, true],
        posterSlots: [2, -1, -1, -1, -1],
      }),
    });
    const resolved = resolvePythonFormationRow({
      row: [
        103, 104, 101, 105, 102,
        203, 204, 201, 205, 202,
        301, 302, 303, 304, 305,
      ],
      characters: duplicateCharacters,
      posters: duplicatePosters,
      rowConstraints: plan.rowConstraints,
    });

    expect(plan.formationOptions.mandatoryCharacters.slice(0, 4)).toEqual([
      101, 3, 102, 0,
    ]);
    expect(plan.formationOptions.mandatoryPosters.slice(0, 4)).toEqual([
      201, 101, 202, 102,
    ]);
    expect(resolved).toEqual({
      charPerm: [3, 4, 0, 5, 2],
      posterPerm: [3, 4, 0, 5, 2],
      accessoryIds: [301, 302, 303, 304, 305],
    });
  });

  test("advanced mode rejects a bound poster away from an unlocked character", () => {
    const plan = createPythonAutoPartyPlan({
      mode: "advanced",
      characters,
      posters,
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints: advancedConstraints({
        leaderPosition: 2,
        characterSlots: [1, -1, -1, -1, -1],
        characterSlotFixed: [false, true, true, true, true],
        posterSlots: [1, -1, -1, -1, -1],
      }),
    });

    expect(resolvePythonFormationRow({
      row: [
        103, 104, 101, 105, 102,
        202, 204, 201, 205, 203,
        301, 302, 303, 304, 305,
      ],
      characters,
      posters,
      rowConstraints: plan.rowConstraints,
    })).toBeNull();
  });

  test("advanced mode rejects violations of each positional constraint", () => {
    const plan = createPythonAutoPartyPlan({
      mode: "advanced",
      characters,
      posters,
      leaderIdx: 0,
      leaderPosterIdx: 0,
      constraints: advancedConstraints({
        leaderPosition: 2,
        characterSlots: [1, -1, -1, -1, -1],
        posterSlots: [1, -1, -1, -1, -1],
      }),
    });
    const validRow = [
      102, 103, 101, 104, 105,
      202, 203, 201, 204, 205,
      301, 302, 303, 304, 305,
    ];

    const wrongCharacter = validRow.slice();
    [wrongCharacter[0], wrongCharacter[1]] = [
      wrongCharacter[1],
      wrongCharacter[0],
    ];
    expect(resolvePythonFormationRow({
      row: wrongCharacter,
      characters,
      posters,
      rowConstraints: plan.rowConstraints,
    })).toBeNull();

    const wrongLeaderPoster = validRow.slice();
    [wrongLeaderPoster[7], wrongLeaderPoster[8]] = [
      wrongLeaderPoster[8],
      wrongLeaderPoster[7],
    ];
    expect(resolvePythonFormationRow({
      row: wrongLeaderPoster,
      characters,
      posters,
      rowConstraints: plan.rowConstraints,
    })).toBeNull();

    const wrongFixedPoster = validRow.slice();
    [wrongFixedPoster[5], wrongFixedPoster[6]] = [
      wrongFixedPoster[6],
      wrongFixedPoster[5],
    ];
    expect(resolvePythonFormationRow({
      row: wrongFixedPoster,
      characters,
      posters,
      rowConstraints: plan.rowConstraints,
    })).toBeNull();
  });

  test("malformed rows and unavailable candidate copies are rejected", () => {
    const plan = createPythonAutoPartyPlan({
      mode: "basic",
      characters,
      posters,
      leaderIdx: 0,
      leaderPosterIdx: -1,
    });

    expect(resolvePythonFormationRow({
      row: [101],
      characters,
      posters,
      rowConstraints: plan.rowConstraints,
    })).toBeNull();
    expect(resolvePythonFormationRow({
      row: [
        101, 102, 102, 104, 105,
        201, 202, 203, 204, 205,
        301, 302, 303, 304, 305,
      ],
      characters,
      posters,
      rowConstraints: plan.rowConstraints,
    })).toBeNull();
  });
});
