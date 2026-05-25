import Party from "./Party";
import ConstText from "../db/ConstText";

import _ from "../createElement";
import removeAllChilds from "../removeAllChilds";

// import {Swappable} from '@shopify/draggable';

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
        maxHeight: "80vh",
        overflowY: "auto",
        minWidth: "400px",
        zIndex: 10001,
      },
    });

    const selectedChars = [];
    const selectedPosters = [];
    const selectedAccs = [];
    let leaderIdx = 0;
    let leaderPosterIdx = -1;

    const title = _("h3", { style: { marginTop: 0 } }, [
      _("text", "自动配队 - 选择候选项"),
    ]);

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
    refreshLeaderOptions();

    leaderSection.appendChild(
      _("div", {}, [_("text", "队长: "), leaderSelect]),
    );
    leaderSection.appendChild(
      _("div", { style: { marginTop: "8px" } }, [
        _("text", "队长海报: "),
        leaderPosterSelect,
      ]),
    );

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
        },
      },
    });
    charSection.appendChild(
      _("label", {}, [charSelectAll, _("text", " 全选/全不选")]),
    );
    const charGrid = _("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: "4px",
        maxHeight: "200px",
        overflowY: "auto",
        border: "1px solid #ddd",
        padding: "8px",
      },
    });
    characters.forEach((c, idx) => {
      const cb = _("input", {
        type: "checkbox",
        checked: true,
        "data-chara": idx,
        event: {
          change: (e) => {
            selectedChars[idx] = e.target.checked;
            refreshLeaderOptions();
          },
        },
      });
      const icon = c.iconNode.cloneNode(true);
      icon.style.cursor = "pointer";
      icon.addEventListener("click", () => {
        cb.checked = !cb.checked;
        selectedChars[idx] = cb.checked;
        refreshLeaderOptions();
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
      selectedChars[idx] = true;
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
        },
      },
    });
    posterSection.appendChild(
      _("label", {}, [posterSelectAll, _("text", " 全选/全不选")]),
    );
    const posterGrid = _("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: "4px",
        maxHeight: "200px",
        overflowY: "auto",
        border: "1px solid #ddd",
        padding: "8px",
      },
    });
    posters.forEach((p, idx) => {
      const cb = _("input", {
        type: "checkbox",
        checked: true,
        "data-poster": idx,
        event: {
          change: (e) => {
            selectedPosters[idx] = e.target.checked;
            refreshLeaderOptions();
          },
        },
      });
      const icon = p.iconNode.cloneNode(true);
      icon.style.cursor = "pointer";
      icon.addEventListener("click", () => {
        cb.checked = !cb.checked;
        selectedPosters[idx] = cb.checked;
        refreshLeaderOptions();
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
      selectedPosters[idx] = true;
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
        },
      },
    });
    accSection.appendChild(
      _("label", {}, [accSelectAll, _("text", " 全选/全不选")]),
    );
    const accGrid = _("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        gap: "4px",
        maxHeight: "200px",
        overflowY: "auto",
        border: "1px solid #ddd",
        padding: "8px",
      },
    });
    accessories.forEach((a, idx) => {
      const cb = _("input", {
        type: "checkbox",
        checked: true,
        "data-acc": idx,
        event: {
          change: (e) => {
            selectedAccs[idx] = e.target.checked;
          },
        },
      });
      const icon = a.iconNode.cloneNode(true);
      icon.style.cursor = "pointer";
      icon.addEventListener("click", () => {
        cb.checked = !cb.checked;
        selectedAccs[idx] = cb.checked;
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
      selectedAccs[idx] = true;
    });
    accSection.appendChild(accGrid);

    const estInfo = _("div", {
      style: {
        marginBottom: "15px",
        padding: "10px",
        background: "#fff3cd",
        borderRadius: "4px",
      },
    });
    const estText = _("span", {}, [_("text", "预估遍历次数: 计算中...")]);
    estInfo.appendChild(estText);

    const updateEstimate = () => {
      const charCount = Array.from(selectedChars).filter(Boolean).length;
      const posterCount = Array.from(selectedPosters).filter(Boolean).length;
      const accCount = Array.from(selectedAccs).filter(Boolean).length;
      const comb = (n, k) =>
        n < k
          ? 0
          : Array.from({ length: k }, (_, i) => n - i).reduce(
              (a, b) => a * b,
              0,
            ) /
            Array.from({ length: k }, (_, i) => i + 1).reduce(
              (a, b) => a * b,
              0,
            );
      const charComb = comb(charCount - 1, 4);
      const posterComb =
        leaderPosterIdx === -1
          ? comb(posterCount - 1, 4)
          : comb(posterCount, 4);
      const accComb = comb(accCount, 5);
      const total = charComb * posterComb * accComb;
      estText.textContent = `预估遍历次数: ${total.toLocaleString()} (角色${charComb} × 海报${posterComb} × 饰品${accComb})`;
    };
    updateEstimate();

    leaderSelect.addEventListener("change", (e) => {
      leaderIdx = parseInt(e.target.value);
      updateEstimate();
    });
    leaderPosterSelect.addEventListener("change", (e) => {
      leaderPosterIdx = parseInt(e.target.value);
      updateEstimate();
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

    const btnRow = _("div", {
      style: { display: "flex", justifyContent: "flex-end", gap: "10px" },
    });
    const cancelBtn = _("input", {
      type: "button",
      value: "取消",
      event: {
        click: () => {
          overlay.remove();
        },
      },
    });
    const startBtn = _("input", {
      type: "button",
      value: "开始计算",
      event: {
        click: async () => {
          startBtn.disabled = true;
          cancelBtn.value = "关闭";
          progressSection.style.display = "";
          resultSection.style.display = "none";

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

          try {
            const result = await root.handleAutoParty({
              selChars,
              selPosters,
              selAccs,
              leader,
              leaderPoster,
              onProgress: (current, total, bestScore) => {
                const pct = ((current / total) * 100).toFixed(1);
                progressFill.style.width = pct + "%";
                progressText.textContent = `${current.toLocaleString()} / ${total.toLocaleString()} (${pct}%) - 当前最高分: ${bestScore}`;
              },
            });

            if (result) {
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

              resultSection.style.display = "";
              resultSection.innerHTML = "";
              resultSection.appendChild(
                _("div", { style: { fontWeight: "bold" } }, [
                  _("text", `最优配队 (分数: ${result.bestScore})`),
                ]),
              );
              const btnApply = _("input", {
                type: "button",
                value: "应用到当前编队",
                style: { marginTop: "8px" },
                event: {
                  click: () => {
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
          }
        },
      },
    });
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(startBtn);

    dialog.appendChild(title);
    dialog.appendChild(leaderSection);
    dialog.appendChild(charSection);
    dialog.appendChild(posterSection);
    dialog.appendChild(accSection);
    dialog.appendChild(estInfo);
    dialog.appendChild(progressSection);
    dialog.appendChild(resultSection);
    dialog.appendChild(btnRow);
    overlay.appendChild(dialog);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
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
