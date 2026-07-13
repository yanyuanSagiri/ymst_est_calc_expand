/* global module */

const CONSTRAINT_VALUE_COUNT = 10;

function validateConstraintValues(name, values) {
  if (
    !Array.isArray(values) ||
    values.length !== CONSTRAINT_VALUE_COUNT ||
    !values.every(Number.isInteger)
  ) {
    throw new TypeError(`${name} must contain exactly 10 integers`);
  }
}

function buildFormationArgs(dataPath, options) {
  const args = ["-d", dataPath];

  if (options === undefined) return args;
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("formation options must be an object");
  }

  const { mandatoryCharacters, mandatoryPosters } = options;
  validateConstraintValues("mandatoryCharacters", mandatoryCharacters);
  validateConstraintValues("mandatoryPosters", mandatoryPosters);

  args.push(
    "-mc",
    ...mandatoryCharacters.map(String),
    "-mp",
    ...mandatoryPosters.map(String),
  );
  return args;
}

module.exports = {
  CONSTRAINT_VALUE_COUNT,
  buildFormationArgs,
};
