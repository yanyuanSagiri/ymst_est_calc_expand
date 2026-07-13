import Party from "./Party";
import ConstText from "../db/ConstText";
import GameDb from "../db/GameDb";
import { createPythonAutoPartyPlan } from "../logic/PythonAutoPartyConstraints";

import _ from "../createElement";
import removeAllChilds from "../removeAllChilds";

// import {Swappable} from '@shopify/draggable';

const AUTO_PARTY_SUGGESTION_TEXT = `
1. 不要全选角色/海报/饰品！！！
2. 最好选择队长和队长海报，减少计算量。
3. 如果你的候选很多，可以分批多轮计算，因为每多选一个角色/海报/饰品，计算量会呈指数级增长。
4. 第一轮勾选的饰品可以只选sa所需额外光对应的生日+sp光，特殊情况可以勾选-ct。
5. 建议勾选数量：角色5，海报5-7，饰品5，需要选上队长海报。
6. 如果你只用来跑配队不做别的事情，worker数量可以选16-20。
7. SA阈值偏移：0只保留最高SA数组合，1保留最高和次高（默认），增大可保留更多候选，但会增加第二轮计算量。
8. solo和jjc轴SA阈值一般填1或0就行。
9. 如果白屏，就是程序崩了，建议减少worker数量与减少候选数量。
10. WebGPU在worker数量较多的情况下优势不明显，可以不勾选。
11. 思路比较重要，可以参考榜上或者群友的配队思路，然后根据自己的box调优。
12. 自动配队是按照当前相册来计算的，不同相册配置可能会得到不同的结果。
13. 若计算结果出现角色带上其他角色的生日饰品时，说明你可以直接将该饰品换为痛衣或者单项`;

export default class PartyManager {
  constructor() {
    this.parties = [new Party()];
    this.currentSelection = 0;
  }
  get currentParty() {
    return this.parties[this.currentSelection];
  }
  addParty() {
    let currentParty = this.currentParty;
    let cloneParty = Party.fromJSON(currentParty.toJSON());
    cloneParty.name = `${ConstText.get("PARTY_DEFAULT_NAME")} ${this.parties.length + 1}`;
    this.parties.push(cloneParty);
    this.currentSelection = this.parties.length - 1;
    this.fillPartySelect();
    this.partyNameInput.value = this.parties[this.currentSelection].name;
  }
  removeParty() {
    if (this.parties.length === 1)
      return alert(ConstText.get("PARTY_DELETE_LAST"));
    if (confirm(ConstText.get("PARTY_DELETE_CONFIRM")) === false) return;
    this.parties.splice(this.currentSelection, 1);
    if (this.currentSelection >= this.parties.length) {
      this.currentSelection = this.parties.length - 1;
    }
    this.fillPartySelect();
    root.update({ party: true });
  }

  init() {
    const container = root.partyManagerContainer;
    removeAllChilds(container);

    container.appendChild(
      _("div", {}, [
        (this.partySelect = _("select", {
          event: {
            change: (e) => {
              this.currentSelection = e.target.value;
              root.update({ party: true });
            },
          },
        })),
        _("input", {
          type: "button",
          "data-text-value": "ADD",
          event: { click: (_) => this.addParty() },
        }),
        _("input", {
          type: "button",
          "data-text-value": "DELETE",
          event: { click: (_) => this.removeParty() },
        }),
        (this.partyNameInput = _("input", {
          type: "text",
          event: {
            blur: (e) => {
              this.parties[this.currentSelection].name = e.target.value;
              this.fillPartySelect();
            },
          },
        })),
      ]),
    );

    this.fillPartySelect();

    container.appendChild(
      _("div", { style: { marginTop: "4px" } }, [
        (this.highEndFilter = _("input", { type: "checkbox" })),
        _("text", "查询列表仅显示：四星角色/SSR海报/Lv10饰品"),
        _("input", {
          type: "button",
          value: "自动配队",
          style: { marginLeft: "1em" },
          event: { click: (_) => this.showAutoPartyPopup() },
        }),
      ]),
    );

    this.leaderSelection = [];
    this.charaSlot = [];
    this.posterSlot = [];
    this.accessorySlot = [];
    container.appendChild(
      _(
        "div",
        {},
        Array(5)
          .fill(0)
          .map((__, idx) =>
            _("div", { className: "party-member", "data-idx": idx }, [
              (this.leaderSelection[idx] = _("input", {
                type: "radio",
                name: "leader",
                event: { change: (e) => this.changeLeader(e, idx) },
              })),
              (this.charaSlot[idx] = _("span", {
                "data-slot-key": "charaSlot",
                "data-data-key": "characters",
                className: "spriteatlas-characters",
                event: { click: (e) => this.pickCharacter(e) },
              })),
              (this.posterSlot[idx] = _("span", {
                "data-slot-key": "posterSlot",
                "data-data-key": "posters",
                className: "spriteatlas-posters",
                event: { click: (e) => this.pickPoster(e) },
              })),
              (this.accessorySlot[idx] = _("span", {
                "data-slot-key": "accessorySlot",
                "data-data-key": "accessories",
                className: "spriteatlas-accessories",
                event: { click: (e) => this.pickAccessory(e) },
              })),
            ]),
          ),
      ),
    );

    if (root.nonPersistentState.swappable) {
      root.nonPersistentState.swappable.destroy();
    }
    const swappable = new Draggable.Swappable(container, {
      draggable: "span",
      distance: 10,
      delay: 0,
    });
    root.nonPersistentState.swappable = swappable;
    let swapSource, swapTarget, slots;
    swappable.on("swappable:start", (e) => {
      if (!e.data.dragEvent.data.originalSource.dataset.id) return e.cancel();
    });
    swappable.on("swappable:swap", (e) => {
      const event = e.data.dragEvent.data;
      const source = event.originalSource;
      const target = event.over;
      if (source.dataset.slotKey !== target.dataset.slotKey) return e.cancel();
      slots = this[source.dataset.slotKey];
      swapSource = slots.indexOf(source);
      swapTarget = target.parentNode.dataset.idx;
    });
    swappable.on("swappable:stop", (e) => {
      const source = slots[swapSource];
      if (swapSource === swapTarget) return;
      {
        const temp = slots[swapSource];
        slots[swapSource] = slots[swapTarget];
        slots[swapTarget] = temp;
      }
      {
        const party = this.currentParty;
        const temp = party[source.dataset.dataKey][swapSource];
        party[source.dataset.dataKey][swapSource] =
          party[source.dataset.dataKey][swapTarget];
        party[source.dataset.dataKey][swapTarget] = temp;
      }
      root.update({ party: true });
    });
  }
  fillPartySelect() {
    removeAllChilds(this.partySelect);
    this.parties.forEach((party, idx) => {
      this.partySelect.appendChild(
        _("option", { value: idx }, [_("text", party.name)]),
      );
    });
    this.partySelect.value = this.currentSelection;
  }
  changeParty() {
    const party = this.currentParty;
    this.leaderSelection.forEach((select, idx) => {
      select.checked =
        null !== party.leader && party.characters[idx] === party.leader;
    });
    this.charaSlot.forEach((icon, idx) => {
      icon.dataset.id = party.characters[idx]
        ? party.characters[idx].cardIconId
        : "";
      const senseLane = root.senseBox.children[idx];
      if (!senseLane) return;
      // senseLane.dataset.senseType = party.characters[idx] === null ? '' : party.characters[idx].sense.getType(party.characters)
    });
    this.posterSlot.forEach((icon, idx) => {
      icon.dataset.id = party.posters[idx] ? party.posters[idx].id : "";
    });
    this.accessorySlot.forEach((icon, idx) => {
      icon.dataset.id = party.accessories[idx] ? party.accessories[idx].id : "";
    });
    this.partyNameInput.value = this.parties[this.currentSelection].name;
  }

  changeChara(chara, idx) {
    const party = this.parties[this.currentSelection];
    const prevLeaderIdx = party.characters.indexOf(party.leader);
    // 寻找冲突，找到冲突角色互换两个角色的位置
    const newCharaBaseId = chara.data.CharacterBaseMasterId;
    for (let i = 0; i < 5; i++) {
      if (i === idx) continue;
      if (!party.characters[i]) continue;
      if (party.characters[i].data.CharacterBaseMasterId === newCharaBaseId) {
        party.characters[i] = party.characters[idx];
        break;
      }
    }
    party.characters[idx] = chara;
    party.leader = party.characters[prevLeaderIdx];
    root.update({ party: true });
  }
  changePoster(poster, idx) {
    const party = this.parties[this.currentSelection];
    if (poster) {
      const restrictId = poster.data.OrganizeRestrictGroupId;
      for (let i = 0; i < 5; i++) {
        if (i === idx) continue;
        if (!party.posters[i]) continue;
        if (party.posters[i] === poster) {
          party.posters[i] = party.posters[idx];
          break;
        }
        if (
          restrictId &&
          restrictId === party.posters[i].data.OrganizeRestrictGroupId
        ) {
          party.posters[i] = party.posters[idx];
          break;
        }
      }
    }
    party.posters[idx] = poster;
    root.update({ party: true });
  }
  changeAccessory(accessory, idx) {
    const party = this.parties[this.currentSelection];
    if (accessory) {
      for (let i = 0; i < 5; i++) {
        if (i === idx) continue;
        if (!party.accessories[i]) continue;
        if (party.accessories[i] === accessory) {
          party.accessories[i] = party.accessories[idx];
          break;
        }
      }
    }
    party.accessories[idx] = accessory;
    root.update({ party: true });
  }
  changeLeader(e, idx) {
    const party = this.parties[this.currentSelection];
    this.leaderSelection.forEach((select, otherIdx) => {
      if (idx === otherIdx) return;
      select.checked = false;
    });
    party.leader = party.characters[idx];
    root.update({ party: true });
  }
  createPickingOverlay() {
    document.body.classList.add("picking");
    const overlay = _("div", {
      className: "picking-overlay",
      event: { click: (e) => this.closePicking(e) },
    });
    const container = _("div", {
      className: "picking-container",
      event: { click: (e) => this.confirmPicking(e) },
    });
    overlay.appendChild(container);
    document.body.appendChild(overlay);
    this.pickingOverlay = overlay;
    this.pickingContainer = container;
    overlay.scrollTop = 0;
  }
  closePicking(e) {
    if (e.target === this.pickingOverlay) {
      document.body.classList.remove("picking");
      this.pickingOverlay.remove();
    }
  }
  confirmPicking(e) {
    let pick;
    for (let el of this.pickingContainer.children) {
      if (el.contains(e.target)) {
        pick = el;
        break;
      }
    }
    if (!pick) return;
    document.body.classList.remove("picking");
    const idx = pick.dataset.idx;
    switch (this.currentPicking.type) {
      case "chara": {
        this.changeChara(
          root.appState.characters[idx] || null,
          this.currentPicking.idx,
        );
        break;
      }
      case "poster": {
        this.changePoster(
          root.appState.posters[idx] || null,
          this.currentPicking.idx,
        );
        break;
      }
      case "accessory": {
        this.changeAccessory(
          root.appState.accessories[idx] || null,
          this.currentPicking.idx,
        );
        break;
      }
    }
    this.pickingOverlay.remove();
  }
  pickCharacter(e) {
    if (root.appState.characters.length === 0) return;
    const idx = this.charaSlot.indexOf(e.target);
    this.currentPicking = { type: "chara", idx };
    this.createPickingOverlay();
    const currentSelection = {};
    const items = this.highEndFilter?.checked
      ? root.appState.characters.filter((c) => c.data.Rarity === "Rare4")
      : root.appState.characters;
    this.currentParty.characters.forEach((chara, i) => {
      if (!chara) return;
      const icon = this.pickingContainer.appendChild(
        chara.iconNode.cloneNode(true),
      );
      icon.classList.remove("selected");
      if (idx === i) icon.classList.add("selected");
      currentSelection[chara.Id] = icon;
    });
    items.forEach((chara) => {
      if (currentSelection[chara.Id]) {
        currentSelection[chara.Id].dataset.idx =
          root.appState.characters.indexOf(chara);
        return;
      }
      const icon = this.pickingContainer.appendChild(
        chara.iconNode.cloneNode(true),
      );
      icon.classList.remove("selected");
      icon.dataset.idx = root.appState.characters.indexOf(chara);
    });
  }
  pickPoster(e) {
    const idx = this.posterSlot.indexOf(e.target);
    this.currentPicking = { type: "poster", idx };
    this.createPickingOverlay();
    const currentSelection = {};
    this.pickingContainer.appendChild(
      _(
        "span",
        { className: "list-icon-container small-text arial", "data-idx": -1 },
        [
          _("span", {
            className: "spriteatlas-posters empty-icon",
            "data-id": "",
            style: { marginLeft: 0 },
          }),
          _("br"),
          _("span", {}, [_("text", ConstText.get("SELECTION_EMPTY"))]),
        ],
      ),
    );
    if (this.currentParty.posters[idx] === null) {
      this.pickingContainer.lastChild.classList.add("selected");
    }
    const posterItems = this.highEndFilter?.checked
      ? root.appState.posters.filter((p) => p.data.Rarity === "SSR")
      : root.appState.posters;
    this.currentParty.posters.forEach((poster, i) => {
      if (!poster) return;
      const icon = this.pickingContainer.appendChild(
        poster.iconNode.cloneNode(true),
      );
      icon.classList.remove("selected");
      if (idx === i) icon.classList.add("selected");
      currentSelection[poster.id] = icon;
    });
    posterItems.forEach((poster) => {
      if (currentSelection[poster.id]) {
        currentSelection[poster.id].dataset.idx =
          root.appState.posters.indexOf(poster);
        return;
      }
      const icon = this.pickingContainer.appendChild(
        poster.iconNode.cloneNode(true),
      );
      icon.classList.remove("selected");
      icon.dataset.idx = root.appState.posters.indexOf(poster);
    });
  }
  pickAccessory(e) {
    const idx = this.accessorySlot.indexOf(e.target);
    this.currentPicking = { type: "accessory", idx };
    this.createPickingOverlay();
    const currentSelection = {};
    this.pickingContainer.appendChild(
      _(
        "span",
        { className: "list-icon-container small-text", "data-idx": -1 },
        [
          _("span", {
            className: "spriteatlas-accessories empty-icon",
            "data-id": "",
            style: { marginLeft: 0 },
          }),
          _("br"),
          _("span", {}, [_("text", ConstText.get("SELECTION_EMPTY"))]),
        ],
      ),
    );
    if (this.currentParty.accessories[idx] === null) {
      this.pickingContainer.lastChild.classList.add("selected");
    }
    const accItems = this.highEndFilter?.checked
      ? root.appState.accessories.filter((a) => a.level >= 10)
      : root.appState.accessories;
    this.currentParty.accessories.forEach((accessory, i) => {
      if (!accessory) return;
      const icon = this.pickingContainer.appendChild(
        accessory.iconNode.cloneNode(true),
      );
      icon.classList.remove("selected");
      if (idx === i) icon.classList.add("selected");
      currentSelection[root.appState.accessories.indexOf(accessory)] = icon;
    });
    accItems.forEach((accessory) => {
      const i = root.appState.accessories.indexOf(accessory);
      if (currentSelection[i]) {
        currentSelection[i].dataset.idx = i;
        return;
      }
      const icon = this.pickingContainer.appendChild(
        accessory.iconNode.cloneNode(true),
      );
      icon.classList.remove("selected");
      icon.dataset.idx = i;
    });
  }

