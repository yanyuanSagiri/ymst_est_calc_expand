const PARTY_SIZE = 5;

const emptySlots = () => new Array(PARTY_SIZE).fill(-1);
const fixedSlots = () => new Array(PARTY_SIZE).fill(true);

function characterId(character) {
  return character?.Id ?? character?.data?.Id;
}

function posterId(poster) {
  return poster?.id ?? poster?.data?.Id;
}

function addBlockingError(errors, message) {
  if (!errors.includes(message)) errors.push(message);
}

function normalizeMode(mode, constraints, blockingErrors) {
  const value = mode ?? constraints?.mode ?? "basic";
  if (value === "basic" || value === "advanced") return value;
  addBlockingError(blockingErrors, "Python 自动配队设置模式无效");
  return "basic";
}

function normalizeLeaderPosition(value, blockingErrors) {
  const position = value ?? -1;
  if (
    Number.isInteger(position) &&
    position >= -1 &&
    position < PARTY_SIZE
  ) {
    return position;
  }
  addBlockingError(blockingErrors, "队长位置必须是自动或第 1～5 位");
  return -1;
}

function normalizeSlots(value, label, blockingErrors) {
  if (value === undefined) return emptySlots();
  if (!Array.isArray(value) || value.length !== PARTY_SIZE) {
    addBlockingError(blockingErrors, `${label}固定槽必须包含 5 个位置`);
    return emptySlots();
  }

  return value.map((index, position) => {
    if (Number.isInteger(index) && index >= -1) return index;
    addBlockingError(
      blockingErrors,
      `第 ${position + 1} 位的${label}固定项无效`,
    );
    return -1;
  });
}

function normalizeCharacterSlotFixed(value, characterSlots, blockingErrors) {
  if (value === undefined) return fixedSlots();
  if (
    !Array.isArray(value) ||
    value.length !== PARTY_SIZE ||
    !value.every((fixed) => typeof fixed === "boolean")
  ) {
    addBlockingError(
      blockingErrors,
      "角色位置固定状态必须包含 5 个布尔值",
    );
    return fixedSlots();
  }
  return value.map((fixed, position) =>
    characterSlots[position] < 0 ? true : fixed,
  );
}

function normalizePosterSlotBound({
  value,
  posterSlots,
  characterSlots,
  leaderPosition,
  blockingErrors,
}) {
  const inferred = posterSlots.map(
    (posterIndex, position) =>
      posterIndex >= 0 &&
      (characterSlots[position] >= 0 || leaderPosition === position),
  );
  if (value === undefined) return inferred;
  if (
    !Array.isArray(value) ||
    value.length !== PARTY_SIZE ||
    !value.every((bound) => typeof bound === "boolean")
  ) {
    addBlockingError(
      blockingErrors,
      "海报绑定状态必须包含 5 个布尔值",
    );
    return inferred;
  }
  return value.map((bound, position) =>
    posterSlots[position] < 0 ? false : bound,
  );
}

function getCandidate({ candidates, index, label, position, blockingErrors }) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= candidates.length
  ) {
    const positionText = position === undefined ? "" : `第 ${position + 1} 位的`;
    addBlockingError(
      blockingErrors,
      `${positionText}${label}不在当前候选池中`,
    );
    return null;
  }
  return candidates[index];
}

function getIntegerCandidateId({
  candidates,
  index,
  label,
  position,
  getId,
  blockingErrors,
}) {
  const candidate = getCandidate({
    candidates,
    index,
    label,
    position,
    blockingErrors,
  });
  if (!candidate) return null;

  const id = getId(candidate);
  if (!Number.isInteger(id)) {
    const positionText = position === undefined ? "" : `第 ${position + 1} 位的`;
    addBlockingError(
      blockingErrors,
      `${positionText}${label}没有有效的整数 Master ID`,
    );
    return null;
  }
  return id;
}

