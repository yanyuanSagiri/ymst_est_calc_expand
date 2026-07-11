import Party from "./Party";
import ConstText from "../db/ConstText";
import GameDb from "../db/GameDb";

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
      },
    });

    const savedChars = new Set();
    const savedPosters = new Set();
    const savedAccs = new Map();
    let savedLeaderId = null;
    let savedLeaderPosterId = null;

    try {
      const raw = localStorage.getItem("autoPartyState");
      if (raw) {
        const data = JSON.parse(raw);
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
      }
    } catch (_) {}

    const selectedChars = [];
    const selectedPosters = [];
    const selectedAccs = [];
    let leaderIdx = 0;
    let leaderPosterIdx = -1;
    let isAutoPartyCalculating = false;
    let hasCompletedAutoPartyRun = false;
    let isAutoPartyCancelled = false;
    let activePythonRunCleanup = null;

    const saveState = () => {
      const data = {
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
      };
      try {
        localStorage.setItem("autoPartyState", JSON.stringify(data));
      } catch (_) {}
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
        _("text", "队长设置"),
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
          } catch {}
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
    const perm = (n, k) =>
      n < k
        ? 0
        : Array.from({ length: k }, (_, i) => n - i).reduce((a, b) => a * b, 1);

    const updateEstimate = () => {
      const charCount = selectedChars.filter(Boolean).length;
      const posterCount = selectedPosters.filter(Boolean).length;
      const accCount = selectedAccs.filter(Boolean).length;
      const posterPool = leaderPosterIdx >= 0 ? posterCount - 1 : posterCount;
      const charComb = perm(charCount, 5);
      const posterSlots = leaderPosterIdx === -1 ? 5 : 4;
      const posterComb = perm(posterPool, posterSlots);
      const accComb = perm(accCount, 5);
      const total = charComb * posterComb * accComb;
      estText.textContent = `预估遍历次数: ${total.toLocaleString()} (角色${charComb} × 海报${posterComb} × 饰品${accComb})`;
      updateStartBtnState();
    };

    const updateStartBtnState = () => {
      const charCount = selectedChars.filter(Boolean).length;
      const posterCount = selectedPosters.filter(Boolean).length;
      const accCount = selectedAccs.filter(Boolean).length;
      const missing = [];
      if (charCount < 5) missing.push(`角色(${charCount}/5)`);
      if (posterCount < 5) missing.push(`海报(${posterCount}/5)`);
      if (accCount < 5) missing.push(`饰品(${accCount}/5)`);
      if (isAutoPartyCalculating) {
        startBtn.disabled = true;
        startBtn.value = "计算中...";
        startBtn.title = "";
        return;
      }
      startBtn.value = hasCompletedAutoPartyRun ? "重新计算" : "开始计算";
      startBtn.disabled = missing.length > 0;
      startBtn.title =
        missing.length > 0 ? `还需选择: ${missing.join("、")}` : "";
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
      const isChecked = savedChars.has(c.data.Id) || savedChars.size === 0;
      selectedChars[idx] = isChecked;
      const cb = _("input", {
        type: "checkbox",
        "data-chara": idx,
        event: {
          change: (e) => {
            selectedChars[idx] = e.target.checked;
            refreshLeaderOptions();
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
      const isChecked = savedPosters.has(p.data.Id) || savedPosters.size === 0;
      selectedPosters[idx] = isChecked;
      const cb = _("input", {
        type: "checkbox",
        "data-poster": idx,
        event: {
          change: (e) => {
            selectedPosters[idx] = e.target.checked;
            refreshLeaderOptions();
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
        savedAccs.size === 0;
      selectedAccs[idx] = isChecked;
      const cb = _("input", {
        type: "checkbox",
        "data-acc": idx,
        event: {
          change: (e) => {
            selectedAccs[idx] = e.target.checked;
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
    } else if (savedChars.size > 0 && savedLeaderPosterId === null) {
      leaderPosterSelect.value = -1;
      leaderPosterIdx = -1;
    }
    leaderIdx = parseInt(leaderSelect.value) || 0;
    leaderPosterIdx = parseInt(leaderPosterSelect.value) || -1;

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
          isAutoPartyCalculating = true;
          isAutoPartyCancelled = false;
          hasCompletedAutoPartyRun = false;
          updateStartBtnState();
          clearAutoPartyCalculationCache();
          updateEstimate();
          cancelBtn.value = "关闭";
          progressSection.style.display = "";

          const selChars = Array.from(selectedChars)
            .map((v, i) => (v ? i : -1))
            .filter((i) => i >= 0)
            .map((i) => characters[i]);
          const selPosters = Array.from(selectedPosters)
            .map((v, i) => (v ? i : -1))
            .filter((i) => i >= 0)
            .map((i) => posters[i]);
          const selAccs = Array.from(selectedAccs)
            .map((v, i) => (v ? i : -1))
            .filter((i) => i >= 0)
            .map((i) => accessories[i]);
          const leader = characters[leaderIdx];
          const leaderPoster =
            leaderPosterIdx === -1 ? null : posters[leaderPosterIdx];

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
              } catch {}

              result = await root.handleAutoPartyPythonStream({
                selChars,
                selPosters,
                selAccs,
                leader,
                leaderPoster,
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
                    console.groupEnd();

                    const formationDone = window.electronAPI
                      .runFormation(userData)
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
              } catch {}
              result = await root.handleAutoParty({
                selChars,
                selPosters,
                selAccs,
                leader,
                leaderPoster,
                searchMode: "precise",
                useWebGPU,
                workerCount,
                saThreshold,
                onTotalReady: (actualTotal, isGpuFiltered) => {
                  if (isGpuFiltered) {
                    estText.textContent = `实际遍历次数: ${actualTotal.toLocaleString()}（WebGPU 筛选后）`;
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
                        ? (
                            ((phase1Current + phase2Current) /
                              (phase1Total + phase2Total)) *
                            100
                          ).toFixed(1)
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
    dialog.appendChild(leaderSection);
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
    updateEstimate();
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