  update() {
    if (!this.leaderSelection || this.leaderSelection.length === 0) return;
    this.changeParty();
  }

  showAutoPartyPopup() {
    const characters = root.appState.characters.filter(
      (c) => c.data.Rarity === "Rare4",
    );
    const posters = root.appState.posters.filter(
      (p) => p.data.Rarity === "SSR",
    );
    const accessories = root.appState.accessories.filter((a) => a.level >= 10);

    if (characters.length < 1 || posters.length < 1 || accessories.length < 5) {
      alert("需要至少1个四星角色、1张SSR海报、5个Lv10饰品才能使用自动配队");
      return;
    }

    const overlay = _("div", { className: "picking-overlay" });
    const dialog = _("div", {
      className: "auto-party-dialog",
      style: {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        background: "white",
        padding: "20px",
        borderRadius: "8px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
        maxHeight: "85vh",
        overflowY: "auto",
        minWidth: "600px",
        width: "70vw",
        maxWidth: "900px",
        zIndex: 10001,
        opacity: "1",
        transition: "opacity 120ms ease",
      },
    });
    const setAutoPartyDialogHidden = (hidden) => {
      dialog.style.opacity = hidden ? "0" : "1";
      dialog.style.pointerEvents = hidden ? "none" : "auto";
    };
    const hoverPreviewButton = _(
      "button",
      {
        type: "button",
        title: "将鼠标停在这里可暂时隐藏自动配队弹窗",
        "aria-label": "悬浮查看当前编队",
        style: {
          position: "fixed",
          top: "50%",
          right: "0",
          transform: "translateY(-50%)",
          zIndex: 10003,
          padding: "14px 9px",
          border: "1px solid #90a4ae",
          borderRadius: "8px 0 0 8px",
          background: "rgba(255, 255, 255, 0.94)",
          boxShadow: "0 3px 12px rgba(0, 0, 0, 0.25)",
          color: "#455a64",
          cursor: "default",
          writingMode: "vertical-rl",
          letterSpacing: "2px",
          userSelect: "none",
        },
        event: {
          mouseenter: () => setAutoPartyDialogHidden(true),
          mouseleave: () => setAutoPartyDialogHidden(false),
        },
      },
      [_("text", "悬浮查看编队")],
    );

    const savedChars = new Set();
    const savedPosters = new Set();
    const savedAccs = new Map();
    let savedLeaderId = null;
    let savedLeaderPosterId = null;
    let savedMode = "basic";
    let savedAdvancedState = null;
    let hasSavedState = false;

    try {
      const raw = localStorage.getItem("autoPartyState");
      if (raw) {
        const data = JSON.parse(raw);
        hasSavedState = true;
        (data.chars || []).forEach((id) => savedChars.add(id));
        (data.posters || []).forEach((id) => savedPosters.add(id));
        (data.accs || []).forEach((item) => {
          const sep = item.indexOf("_");
          if (sep > 0) {
            const idx = parseInt(item.substring(0, sep));
            const id = parseInt(item.substring(sep + 1));
            savedAccs.set(idx, id);
          }
        });
        savedLeaderId = data.leaderId ?? null;
        savedLeaderPosterId = data.leaderPosterId ?? null;
        if (data.version >= 2) {
          savedMode = data.mode === "advanced" ? "advanced" : "basic";
          savedAdvancedState = data.advanced || null;
        }
      }
    } catch {
      hasSavedState = false;
    }

    const serializeInventoryItem = (item) => {
      if (!item) return null;
      try {
        return typeof item.toJSON === "function" ? item.toJSON() : item.data;
      } catch {
        return item.data || null;
      }
    };
    const serializedItemEquals = (item, data) => {
      if (!item || data == null) return false;
      try {
        return JSON.stringify(serializeInventoryItem(item)) === JSON.stringify(data);
      } catch {
        return false;
      }
    };
    const createInventoryRef = (item, inventory) => {
      if (!item) return null;
      return {
        index: inventory.indexOf(item),
        data: serializeInventoryItem(item),
      };
    };
    const restoreInventoryRef = (ref, inventory, eligibleItems) => {
      if (!ref) return -1;
      const storedIndex = Number.isInteger(ref.index)
        ? ref.index
        : Number.isInteger(ref.inventoryIndex)
          ? ref.inventoryIndex
          : -1;
      if (storedIndex >= 0) {
        const indexedItem = inventory[storedIndex];
        if (
          eligibleItems.includes(indexedItem) &&
          (ref.data == null || serializedItemEquals(indexedItem, ref.data))
        ) {
          return eligibleItems.indexOf(indexedItem);
        }
      }
      if (ref.data != null) {
        return eligibleItems.findIndex((item) =>
          serializedItemEquals(item, ref.data),
        );
      }
      return -1;
    };

    const selectedChars = [];
    const selectedPosters = [];
    const selectedAccs = [];
    let autoPartyMode = savedMode;
    let leaderIdx = 0;
    let leaderPosterIdx = -1;
    let advancedLeaderIdx = restoreInventoryRef(
      savedAdvancedState?.leader,
      root.appState.characters,
      characters,
    );
    let advancedLeaderPosterIdx = restoreInventoryRef(
      savedAdvancedState?.leaderPoster,
      root.appState.posters,
      posters,
    );
    let advancedLeaderPosition = [-1, 0, 1, 2, 3, 4].includes(
      savedAdvancedState?.leaderPosition,
    )
      ? savedAdvancedState.leaderPosition
      : -1;
    const restoreAdvancedSlots = (refs, inventory, eligibleItems) =>
      Array.from({ length: 5 }, (_, idx) =>
        restoreInventoryRef(refs?.[idx], inventory, eligibleItems),
      );
    const advancedCharacterSlots = restoreAdvancedSlots(
      savedAdvancedState?.characterSlots,
      root.appState.characters,
      characters,
    );
    const advancedPosterSlots = restoreAdvancedSlots(
      savedAdvancedState?.posterSlots,
      root.appState.posters,
      posters,
    );
    const advancedAccessorySlots = restoreAdvancedSlots(
      savedAdvancedState?.accessorySlots,
      root.appState.accessories,
      accessories,
    );
    const restoreCharacterSlotFixed = (value) => {
      if (
        !Array.isArray(value) ||
        value.length !== 5 ||
        !value.every((fixed) => typeof fixed === "boolean")
      ) {
        return new Array(5).fill(true);
      }
      return value.slice();
    };
    const advancedCharacterSlotFixed = restoreCharacterSlotFixed(
      savedAdvancedState?.characterSlotFixed,
    );
    const clearAdvancedCharacterSlot = (position) => {
      advancedCharacterSlots[position] = -1;
      advancedCharacterSlotFixed[position] = true;
    };
    advancedCharacterSlots.forEach((idx, position) => {
      if (idx < 0) advancedCharacterSlotFixed[position] = true;
    });
    let isAutoPartyCalculating = false;
    let hasCompletedAutoPartyRun = false;
    let isAutoPartyCancelled = false;
    let activePythonRunCleanup = null;

    const saveState = () => {
      const data = {
        version: 3,
        mode: autoPartyMode,
        chars: characters
          .filter((_, i) => selectedChars[i])
          .map((c) => c.data.Id),
        posters: posters
          .filter((_, i) => selectedPosters[i])
          .map((p) => p.data.Id),
        accs: accessories
          .map((a, i) => (selectedAccs[i] ? `${i}_${a.data.Id}` : null))
          .filter(Boolean),
        leaderId: characters[leaderIdx]?.data.Id ?? null,
        leaderPosterId:
          leaderPosterIdx >= 0
            ? (posters[leaderPosterIdx]?.data.Id ?? null)
            : null,
        advanced: {
          leader: createInventoryRef(
            characters[advancedLeaderIdx],
            root.appState.characters,
          ),
          leaderPoster: createInventoryRef(
            posters[advancedLeaderPosterIdx],
            root.appState.posters,
          ),
          leaderPosition: advancedLeaderPosition,
          characterSlots: advancedCharacterSlots.map((idx) =>
            createInventoryRef(characters[idx], root.appState.characters),
          ),
          characterSlotFixed: advancedCharacterSlotFixed.slice(),
          posterSlots: advancedPosterSlots.map((idx) =>
            createInventoryRef(posters[idx], root.appState.posters),
          ),
          accessorySlots: advancedAccessorySlots.map((idx) =>
            createInventoryRef(accessories[idx], root.appState.accessories),
          ),
        },
      };
      try {
        localStorage.setItem("autoPartyState", JSON.stringify(data));
      } catch {
        // localStorage may be unavailable in private or restricted contexts.
      }
    };

    const stopAutoPartyProcesses = (markCancelled = true) => {
      if (markCancelled) isAutoPartyCancelled = true;
      if (activePythonRunCleanup) {
        activePythonRunCleanup();
        activePythonRunCleanup = null;
      }
      if (root.stopAutoPartySearch) root.stopAutoPartySearch();
      if (window.electronAPI?.stopFormation) {
        window.electronAPI.stopFormation().catch((err) => {
          console.warn("[PartyManager] stopFormation failed:", err);
        });
      }
      if (window.electronAPI?.removeFormationResultListener)
        window.electronAPI.removeFormationResultListener();
    };

    const closeBtn = _(
      "span",
      {
        style: {
          position: "absolute",
          top: "18px",
          right: "15px",
          cursor: "pointer",
          fontSize: "28px",
          fontWeight: "bold",
          color: "#666",
          lineHeight: "1",
        },
        event: {
          click: () => {
            stopAutoPartyProcesses();
            overlay.remove();
          },
        },
      },
      [_("text", "×")],
    );

    const showAutoPartySuggestion = () => {
      const suggestionOverlay = _("div", {
        className: "picking-overlay",
        style: { zIndex: 10002 },
        event: {
          click: (e) => {
            if (e.target === suggestionOverlay) suggestionOverlay.remove();
          },
        },
      });
      const suggestionDialog = _("div", {
        style: {
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          background: "white",
          padding: "20px",
          borderRadius: "8px",
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          width: "min(560px, 80vw)",
          maxHeight: "75vh",
          overflowY: "auto",
          zIndex: 10003,
        },
      });
      const suggestionCloseBtn = _("input", {
        type: "button",
        value: "关闭",
        event: { click: () => suggestionOverlay.remove() },
      });
      suggestionDialog.appendChild(
        _("h3", { style: { marginTop: 0 } }, [_("text", "配队建议")]),
      );
      suggestionDialog.appendChild(
        _("div", { style: { whiteSpace: "pre-wrap", lineHeight: "1.6" } }, [
          _("text", AUTO_PARTY_SUGGESTION_TEXT),
        ]),
      );
      suggestionDialog.appendChild(
        _(
          "div",
          {
            style: {
              display: "flex",
              justifyContent: "flex-end",
              marginTop: "12px",
            },
          },
          [suggestionCloseBtn],
        ),
      );
      suggestionOverlay.appendChild(suggestionDialog);
      document.body.appendChild(suggestionOverlay);
    };

    const title = _(
      "div",
      {
        style: {
          display: "flex",
          alignItems: "center",
          gap: "12px",
          marginBottom: "1em",
          paddingRight: "30px",
        },
      },
      [
        _("h3", { style: { margin: 0 } }, [_("text", "自动配队 - 选择候选项")]),
        _("input", {
          type: "button",
          value: "配队建议",
          event: { click: showAutoPartySuggestion },
        }),
      ],
    );

    let refreshAdvancedOptions = () => {};
    let cleanupAdvancedReferences = () => {};
    let updateAutoPartyMode = () => {};
    let updatePythonAvailability = () => {};
    let updateEstimate = () => {};
    let updateStartBtnState = () => {};

    const modeSection = _("div", {
      style: {
        marginBottom: "15px",
        padding: "10px",
        background: "#eef5ff",
        borderRadius: "4px",
      },
    });
    modeSection.appendChild(
      _("div", { style: { fontWeight: "bold", marginBottom: "8px" } }, [
        _("text", "配队设置模式"),
      ]),
    );
    const modeRadioName = `auto-party-mode-${Date.now()}`;
    const basicModeRadio = _("input", {
      type: "radio",
      name: modeRadioName,
      value: "basic",
      event: {
        change: () => {
          if (!basicModeRadio.checked) return;
          autoPartyMode = "basic";
          updateAutoPartyMode();
          updateEstimate();
          saveState();
        },
      },
    });
    const advancedModeRadio = _("input", {
      type: "radio",
      name: modeRadioName,
      value: "advanced",
      event: {
        change: () => {
          if (!advancedModeRadio.checked) return;
          autoPartyMode = "advanced";
          updateAutoPartyMode();
          updateEstimate();
          saveState();
        },
      },
    });
    basicModeRadio.checked = autoPartyMode === "basic";
    advancedModeRadio.checked = autoPartyMode === "advanced";
    modeSection.appendChild(
      _("div", { style: { display: "flex", gap: "24px" } }, [
        _("label", {}, [basicModeRadio, _("text", " 基础设置")]),
        _("label", {}, [advancedModeRadio, _("text", " 进阶设置")]),
      ]),
    );

    const leaderSection = _("div", {
      style: {
        marginBottom: "15px",
        padding: "10px",
        background: "#f0f0f0",
        borderRadius: "4px",
      },
    });
    leaderSection.appendChild(
      _("div", { style: { fontWeight: "bold", marginBottom: "8px" } }, [
        _("text", "基础设置"),
      ]),
    );

    const leaderSelect = _("select", {
      style: { width: "100%", marginBottom: "8px" },
    });
    leaderIdx = 0;

    const leaderPosterSelect = _("select", { style: { width: "100%" } });
    leaderPosterIdx = -1;

    const refreshLeaderOptions = () => {
      const prevLeader = leaderSelect.value;
      const prevPoster = leaderPosterSelect.value;
      removeAllChilds(leaderSelect);
      characters.forEach((c, idx) => {
        if (!selectedChars[idx]) return;
        leaderSelect.appendChild(
          _("option", { value: idx }, [_("text", c.fullCardName)]),
        );
      });
      if (leaderSelect.querySelector(`option[value="${prevLeader}"]`)) {
        leaderSelect.value = prevLeader;
      }
      leaderIdx = parseInt(leaderSelect.value);

      removeAllChilds(leaderPosterSelect);
      leaderPosterSelect.appendChild(
        _("option", { value: -1 }, [_("text", "（自动选择最优海报）")]),
      );
      posters.forEach((p, idx) => {
        if (!selectedPosters[idx]) return;
        leaderPosterSelect.appendChild(
          _("option", { value: idx }, [_("text", p.fullPosterName)]),
        );
      });
      if (leaderPosterSelect.querySelector(`option[value="${prevPoster}"]`)) {
        leaderPosterSelect.value = prevPoster;
      }
      leaderPosterIdx = parseInt(leaderPosterSelect.value);
    };

    if (savedLeaderId != null) {
      const li = characters.findIndex((c) => c.data.Id === savedLeaderId);
      if (li >= 0) leaderIdx = li;
    }
    if (savedLeaderPosterId != null) {
      const pi = posters.findIndex((p) => p.data.Id === savedLeaderPosterId);
      if (pi >= 0) leaderPosterIdx = pi;
    }

    leaderSection.appendChild(
      _("div", {}, [_("text", "队长: "), leaderSelect]),
    );
    leaderSection.appendChild(
      _("div", { style: { marginTop: "8px" } }, [
        _("text", "队长海报: "),
        leaderPosterSelect,
      ]),
    );

    const advancedSection = _("div", {
      style: {
        display: "none",
        marginBottom: "15px",
        padding: "10px",
        background: "#f8f4ff",
        borderRadius: "4px",
      },
    });
    advancedSection.appendChild(
      _("div", { style: { fontWeight: "bold", marginBottom: "8px" } }, [
        _("text", "进阶设置"),
      ]),
    );
    const advancedLeaderSelect = _("select", {
      style: { width: "100%", marginBottom: "8px" },
      event: {
        change: (e) => {
          advancedLeaderIdx = parseInt(e.target.value);
          if (!Number.isInteger(advancedLeaderIdx) || advancedLeaderIdx < 0) {
            advancedLeaderIdx = -1;
            advancedLeaderPosition = -1;
          } else {
            const leaderBaseId =
              characters[advancedLeaderIdx]?.data.CharacterBaseMasterId;
            advancedCharacterSlots.forEach((idx, position) => {
              if (
                idx >= 0 &&
                characters[idx]?.data.CharacterBaseMasterId === leaderBaseId
              ) {
                clearAdvancedCharacterSlot(position);
              }
            });
          }
          if (advancedLeaderPosition >= 0) {
            clearAdvancedCharacterSlot(advancedLeaderPosition);
          }
          refreshAdvancedOptions();
          updateEstimate();
          saveState();
        },
      },
    });
    const advancedLeaderPosterSelect = _("select", {
      style: { width: "100%" },
      event: {
        change: (e) => {
          advancedLeaderPosterIdx = parseInt(e.target.value);
          if (
            !Number.isInteger(advancedLeaderPosterIdx) ||
            advancedLeaderPosterIdx < 0
          ) {
            advancedLeaderPosterIdx = -1;
          } else {
            const leaderPoster = posters[advancedLeaderPosterIdx];
            const restrictId = leaderPoster?.data.OrganizeRestrictGroupId;
            advancedPosterSlots.forEach((idx, position) => {
              const fixedPoster = posters[idx];
              if (
                fixedPoster === leaderPoster ||
                (restrictId &&
                  fixedPoster?.data.OrganizeRestrictGroupId === restrictId)
              ) {
                advancedPosterSlots[position] = -1;
              }
            });
          }
          if (
            advancedLeaderPosterIdx >= 0 &&
            advancedLeaderPosition >= 0
          ) {
            advancedPosterSlots[advancedLeaderPosition] = -1;
          }
          refreshAdvancedOptions();
          updateEstimate();
          saveState();
        },
      },
    });
    advancedSection.appendChild(
      _("div", {}, [_("text", "队长: "), advancedLeaderSelect]),
    );
    advancedSection.appendChild(
      _("div", { style: { marginTop: "8px" } }, [
        _("text", "跟随队长海报: "),
        advancedLeaderPosterSelect,
      ]),
    );

    const leaderPositionContainer = _("div", {
      style: { marginTop: "10px", marginBottom: "10px" },
    });
    leaderPositionContainer.appendChild(
      _("div", { style: { fontWeight: "bold", marginBottom: "4px" } }, [
        _("text", "队长位置"),
      ]),
    );
    const advancedLeaderPositionInputs = [];
    const leaderPositionRadioName = `auto-party-leader-position-${Date.now()}`;
    const createLeaderPositionRadio = (position) => {
      const radio = _("input", {
        type: "radio",
        name: leaderPositionRadioName,
        value: position,
        event: {
          change: () => {
            if (!radio.checked) return;
            advancedLeaderPosition = position;
            if (position >= 0) {
              clearAdvancedCharacterSlot(position);
              if (advancedLeaderPosterIdx >= 0) {
                advancedPosterSlots[position] = -1;
              }
            }
            refreshAdvancedOptions();
            updateEstimate();
            saveState();
          },
        },
      });
      radio.checked = advancedLeaderPosition === position;
      return radio;
    };
    const automaticLeaderPositionRadio = createLeaderPositionRadio(-1);
    advancedLeaderPositionInputs.push(automaticLeaderPositionRadio);
    leaderPositionContainer.appendChild(
      _("label", {}, [
        automaticLeaderPositionRadio,
        _("text", " 位置自动"),
      ]),
    );
    advancedSection.appendChild(leaderPositionContainer);

    const advancedSlotIcons = {
      character: [],
      poster: [],
      accessory: [],
    };
    const advancedCharacterSlotFixedInputs = [];
    const advancedSlotsByType = {
      character: advancedCharacterSlots,
      poster: advancedPosterSlots,
      accessory: advancedAccessorySlots,
    };
    const advancedSlotMeta = {
      character: {
        items: characters,
        selected: selectedChars,
        label: "角色",
        spriteClass: "spriteatlas-characters",
        iconId: (item) => item.cardIconId,
        name: (item) => item.fullCardName,
      },
      poster: {
        items: posters,
        selected: selectedPosters,
        label: "海报",
        spriteClass: "spriteatlas-posters",
        iconId: (item) => item.id,
        name: (item) => item.fullPosterName,
      },
      accessory: {
        items: accessories,
        selected: selectedAccs,
        label: "饰品",
        spriteClass: "spriteatlas-accessories",
        iconId: (item) => item.id,
        name: (item) => item.fullAccessoryName,
      },
    };
    const setAdvancedSlot = (type, position, value) => {
      const slots = advancedSlotsByType[type];
      const items = advancedSlotMeta[type].items;
      const previousValue = slots[position];
      const parsedValue = parseInt(value);
      if (!Number.isInteger(parsedValue) || parsedValue < 0) {
        if (type === "character") {
          clearAdvancedCharacterSlot(position);
        } else {
          slots[position] = -1;
        }
      } else {
        slots.forEach((idx, otherPosition) => {
          if (otherPosition === position || idx < 0) return;
          let conflicts = idx === parsedValue;
          if (type === "character") {
            conflicts =
              conflicts ||
              items[idx]?.data.CharacterBaseMasterId ===
                items[parsedValue]?.data.CharacterBaseMasterId;
          } else if (type === "poster") {
            const restrictId = items[parsedValue]?.data.OrganizeRestrictGroupId;
            conflicts =
              conflicts ||
              (restrictId &&
                restrictId === items[idx]?.data.OrganizeRestrictGroupId);
          }
          if (!conflicts) return;
          if (type === "character") {
            clearAdvancedCharacterSlot(otherPosition);
          } else {
            slots[otherPosition] = -1;
          }
        });
        slots[position] = parsedValue;
        if (type === "character" && previousValue !== parsedValue) {
          advancedCharacterSlotFixed[position] = true;
        }
      }
      refreshAdvancedOptions();
      updateEstimate();
      saveState();
    };

    const getAdvancedSlotConflict = (type, candidateIdx) => {
      if (type === "character" && advancedLeaderIdx >= 0) {
        const candidateBaseId =
          characters[candidateIdx]?.data.CharacterBaseMasterId;
        const leaderBaseId =
          characters[advancedLeaderIdx]?.data.CharacterBaseMasterId;
        if (leaderBaseId != null && candidateBaseId === leaderBaseId) {
          return "与当前队长使用同一主角色";
        }
      }
      if (type === "poster" && advancedLeaderPosterIdx >= 0) {
        const candidate = posters[candidateIdx];
        const leaderPoster = posters[advancedLeaderPosterIdx];
        const leaderRestrictId = leaderPoster?.data.OrganizeRestrictGroupId;
        if (
          candidate === leaderPoster ||
          (leaderRestrictId &&
            candidate?.data.OrganizeRestrictGroupId === leaderRestrictId)
        ) {
          return "与当前队长海报冲突";
        }
      }
      return null;
    };

    const isAdvancedDerivedSlot = (type, position) =>
      (type === "character" &&
        advancedLeaderIdx >= 0 &&
        advancedLeaderPosition === position) ||
      (type === "poster" &&
        advancedLeaderPosterIdx >= 0 &&
        advancedLeaderPosition === position);

    const openAdvancedSlotPicker = (type, position) => {
      if (isAdvancedDerivedSlot(type, position)) return;
      const meta = advancedSlotMeta[type];
      const slots = advancedSlotsByType[type];
      const pickerOverlay = _("div", {
        className: "picking-overlay",
        style: { zIndex: 10002 },
      });
      const pickerContainer = _("div", { className: "picking-container" });
      const closePicker = () => {
        document.body.classList.remove("picking");
        pickerOverlay.remove();
      };
      pickerOverlay.addEventListener("click", (e) => {
        if (e.target === pickerOverlay) closePicker();
      });
      pickerContainer.appendChild(
        _(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "10px",
            },
          },
          [
            _("strong", {}, [
              _(
                "text",
                type === "character"
                  ? `选择第${position + 1}行必选角色`
                  : `选择第${position + 1}行${meta.label}`,
              ),
            ]),
            _("input", {
              type: "button",
              value: "关闭",
              event: { click: closePicker },
            }),
          ],
        ),
      );
      pickerContainer.appendChild(
        _(
          "div",
          { style: { color: "#666", fontSize: "12px", marginBottom: "8px" } },
          [_(
            "text",
            "仅显示当前已勾选的候选；选择已使用项会将该项移动到这里。",
          )],
        ),
      );