function mergeLeaderPosition(
  currentPosition,
  nextPosition,
  sourceLabel,
  blockingErrors,
) {
  if (nextPosition < 0) return currentPosition;
  if (currentPosition >= 0 && currentPosition !== nextPosition) {
    addBlockingError(
      blockingErrors,
      `队长位置与${sourceLabel}的固定位置冲突`,
    );
    return currentPosition;
  }
  return nextPosition;
}

function findAllPositions(slots, candidateIndex) {
  const positions = [];
  slots.forEach((index, position) => {
    if (index === candidateIndex) positions.push(position);
  });
  return positions;
}

function deriveLeaderPosition({
  leaderPosition,
  leaderIdx,
  leaderPosterIdx,
  characterSlots,
  characterSlotFixed,
  posterSlots,
  blockingErrors,
}) {
  let result = leaderPosition;
  const characterPositions = findAllPositions(characterSlots, leaderIdx);
  const fixedCharacterPositions = characterPositions.filter(
    (position) => characterSlotFixed[position],
  );
  const posterPositions =
    leaderPosterIdx >= 0
      ? findAllPositions(posterSlots, leaderPosterIdx)
      : [];

  if (characterPositions.length > 1) {
    addBlockingError(blockingErrors, "队长不能固定在多个角色位置");
  }
  if (posterPositions.length > 1) {
    addBlockingError(blockingErrors, "队长海报不能固定在多个海报位置");
  }

  if (fixedCharacterPositions.length > 0) {
    result = mergeLeaderPosition(
      result,
      fixedCharacterPositions[0],
      "队长角色槽",
      blockingErrors,
    );
  }
  if (posterPositions.length > 0) {
    result = mergeLeaderPosition(
      result,
      posterPositions[0],
      "队长海报槽",
      blockingErrors,
    );
  }
  return result;
}

function pushUniquePair({
  pairs,
  usedCandidateIndices,
  usedIds,
  candidateIndex,
  id,
  pairValue,
  duplicateMessage,
  blockingErrors,
}) {
  if (usedCandidateIndices.has(candidateIndex) || usedIds.has(id)) {
    addBlockingError(blockingErrors, duplicateMessage);
    return;
  }
  usedCandidateIndices.add(candidateIndex);
  usedIds.add(id);
  pairs.push([id, pairValue]);
}

function flattenPairs(pairs, label, blockingErrors) {
  if (pairs.length > PARTY_SIZE) {
    addBlockingError(
      blockingErrors,
      `${label}约束超过 Python 接口允许的 5 组`,
    );
  }

  const result = [];
  for (const pair of pairs.slice(0, PARTY_SIZE)) result.push(...pair);
  while (result.length < PARTY_SIZE * 2) result.push(0, 0);
  return result;
}

function createRowConstraints({
  mode,
  leaderIdx,
  leaderPosterIdx,
  leaderPosition,
  characterSlots,
  characterSlotFixed,
  posterSlots,
  posterSlotBound,
  posterBindings,
}) {
  return {
    mode,
    leaderIdx,
    leaderPosterIdx,
    leaderPosition,
    characterSlots: characterSlots.slice(),
    characterSlotFixed: characterSlotFixed.slice(),
    posterSlots: posterSlots.slice(),
    posterSlotBound: posterSlotBound.slice(),
    posterBindings: posterBindings.slice(),
  };
}

/**
 * Convert the renderer's candidate-index constraints into Start.exe -mc/-mp
 * arguments and a compact description used to validate streamed rows.
 */
