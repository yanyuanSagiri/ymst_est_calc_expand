/* global describe expect require test */

const { buildFormationArgs } = require("../electron/formationArgs");

describe("buildFormationArgs", () => {
  test("only includes the data path when formation options are omitted", () => {
    expect(buildFormationArgs("C:\\formation-data")).toEqual([
      "-d",
      "C:\\formation-data",
    ]);
  });

  test("expands both mandatory constraint arrays into separate argv values", () => {
    expect(
      buildFormationArgs("data", {
        mandatoryCharacters: [150010, 1, 150020, 0, 0, 0, 0, 0, 0, 0],
        mandatoryPosters: [330380, 150010, 230120, 0, 0, 0, 0, 0, 0, 0],
      }),
    ).toEqual([
      "-d",
      "data",
      "-mc",
      "150010",
      "1",
      "150020",
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
      "-mp",
      "330380",
      "150010",
      "230120",
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
      "0",
    ]);
  });

  test.each([
    ["missing mandatoryCharacters", { mandatoryPosters: Array(10).fill(0) }],
    [
      "missing mandatoryPosters",
      { mandatoryCharacters: Array(10).fill(0) },
    ],
    [
      "short mandatoryCharacters",
      {
        mandatoryCharacters: Array(9).fill(0),
        mandatoryPosters: Array(10).fill(0),
      },
    ],
    [
      "long mandatoryPosters",
      {
        mandatoryCharacters: Array(10).fill(0),
        mandatoryPosters: Array(11).fill(0),
      },
    ],
    [
      "string value",
      {
        mandatoryCharacters: ["1", ...Array(9).fill(0)],
        mandatoryPosters: Array(10).fill(0),
      },
    ],
    [
      "non-integer number",
      {
        mandatoryCharacters: Array(10).fill(0),
        mandatoryPosters: [1.5, ...Array(9).fill(0)],
      },
    ],
  ])("rejects %s", (_label, options) => {
    expect(() => buildFormationArgs("data", options)).toThrow(
      /exactly 10 integers/,
    );
  });

  test.each([null, [], "invalid"])(
    "rejects a non-object options value: %p",
    (options) => {
      expect(() => buildFormationArgs("data", options)).toThrow(
        "formation options must be an object",
      );
    },
  );
});
