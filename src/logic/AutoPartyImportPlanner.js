const PARTY_SIZE = 5;

const emptySlots = () => new Array(PARTY_SIZE).fill(-1);

function normalizeCandidates(candidates) {
  return Array.isArray(candidates) ? candidates : [];
}

function normalizePartySlots(slots) {
  return Array.from({ length: PARTY_SIZE }, (_, position) =>
    Array.isArray(slots) ? slots[position] ?? null : null,
  );
}

function isEmptyItem(item) {
  return item === null || item === undefined;
}

/**
 * Converts the current party into selected candidate flags and advanced-mode
 * constraints. Inventory objects are deliberately matched by identity so
 * duplicate accessory instances with the same master ID remain distinct.
 */
export function createAutoPartyImportPlan({
  party,
  characters,
  posters,
  accessories,
} = {}) {
  const characterCandidates = normalizeCandidates(characters);
  const posterCandidates = normalizeCandidates(posters);
  const accessoryCandidates = normalizeCandidates(accessories);
  const partyCharacters = normalizePartySlots(party?.characters);
  const partyPosters = normalizePartySlots(party?.posters);
  const partyAccessories = normalizePartySlots(party?.accessories);

  const selectedCharacters = new Array(characterCandidates.length).fill(false);
  const selectedPosters = new Array(posterCandidates.length).fill(false);
  const selectedAccessories = new Array(accessoryCandidates.length).fill(false);
  const skippedItems = [];
  let importedItemCount = 0;

  const advanced = {
    leaderIdx: -1,
    leaderPosterIdx: -1,
    leaderPosition: -1,
    characterSlots: emptySlots(),
    characterSlotFixed: new Array(PARTY_SIZE).fill(true),
    posterSlots: emptySlots(),
    posterSlotBound: new Array(PARTY_SIZE).fill(false),
    accessorySlots: emptySlots(),
  };

  const partyLeader = party?.leader;
  const partyLeaderPosition = isEmptyItem(partyLeader)
    ? -1
    : partyCharacters.indexOf(partyLeader);
  let leaderStatus = "missing";

  if (partyLeaderPosition >= 0) {
    const leaderIdx = characterCandidates.indexOf(partyLeader);
    if (leaderIdx >= 0) {
      leaderStatus = "imported";
      advanced.leaderIdx = leaderIdx;
      advanced.leaderPosition = partyLeaderPosition;
    } else {
      leaderStatus = "skipped";
    }
  }

  partyCharacters.forEach((character, position) => {
    if (isEmptyItem(character)) return;
    const candidateIdx = characterCandidates.indexOf(character);
    if (candidateIdx < 0) {
      skippedItems.push({ type: "character", position });
      return;
    }

    selectedCharacters[candidateIdx] = true;
    importedItemCount++;
    if (
      leaderStatus !== "imported" ||
      position !== advanced.leaderPosition
    ) {
      advanced.characterSlots[position] = candidateIdx;
    }
  });

  partyPosters.forEach((poster, position) => {
    if (isEmptyItem(poster)) return;
    const candidateIdx = posterCandidates.indexOf(poster);
    if (candidateIdx < 0) {
      skippedItems.push({ type: "poster", position });
      return;
    }

    selectedPosters[candidateIdx] = true;
    importedItemCount++;
    if (
      leaderStatus === "imported" &&
      position === advanced.leaderPosition
    ) {
      advanced.leaderPosterIdx = candidateIdx;
    } else {
      advanced.posterSlots[position] = candidateIdx;
      advanced.posterSlotBound[position] =
        advanced.characterSlots[position] >= 0 ||
        (leaderStatus === "imported" &&
          advanced.leaderPosition === position);
    }
  });

  partyAccessories.forEach((accessory, position) => {
    if (isEmptyItem(accessory)) return;
    const candidateIdx = accessoryCandidates.indexOf(accessory);
    if (candidateIdx < 0) {
      skippedItems.push({ type: "accessory", position });
      return;
    }

    selectedAccessories[candidateIdx] = true;
    advanced.accessorySlots[position] = candidateIdx;
    importedItemCount++;
  });

  return {
    selectedCharacters,
    selectedPosters,
    selectedAccessories,
    advanced,
    skippedItems,
    leaderStatus,
    importedItemCount,
  };
}