export function createPythonAutoPartyPlan({
  mode,
  characters = [],
  posters = [],
  leaderIdx = -1,
  leaderPosterIdx = -1,
  constraints = {},
}) {
  const blockingErrors = [];
  const normalizedMode = normalizeMode(mode, constraints, blockingErrors);

  const leaderId = getIntegerCandidateId({
    candidates: characters,
    index: leaderIdx,
    label: "队长",
    getId: characterId,
    blockingErrors,
  });
  if (leaderPosterIdx !== -1) {
    getIntegerCandidateId({
      candidates: posters,
      index: leaderPosterIdx,
      label: "队长海报",
      getId: posterId,
      blockingErrors,
    });
  }

  if (normalizedMode === "basic") {
    return {
      formationOptions: null,
      rowConstraints: createRowConstraints({
        mode: "basic",
        leaderIdx,
        leaderPosterIdx,
        leaderPosition: -1,
        characterSlots: emptySlots(),
        characterSlotFixed: fixedSlots(),
        posterSlots: emptySlots(),
        posterSlotBound: new Array(PARTY_SIZE).fill(false),
        posterBindings: emptySlots(),
      }),
      ignoredAccessoryPositions: [],
      unboundPosterPositions: [],
      blockingErrors,
    };
  }

  const characterSlots = normalizeSlots(
    constraints?.characterSlots,
    "角色",
    blockingErrors,
  );
  const characterSlotFixed = normalizeCharacterSlotFixed(
    constraints?.characterSlotFixed,
    characterSlots,
    blockingErrors,
  );
  const posterSlots = normalizeSlots(
    constraints?.posterSlots,
    "海报",
    blockingErrors,
  );
  const accessorySlots = normalizeSlots(
    constraints?.accessorySlots,
    "饰品",
    blockingErrors,
  );
  const requestedLeaderPosition = normalizeLeaderPosition(
    constraints?.leaderPosition,
    blockingErrors,
  );
  const effectiveLeaderPosition = deriveLeaderPosition({
    leaderPosition: requestedLeaderPosition,
    leaderIdx,
    leaderPosterIdx,
    characterSlots,
    characterSlotFixed,
    posterSlots,
    blockingErrors,
  });
  const posterSlotBound = normalizePosterSlotBound({
    value: constraints?.posterSlotBound,
    posterSlots,
    characterSlots,
    leaderPosition: effectiveLeaderPosition,
    blockingErrors,
  });

  if (
    effectiveLeaderPosition >= 0 &&
    characterSlots[effectiveLeaderPosition] >= 0 &&
    characterSlots[effectiveLeaderPosition] !== leaderIdx &&
    characterSlotFixed[effectiveLeaderPosition]
  ) {
    addBlockingError(blockingErrors, "固定队长位置已被其他固定角色占用");
  }

  const characterPairs = [];
  const usedCharacterIndices = new Set();
  const usedCharacterIds = new Set();
  if (leaderId !== null) {
    pushUniquePair({
      pairs: characterPairs,
      usedCandidateIndices: usedCharacterIndices,
      usedIds: usedCharacterIds,
      candidateIndex: leaderIdx,
      id: leaderId,
      pairValue:
        effectiveLeaderPosition >= 0 ? effectiveLeaderPosition + 1 : 0,
      duplicateMessage: "队长角色约束重复",
      blockingErrors,
    });
  }

  characterSlots.forEach((candidateIndex, position) => {
    if (candidateIndex < 0 || candidateIndex === leaderIdx) return;
    if (
      effectiveLeaderPosition === position &&
      candidateIndex !== leaderIdx &&
      characterSlotFixed[position]
    ) {
      return;
    }
    const id = getIntegerCandidateId({
      candidates: characters,
      index: candidateIndex,
      label: "固定角色",
      position,
      getId: characterId,
      blockingErrors,
    });
    if (id === null) return;
    pushUniquePair({
      pairs: characterPairs,
      usedCandidateIndices: usedCharacterIndices,
      usedIds: usedCharacterIds,
      candidateIndex,
      id,
      pairValue: characterSlotFixed[position] ? position + 1 : 0,
      duplicateMessage: `第 ${position + 1} 位的固定角色重复`,
      blockingErrors,
    });
  });

  const posterPairs = [];
  const usedPosterIndices = new Set();
  const usedPosterIds = new Set();
  const usedPosterBindings = new Set();
  const posterBindings = emptySlots();
  const unboundPosterPositions = [];
  const leaderPosterId =
    leaderPosterIdx >= 0
      ? getIntegerCandidateId({
        candidates: posters,
        index: leaderPosterIdx,
        label: "队长海报",
        getId: posterId,
        blockingErrors,
      })
      : null;

  if (leaderPosterId !== null && leaderId !== null) {
    pushUniquePair({
      pairs: posterPairs,
      usedCandidateIndices: usedPosterIndices,
      usedIds: usedPosterIds,
      candidateIndex: leaderPosterIdx,
      id: leaderPosterId,
      pairValue: leaderId,
      duplicateMessage: "队长海报约束重复",
      blockingErrors,
    });
    usedPosterBindings.add(leaderId);
  }

  posterSlots.forEach((candidateIndex, position) => {
    if (candidateIndex < 0) return;
    if (candidateIndex === leaderPosterIdx) {
      posterBindings[position] = leaderIdx;
      if (effectiveLeaderPosition !== position) {
        addBlockingError(
          blockingErrors,
          "队长海报不能固定到队长以外的位置",
        );
      }
      return;
    }
    const id = getIntegerCandidateId({
      candidates: posters,
      index: candidateIndex,
      label: "固定海报",
      position,
      getId: posterId,
      blockingErrors,
    });
    if (id === null) return;

    if (!posterSlotBound[position]) {
      const before = posterPairs.length;
      pushUniquePair({
        pairs: posterPairs,
        usedCandidateIndices: usedPosterIndices,
        usedIds: usedPosterIds,
        candidateIndex,
        id,
        pairValue: 0,
        duplicateMessage: `第 ${position + 1} 位的固定海报重复`,
        blockingErrors,
      });
      if (posterPairs.length > before) {
        unboundPosterPositions.push(position);
      }
      return;
    }

    let bindingCharacterIndex = -1;
    if (characterSlots[position] >= 0) {
      bindingCharacterIndex = characterSlots[position];
    } else if (effectiveLeaderPosition === position) {
      bindingCharacterIndex = leaderIdx;
    }
    if (bindingCharacterIndex < 0) {
      addBlockingError(
        blockingErrors,
        `第 ${position + 1} 位海报已设置绑定，但没有可绑定的角色`,
      );
      return;
    }
    posterBindings[position] = bindingCharacterIndex;

    const bindingCharacterId = getIntegerCandidateId({
      candidates: characters,
      index: bindingCharacterIndex,
      label: "海报绑定角色",
      position,
      getId: characterId,
      blockingErrors,
    });
    if (bindingCharacterId === null) return;
    if (usedPosterBindings.has(bindingCharacterId)) {
      addBlockingError(
        blockingErrors,
        `第 ${position + 1} 位的固定海报与其他海报绑定了同一角色`,
      );
      return;
    }

    const before = posterPairs.length;
    pushUniquePair({
      pairs: posterPairs,
      usedCandidateIndices: usedPosterIndices,
      usedIds: usedPosterIds,
      candidateIndex,
      id,
      pairValue: bindingCharacterId,
      duplicateMessage: `第 ${position + 1} 位的固定海报重复`,
      blockingErrors,
    });
    if (posterPairs.length > before) {
      usedPosterBindings.add(bindingCharacterId);
    }
  });

  const ignoredAccessoryPositions = [];
  accessorySlots.forEach((candidateIndex, position) => {
    if (candidateIndex >= 0) ignoredAccessoryPositions.push(position);
  });

  return {
    formationOptions: {
      mandatoryCharacters: flattenPairs(
        characterPairs,
        "角色",
        blockingErrors,
      ),
      mandatoryPosters: flattenPairs(
        posterPairs,
        "海报",
        blockingErrors,
      ),
    },
    rowConstraints: createRowConstraints({
      mode: "advanced",
      leaderIdx,
      leaderPosterIdx,
      leaderPosition: effectiveLeaderPosition,
      characterSlots,
      characterSlotFixed,
      posterSlots,
      posterSlotBound,
      posterBindings,
    }),
    ignoredAccessoryPositions,
    unboundPosterPositions,
    blockingErrors,
  };
}

