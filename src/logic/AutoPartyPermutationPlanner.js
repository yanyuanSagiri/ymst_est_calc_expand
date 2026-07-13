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

function normalizeCharacterSlotFixed(values, characterSlots) {
  if (values === undefined) return new Array(PARTY_SIZE).fill(true);
  if (!Array.isArray(values) || values.length !== PARTY_SIZE) {
    constraintError(
      "INVALID_CHARACTER_SLOT_FIXED",
      `characterSlotFixed must contain exactly ${PARTY_SIZE} entries`,
      { values },
    );
  }

  return values.map((value, position) => {
    if (typeof value !== "boolean") {
      constraintError(
        "INVALID_CHARACTER_SLOT_FIXED_VALUE",
        `characterSlotFixed slot ${position} must be a boolean`,
        { value, position },
      );
    }
    return characterSlots[position] === -1 ? true : value;
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
      characterSlotFixed: new Array(PARTY_SIZE).fill(true),
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

  const characterSlots = normalizeAdvancedSlots(
    constraints?.characterSlots,
    "character",
  );

  return {
    mode,
    leaderPosition,
    characterSlots,
    characterSlotFixed: normalizeCharacterSlotFixed(
      constraints?.characterSlotFixed,
      characterSlots,
    ),
    posterSlots: normalizeAdvancedSlots(constraints?.posterSlots, "poster"),
    accessorySlots: normalizeAdvancedSlots(
      constraints?.accessorySlots,
      "accessory",
    ),
  };
}

function splitAdvancedRows(normalizedConstraints) {
  const absoluteCharacterSlots = new Array(PARTY_SIZE).fill(-1);
  const absolutePosterSlots = normalizedConstraints.posterSlots.slice();
  const absoluteAccessorySlots = normalizedConstraints.accessorySlots.slice();
  const movableRows = [];

  for (let position = 0; position < PARTY_SIZE; position++) {
    const characterIdx = normalizedConstraints.characterSlots[position];
    const isMovable =
      characterIdx !== -1 &&
      normalizedConstraints.characterSlotFixed[position] === false;

    if (!isMovable) {
      absoluteCharacterSlots[position] = characterIdx;
      continue;
    }

    movableRows.push({
      sourcePosition: position,
      characterIdx,
      posterIdx: normalizedConstraints.posterSlots[position],
      accessoryIdx: normalizedConstraints.accessorySlots[position],
    });
    absolutePosterSlots[position] = -1;
    absoluteAccessorySlots[position] = -1;
  }

  return {
    absoluteCharacterSlots,
    absolutePosterSlots,
    absoluteAccessorySlots,
    movableRows,
  };
}

function getLeaderPositions({
  normalizedConstraints,
  leaderIdx,
  leaderPosterIdx,
  absoluteCharacterSlots,
  absolutePosterSlots,
}) {
  let forcedPosition =
    normalizedConstraints.leaderPosition === -1
      ? null
      : normalizedConstraints.leaderPosition;

  forcedPosition = mergeForcedLeaderPosition(
    forcedPosition,
    findFixedPosition(absoluteCharacterSlots, leaderIdx),
    "characterSlots",
  );
  if (leaderPosterIdx >= 0) {
    forcedPosition = mergeForcedLeaderPosition(
      forcedPosition,
      findFixedPosition(absolutePosterSlots, leaderPosterIdx),
      "posterSlots",
    );
  }

  if (forcedPosition !== null) {
    const fixedCharacter = absoluteCharacterSlots[forcedPosition];
    if (fixedCharacter !== -1 && fixedCharacter !== leaderIdx) {
      constraintError(
        "LEADER_POSITION_CONFLICT",
        "The selected leader position is occupied by another fixed character",
        { position: forcedPosition, fixedCharacter, leaderIdx },
      );
    }

    if (leaderPosterIdx >= 0) {
      const fixedPoster = absolutePosterSlots[forcedPosition];
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
    if (absoluteCharacterSlots[position] !== -1) continue;
    if (
      leaderPosterIdx >= 0 &&
      absolutePosterSlots[position] !== -1
    ) continue;
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
  absoluteCharacterSlots,
  characterKeys,
  fixedCharacterState,
}) {
  const leaderPosition = findFixedPosition(absoluteCharacterSlots, leaderIdx);
  if (leaderPosition !== null) return;

  if (fixedCharacterState.usedIndices.has(leaderIdx)) {
    const position = fixedCharacterState.usedIndices.get(leaderIdx);
    constraintError(
      "DUPLICATE_FIXED_CHARACTER",
      "The leader cannot also be configured as a movable character",
      { leaderIdx, position },
    );
  }

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
  absolutePosterSlots,
  posterRestrictionKeys,
  fixedPosterState,
}) {
  if (leaderPosterIdx < 0) return;
  const leaderPosterPosition = findFixedPosition(
    absolutePosterSlots,
    leaderPosterIdx,
  );
  if (leaderPosterPosition !== null) return;

  if (fixedPosterState.usedIndices.has(leaderPosterIdx)) {
    const position = fixedPosterState.usedIndices.get(leaderPosterIdx);
    constraintError(
      "DUPLICATE_FIXED_POSTER",
      "The leader poster cannot be attached to a movable character",
      { leaderPosterIdx, position },
    );
  }

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

function slotSignature(slots) {
  return slots.join(",");
}

function getCachedPermutations(cache, count, fixedSlots, uniqueKeys = null) {
  const signature = slotSignature(fixedSlots);
  if (!cache.has(signature)) {
    cache.set(
      signature,
      generateSlotPermutations(count, fixedSlots, uniqueKeys),
    );
  }
  return cache.get(signature);
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
  const rowLayout = splitAdvancedRows(normalizedConstraints);

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
      absoluteCharacterSlots: rowLayout.absoluteCharacterSlots,
      characterKeys,
      fixedCharacterState,
    });
    validateLeaderPosterAgainstFixedPosters({
      leaderPosterIdx,
      absolutePosterSlots: rowLayout.absolutePosterSlots,
      posterRestrictionKeys,
      fixedPosterState,
    });
    leaderPositions = getLeaderPositions({
      normalizedConstraints,
      leaderIdx,
      leaderPosterIdx,
      absoluteCharacterSlots: rowLayout.absoluteCharacterSlots,
      absolutePosterSlots: rowLayout.absolutePosterSlots,
    });
  }

  const groupBuilders = new Map();
  const posterPermutationCache = new Map();
  const accessoryPermutationCache = new Map();
  let movableLayoutCount = 0;

  for (const leaderPosition of leaderPositions) {
    const fixedCharacters = rowLayout.absoluteCharacterSlots.slice();
    fixedCharacters[leaderPosition] = leaderIdx;
    const fixedPosters = rowLayout.absolutePosterSlots.slice();
    if (leaderPosterIdx >= 0) fixedPosters[leaderPosition] = leaderPosterIdx;
    const fixedAccessories = rowLayout.absoluteAccessorySlots.slice();

    const addResolvedLayout = () => {
      movableLayoutCount++;
      const posterSignature = slotSignature(fixedPosters);
      const accessorySignature = slotSignature(fixedAccessories);
      const groupKey =
        `${leaderPosition}|poster:${posterSignature}` +
        `|accessory:${accessorySignature}`;
      let group = groupBuilders.get(groupKey);
      if (!group) {
        group = {
          leaderPosition,
          characterPermutations: [],
          posterPermutations: getCachedPermutations(
            posterPermutationCache,
            posterCount,
            fixedPosters,
            posterRestrictionKeys,
          ),
          accessoryPermutations: getCachedPermutations(
            accessoryPermutationCache,
            accessoryCount,
            fixedAccessories,
          ),
        };
        groupBuilders.set(groupKey, group);
      }

      const resolvedCharacters = generateSlotPermutations(
        characterCount,
        fixedCharacters,
        characterKeys,
      );
      for (const permutation of resolvedCharacters) {
        group.characterPermutations.push(permutation);
      }
    };

    const placeMovableRow = (rowIndex) => {
      if (rowIndex === rowLayout.movableRows.length) {
        addResolvedLayout();
        return;
      }

      const row = rowLayout.movableRows[rowIndex];
      for (let position = 0; position < PARTY_SIZE; position++) {
        if (fixedCharacters[position] !== -1) continue;
        if (row.posterIdx !== -1 && fixedPosters[position] !== -1) continue;
        if (
          row.accessoryIdx !== -1 &&
          fixedAccessories[position] !== -1
        ) continue;

        fixedCharacters[position] = row.characterIdx;
        if (row.posterIdx !== -1) fixedPosters[position] = row.posterIdx;
        if (row.accessoryIdx !== -1) {
          fixedAccessories[position] = row.accessoryIdx;
        }

        placeMovableRow(rowIndex + 1);

        fixedCharacters[position] = -1;
        if (row.posterIdx !== -1) fixedPosters[position] = -1;
        if (row.accessoryIdx !== -1) fixedAccessories[position] = -1;
      }
    };

    placeMovableRow(0);
  }

  if (rowLayout.movableRows.length > 0 && movableLayoutCount === 0) {
    constraintError(
      "NO_LEGAL_MOVABLE_CHARACTER_PLACEMENT",
      "There is no legal placement for the movable character rows",
      {
        sourcePositions: rowLayout.movableRows.map(
          (row) => row.sourcePosition,
        ),
      },
    );
  }

  const groups = [];
  let totalCombinations = 0;
  for (const group of groupBuilders.values()) {
    const combinationCount =
      group.characterPermutations.length *
      group.posterPermutations.length *
      group.accessoryPermutations.length;
    groups.push({
      ...group,
      combinationCount,
      offset: totalCombinations,
    });
    totalCombinations += combinationCount;
  }

  return {
    groups,
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
  const accessoryCount = group.accessoryPermutations.length;
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
    accPerm: group.accessoryPermutations[accessoryPermutationIndex],
  };
}
