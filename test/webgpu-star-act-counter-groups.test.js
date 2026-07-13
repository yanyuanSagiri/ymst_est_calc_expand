import WebGPUStarActCounter from "../src/logic/WebGPUStarActCounter";

/* global describe test expect jest */

describe("WebGPUStarActCounter grouped permutation pools", () => {
  test("uses each group's accessory pool and applies one global threshold", async () => {
    const counter = new WebGPUStarActCounter();
    const firstAccessories = [[0, 1, 2, 3, 4], [1, 0, 2, 3, 4]];
    const secondAccessories = [[4, 3, 2, 1, 0]];
    const groups = [
      {
        characterPermutations: [[0, 1, 2, 3, 4]],
        posterPermutations: [[0, 1, 2, 3, 4]],
        accessoryPermutations: firstAccessories,
      },
      {
        characterPermutations: [[4, 3, 2, 1, 0]],
        posterPermutations: [
          [0, 1, 2, 3, 4],
          [1, 0, 2, 3, 4],
        ],
        accessoryPermutations: secondAccessories,
      },
    ];
    counter.computeWithPools = jest
      .fn()
      .mockResolvedValueOnce(Uint32Array.from([3, 5]))
      .mockResolvedValueOnce(Uint32Array.from([4, 5]));

    const result = await counter.computeFilteredPoolGroups({ groups }, 1);

    expect(counter.computeWithPools).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ accPerms: firstAccessories }),
    );
    expect(counter.computeWithPools).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ accPerms: secondAccessories }),
    );
    expect(result.maxCount).toBe(5);
    expect(result.threshold).toBe(4);
    expect(result.totalCount).toBe(4);
    expect(result.candidates).toEqual([
      { groupIdx: 0, cpIdx: 0, ppIdx: 0, apIdx: 1 },
      { groupIdx: 1, cpIdx: 0, ppIdx: 0, apIdx: 0 },
      { groupIdx: 1, cpIdx: 0, ppIdx: 1, apIdx: 0 },
    ]);
  });

  test("skips groups without a complete local pool", async () => {
    const counter = new WebGPUStarActCounter();
    counter.computeWithPools = jest.fn();

    const result = await counter.computeFilteredPoolGroups({
      groups: [
        {
          characterPermutations: [[0, 1, 2, 3, 4]],
          posterPermutations: [[0, 1, 2, 3, 4]],
          accessoryPermutations: [],
        },
      ],
    });

    expect(counter.computeWithPools).not.toHaveBeenCalled();
    expect(result).toEqual({
      candidates: [],
      maxCount: 0,
      threshold: 0,
      totalCount: 0,
      maxCombo: null,
    });
  });
});