      const chooseCandidate = (candidateIdx) => {
        setAdvancedSlot(type, position, candidateIdx);
        closePicker();
      };
      const emptyOption = _(
        "span",
        {
          className: `list-icon-container small-text${type === "poster" ? " arial" : ""}`,
          title: type === "character" ? "不选择角色" : `不选择${meta.label}`,
          style: { cursor: "pointer" },
          event: { click: () => chooseCandidate(-1) },
        },
        [
          _("span", {
            className: `${meta.spriteClass} empty-icon`,
            "data-id": "",
            style: { marginLeft: 0 },
          }),
          _("br"),
          _("span", {}, [_("text", "不选择")]),
        ],
      );
      if (slots[position] < 0) emptyOption.classList.add("selected");
      pickerContainer.appendChild(emptyOption);

      meta.items.forEach((item, candidateIdx) => {
        if (!meta.selected[candidateIdx]) return;
        const option = item.iconNode.cloneNode(true);
        option.classList.remove("selected");
        option
          .querySelectorAll("input.icon-selection")
          .forEach((input) => input.remove());
        if (slots[position] === candidateIdx) option.classList.add("selected");
        const conflict = getAdvancedSlotConflict(type, candidateIdx);
        option.title = conflict
          ? `${meta.name(item)}（${conflict}）`
          : meta.name(item);
        if (conflict) {
          option.style.cursor = "not-allowed";
          option.style.opacity = "0.35";
        } else {
          option.style.cursor = "pointer";
          option.addEventListener("click", () =>
            chooseCandidate(candidateIdx),
          );
        }
        pickerContainer.appendChild(option);
      });

