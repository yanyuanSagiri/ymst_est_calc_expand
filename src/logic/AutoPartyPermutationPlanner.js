const PARTY_SIZE = 5;

export class AutoPartyConstraintError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AutoPartyConstraintError";
    this.code = code;
    this.details = details;
  }
}

function constraintError(code, message, details = {}) {
  throw new AutoPartyConstraintError(code, message, details);
}

function validateCandidateCount(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    constraintError(
      `INVALID_${label.toUpperCase()}_COUNT`,
      `${label}Count must be a non-negative integer`,
      { value },
    );
  }
}

function validateCandidateIndex(index, count, code, label) {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    constraintError(code, `${label} is not in the selected candidate pool`, {
      index,
      count,
    });
  }
}

function normalizeAdvancedSlots(slots, label) {
  if (slots === undefined) return new Array(PARTY_SIZE).fill(-1);
  if (!Array.isArray(slots) || slots.length !== PARTY_SIZE) {
    constraintError(
      `INVALID_${label.toUpperCase()}_SLOTS`,
      `${label}Slots must contain exactly ${PARTY_SIZE} entries`,
      { slots },
    );
  }

  return slots.map((index, position) => {
    if (!Number.isInteger(index) || index < -1) {
      constraintError(
        `INVALID_${label.toUpperCase()}_SLOT`,
        `${label} slot ${position} must be -1 or a candidate index`,
        { index, position },
      );
    }
    return index;
  });
}

function createCharacterKeys(characterCount, characterBaseIds) {
  return Array.from({ length: characterCount }, (_, index) => {
    const baseId = characterBaseIds[index];
    if (baseId === undefined || baseId === null) return { index };
    return `base:${typeof baseId}:${String(baseId)}`;
  });
}

function createPosterRestrictionKeys(posterCount, posterRestrictGroupIds) {
  return Array.from({ length: posterCount }, (_, index) => {
    const groupId = posterRestrictGroupIds[index];
    if (!groupId) return null;
    return `restrict:${typeof groupId}:${String(groupId)}`;
  });
}

function validateFixedSlots({
  slots,
  count,
  label,
  duplicateCode,
  uniqueKeys = null,
  duplicateKeyCode = null,
}) {
  const usedIndices = new Map();
  const usedKeys = new Map();

  for (let position = 0; position < PARTY_SIZE; position++) {
    const index = slots[position];
    if (index === -1) continue;

    if (index >= count) {
      constraintError(
        `FIXED_${label.toUpperCase()}_OUT_OF_RANGE`,
        `Fixed ${label} at position ${position} is not in the selected candidate pool`,
        { index, position, count },
      );
    }

    if (usedIndices.has(index)) {
      constraintError(
        duplicateCode,
        `The same ${label} candidate cannot be fixed more than once`,
        { index, positions: [usedIndices.get(index), position] },
      );
    }
    usedIndices.set(index, position);

    if (!uniqueKeys) continue;
    const key = uniqueKeys[index];
    if (key === null) continue;
    if (usedKeys.has(key)) {
      const previous = usedKeys.get(key);
      constraintError(
        duplicateKeyCode,
        `Fixed ${label} candidates at positions ${previous.position} and ${position} conflict`,
        {
          indices: [previous.index, index],
          positions: [previous.position, position],
        },
      );
    }
    usedKeys.set(key, { index, position });
  }

  return { usedIndices, usedKeys };
}

function findFixedPosition(slots, candidateIndex) {
  const position = slots.indexOf(candidateIndex);
  return position === -1 ? null : position;
}

function mergeForcedLeaderPosition(current, next, source) {
  if (next === null) return current;
  if (current !== null && current !== next) {
    constraintError(
      "LEADER_POSITION_CONFLICT",
      "The fixed leader, leader poster, and selected leader position do not match",
      { current, next, source },
    );
  }
  return next;
}

function generateSlotPermutations(count, fixedSlots, uniqueKeys = null) {
  const permutations = [];
  const current = fixedSlots.slice();
  const usedIndices = new Set();
  const usedKeys = new Set();

  for (const index of fixedSlots) {
    if (index === -1) continue;
    usedIndices.add(index);
    if (uniqueKeys) {
      const key = uniqueKeys[index];
      if (key !== null) usedKeys.add(key);
    }
  }

  const visit = (position) => {
    if (position === PARTY_SIZE) {
      permutations.push(current.slice());
      return;
    }

    if (current[position] !== -1) {
      visit(position + 1);
      return;
    }

    for (let index = 0; index < count; index++) {
      if (usedIndices.has(index)) continue;

      const key = uniqueKeys ? uniqueKeys[index] : null;
      if (key !== null && usedKeys.has(key)) continue;

      current[position] = index;
      usedIndices.add(index);
      if (key !== null) usedKeys.add(key);

      visit(position + 1);

      if (key !== null) usedKeys.delete(key);
      usedIndices.delete(index);
      current[position] = -1;
    }
  };

  visit(0);
  return permutations;
}