function normalizeResolutionSlots(slots) {
  if (!Array.isArray(slots) || slots.length !== PARTY_SIZE) return null;
  if (!slots.every((index) => Number.isInteger(index) && index >= -1)) {
    return null;
  }
  return slots.slice();
}

function normalizeResolutionCharacterSlotFixed(value) {
  if (value === undefined) return fixedSlots();
  if (
    !Array.isArray(value) ||
    value.length !== PARTY_SIZE ||
    !value.every((fixed) => typeof fixed === "boolean")
  ) {
    return null;
  }
  return value.slice();
}

function deriveResolutionPosterBindings({
  posterSlots,
  characterSlots,
  leaderPosition,
  leaderIdx,
}) {
  return posterSlots.map((posterIndex, position) => {
    if (posterIndex < 0) return -1;
    if (characterSlots[position] >= 0) return characterSlots[position];
    if (leaderPosition === position) return leaderIdx;
    return -1;
  });
}

function normalizeResolutionPosterBindings(value, fallback) {
  if (value === undefined) return fallback;
  if (
    !Array.isArray(value) ||
    value.length !== PARTY_SIZE ||
    !value.every((index) => Number.isInteger(index) && index >= -1)
  ) {
    return null;
  }
  return value.slice();
}

function pinCandidate(pinned, position, candidateIndex) {
  if (
    !Number.isInteger(position) ||
    position < 0 ||
    position >= PARTY_SIZE ||
    !Number.isInteger(candidateIndex) ||
    candidateIndex < 0
  ) {
    return false;
  }

  const current = pinned.get(position);
  if (current !== undefined && current !== candidateIndex) return false;
  for (const [otherPosition, otherIndex] of pinned) {
    if (otherPosition !== position && otherIndex === candidateIndex) {
      return false;
    }
  }
  pinned.set(position, candidateIndex);
  return true;
}

