import { createAutoPartyImportPlan } from "../src/logic/AutoPartyImportPlanner.js";
import { createAutoPartyPermutationPlan } from "../src/logic/AutoPartyPermutationPlanner.js";

/* global describe expect test */

const emptySlots = () => [-1, -1, -1, -1, -1];

describe("createAutoPartyImportPlan", () => {
  test("imports a complete party and derives the leader and leader poster", () => {
    const chars = Array.from({ length: 6 }, (_, id) => ({ type: "c", id }));
    const posters = Array.from({ length: 6 }, (_, id) => ({ type: "p", id }));
    const accessories = Array.from(
      { length: 6 },
      (_, id) => ({ type: "a", id }),
    );
    const characterCandidates = [chars[5], chars[2], chars[0], chars[4], chars[1], chars[3]];
    const posterCandidates = [posters[3], posters[5], posters[0], posters[2], posters[4], posters[1]];
    const accessoryCandidates = [
      accessories[4],
      accessories[2],
      accessories[5],
      accessories[0],
      accessories[3],
      accessories[1],
    ];
    const party = {
      characters: chars.slice(0, 5),
      posters: posters.slice(0, 5),
      accessories: accessories.slice(0, 5),
      leader: chars[2],
    };

    const plan = createAutoPartyImportPlan({
      party,
      characters: characterCandidates,
      posters: posterCandidates,
      accessories: accessoryCandidates,
    });

    expect(plan.selectedCharacters).toEqual([false, true, true, true, true, true]);
    expect(plan.selectedPosters).toEqual([true, false, true, true, true, true]);
    expect(plan.selectedAccessories).toEqual([true, true, false, true, true, true]);
    expect(plan.advanced).toEqual({
      leaderIdx: 1,
      leaderPosterIdx: 3,
      leaderPosition: 2,
      characterSlots: [2, 4, -1, 5, 3],
      characterSlotFixed: [true, true, true, true, true],
      posterSlots: [2, 5, -1, 0, 4],
      posterSlotBound: [true, true, false, true, true],
      accessorySlots: [3, 5, 1, 4, 0],
    });
    expect(plan.skippedItems).toEqual([]);
    expect(plan.leaderStatus).toBe("imported");
    expect(plan.importedItemCount).toBe(15);
  });

  test("a fully imported party produces exactly one constrained combination", () => {
    const characters = Array.from({ length: 5 }, (_, id) => ({ id }));
    const posters = Array.from({ length: 5 }, (_, id) => ({ id }));
    const accessories = Array.from({ length: 5 }, (_, id) => ({ id }));
    const importPlan = createAutoPartyImportPlan({
      party: {
        characters,
        posters,
        accessories,
        leader: characters[2],
      },
      characters,
      posters,
      accessories,
    });

    const permutationPlan = createAutoPartyPermutationPlan({
      characterCount: characters.length,
      posterCount: posters.length,
      accessoryCount: accessories.length,
      leaderIdx: importPlan.advanced.leaderIdx,
      leaderPosterIdx: importPlan.advanced.leaderPosterIdx,
      constraints: {
        mode: "advanced",
        leaderPosition: importPlan.advanced.leaderPosition,
        characterSlots: importPlan.advanced.characterSlots,
        characterSlotFixed: importPlan.advanced.characterSlotFixed,
        posterSlots: importPlan.advanced.posterSlots,
        posterSlotBound: importPlan.advanced.posterSlotBound,
        accessorySlots: importPlan.advanced.accessorySlots,
      },
      characterBaseIds: [10, 20, 30, 40, 50],
      posterRestrictGroupIds: [10, 20, 30, 40, 50],
    });

    expect(permutationPlan.totalCombinations).toBe(1);
  });

  test("imports existing slots when the party has no leader and pads short arrays", () => {
    const char0 = { type: "c", id: 0 };
    const char1 = { type: "c", id: 1 };
    const poster0 = { type: "p", id: 0 };
    const accessory0 = { type: "a", id: 0 };

    const plan = createAutoPartyImportPlan({
      party: {
        characters: [char0, char1],
        posters: [poster0],
        accessories: [accessory0],
        leader: null,
      },
      characters: [char1, char0],
      posters: [poster0],
      accessories: [accessory0],
    });

    expect(plan.advanced).toEqual({
      leaderIdx: -1,
      leaderPosterIdx: -1,
      leaderPosition: -1,
      characterSlots: [1, 0, -1, -1, -1],
      characterSlotFixed: [true, true, true, true, true],
      posterSlots: [0, -1, -1, -1, -1],
      posterSlotBound: [true, false, false, false, false],
      accessorySlots: [0, -1, -1, -1, -1],
    });
    expect(plan.leaderStatus).toBe("missing");
    expect(plan.importedItemCount).toBe(4);
    expect(plan.skippedItems).toEqual([]);
  });

  test("skips a leader outside the candidate pool but imports other slots", () => {
    const skippedLeader = { type: "c", id: 0 };
    const importedCharacter = { type: "c", id: 1 };
    const importedPoster = { type: "p", id: 0 };

    const plan = createAutoPartyImportPlan({
      party: {
        characters: [skippedLeader, importedCharacter],
        posters: [importedPoster],
        accessories: [],
        leader: skippedLeader,
      },
      characters: [importedCharacter],
      posters: [importedPoster],
      accessories: [],
    });

    expect(plan.selectedCharacters).toEqual([true]);
    expect(plan.selectedPosters).toEqual([true]);
    expect(plan.advanced.leaderIdx).toBe(-1);
    expect(plan.advanced.leaderPosition).toBe(-1);
    expect(plan.advanced.characterSlots).toEqual([-1, 0, -1, -1, -1]);
    expect(plan.advanced.posterSlots).toEqual([0, -1, -1, -1, -1]);
    expect(plan.advanced.posterSlotBound).toEqual([
      false, false, false, false, false,
    ]);
    expect(plan.advanced.leaderPosterIdx).toBe(-1);
    expect(plan.leaderStatus).toBe("skipped");
    expect(plan.skippedItems).toEqual([{ type: "character", position: 0 }]);
    expect(plan.importedItemCount).toBe(2);
  });

  test("records every non-empty item outside its candidate pool", () => {
    const plan = createAutoPartyImportPlan({
      party: {
        characters: [{ id: 1 }],
        posters: [{ id: 2 }],
        accessories: [{ id: 3 }],
        leader: null,
      },
      characters: [],
      posters: [],
      accessories: [],
    });

    expect(plan.selectedCharacters).toEqual([]);
    expect(plan.selectedPosters).toEqual([]);
    expect(plan.selectedAccessories).toEqual([]);
    expect(plan.advanced.characterSlots).toEqual(emptySlots());
    expect(plan.advanced.posterSlots).toEqual(emptySlots());
    expect(plan.advanced.posterSlotBound).toEqual([
      false, false, false, false, false,
    ]);
    expect(plan.advanced.accessorySlots).toEqual(emptySlots());
    expect(plan.skippedItems).toEqual([
      { type: "character", position: 0 },
      { type: "poster", position: 0 },
      { type: "accessory", position: 0 },
    ]);
    expect(plan.importedItemCount).toBe(0);
  });

  test("maps duplicate accessory master IDs by inventory object identity", () => {
    const firstAccessory = { id: 100, level: 10 };
    const secondAccessory = { id: 100, level: 10 };
    const sameDataClone = { id: 100, level: 10 };

    const imported = createAutoPartyImportPlan({
      party: {
        characters: [],
        posters: [],
        accessories: [secondAccessory],
        leader: null,
      },
      characters: [],
      posters: [],
      accessories: [firstAccessory, secondAccessory],
    });
    const skipped = createAutoPartyImportPlan({
      party: {
        characters: [],
        posters: [],
        accessories: [sameDataClone],
        leader: null,
      },
      characters: [],
      posters: [],
      accessories: [firstAccessory, secondAccessory],
    });

    expect(imported.selectedAccessories).toEqual([false, true]);
    expect(imported.advanced.accessorySlots).toEqual([1, -1, -1, -1, -1]);
    expect(imported.skippedItems).toEqual([]);
    expect(skipped.selectedAccessories).toEqual([false, false]);
    expect(skipped.advanced.accessorySlots).toEqual(emptySlots());
    expect(skipped.skippedItems).toEqual([
      { type: "accessory", position: 0 },
    ]);
  });

  test("treats a leader object that is not in a character slot as missing", () => {
    const character = { id: 1 };
    const detachedLeader = { id: 2 };

    const plan = createAutoPartyImportPlan({
      party: {
        characters: [character],
        posters: [],
        accessories: [],
        leader: detachedLeader,
      },
      characters: [character, detachedLeader],
      posters: [],
      accessories: [],
    });

    expect(plan.leaderStatus).toBe("missing");
    expect(plan.advanced.leaderIdx).toBe(-1);
    expect(plan.advanced.leaderPosition).toBe(-1);
    expect(plan.advanced.characterSlots).toEqual([0, -1, -1, -1, -1]);
  });
});