function normalizeConstraints(constraints) {
  const mode = constraints?.mode ?? "basic";
  if (mode !== "basic" && mode !== "advanced") {
    constraintError(
      "INVALID_CONSTRAINT_MODE",
      'Auto-party constraint mode must be "basic" or "advanced"',
      { mode },
    );
  }

  if (mode === "basic") {
    return {
      mode,
      leaderPosition: -1,
      characterSlots: new Array(PARTY_SIZE).fill(-1),
      posterSlots: new Array(PARTY_SIZE).fill(-1),
      accessorySlots: new Array(PARTY_SIZE).fill(-1),
    };
  }

  const leaderPosition = constraints?.leaderPosition ?? -1;
  if (
    !Number.isInteger(leaderPosition) ||
    leaderPosition < -1 ||
    leaderPosition >= PARTY_SIZE
  ) {
    constraintError(
      "INVALID_LEADER_POSITION",
      "leaderPosition must be -1 or a party position from 0 to 4",
      { leaderPosition },
    );
  }

  return {
    mode,
    leaderPosition,
    characterSlots: normalizeAdvancedSlots(
      constraints?.characterSlots,
      "character",
    ),
    posterSlots: normalizeAdvancedSlots(constraints?.posterSlots, "poster"),
    accessorySlots: normalizeAdvancedSlots(
      constraints?.accessorySlots,
      "accessory",
    ),
  };
}

function getLeaderPositions({
  normalizedConstraints,
  leaderIdx,
  leaderPosterIdx,
}) {
  const { characterSlots, posterSlots } = normalizedConstraints;
  let forcedPosition =
    normalizedConstraints.leaderPosition === -1
      ? null
      : normalizedConstraints.leaderPosition;

  forcedPosition = mergeForcedLeaderPosition(
    forcedPosition,
    findFixedPosition(characterSlots, leaderIdx),
    "characterSlots",
  );
  if (leaderPosterIdx >= 0) {
    forcedPosition = mergeForcedLeaderPosition(
      forcedPosition,
      findFixedPosition(posterSlots, leaderPosterIdx),
      "posterSlots",
    );
  }

  if (forcedPosition !== null) {
    const fixedCharacter = characterSlots[forcedPosition];
    if (fixedCharacter !== -1 && fixedCharacter !== leaderIdx) {
      constraintError(
        "LEADER_POSITION_CONFLICT",
        "The selected leader position is occupied by another fixed character",
        { position: forcedPosition, fixedCharacter, leaderIdx },
      );
    }

    if (leaderPosterIdx >= 0) {
      const fixedPoster = posterSlots[forcedPosition];
      if (fixedPoster !== -1 && fixedPoster !== leaderPosterIdx) {
        constraintError(
          "LEADER_POSTER_POSITION_CONFLICT",
          "The selected leader position is occupied by another fixed poster",
          { position: forcedPosition, fixedPoster, leaderPosterIdx },
        );
      }
    }
    return [forcedPosition];
  }

  const positions = [];
  for (let position = 0; position < PARTY_SIZE; position++) {
    if (characterSlots[position] !== -1) continue;
    if (leaderPosterIdx >= 0 && posterSlots[position] !== -1) continue;
    positions.push(position);
  }

  if (positions.length === 0) {
    constraintError(
      "NO_LEGAL_LEADER_POSITION",
      "There is no position where both the leader and leader poster can be placed",
    );
  }
  return positions;
}

function validateLeaderAgainstFixedCharacters({
  leaderIdx,
  characterSlots,
  characterKeys,
  fixedCharacterState,
}) {
  const leaderPosition = findFixedPosition(characterSlots, leaderIdx);
  if (leaderPosition !== null) return;

  const leaderKey = characterKeys[leaderIdx];
  if (fixedCharacterState.usedKeys.has(leaderKey)) {
    const previous = fixedCharacterState.usedKeys.get(leaderKey);
    constraintError(
      "DUPLICATE_CHARACTER_BASE",
      "The leader has the same primary character as a fixed character",
      {
        leaderIdx,
        fixedIndex: previous.index,
        fixedPosition: previous.position,
      },
    );
  }
}

function validateLeaderPosterAgainstFixedPosters({
  leaderPosterIdx,
  posterSlots,
  posterRestrictionKeys,
  fixedPosterState,
}) {
  if (leaderPosterIdx < 0) return;
  const leaderPosterPosition = findFixedPosition(posterSlots, leaderPosterIdx);
  if (leaderPosterPosition !== null) return;

  const restrictionKey = posterRestrictionKeys[leaderPosterIdx];
  if (restrictionKey === null) return;
  if (fixedPosterState.usedKeys.has(restrictionKey)) {
    const previous = fixedPosterState.usedKeys.get(restrictionKey);
    constraintError(
      "DUPLICATE_POSTER_RESTRICT_GROUP",
      "The leader poster conflicts with a fixed poster restriction group",
      {
        leaderPosterIdx,
        fixedIndex: previous.index,
        fixedPosition: previous.position,
      },
    );
  }
}