function findPinnedPosition(pinned, candidateIndex) {
  for (const [position, index] of pinned) {
    if (index === candidateIndex) return position;
  }
  return -1;
}

function findAvailableIdPosition(ids, id, pinned, candidateIndex) {
  const pinnedPosition = findPinnedPosition(pinned, candidateIndex);
  if (pinnedPosition >= 0) {
    return ids[pinnedPosition] === id ? pinnedPosition : -1;
  }

  for (let position = 0; position < PARTY_SIZE; position++) {
    if (ids[position] !== id) continue;
    const pinnedIndex = pinned.get(position);
    if (pinnedIndex === undefined || pinnedIndex === candidateIndex) {
      return position;
    }
  }
  return -1;
}

function allocateCandidatePermutation({ ids, candidates, getId, pinned }) {
  const pools = new Map();
  candidates.forEach((candidate, index) => {
    const id = getId(candidate);
    if (!pools.has(id)) pools.set(id, []);
    pools.get(id).push(index);
  });

  const permutation = emptySlots();
  const usedIndices = new Set();
  for (const [position, candidateIndex] of pinned) {
    if (candidateIndex >= candidates.length || usedIndices.has(candidateIndex)) {
      return null;
    }
    if (getId(candidates[candidateIndex]) !== ids[position]) return null;
    permutation[position] = candidateIndex;
    usedIndices.add(candidateIndex);
  }

  for (let position = 0; position < PARTY_SIZE; position++) {
    if (permutation[position] >= 0) continue;
    const pool = pools.get(ids[position]);
    if (!pool) return null;
    const candidateIndex = pool.find((index) => !usedIndices.has(index));
    if (candidateIndex === undefined) return null;
    permutation[position] = candidateIndex;
    usedIndices.add(candidateIndex);
  }
  return permutation;
}

function validateCharacterSlots(slots, candidates) {
  return slots.every(
    (candidateIndex) =>
      candidateIndex < 0 || candidateIndex < candidates.length,
  );
}