      pickerOverlay.appendChild(pickerContainer);
      document.body.classList.add("picking");
      document.body.appendChild(pickerOverlay);
      pickerOverlay.scrollTop = 0;
    };

    const advancedSlotsGrid = _("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "90px 72px repeat(3, minmax(90px, 1fr))",
        gap: "8px",
        alignItems: "center",
      },
    });
    ["队长 / 位置", "固定位置", "必选角色", "海报", "饰品"].forEach((label) => {
      advancedSlotsGrid.appendChild(
        _("div", { style: { fontWeight: "bold", textAlign: "center" } }, [_("text", label)]),
      );
    });
    for (let position = 0; position < 5; position++) {
      const leaderPositionRadio = createLeaderPositionRadio(position);
      advancedLeaderPositionInputs.push(leaderPositionRadio);
      const rowChildren = [
        _("label", { style: { fontWeight: "bold" } }, [
          leaderPositionRadio,
          _("text", ` ${position + 1}号位`),
        ]),
      ];
      const fixedPositionCheckbox = _("input", {
        type: "checkbox",
        title: "勾选时固定在该位置；取消后角色位置自动，同行海报和饰品跟随角色",
        event: {
          change: () => {
            const hasCharacter = advancedCharacterSlots[position] >= 0;
            const isLeaderPosition =
              advancedLeaderIdx >= 0 &&
              advancedLeaderPosition === position;
            if (!hasCharacter || isLeaderPosition) {
              advancedCharacterSlotFixed[position] = true;
              fixedPositionCheckbox.checked = true;
              return;
            }
            advancedCharacterSlotFixed[position] =
              fixedPositionCheckbox.checked;
            refreshAdvancedOptions();
            updateEstimate();
            saveState();
          },
        },
      });
      fixedPositionCheckbox.checked = advancedCharacterSlotFixed[position];
      advancedCharacterSlotFixedInputs[position] = fixedPositionCheckbox;
      rowChildren.push(
        _(
          "label",
          {
            style: {
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            },
            title: fixedPositionCheckbox.title,
          },
          [fixedPositionCheckbox],
        ),
      );
      ["character", "poster", "accessory"].forEach((type) => {
        const meta = advancedSlotMeta[type];
        const icon = _("span", {
          className: meta.spriteClass,
          "data-id": "",
          role: "button",
          tabindex: 0,
          title: `不固定${meta.label}，点击选择`,
          style: {
            justifySelf: "center",
            marginLeft: 0,
            cursor: "pointer",
          },
          event: {
            click: () => openAdvancedSlotPicker(type, position),
            keydown: (e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              openAdvancedSlotPicker(type, position);
            },
          },
        });
        advancedSlotIcons[type][position] = icon;
        rowChildren.push(icon);
      });
      advancedSlotsGrid.appendChild(
        _(
          "div",
          { className: "party-member", style: { display: "contents" } },
          rowChildren,
        ),
      );
    }
    advancedSection.appendChild(advancedSlotsGrid);
    advancedSection.appendChild(
      _(
        "div",
        { style: { marginTop: "6px", color: "#666", fontSize: "12px" } },
        [_(
          "text",
          "点击图标选择必选项；取消“固定位置”后，该行角色位置自动，同行海报和饰品跟随角色。蓝色高亮槽跟随队长。",
        )],
      ),
    );
    const clearAdvancedBtn = _("input", {
      type: "button",
      value: "清空进阶设置",
      style: { marginTop: "10px" },
      event: {
        click: () => {
          advancedLeaderIdx = -1;
          advancedLeaderPosterIdx = -1;
          advancedLeaderPosition = -1;
          advancedCharacterSlots.fill(-1);
          advancedCharacterSlotFixed.fill(true);
          advancedPosterSlots.fill(-1);
          advancedAccessorySlots.fill(-1);
          refreshAdvancedOptions();
          updateEstimate();
          saveState();
        },
      },
    });
    advancedSection.appendChild(clearAdvancedBtn);

    cleanupAdvancedReferences = () => {
      if (advancedLeaderIdx < 0 || !selectedChars[advancedLeaderIdx]) {
        advancedLeaderIdx = -1;
        advancedLeaderPosition = -1;
      }
      if (
        advancedLeaderPosterIdx < 0 ||
        !selectedPosters[advancedLeaderPosterIdx]
      ) {
        advancedLeaderPosterIdx = -1;
      }
      advancedCharacterSlots.forEach((idx, position) => {
        if (idx < 0 || !selectedChars[idx]) {
          clearAdvancedCharacterSlot(position);
        }
      });
      advancedPosterSlots.forEach((idx, position) => {
        if (idx < 0 || !selectedPosters[idx]) advancedPosterSlots[position] = -1;
      });
      advancedAccessorySlots.forEach((idx, position) => {
        if (idx < 0 || !selectedAccs[idx]) advancedAccessorySlots[position] = -1;
      });
    };

    const addSelectOption = (select, value, label, disabled = false) => {
      const attributes = { value };
      if (disabled) attributes.disabled = true;
      select.appendChild(
        _("option", attributes, [_("text", label)]),
      );
    };
    const updateAdvancedSlotIcon = (type, position) => {
      const meta = advancedSlotMeta[type];
      const icon = advancedSlotIcons[type][position];
      const derived = isAdvancedDerivedSlot(type, position);
      let itemIdx = advancedSlotsByType[type][position];
      let stateLabel = "不固定";
      if (derived) {
        itemIdx =
          type === "character"
            ? advancedLeaderIdx
            : advancedLeaderPosterIdx;
      }
      const item = itemIdx >= 0 ? meta.items[itemIdx] : null;
      icon.dataset.id = item ? meta.iconId(item) : "";
      if (item) {
        if (derived) {
          stateLabel = `${type === "character" ? "队长" : "队长海报"}：${meta.name(item)}`;
        } else if (!advancedCharacterSlotFixed[position]) {
          stateLabel = `${
            type === "character" ? "必选（位置自动）" : "跟随角色"
          }：${meta.name(item)}`;
        } else {
          stateLabel = `固定：${meta.name(item)}`;
        }
      }
      icon.title = `第${position + 1}行${meta.label} - ${stateLabel}${
        derived ? "（跟随队长位置）" : "（点击选择）"
      }`;
      icon.setAttribute("aria-label", icon.title);
      icon.style.cursor = derived ? "not-allowed" : "pointer";
      icon.style.opacity = derived ? "0.85" : "1";
      icon.style.borderRadius = "10px";
      icon.style.boxShadow = derived
        ? "0 0 0 3px rgba(33, 150, 243, 0.45)"
        : item && !advancedCharacterSlotFixed[position]
          ? "0 0 0 2px rgba(0, 150, 136, 0.35)"
          : item
            ? "0 0 0 2px rgba(63, 81, 181, 0.25)"
            : "";
      if (derived) {
        icon.setAttribute("aria-disabled", "true");
        icon.setAttribute("tabindex", "-1");
      } else {
        icon.removeAttribute("aria-disabled");
        icon.setAttribute("tabindex", "0");
      }
    };
    refreshAdvancedOptions = () => {
      cleanupAdvancedReferences();

      removeAllChilds(advancedLeaderSelect);
      addSelectOption(advancedLeaderSelect, -1, "（请选择队长）");
      characters.forEach((character, idx) => {
        if (!selectedChars[idx]) return;
        addSelectOption(
          advancedLeaderSelect,
          idx,
          character.fullCardName,
        );
      });
      advancedLeaderSelect.value = String(advancedLeaderIdx);

      removeAllChilds(advancedLeaderPosterSelect);
      addSelectOption(
        advancedLeaderPosterSelect,
        -1,
        "（自动选择最优海报）",
      );
      posters.forEach((poster, idx) => {
        if (!selectedPosters[idx]) return;
        addSelectOption(
          advancedLeaderPosterSelect,
          idx,
          poster.fullPosterName,
        );
      });
      advancedLeaderPosterSelect.value = String(advancedLeaderPosterIdx);

      advancedLeaderPositionInputs.forEach((radio, inputIdx) => {
        const position = inputIdx - 1;
        radio.checked = advancedLeaderPosition === position;
        radio.disabled = position >= 0 && advancedLeaderIdx < 0;
      });

      for (let position = 0; position < 5; position++) {
        const hasCharacter = advancedCharacterSlots[position] >= 0;
        const isLeaderPosition =
          advancedLeaderIdx >= 0 && advancedLeaderPosition === position;
        if (!hasCharacter || isLeaderPosition) {
          advancedCharacterSlotFixed[position] = true;
        }
        const fixedPositionCheckbox =
          advancedCharacterSlotFixedInputs[position];
        fixedPositionCheckbox.checked =
          advancedCharacterSlotFixed[position];
        fixedPositionCheckbox.disabled = !hasCharacter || isLeaderPosition;
        fixedPositionCheckbox.title = isLeaderPosition
          ? "队长已固定在该位置"
          : hasCharacter
            ? "勾选时固定在该位置；取消后角色位置自动，同行海报和饰品跟随角色"
            : "请先选择角色，再设置位置自动";
        updateAdvancedSlotIcon("character", position);
        updateAdvancedSlotIcon("poster", position);
        updateAdvancedSlotIcon("accessory", position);
      }
      updatePythonAvailability();
    };

    const estInfo = _("div", {
      style: {
        marginBottom: "15px",
        padding: "10px",
        background: "#e2fff6ff",
        borderRadius: "4px",
      },
    });
    const estText = _("span", {}, [_("text", "预估遍历次数: 计算中...")]);
    estInfo.appendChild(estText);
    const validationText = _("div", {
      style: {
        display: "none",
        marginTop: "6px",
        color: "#c62828",
        fontSize: "12px",
        whiteSpace: "pre-wrap",
      },
    });
    estInfo.appendChild(validationText);

    // Worker 数量设置
    const maxCores = navigator.hardwareConcurrency || 4;
    const defaultWorkerCount = Math.max(1, maxCores - 2);
    const clampWorkerCount = (value) => {
      const parsed = parseInt(value);
      if (!Number.isFinite(parsed)) return defaultWorkerCount;
      return Math.max(1, Math.min(parsed, maxCores));
    };
    const savedWorkerCount = (() => {
      try {
        return clampWorkerCount(localStorage.getItem("autoPartyWorkerCount"));
      } catch {
        return defaultWorkerCount;
      }
    })();
    const workerSection = _("div", {
      style: {
        marginBottom: "15px",
        padding: "10px",
        background: "#fff8e1",
        borderRadius: "4px",
      },
    });
    workerSection.appendChild(
      _("div", { style: { fontWeight: "bold", marginBottom: "8px" } }, [
        _("text", "并行计算设置"),
      ]),
    );
    const workerInput = _("input", {
      type: "number",
      value: savedWorkerCount,
      min: 1,
      max: maxCores,
      step: 1,
      style: { width: "80px" },
      event: {
        change: (e) => {
          const count = clampWorkerCount(e.target.value);
          e.target.value = count;
          try {
            localStorage.setItem("autoPartyWorkerCount", count);
          } catch {
            // Keep the in-memory value when localStorage is unavailable.
          }
        },
      },
    });
    workerSection.appendChild(
      _("div", {}, [
        _("text", "Worker 数量: "),
        workerInput,
        _("text", ` （当前设备最大核心数: ${maxCores}）`),
      ]),
    );
    workerSection.appendChild(
      _(
        "div",
        {
          style: { marginTop: "4px", fontSize: "12px", color: "#666" },
        },
        [_("text", "建议使用全部核心数。减少数量可降低系统负载。")],
      ),
    );

    // SA 筛选阈值设置
    const saThresholdSection = _("div", {
      style: {
        marginBottom: "15px",
        padding: "10px",
        background: "#fff3e0",
        borderRadius: "4px",
      },
    });
    saThresholdSection.appendChild(
      _("div", { style: { fontWeight: "bold", marginBottom: "8px" } }, [
        _("text", "StarAct 筛选设置"),
      ]),
    );
    const savedThreshold = (() => {
      try {
        return parseInt(localStorage.getItem("autoPartySAThreshold")) || 1;
      } catch {
        return 1;
      }
    })();
    const saThresholdInput = _("input", {
      type: "number",
      value: savedThreshold,
      min: 0,
      max: 10,
      step: 1,
      style: { width: "80px" },
    });
    saThresholdSection.appendChild(
      _("div", {}, [
        _("text", "SA 阈值偏移: "),
        saThresholdInput,
        _("text", " （第一轮筛选阈值 = 最大SA数 - 此值）"),
      ]),
    );
    saThresholdSection.appendChild(
      _(
        "div",
        {
          style: { marginTop: "4px", fontSize: "12px", color: "#666" },
        },
        [
          _(
            "text",
            "设为 0 只保留最高 SA 组合。设为 1 保留最高和次高（默认）。增大可保留更多候选，但会增加第二轮计算量。",
          ),
        ],
      ),
    );

    // WebGPU 加速选项
    const gpuSection = _("div", {
      style: {
        marginBottom: "15px",
        padding: "10px",
        background: "#f3e5f5",
        borderRadius: "4px",
      },
    });
    gpuSection.appendChild(
      _("div", { style: { fontWeight: "bold", marginBottom: "8px" } }, [
        _("text", "WebGPU 加速"),
      ]),
    );
    const gpuCheckbox = _("input", {
      type: "checkbox",
      disabled: true,
    });
    const gpuStatus = _(
      "span",
      { style: { marginLeft: "8px", fontSize: "12px", color: "#999" } },
      [_("text", "检测中...")],
    );
    gpuSection.appendChild(
      _("label", {}, [
        gpuCheckbox,
        _("text", " 使用 WebGPU 预筛选角色排列"),
        gpuStatus,
      ]),
    );
    gpuSection.appendChild(
      _(
        "div",
        {
          style: { marginTop: "4px", fontSize: "12px", color: "#666" },
        },
        [
          _(
            "text",
            "WebGPU 会在 CPU 计算前先用 GPU 快速评估角色排列的 StarAct 触发次数，减少需要遍历的组合数。",
          ),
        ],
      ),
    );

    // 异步检测 WebGPU 支持
    (async () => {
      try {
        if (!navigator.gpu) {
          gpuStatus.textContent = "（浏览器不支持 WebGPU）";
          return;
        }
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          gpuStatus.textContent = "（无可用 GPU 适配器）";
          return;
        }
        gpuCheckbox.disabled = false;
        gpuStatus.textContent = "（可用）";
        gpuStatus.style.color = "#4caf50";
      } catch {
        gpuStatus.textContent = "（WebGPU 初始化失败）";
      }
    })();

    // Python 脚本配队选项
    const pythonSection = _("div", {
      style: {
        marginBottom: "15px",
        padding: "10px",
        background: "#e8f5e9",
        borderRadius: "4px",
      },
    });
    pythonSection.appendChild(
      _("div", { style: { fontWeight: "bold", marginBottom: "8px" } }, [
        _("text", "Python 脚本配队"),
      ]),
    );
    const pythonCheckbox = _("input", { type: "checkbox" });
    pythonSection.appendChild(
      _("label", {}, [
        pythonCheckbox,
        _("text", " 使用 Python 脚本计算最优配队（仅 Electron 环境可用）"),
      ]),
    );
    const pythonConstraintNote = _(
      "div",
      {
        style: {
          display: "none",
          marginTop: "6px",
          fontSize: "12px",
          whiteSpace: "pre-wrap",
        },
      },
    );
    pythonSection.appendChild(pythonConstraintNote);

    const createCurrentAdvancedPythonPlan = () =>
      createPythonAutoPartyPlan({
        mode: "advanced",
        characters,
        posters,
        leaderIdx: advancedLeaderIdx,
        leaderPosterIdx: advancedLeaderPosterIdx,
        constraints: {
          mode: "advanced",
          leaderPosition: advancedLeaderPosition,
          characterSlots: advancedCharacterSlots,
          characterSlotFixed: advancedCharacterSlotFixed,
          posterSlots: advancedPosterSlots,
          accessorySlots: advancedAccessorySlots,
        },
      });

    updatePythonAvailability = () => {
      if (autoPartyMode !== "advanced") {
        pythonCheckbox.disabled = false;
        pythonConstraintNote.style.display = "none";
        pythonConstraintNote.textContent = "";
        return;
      }

      const pythonPlan = createCurrentAdvancedPythonPlan();
      if (pythonPlan.blockingErrors.length > 0) {
        pythonCheckbox.checked = false;
        pythonCheckbox.disabled = true;
        pythonConstraintNote.style.display = "";
        pythonConstraintNote.style.color = "#c62828";
        pythonConstraintNote.textContent = pythonPlan.blockingErrors
          .map((message) => `• ${message}`)
          .join("\n");
        return;
      }

      pythonCheckbox.disabled = false;
      if (pythonPlan.ignoredAccessoryPositions.length > 0) {
        const ignoredItems = pythonPlan.ignoredAccessoryPositions
          .map((position) => {
            const characterIdx = advancedCharacterSlots[position];
            if (
              characterIdx >= 0 &&
              !advancedCharacterSlotFixed[position]
            ) {
              const characterName =
                characters[characterIdx]?.fullCardName ||
                `第${position + 1}行角色`;
              return `“${characterName}”的跟随饰品`;
            }
            return `${position + 1}号位饰品`;
          })
          .join("、");
        pythonConstraintNote.style.display = "";
        pythonConstraintNote.style.color = "#ef6c00";
        pythonConstraintNote.textContent = `Python 暂不支持饰品约束，将忽略：${ignoredItems}；角色和海报约束仍会生效。`;
      } else {
        pythonConstraintNote.style.display = "none";
        pythonConstraintNote.textContent = "";
      }
    };

    updateAutoPartyMode = () => {
      const isAdvanced = autoPartyMode === "advanced";
      basicModeRadio.checked = !isAdvanced;
      advancedModeRadio.checked = isAdvanced;
      leaderSection.style.display = isAdvanced ? "none" : "";
      advancedSection.style.display = isAdvanced ? "" : "none";
      if (isAdvanced) {
        refreshAdvancedOptions();
      } else {
        updatePythonAvailability();
      }
    };

    const perm = (n, k) =>
      n < k
        ? 0
        : Array.from({ length: k }, (_, i) => n - i).reduce((a, b) => a * b, 1);

    const getMaxCompatiblePosterCount = (
      selectedIndexes,
      usedIndexes = new Set(),
      usedRestrictIds = new Set(),
    ) => {
      let unrestrictedCount = 0;
      const availableRestrictIds = new Set();
      selectedIndexes.forEach((idx) => {
        if (usedIndexes.has(idx)) return;
        const restrictId = posters[idx]?.data.OrganizeRestrictGroupId;
        if (restrictId) {
          if (!usedRestrictIds.has(restrictId)) {
            availableRestrictIds.add(restrictId);
          }
        } else {
          unrestrictedCount++;
        }
      });
      return unrestrictedCount + availableRestrictIds.size;
    };

    const getAutoPartyValidation = () => {
      const charCount = selectedChars.filter(Boolean).length;
      const posterCount = selectedPosters.filter(Boolean).length;
      const accCount = selectedAccs.filter(Boolean).length;
      const selectedCharIndexes = selectedChars
        .map((selected, idx) => (selected ? idx : -1))
        .filter((idx) => idx >= 0);
      const selectedPosterIndexes = selectedPosters
        .map((selected, idx) => (selected ? idx : -1))
        .filter((idx) => idx >= 0);
      const selectedAccessoryIndexes = selectedAccs
        .map((selected, idx) => (selected ? idx : -1))
        .filter((idx) => idx >= 0);
      const errors = [];

      if (autoPartyMode === "basic") {
        if (leaderIdx < 0 || !selectedChars[leaderIdx]) {
          errors.push("请选择一个已勾选的队长");
        }
        if (leaderPosterIdx >= 0 && !selectedPosters[leaderPosterIdx]) {
          errors.push("队长海报已不在候选池中");
        }
        const leaderBaseId = characters[leaderIdx]?.data.CharacterBaseMasterId;
        const availableCharacterBaseIds = new Set(
          selectedCharIndexes
            .filter((idx) => idx !== leaderIdx)
            .map((idx) => characters[idx]?.data.CharacterBaseMasterId)
            .filter((baseId) => baseId !== leaderBaseId),
        );
        if (availableCharacterBaseIds.size < 4) {
          errors.push(`可用角色不足（还需 ${4 - availableCharacterBaseIds.size} 个不同角色）`);
        }
        const usedPosterIndexes = new Set();
        const usedPosterRestrictIds = new Set();
        if (leaderPosterIdx >= 0) {
          usedPosterIndexes.add(leaderPosterIdx);
          const restrictId =
            posters[leaderPosterIdx]?.data.OrganizeRestrictGroupId;
          if (restrictId) usedPosterRestrictIds.add(restrictId);
        }
        const posterRemaining = leaderPosterIdx >= 0 ? 4 : 5;
        const compatiblePosterCount = getMaxCompatiblePosterCount(
          selectedPosterIndexes,
          usedPosterIndexes,
          usedPosterRestrictIds,
        );
        if (compatiblePosterCount < posterRemaining) {
          errors.push(`可用海报不足（还需 ${posterRemaining - compatiblePosterCount} 张无冲突海报）`);
        }
        if (accCount < 5) errors.push(`可用饰品不足（${accCount}/5）`);

        const posterPool = Math.max(
          0,
          posterCount - (leaderPosterIdx >= 0 ? 1 : 0),
        );
        const charComb = perm(charCount, 5);
        const posterOpenSlots = leaderPosterIdx >= 0 ? 4 : 5;
        const posterComb = perm(posterPool, posterOpenSlots);
        const accComb = perm(accCount, 5);
        return {
          errors,
          charComb,
          posterComb,
          accComb,
          positionLayoutCount: 1,
          remainingText: "角色5、海报5、饰品5",
        };
      }

      if (advancedLeaderIdx < 0 || !selectedChars[advancedLeaderIdx]) {
        errors.push("进阶设置必须选择队长");
      }
      if (
        advancedLeaderPosterIdx >= 0 &&
        !selectedPosters[advancedLeaderPosterIdx]
      ) {
        errors.push("跟随队长海报已不在候选池中");
      }

      const mandatoryCharacterIndexes = [];
      const usedCharacterIndexes = new Set();
      const usedCharacterBaseIds = new Set();
      advancedCharacterSlots.forEach((idx, position) => {
        if (idx < 0) return;
        if (!selectedChars[idx]) {
          errors.push(`第${position + 1}行必选角色已不在候选池中`);
          return;
        }
        const baseId = characters[idx]?.data.CharacterBaseMasterId;
        if (usedCharacterIndexes.has(idx)) {
          errors.push("必选角色存在重复库存对象");
        }
        if (usedCharacterBaseIds.has(baseId)) {
          errors.push("必选角色存在相同主角色冲突");
        }
        usedCharacterIndexes.add(idx);
        usedCharacterBaseIds.add(baseId);
        mandatoryCharacterIndexes.push(idx);
      });
      const leaderBaseId =
        characters[advancedLeaderIdx]?.data.CharacterBaseMasterId;
      if (leaderBaseId != null && usedCharacterBaseIds.has(leaderBaseId)) {
        errors.push("必选角色不能与队长使用同一主角色");
      }
      if (mandatoryCharacterIndexes.length > 4) {
        errors.push("必选角色过多（队长之外最多选择 4 个）");
      }

      const mandatoryPosterIndexes = [];
      const usedPosterIndexes = new Set();
      const usedPosterRestrictIds = new Set();
      advancedPosterSlots.forEach((idx, position) => {
        if (idx < 0) return;
        if (!selectedPosters[idx]) {
          errors.push(`第${position + 1}行海报已不在候选池中`);
          return;
        }
        const restrictId = posters[idx]?.data.OrganizeRestrictGroupId;
        if (usedPosterIndexes.has(idx)) {
          errors.push("固定海报存在重复库存对象");
        }
        if (restrictId && usedPosterRestrictIds.has(restrictId)) {
          errors.push("固定海报存在限制组冲突");
        }
        usedPosterIndexes.add(idx);
        if (restrictId) usedPosterRestrictIds.add(restrictId);
        mandatoryPosterIndexes.push(idx);
      });
      if (advancedLeaderPosterIdx >= 0) {
        const restrictId =
          posters[advancedLeaderPosterIdx]?.data.OrganizeRestrictGroupId;
        if (usedPosterIndexes.has(advancedLeaderPosterIdx)) {
          errors.push("队长海报不能再固定到其他位置");
        }
        if (restrictId && usedPosterRestrictIds.has(restrictId)) {
          errors.push("队长海报与固定海报存在限制组冲突");
        }
        usedPosterIndexes.add(advancedLeaderPosterIdx);
        if (restrictId) usedPosterRestrictIds.add(restrictId);
      }
      if (
        mandatoryPosterIndexes.length +
          (advancedLeaderPosterIdx >= 0 ? 1 : 0) >
        5
      ) {
        errors.push("必选海报过多（最多选择 5 张）");
      }

      const mandatoryAccessoryIndexes = [];
      const usedAccessoryIndexes = new Set();
      advancedAccessorySlots.forEach((idx, position) => {
        if (idx < 0) return;
        if (!selectedAccs[idx]) {
          errors.push(`第${position + 1}行饰品已不在候选池中`);
          return;
        }
        if (usedAccessoryIndexes.has(idx)) {
          errors.push("固定饰品存在重复库存对象");
        }
        usedAccessoryIndexes.add(idx);
        mandatoryAccessoryIndexes.push(idx);
      });

      const fixedCharacterPositions = new Set();
      const fixedPosterPositions = new Set();
      const fixedAccessoryPositions = new Set();
      const automaticCharacterRows = [];
      advancedCharacterSlots.forEach((idx, position) => {
        if (idx < 0) return;
        if (advancedCharacterSlotFixed[position]) {
          fixedCharacterPositions.add(position);
        } else {
          automaticCharacterRows.push(position);
        }
      });
      advancedPosterSlots.forEach((idx, position) => {
        if (
          idx >= 0 &&
          (advancedCharacterSlots[position] < 0 ||
            advancedCharacterSlotFixed[position])
        ) {
          fixedPosterPositions.add(position);
        }
      });
      advancedAccessorySlots.forEach((idx, position) => {
        if (
          idx >= 0 &&
          (advancedCharacterSlots[position] < 0 ||
            advancedCharacterSlotFixed[position])
        ) {
          fixedAccessoryPositions.add(position);
        }
      });

      if (
        advancedLeaderPosition >= 0 &&
        fixedCharacterPositions.has(advancedLeaderPosition)
      ) {
        errors.push("队长位置与固定角色冲突");
      }
      if (
        advancedLeaderPosition >= 0 &&
        advancedLeaderPosterIdx >= 0 &&
        fixedPosterPositions.has(advancedLeaderPosition)
      ) {
        errors.push("队长海报与固定海报位置冲突");
      }

      const positionAnchors = [
        {
          type: "leader",
          row: -1,
          fixedPosition: advancedLeaderPosition,
          followsPoster: advancedLeaderPosterIdx >= 0,
          followsAccessory: false,
        },
        ...automaticCharacterRows.map((row) => ({
          type: "character",
          row,
          fixedPosition: -1,
          followsPoster: advancedPosterSlots[row] >= 0,
          followsAccessory: advancedAccessorySlots[row] >= 0,
        })),
      ];
      let positionLayoutCount = 0;
      const usedLayoutPositions = new Set(fixedCharacterPositions);
      const visitPositionLayouts = (anchorIndex) => {
        if (anchorIndex >= positionAnchors.length) {
          positionLayoutCount++;
          return;
        }
        const anchor = positionAnchors[anchorIndex];
        const positions =
          anchor.fixedPosition >= 0
            ? [anchor.fixedPosition]
            : [0, 1, 2, 3, 4];
        positions.forEach((position) => {
          if (usedLayoutPositions.has(position)) return;
          if (anchor.followsPoster && fixedPosterPositions.has(position)) {
            return;
          }
          if (
            anchor.followsAccessory &&
            fixedAccessoryPositions.has(position)
          ) {
            return;
          }
          usedLayoutPositions.add(position);
          visitPositionLayouts(anchorIndex + 1);
          usedLayoutPositions.delete(position);
        });
      };
      const hasValidAdvancedLeader =
        advancedLeaderIdx >= 0 && selectedChars[advancedLeaderIdx];
      if (hasValidAdvancedLeader) {
        visitPositionLayouts(0);
      }
      if (hasValidAdvancedLeader && positionLayoutCount === 0) {
        errors.push("队长或位置自动角色没有合法位置布局");
      }

      const characterOpenSlots = Math.max(
        0,
        4 - mandatoryCharacterIndexes.length,
      );
      const unavailableCharacterBaseIds = new Set(usedCharacterBaseIds);
      if (leaderBaseId != null) unavailableCharacterBaseIds.add(leaderBaseId);
      const availableCharacterIndexes = selectedCharIndexes.filter(
        (idx) =>
          !usedCharacterIndexes.has(idx) &&
          !unavailableCharacterBaseIds.has(
            characters[idx]?.data.CharacterBaseMasterId,
          ),
      );
      const availableCharacterBaseIds = new Set(
        availableCharacterIndexes.map(
          (idx) => characters[idx]?.data.CharacterBaseMasterId,
        ),
      );
      if (availableCharacterBaseIds.size < characterOpenSlots) {
        errors.push(
          `剩余角色不足（还需 ${characterOpenSlots - availableCharacterBaseIds.size} 个不同角色）`,
        );
      }

      const posterOpenSlots = Math.max(
        0,
        5 -
          mandatoryPosterIndexes.length -
          (advancedLeaderPosterIdx >= 0 ? 1 : 0),
      );
      const compatiblePosterCount = getMaxCompatiblePosterCount(
        selectedPosterIndexes,
        usedPosterIndexes,
        usedPosterRestrictIds,
      );
      if (compatiblePosterCount < posterOpenSlots) {
        errors.push(
          `剩余海报不足（还需 ${posterOpenSlots - compatiblePosterCount} 张无冲突海报）`,
        );
      }

      const accessoryOpenSlots = Math.max(
        0,
        5 - mandatoryAccessoryIndexes.length,
      );
      const availableAccessoryCount = selectedAccessoryIndexes.filter(
        (idx) => !usedAccessoryIndexes.has(idx),
      ).length;
      if (availableAccessoryCount < accessoryOpenSlots) {
        errors.push(
          `剩余饰品不足（还需 ${accessoryOpenSlots - availableAccessoryCount} 个库存饰品）`,
        );
      }

      return {
        errors,
        charComb: perm(availableCharacterIndexes.length, characterOpenSlots),
        posterComb: perm(compatiblePosterCount, posterOpenSlots),
        accComb: perm(availableAccessoryCount, accessoryOpenSlots),
        positionLayoutCount,
        remainingText: `角色${characterOpenSlots}、海报${posterOpenSlots}、饰品${accessoryOpenSlots}`,
      };
    };

    updateEstimate = () => {
      const validation = getAutoPartyValidation();
      const total =
        validation.positionLayoutCount *
        validation.charComb *
        validation.posterComb *
        validation.accComb;
      const positionText =
        autoPartyMode === "advanced"
          ? ` × 位置布局${validation.positionLayoutCount}`
          : "";
      estText.textContent = `预估遍历次数: ${total.toLocaleString()} (角色${validation.charComb} × 海报${validation.posterComb} × 饰品${validation.accComb}${positionText})；剩余空位: ${validation.remainingText}`;
      if (validation.errors.length > 0) {
        validationText.style.display = "";
        validationText.textContent = validation.errors
          .map((message) => `• ${message}`)
          .join("\n");
      } else {
        validationText.style.display = "none";
        validationText.textContent = "";
      }
      updateStartBtnState();
    };

    updateStartBtnState = () => {
      const validation = getAutoPartyValidation();
      if (isAutoPartyCalculating) {
        startBtn.disabled = true;
        startBtn.value = "计算中...";
        startBtn.title = "";
        return;
      }
      startBtn.value = hasCompletedAutoPartyRun ? "重新计算" : "开始计算";
      startBtn.disabled = validation.errors.length > 0;
      startBtn.title =
        validation.errors.length > 0 ? validation.errors.join("；") : "";
    };

    const charSection = _("div", { style: { marginBottom: "15px" } });
    charSection.appendChild(
      _("div", { style: { fontWeight: "bold", marginBottom: "8px" } }, [
        _("text", "候选角色"),
      ]),
    );
    const charSelectAll = _("input", {
      type: "checkbox",
      event: {
        change: (e) => {
          charSection
            .querySelectorAll("input[type=checkbox][data-chara]")
            .forEach((cb) => {
              cb.checked = e.target.checked;
              selectedChars[cb.getAttribute("data-chara")] = e.target.checked;
            });
          refreshLeaderOptions();
          cleanupAdvancedReferences();
          refreshAdvancedOptions();
          updateEstimate();
          saveState();
        },
      },
    });
    charSection.appendChild(
      _("label", {}, [charSelectAll, _("text", " 全选/全不选")]),
    );
    const charGrid = _("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(8, 1fr)",
        gap: "4px",
        maxHeight: "280px",
        overflowY: "auto",
        border: "1px solid #ddd",
        padding: "8px",
      },
    });
    characters.forEach((c, idx) => {
      const isChecked = savedChars.has(c.data.Id) || !hasSavedState;
      selectedChars[idx] = isChecked;
      const cb = _("input", {
        type: "checkbox",
        "data-chara": idx,
        event: {
          change: (e) => {
            selectedChars[idx] = e.target.checked;
            refreshLeaderOptions();
            cleanupAdvancedReferences();
            refreshAdvancedOptions();
            updateEstimate();
            saveState();
          },
        },
      });
      cb.checked = isChecked;
      const icon = c.iconNode.cloneNode(true);
      icon.style.cursor = "pointer";
      icon.addEventListener("click", () => {
        cb.checked = !cb.checked;
        selectedChars[idx] = cb.checked;
        refreshLeaderOptions();
        cleanupAdvancedReferences();
        refreshAdvancedOptions();
        updateEstimate();
        saveState();
      });
      const wrapper = _(
        "span",
        {
          style: {
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            fontSize: "10px",
          },
        },
        [icon, cb],
      );
      charGrid.appendChild(wrapper);
    });
    charSection.appendChild(charGrid);

    const posterSection = _("div", { style: { marginBottom: "15px" } });
    posterSection.appendChild(
      _("div", { style: { fontWeight: "bold", marginBottom: "8px" } }, [
        _("text", "候选海报"),
      ]),
    );
    const posterSelectAll = _("input", {
      type: "checkbox",
      event: {
        change: (e) => {
          posterSection
            .querySelectorAll("input[type=checkbox][data-poster]")
            .forEach((cb) => {
              cb.checked = e.target.checked;
              selectedPosters[cb.getAttribute("data-poster")] =
                e.target.checked;
            });
          refreshLeaderOptions();
          cleanupAdvancedReferences();
          refreshAdvancedOptions();
          updateEstimate();
          saveState();
        },
      },
    });
    posterSection.appendChild(
      _("label", {}, [posterSelectAll, _("text", " 全选/全不选")]),
    );
    const posterGrid = _("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(8, 1fr)",
        gap: "4px",
        maxHeight: "280px",
        overflowY: "auto",
        border: "1px solid #ddd",
        padding: "8px",
      },
    });
    posters.forEach((p, idx) => {
      const isChecked = savedPosters.has(p.data.Id) || !hasSavedState;
      selectedPosters[idx] = isChecked;
      const cb = _("input", {
        type: "checkbox",
        "data-poster": idx,
        event: {
          change: (e) => {
            selectedPosters[idx] = e.target.checked;
            refreshLeaderOptions();
            cleanupAdvancedReferences();
            refreshAdvancedOptions();
            updateEstimate();
            saveState();
          },
        },
      });
      cb.checked = isChecked;
      const icon = p.iconNode.cloneNode(true);
      icon.style.cursor = "pointer";
      icon.addEventListener("click", () => {
        cb.checked = !cb.checked;
        selectedPosters[idx] = cb.checked;
        refreshLeaderOptions();
        cleanupAdvancedReferences();
        refreshAdvancedOptions();
        updateEstimate();
        saveState();
      });
      const wrapper = _(
        "span",
        {
          style: {
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            fontSize: "10px",
          },
        },
        [icon, cb],
      );
      posterGrid.appendChild(wrapper);
    });
    posterSection.appendChild(posterGrid);

    const accSection = _("div", { style: { marginBottom: "15px" } });
    accSection.appendChild(
      _("div", { style: { fontWeight: "bold", marginBottom: "8px" } }, [
        _("text", "候选饰品"),
      ]),
    );
    const accSelectAll = _("input", {
      type: "checkbox",
      event: {
        change: (e) => {
          accSection
            .querySelectorAll("input[type=checkbox][data-acc]")
            .forEach((cb) => {
              cb.checked = e.target.checked;
              selectedAccs[cb.getAttribute("data-acc")] = e.target.checked;
            });
          cleanupAdvancedReferences();
          refreshAdvancedOptions();
          updateEstimate();
          saveState();
        },
      },
    });
    accSection.appendChild(
      _("label", {}, [accSelectAll, _("text", " 全选/全不选")]),
    );
    const accGrid = _("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(8, 1fr)",
        gap: "4px",
        maxHeight: "280px",
        overflowY: "auto",
        border: "1px solid #ddd",
        padding: "8px",
      },
    });
    accessories.forEach((a, idx) => {
      const isChecked =
        (savedAccs.has(idx) && savedAccs.get(idx) === a.data.Id) ||
        !hasSavedState;
      selectedAccs[idx] = isChecked;
      const cb = _("input", {
        type: "checkbox",
        "data-acc": idx,
        event: {
          change: (e) => {
            selectedAccs[idx] = e.target.checked;
            cleanupAdvancedReferences();
            refreshAdvancedOptions();
            updateEstimate();
            saveState();
          },
        },
      });
      cb.checked = isChecked;
      const icon = a.iconNode.cloneNode(true);
      icon.style.cursor = "pointer";
      icon.addEventListener("click", () => {
        cb.checked = !cb.checked;
        selectedAccs[idx] = cb.checked;
        cleanupAdvancedReferences();
        refreshAdvancedOptions();
        updateEstimate();
        saveState();
      });
      const wrapper = _(
        "span",
        {
          style: {
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            fontSize: "10px",
          },
        },
        [icon, cb],
      );
      accGrid.appendChild(wrapper);
    });
    accSection.appendChild(accGrid);

    refreshLeaderOptions();
    if (savedLeaderId != null) {
      const li = characters.findIndex((c) => c.data.Id === savedLeaderId);
      if (li >= 0 && selectedChars[li]) {
        leaderIdx = li;
        if (leaderSelect.querySelector(`option[value="${li}"]`)) {
          leaderSelect.value = li;
        }
      }
    }
    if (savedLeaderPosterId != null) {
      const pi = posters.findIndex((p) => p.data.Id === savedLeaderPosterId);
      if (pi >= 0 && selectedPosters[pi]) {
        leaderPosterIdx = pi;
        if (leaderPosterSelect.querySelector(`option[value="${pi}"]`)) {
          leaderPosterSelect.value = pi;
        }
      }
    } else if (hasSavedState && savedLeaderPosterId === null) {
      leaderPosterSelect.value = -1;
      leaderPosterIdx = -1;
    }
    const parsedLeaderIdx = parseInt(leaderSelect.value);
    const parsedLeaderPosterIdx = parseInt(leaderPosterSelect.value);
    leaderIdx = Number.isInteger(parsedLeaderIdx) ? parsedLeaderIdx : -1;
    leaderPosterIdx = Number.isInteger(parsedLeaderPosterIdx)
      ? parsedLeaderPosterIdx
      : -1;

    leaderSelect.addEventListener("change", (e) => {
      leaderIdx = parseInt(e.target.value);
      updateEstimate();
      saveState();
    });
    leaderPosterSelect.addEventListener("change", (e) => {
      leaderPosterIdx = parseInt(e.target.value);
      updateEstimate();
      saveState();
    });
    cleanupAdvancedReferences();
    refreshAdvancedOptions();
    updateAutoPartyMode();

    const progressSection = _("div", {
      style: { display: "none", marginBottom: "15px" },
    });
    const progressBar = _("div", {
      style: {
        width: "100%",
        height: "20px",
        background: "#e0e0e0",
        borderRadius: "4px",
        overflow: "hidden",
      },
    });
    const progressFill = _("div", {
      style: {
        width: "0%",
        height: "100%",
        background: "#4caf50",
        transition: "width 0.1s",
      },
    });
    progressBar.appendChild(progressFill);
    const progressText = _("div", {
      style: { textAlign: "center", marginTop: "4px" },
    });
    progressSection.appendChild(progressBar);
    progressSection.appendChild(progressText);

    const resultSection = _("div", {
      style: {
        display: "none",
        marginBottom: "15px",
        padding: "10px",
        background: "#e8f5e9",
        borderRadius: "4px",
      },
    });

    const clearAutoPartyCalculationCache = () => {
      stopAutoPartyProcesses(false);
      resultSection.style.display = "none";
      resultSection.innerHTML = "";
      progressFill.style.width = "0%";
      progressText.textContent = "";
    };

    const btnRow = _("div", {
      style: { display: "flex", justifyContent: "flex-end", gap: "10px" },
    });
    const cancelBtn = _("input", {
      type: "button",
      value: "取消",
      event: {
        click: () => {
          stopAutoPartyProcesses();
          overlay.remove();
        },
      },
    });
    const startBtn = _("input", {
      type: "button",
      value: "开始计算",
      disabled: true,
      event: {
        click: async () => {
          if (isAutoPartyCalculating) return;
          const validation = getAutoPartyValidation();
          if (validation.errors.length > 0) {
            updateEstimate();
            return;
          }
          isAutoPartyCalculating = true;
          isAutoPartyCancelled = false;
          hasCompletedAutoPartyRun = false;
          updateStartBtnState();
          clearAutoPartyCalculationCache();
          updateEstimate();
          cancelBtn.value = "关闭";
          progressSection.style.display = "";

          const selCharIndexes = Array.from(selectedChars)
            .map((v, i) => (v ? i : -1))
            .filter((i) => i >= 0);
          const selPosterIndexes = Array.from(selectedPosters)
            .map((v, i) => (v ? i : -1))
            .filter((i) => i >= 0);
          const selAccessoryIndexes = Array.from(selectedAccs)
            .map((v, i) => (v ? i : -1))
            .filter((i) => i >= 0);
          const selChars = selCharIndexes.map((i) => characters[i]);
          const selPosters = selPosterIndexes.map((i) => posters[i]);
          const selAccs = selAccessoryIndexes.map((i) => accessories[i]);
          const activeLeaderIdx =
            autoPartyMode === "advanced" ? advancedLeaderIdx : leaderIdx;
          const activeLeaderPosterIdx =
            autoPartyMode === "advanced"
              ? advancedLeaderPosterIdx
              : leaderPosterIdx;
          const leader = characters[activeLeaderIdx];
          const leaderPoster =
            activeLeaderPosterIdx < 0
              ? null
              : posters[activeLeaderPosterIdx];
          const mapSlotIndexes = (slots, selectedIndexes) =>
            slots.map((idx) => (idx < 0 ? -1 : selectedIndexes.indexOf(idx)));
          let constraints = {
            mode: "basic",
            leaderPosition: -1,
            characterSlots: [-1, -1, -1, -1, -1],
            characterSlotFixed: [true, true, true, true, true],
            posterSlots: [-1, -1, -1, -1, -1],
            accessorySlots: [-1, -1, -1, -1, -1],
          };
          if (autoPartyMode === "advanced") {
            constraints = {
              mode: "advanced",
              leaderPosition: advancedLeaderPosition,
              characterSlots: mapSlotIndexes(
                advancedCharacterSlots,
                selCharIndexes,
              ),
              characterSlotFixed: advancedCharacterSlotFixed.slice(),
              posterSlots: mapSlotIndexes(
                advancedPosterSlots,
                selPosterIndexes,
              ),
              accessorySlots: mapSlotIndexes(
                advancedAccessorySlots,
                selAccessoryIndexes,
              ),
            };
          }

          console.log(
            JSON.stringify(
              {
                characters: selChars.map((c) => ({
                  id: c.Id,
                  name: c.fullCardName,
                })),
                posters: selPosters.map((p) => ({
                  id: p.id,
                  name: p.fullPosterName,
                })),
                accessories: selAccs.map((a) => ({
                  id: a.id,
                  name: a.fullAccessoryName,
                })),
                constraints,
              },
              null,
              2,
            ),
          );

          try {
            let result;

            if (pythonCheckbox.checked) {
              // ===== Python 脚本配队流程 =====
              if (typeof window.electronAPI === "undefined") {
                resultSection.style.display = "";
                resultSection.innerHTML =
                  '<div style="color:red">Python 脚本配队仅在 Electron 环境下可用</div>';
                startBtn.disabled = false;
                return;
              }
              const pythonPlan = createPythonAutoPartyPlan({
                mode: autoPartyMode,
                characters: selChars,
                posters: selPosters,
                leaderIdx: selChars.indexOf(leader),
                leaderPosterIdx: leaderPoster
                  ? selPosters.indexOf(leaderPoster)
                  : -1,
                constraints,
              });
              if (pythonPlan.blockingErrors.length > 0) {
                throw new Error(pythonPlan.blockingErrors.join("；"));
              }
              progressText.textContent = "Python 脚本计算中...";
              progressFill.style.width = "0%";

              const userData = {
                characters: selChars.map((c) => [
                  c.Id,
                  c.lvl,
                  c.awaken ? 1 : 0,
                ]),
                posters: selPosters.map((p) => [p.id, p.level, p.release || 0]),
                accessories: selAccs.map((a) => [a.id, a.level]),
                characters_data: Object.values(GameDb.Character),
                posters_ability_data: Object.values(GameDb.PosterAbility),
                effects_data: Object.values(GameDb.Effect),
              };

              // 流式接收 + 分批处理
              let overallBest = 0;
              const PY_BATCH_SIZE = 100000;
              const pyAccum = [];
              const batchQueue = [];
              let pyTotalReceived = 0;
              let resolveQueue = null;
              let currentBatch = 0;
              const workerCount = parseInt(workerInput.value) || maxCores;
              const saThreshold = parseInt(saThresholdInput.value) || 1;
              try {
                localStorage.setItem("autoPartySAThreshold", saThreshold);
              } catch {
                // Keep the in-memory value when localStorage is unavailable.
              }

              result = await root.handleAutoPartyPythonStream({
                selChars,
                selPosters,
                selAccs,
                leader,
                leaderPoster,
                rowConstraints: pythonPlan.rowConstraints,
                workerCount,
                saThreshold,
                batchReader: async (processBatch) => {
                  let finReceived = false;
                  let pythonOutputPaused = false;

                  const wakeBatchReader = () => {
                    if (resolveQueue) {
                      resolveQueue();
                      resolveQueue = null;
                    }
                  };

                  const queueAccumulatedBatch = (force = false) => {
                    if (isAutoPartyCancelled) return false;
                    if (pyAccum.length === 0) return false;
                    if (!force && batchQueue.length > 0) return false;
                    batchQueue.push(pyAccum.splice(0, pyAccum.length));
                    wakeBatchReader();
                    return true;
                  };

                  const pausePythonOutput = () => {
                    if (
                      pythonOutputPaused ||
                      !window.electronAPI.pauseFormation
                    )
                      return;
                    pythonOutputPaused = true;
                    window.electronAPI.pauseFormation().catch((err) => {
                      console.warn(
                        "[PartyManager] pauseFormation failed:",
                        err,
                      );
                    });
                  };

                  const resumePythonOutput = async () => {
                    if (
                      !pythonOutputPaused ||
                      finReceived ||
                      !window.electronAPI.resumeFormation
                    )
                      return;
                    pythonOutputPaused = false;
                    try {
                      await window.electronAPI.resumeFormation();
                    } catch (err) {
                      console.warn(
                        "[PartyManager] resumeFormation failed:",
                        err,
                      );
                    }
                  };

                  const sendFIN = () => {
                    if (finReceived) return;
                    finReceived = true;
                    console.log(
                      `[PartyManager] sendFIN: totalReceived=${pyTotalReceived}, pyAccum=${pyAccum.length}`,
                    );
                    queueAccumulatedBatch(true);
                    batchQueue.push(null);
                    wakeBatchReader();
                  };

                  const cleanupPythonQueues = () => {
                    pyAccum.length = 0;
                    batchQueue.length = 0;
                    batchQueue.push(null);
                    wakeBatchReader();
                  };
                  activePythonRunCleanup = cleanupPythonQueues;

                  try {
                    window.electronAPI.onFormationResult((msg) => {
                      if (isAutoPartyCancelled) return;
                      if (msg.FIN) {
                        console.log(`[PartyManager] FIN via IPC`);
                        sendFIN();
                      } else if (msg.error) {
                        console.error(`[PartyManager] Python error:`, msg.error);
                        sendFIN();
                      } else if (!msg.error) {
                        pyAccum.push(msg);
                        pyTotalReceived++;
                        if (pyAccum.length >= PY_BATCH_SIZE) {
                          pausePythonOutput();
                          queueAccumulatedBatch();
                        }
                      }
                      if (pyTotalReceived % 5000 === 0) {
                        progressText.textContent = `Python 接收中: ${pyTotalReceived.toLocaleString()} 个候选...`;
                      }
                    });

                    // runFormation 的 Promise 在进程关闭时 resolve，作为 FIN 兜底
                    console.groupCollapsed("[PartyManager] Python runFormation input");
                    console.log("counts:", {
                      characters: userData.characters.length,
                      posters: userData.posters.length,
                      accessories: userData.accessories.length,
                      characters_data: userData.characters_data.length,
                      posters_ability_data: userData.posters_ability_data.length,
                      effects_data: userData.effects_data.length,
                    });
                    console.log("userData:", userData);
                    console.log(
                      "formationOptions:",
                      pythonPlan.formationOptions,
                    );
                    console.groupEnd();

                    const formationRequest = pythonPlan.formationOptions
                      ? window.electronAPI.runFormation(
                        userData,
                        pythonPlan.formationOptions,
                      )
                      : window.electronAPI.runFormation(userData);
                    const formationDone = formationRequest
                      .then(() => {
                        console.log(
                          `[PartyManager] Python process closed, finReceived=${finReceived}`,
                        );
                        sendFIN();
                      })
                      .catch((err) => {
                        console.error(
                          `[PartyManager] Python process error:`,
                          err,
                        );
                        sendFIN();
                      });

                    while (true) {
                      while (batchQueue.length === 0) {
                        await new Promise((r) => {
                          resolveQueue = r;
                        });
                      }
                      const batch = batchQueue.shift();
                      if (batch === null || isAutoPartyCancelled) break;
                      currentBatch++;
                      console.log(
                        `[PartyManager] 批次 ${currentBatch}: 候选数=${batch.length}`,
                      );
                      await processBatch(batch);
                      if (batchQueue.length === 0) {
                        if (pyAccum.length >= PY_BATCH_SIZE) {
                          pausePythonOutput();
                          queueAccumulatedBatch();
                        } else {
                          await resumePythonOutput();
                        }
                      }
                    }

                    await formationDone;
                    if (!isAutoPartyCancelled) {
                      console.log(
                        `[PartyManager] Python 流式处理完成: 总候选数=${pyTotalReceived}, 总批次=${currentBatch}`,
                      );
                    }
                  } finally {
                    pyAccum.length = 0;
                    batchQueue.length = 0;
                    resolveQueue = null;
                    if (activePythonRunCleanup === cleanupPythonQueues) {
                      activePythonRunCleanup = null;
                    }
                    window.electronAPI.removeFormationResultListener();
                  }
                },
                onProgress: (progress) => {
                  const {
                    phase,
                    phase1Current,
                    phase1Total,
                    phase2Current,
                    phase2Total,
                    bestScore,
                  } = progress;
                  if (bestScore > 0 && bestScore > (overallBest || 0))
                    overallBest = bestScore;
                  if (phase === "scoring" && phase2Total > 0) {
                    const pct = ((phase2Current / phase2Total) * 100).toFixed(
                      1,
                    );
                    progressFill.style.width = pct + "%";
                    const estTotal = Math.max(
                      currentBatch,
                      Math.ceil(pyTotalReceived / PY_BATCH_SIZE),
                    );
                    progressText.textContent = `评分中: ${phase2Current.toLocaleString()} / ${phase2Total.toLocaleString()} 候选 (${pct}%) - 批次 ${currentBatch}/${estTotal} - 最高分: ${overallBest}`;
                  } else if (phase1Total > 0) {
                    const pct = ((phase1Current / phase1Total) * 100).toFixed(
                      1,
                    );
                    progressFill.style.width = pct + "%";
                    progressText.textContent = `筛选中: ${phase1Current.toLocaleString()} / ${phase1Total.toLocaleString()} 组合 (${pct}%)`;
                  }
                },
              });
            } else {
              // ===== 原有 Worker 配队流程 =====
              const useWebGPU = gpuCheckbox.checked && !gpuCheckbox.disabled;
              const workerCount = clampWorkerCount(workerInput.value);
              workerInput.value = workerCount;
              const saThreshold = parseInt(saThresholdInput.value) || 1;
              try {
                localStorage.setItem("autoPartyWorkerCount", workerCount);
                localStorage.setItem("autoPartySAThreshold", saThreshold);
              } catch {
                // Keep the in-memory values when localStorage is unavailable.
              }
              result = await root.handleAutoParty({
                selChars,
                selPosters,
                selAccs,
                leader,
                leaderPoster,
                constraints,
                searchMode: "precise",
                useWebGPU,
                workerCount,
                saThreshold,
                onTotalReady: (actualTotal, isGpuFiltered) => {
                  const source = isGpuFiltered
                    ? "WebGPU 筛选后"
                    : "约束规划后";
                  estText.textContent = `实际遍历次数: ${actualTotal.toLocaleString()}（${source}）`;
                },
                onProgress: (progress) => {
                  const {
                    phase,
                    phase1Current,
                    phase1Total,
                    phase2Current,
                    phase2Total,
                    bestScore,
                  } = progress;
                  if (phase === "counting") {
                    const pct =
                      phase1Total > 0
                        ? ((phase1Current / phase1Total) * 100).toFixed(1)
                        : "0.0";
                    progressFill.style.width = pct + "%";
                    progressText.textContent = `筛选中: ${phase1Current.toLocaleString()} / ${phase1Total.toLocaleString()} 组合 (${pct}%)`;
                  } else {
                    if (phase1Total > 0) {
                      // CPU 模式：显示两阶段筛选结果
                      estText.textContent = `筛选完成: ${phase1Total.toLocaleString()} 个组合 → ${phase2Total.toLocaleString()} 个候选`;
                    }
                    // GPU 模式时 onTotalReady 已设置 estText，不覆盖
                    const pct =
                      phase2Total > 0
                        ? ((phase2Current / phase2Total) * 100).toFixed(1)
                        : "0.0";
                    const overallPct =
                      phase1Total + phase2Total > 0
                        ? (((phase1Current + phase2Current) /
                            (phase1Total + phase2Total)) *
                            100).toFixed(1)
                        : "0.0";
                    progressFill.style.width = overallPct + "%";
                    progressText.textContent = `评分中: ${phase2Current.toLocaleString()} / ${phase2Total.toLocaleString()} 候选 (${pct}%) - 当前最高分: ${bestScore}`;
                  }
                },
              });
            }

            if (isAutoPartyCancelled) return;

            if (result) {
              resultSection.style.display = "";
              resultSection.innerHTML = "";
              resultSection.appendChild(
                _("div", { style: { fontWeight: "bold" } }, [
                  _("text", `最优配队 (分数: ${result.bestScore})`),
                ]),
              );

              // 显示耗时信息
              const formatDuration = (ms) => {
                if (ms < 1000) return `${ms.toFixed(0)}ms`;
                if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
                return `${Math.floor(ms / 60000)}m${((ms % 60000) / 1000).toFixed(0)}s`;
              };
              const timeInfo = [];
              if (result.filterDuration > 0)
                timeInfo.push(`筛选: ${formatDuration(result.filterDuration)}`);
              if (result.scoringDuration > 0)
                timeInfo.push(
                  `评分: ${formatDuration(result.scoringDuration)}`,
                );
              if (timeInfo.length > 0) {
                resultSection.appendChild(
                  _(
                    "div",
                    {
                      style: {
                        fontSize: "12px",
                        color: "#888",
                        marginTop: "4px",
                      },
                    },
                    [_("text", timeInfo.join(" | "))],
                  ),
                );
              }
              const btnApply = _("input", {
                type: "button",
                value: "应用到当前编队",
                style: { marginTop: "8px" },
                event: {
                  click: () => {
                    const party = this.currentParty;
                    result.characters.forEach((c, i) => {
                      party.characters[i] = c;
                    });
                    result.posters.forEach((p, i) => {
                      party.posters[i] = p;
                    });
                    result.accessories.forEach((a, i) => {
                      party.accessories[i] = a;
                    });
                    party.leader = leader;
                    root.update({ party: true });
                    overlay.remove();
                  },
                },
              });
              resultSection.appendChild(btnApply);
            } else {
              resultSection.style.display = "";
              resultSection.innerHTML = "<div>未找到有效配队</div>";
            }
          } catch (e) {
            console.error(e);
            resultSection.style.display = "";
            resultSection.innerHTML = `<div style="color:red">计算出错: ${e.message}</div>`;
          } finally {
            isAutoPartyCalculating = false;
            hasCompletedAutoPartyRun = true;
            updateStartBtnState();
          }
        },
      },
    });
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(startBtn);

    dialog.appendChild(title);
    dialog.appendChild(closeBtn);
    dialog.appendChild(modeSection);
    dialog.appendChild(leaderSection);
    dialog.appendChild(advancedSection);
    dialog.appendChild(charSection);
    dialog.appendChild(posterSection);
    dialog.appendChild(accSection);
    dialog.appendChild(estInfo);
    dialog.appendChild(workerSection);
    dialog.appendChild(saThresholdSection);
    dialog.appendChild(gpuSection);
    dialog.appendChild(pythonSection);
    dialog.appendChild(progressSection);
    dialog.appendChild(resultSection);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    overlay.appendChild(hoverPreviewButton);
    updateAutoPartyMode();
    updateEstimate();
    saveState();
    document.body.appendChild(overlay);
  }

  toJSON() {
    return [this.parties.map((i) => i.toJSON()), this.currentSelection];
  }
  static fromJSON(data) {
    const manager = new PartyManager();
    manager.parties = data[0].map((i) => Party.fromJSON(i));
    manager.currentSelection = data[1];
    return manager;
  }
}