export function createAutoPartyPermutationPlan({
  characterCount,
  posterCount,
  accessoryCount,
  leaderIdx,
  leaderPosterIdx = -1,
  constraints,
  characterBaseIds = [],
  posterRestrictGroupIds = [],
}) {
  validateCandidateCount(characterCount, "character");
  validateCandidateCount(posterCount, "poster");
  validateCandidateCount(accessoryCount, "accessory");
  validateCandidateIndex(
    leaderIdx,
    characterCount,
    "LEADER_NOT_IN_POOL",
    "Leader",
  );
  if (leaderPosterIdx !== -1) {
    validateCandidateIndex(
      leaderPosterIdx,
      posterCount,
      "LEADER_POSTER_NOT_IN_POOL",
      "Leader poster",
    );
  }

  const normalizedConstraints = normalizeConstraints(constraints);
  const characterKeys = createCharacterKeys(
    characterCount,
    Array.isArray(characterBaseIds) ? characterBaseIds : [],
  );
  const posterRestrictionKeys = createPosterRestrictionKeys(
    posterCount,
    Array.isArray(posterRestrictGroupIds) ? posterRestrictGroupIds : [],
  );

  let leaderPositions = [0, 1, 2, 3, 4];
  if (normalizedConstraints.mode === "advanced") {
    const fixedCharacterState = validateFixedSlots({
      slots: normalizedConstraints.characterSlots,
      count: characterCount,
      label: "character",
      duplicateCode: "DUPLICATE_FIXED_CHARACTER",
      uniqueKeys: characterKeys,
      duplicateKeyCode: "DUPLICATE_CHARACTER_BASE",
    });
    const fixedPosterState = validateFixedSlots({
      slots: normalizedConstraints.posterSlots,
      count: posterCount,
      label: "poster",
      duplicateCode: "DUPLICATE_FIXED_POSTER",
      uniqueKeys: posterRestrictionKeys,
      duplicateKeyCode: "DUPLICATE_POSTER_RESTRICT_GROUP",
    });
    validateFixedSlots({
      slots: normalizedConstraints.accessorySlots,
      count: accessoryCount,
      label: "accessory",
      duplicateCode: "DUPLICATE_FIXED_ACCESSORY",
    });
    validateLeaderAgainstFixedCharacters({
      leaderIdx,
      characterSlots: normalizedConstraints.characterSlots,
      characterKeys,
      fixedCharacterState,
    });
    validateLeaderPosterAgainstFixedPosters({
      leaderPosterIdx,
      posterSlots: normalizedConstraints.posterSlots,
      posterRestrictionKeys,
      fixedPosterState,
    });
    leaderPositions = getLeaderPositions({
      normalizedConstraints,
      leaderIdx,
      leaderPosterIdx,
    });
  }

  const accessoryPermutations = generateSlotPermutations(
    accessoryCount,
    normalizedConstraints.accessorySlots,
  );
  const groups = [];
  let totalCombinations = 0;

  for (const leaderPosition of leaderPositions) {
    const fixedCharacters = normalizedConstraints.characterSlots.slice();
    fixedCharacters[leaderPosition] = leaderIdx;
    const characterPermutations = generateSlotPermutations(
      characterCount,
      fixedCharacters,
      characterKeys,
    );

    const fixedPosters = normalizedConstraints.posterSlots.slice();
    if (leaderPosterIdx >= 0) fixedPosters[leaderPosition] = leaderPosterIdx;
    const posterPermutations = generateSlotPermutations(
      posterCount,
      fixedPosters,
      posterRestrictionKeys,
    );

    const combinationCount =
      characterPermutations.length *
      posterPermutations.length *
      accessoryPermutations.length;
    groups.push({
      leaderPosition,
      characterPermutations,
      posterPermutations,
      combinationCount,
      offset: totalCombinations,
    });
    totalCombinations += combinationCount;
  }

  return {
    groups,
    accessoryPermutations,
    totalCombinations,
  };
}

export function resolveAutoPartyCombination(plan, index) {
  if (!plan || !Array.isArray(plan.groups)) {
    throw new TypeError("A valid auto-party permutation plan is required");
  }
  if (
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= plan.totalCombinations
  ) {
    throw new RangeError("Auto-party combination index is out of range");
  }

  const groupIdx = plan.groups.findIndex(
    (group) =>
      index >= group.offset && index < group.offset + group.combinationCount,
  );
  if (groupIdx === -1) {
    throw new RangeError("Auto-party combination index is out of range");
  }

  const group = plan.groups[groupIdx];
  const accessoryCount = plan.accessoryPermutations.length;
  const posterBlockSize = group.posterPermutations.length * accessoryCount;
  const localIndex = index - group.offset;
  const characterPermutationIndex = Math.floor(
    localIndex / posterBlockSize,
  );
  const remaining = localIndex % posterBlockSize;
  const posterPermutationIndex = Math.floor(remaining / accessoryCount);
  const accessoryPermutationIndex = remaining % accessoryCount;

  return {
    groupIdx,
    leaderPosition: group.leaderPosition,
    characterPermutationIndex,
    posterPermutationIndex,
    accessoryPermutationIndex,
    charPerm: group.characterPermutations[characterPermutationIndex],
    posterPerm: group.posterPermutations[posterPermutationIndex],
    accPerm: plan.accessoryPermutations[accessoryPermutationIndex],
  };
}