function pinFixedCharacterSlots(pinned, slots, fixed, candidates) {
  for (let position = 0; position < PARTY_SIZE; position++) {
    const candidateIndex = slots[position];
    if (candidateIndex < 0 || !fixed[position]) continue;
    if (!pinCandidate(pinned, position, candidateIndex)) return false;
  }
  return validateCharacterSlots(slots, candidates);
}

function pinFloatingCharacterSlots({
  pinned,
  slots,
  fixed,
  ids,
  candidates,
}) {
  const seen = new Set(pinned.values());
  for (let position = 0; position < PARTY_SIZE; position++) {
    const candidateIndex = slots[position];
    if (candidateIndex < 0 || fixed[position]) continue;
    if (candidateIndex >= candidates.length || seen.has(candidateIndex)) {
      return false;
    }
    seen.add(candidateIndex);
    const id = characterId(candidates[candidateIndex]);
    const resolvedPosition = findAvailableIdPosition(
      ids,
      id,
      pinned,
      candidateIndex,
    );
    if (
      resolvedPosition < 0 ||
      !pinCandidate(pinned, resolvedPosition, candidateIndex)
    ) {
      return false;
    }
  }
  return true;
}

function pinConfiguredPosters({
  pinned,
  posterSlots,
  posterBindings,
  characterPermutation,
  posterIds,
  posters,
}) {
  for (let sourcePosition = 0; sourcePosition < PARTY_SIZE; sourcePosition++) {
    const posterIndex = posterSlots[sourcePosition];
    const bindingCharacterIndex = posterBindings[sourcePosition];
    if (posterIndex < 0) {
      if (bindingCharacterIndex >= 0) return false;
      continue;
    }
    if (posterIndex >= posters.length) return false;

    let resolvedPosition = -1;
    if (bindingCharacterIndex >= 0) {
      resolvedPosition = characterPermutation.indexOf(
        bindingCharacterIndex,
      );
    } else {
      const selectedPosterId = posterId(posters[posterIndex]);
      if (!Number.isInteger(selectedPosterId)) return false;
      resolvedPosition = findAvailableIdPosition(
        posterIds,
        selectedPosterId,
        pinned,
        posterIndex,
      );
    }
    if (
      resolvedPosition < 0 ||
      !pinCandidate(pinned, resolvedPosition, posterIndex)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Validate and map a streamed Python row back to selected inventory indices.
 * Accessory IDs are intentionally left unresolved because Python may return
 * accessories which the renderer creates on demand.
 */
export function resolvePythonFormationRow({
  row,
  characters = [],
  posters = [],
  rowConstraints,
}) {
  if (
    !Array.isArray(row) ||
    row.length !== PARTY_SIZE * 3 ||
    !row.every(Number.isInteger)
  ) {
    return null;
  }

  const mode = rowConstraints?.mode;
  if (mode !== "basic" && mode !== "advanced") return null;
  const leaderIdx = rowConstraints?.leaderIdx;
  const leaderPosterIdx = rowConstraints?.leaderPosterIdx ?? -1;
  if (
    !Number.isInteger(leaderIdx) ||
    leaderIdx < 0 ||
    leaderIdx >= characters.length
  ) {
    return null;
  }
  if (
    leaderPosterIdx !== -1 &&
    (!Number.isInteger(leaderPosterIdx) ||
      leaderPosterIdx < 0 ||
      leaderPosterIdx >= posters.length)
  ) {
    return null;
  }

  const charIds = row.slice(0, PARTY_SIZE);
  const rawPosterIds = row.slice(PARTY_SIZE, PARTY_SIZE * 2);
  const accessoryIds = row.slice(PARTY_SIZE * 2);
  const leaderId = characterId(characters[leaderIdx]);
  if (!Number.isInteger(leaderId)) return null;

  const characterPins = new Map();
  let characterSlots = emptySlots();
  let characterSlotFixed = fixedSlots();
  let posterSlots = emptySlots();
  let posterBindings = emptySlots();
  let requestedLeaderPosition = -1;
  if (mode === "advanced") {
    characterSlots = normalizeResolutionSlots(rowConstraints.characterSlots);
    characterSlotFixed = normalizeResolutionCharacterSlotFixed(
      rowConstraints.characterSlotFixed,
    );
    posterSlots = normalizeResolutionSlots(rowConstraints.posterSlots);
    requestedLeaderPosition = rowConstraints.leaderPosition;
    const fallbackPosterBindings =
      characterSlots && posterSlots
        ? deriveResolutionPosterBindings({
          posterSlots,
          characterSlots,
          leaderPosition: requestedLeaderPosition,
          leaderIdx,
        })
        : emptySlots();
    posterBindings = normalizeResolutionPosterBindings(
      rowConstraints.posterBindings,
      fallbackPosterBindings,
    );
    if (
      characterSlots === null ||
      characterSlotFixed === null ||
      posterSlots === null ||
      posterBindings === null ||
      !Number.isInteger(requestedLeaderPosition) ||
      requestedLeaderPosition < -1 ||
      requestedLeaderPosition >= PARTY_SIZE ||
      !pinFixedCharacterSlots(
        characterPins,
        characterSlots,
        characterSlotFixed,
        characters,
      )
    ) {
      return null;
    }
  }

  let leaderPosition = requestedLeaderPosition;
  if (leaderPosition < 0) {
    leaderPosition = findAvailableIdPosition(
      charIds,
      leaderId,
      characterPins,
      leaderIdx,
    );
  }
  if (
    leaderPosition < 0 ||
    charIds[leaderPosition] !== leaderId ||
    !pinCandidate(characterPins, leaderPosition, leaderIdx)
  ) {
    return null;
  }

  if (
    mode === "advanced" &&
    !pinFloatingCharacterSlots({
      pinned: characterPins,
      slots: characterSlots,
      fixed: characterSlotFixed,
      ids: charIds,
      candidates: characters,
    })
  ) {
    return null;
  }

  const charPerm = allocateCandidatePermutation({
    ids: charIds,
    candidates: characters,
    getId: characterId,
    pinned: characterPins,
  });
  if (!charPerm) return null;

  const posterPins = new Map();
  let normalizedPosterIds = rawPosterIds;
  if (mode === "advanced") {
    if (
      !pinConfiguredPosters({
        pinned: posterPins,
        posterSlots,
        posterBindings,
        characterPermutation: charPerm,
        posterIds: rawPosterIds,
        posters,
      })
    ) {
      return null;
    }
  }

  if (leaderPosterIdx >= 0) {
    const selectedLeaderPosterId = posterId(posters[leaderPosterIdx]);
    if (!Number.isInteger(selectedLeaderPosterId)) return null;

    if (mode === "basic") {
      const sourcePosition = rawPosterIds.indexOf(selectedLeaderPosterId);
      if (sourcePosition < 0) return null;
      const remainingIds = rawPosterIds.slice();
      remainingIds.splice(sourcePosition, 1);
      normalizedPosterIds = emptySlots();
      normalizedPosterIds[leaderPosition] = selectedLeaderPosterId;
      let remainingIndex = 0;
      for (let position = 0; position < PARTY_SIZE; position++) {
        if (position === leaderPosition) continue;
        normalizedPosterIds[position] = remainingIds[remainingIndex++];
      }
    } else if (rawPosterIds[leaderPosition] !== selectedLeaderPosterId) {
      return null;
    }

    if (!pinCandidate(posterPins, leaderPosition, leaderPosterIdx)) return null;
  }

  const posterPerm = allocateCandidatePermutation({
    ids: normalizedPosterIds,
    candidates: posters,
    getId: posterId,
    pinned: posterPins,
  });
  if (!posterPerm) return null;

  return {
    charPerm,
    posterPerm,
    accessoryIds,
  };
}
