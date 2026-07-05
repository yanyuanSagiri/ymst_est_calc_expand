import Party from "./Party";
import ConstText from "../db/ConstText";
import GameDb from "../db/GameDb";

import _ from "../createElement";
import removeAllChilds from "../removeAllChilds";

export default class TripleCastManager {
  constructor() {
    this.axes = [
      {
        notationId: 0,
        party: new Party(),
        parties: [],
        currentPartyIdx: 0,
        selectedPartyKey: "",
      },
      {
        notationId: 0,
        party: new Party(),
        parties: [],
        currentPartyIdx: 0,
        selectedPartyKey: "",
      },
      {
        notationId: 0,
        party: new Party(),
        parties: [],
        currentPartyIdx: 0,
        selectedPartyKey: "",
      },
    ];
    this.axes[0].party.name = ConstText.get("PARTY_DEFAULT_NAME") + " 1";
    this.axes[1].party.name = ConstText.get("PARTY_DEFAULT_NAME") + " 2";
    this.axes[2].party.name = ConstText.get("PARTY_DEFAULT_NAME") + " 3";
    this.axes.forEach((axis) => axis.parties.push(axis.party));
    this.currentPicking = null;
    this.swappables = [];
  }

  getParty(axisIdx) {
    return this.axes[axisIdx].party;
  }

  getNotationId(axisIdx) {
    return this.axes[axisIdx].notationId;
  }

  init(container) {
    this.container = container;
    removeAllChilds(container);

    this.tripleCastSelect = null;
    this.axisNotationLabels = [];
    this.senseBoxes = [];
    this.partySelects = [];
    this.partyNameInputs = [];
    this.leaderSelections = [];
    this.charaSlots = [];
    this.posterSlots = [];
    this.accessorySlots = [];
    this.calcResults = [];

    this.swappables.forEach((s) => s && s.destroy());
    this.swappables = [];

    const tripleCastSelect = _("select", {
      event: {
        change: (e) => {
          this.setTripleCastNotation(e.target.value | 0);
          for (let i = 0; i < 3; i++) {
            this.renderAxisSenseNote(i);
          }
          try {
            root.update({ party: true });
          } catch (err) {
            console.error(err);
          }
        },
      },
    });
    this.tripleCastSelect = tripleCastSelect;

    container.appendChild(
      _("div", { style: { marginBottom: "8px" } }, [
        (this.highEndFilter = _("input", { type: "checkbox" })),
        _("text", "查询列表仅显示：四星角色/SSR海报/Lv10饰品"),
        _("span", { style: { margin: "0 8px" } }),
        _("text", "公演日期: "),
        tripleCastSelect,
        _("span", { style: { margin: "0 8px" } }),
        _(
          "button",
          {
            event: {
              click: () => {
                for (let i = 0; i < 3; i++) {
                  const party = this.axes[i].party;
                  party.characters = Array(5).fill(null);
                  party.posters = Array(5).fill(null);
                  party.accessories = Array(5).fill(null);
                  party.leader = null;
                }
                this.update();
                try {
                  root.update({ party: true });
                } catch (err) {
                  console.error(err);
                }
              },
            },
          },
          [_("text", "清空全部编队")],
        ),
      ]),
    );

    const axisWrapper = _("div", { style: { display: "flex", gap: "8px" } });
    container.appendChild(axisWrapper);

    for (let axisIdx = 0; axisIdx < 3; axisIdx++) {
      const axisSection = _("div", {
        className: "triple-axis-section",
        style: { flex: 1, minWidth: "300px", padding: "0 4px" },
      });

      const axisNotationLabel = _("span", {
        style: { marginLeft: "4px", fontSize: "12px", color: "#666" },
      });
      this.axisNotationLabels.push(axisNotationLabel);

      // const partyNameInput = _("input", {
      //   type: "text",
      //   value: this.axes[axisIdx].party.name,
      //   event: {
      //     blur: (e) => {
      //       this.axes[axisIdx].party.name = e.target.value;
      //     },
      //   },
      // });
      // this.partyNameInputs.push(partyNameInput);

      const senseBox = _("div", { className: "sense-render-box" });
      this.senseBoxes.push(senseBox);

      const leaderSelection = [];
      const charaSlot = [];
      const posterSlot = [];
      const accessorySlot = [];

      const slotsContainer = _(
        "div",
        { className: "triple-party-slots", "data-axis-idx": axisIdx },
        Array(5)
          .fill(0)
          .map((__, idx) =>
            _("div", { className: "party-member", "data-idx": idx }, [
              (leaderSelection[idx] = _("input", {
                type: "radio",
                name: "leader-triple-" + axisIdx,
                event: { change: (e) => this.changeLeader(e, axisIdx, idx) },
              })),
              (charaSlot[idx] = _("span", {
                "data-slot-key": "charaSlot",
                "data-data-key": "characters",
                className: "spriteatlas-characters",
                event: { click: (e) => this.pickCharacter(e, axisIdx, idx) },
              })),
              (posterSlot[idx] = _("span", {
                "data-slot-key": "posterSlot",
                "data-data-key": "posters",
                className: "spriteatlas-posters",
                event: { click: (e) => this.pickPoster(e, axisIdx, idx) },
              })),
              (accessorySlot[idx] = _("span", {
                "data-slot-key": "accessorySlot",
                "data-data-key": "accessories",
                className: "spriteatlas-accessories",
                event: { click: (e) => this.pickAccessory(e, axisIdx, idx) },
              })),
            ]),
          ),
      );

      this.leaderSelections.push(leaderSelection);
      this.charaSlots.push(charaSlot);
      this.posterSlots.push(posterSlot);
      this.accessorySlots.push(accessorySlot);

      const calcResult = _("div");
      this.calcResults.push(calcResult);

      const partySelect = _("select", {
        event: {
          change: (e) => {
            const axis = this.axes[axisIdx];
            const val = e.target.value;
            if (!val) return;
            axis.selectedPartyKey = val;
            if (val.startsWith("pm_")) {
              const pmIdx = parseInt(val.slice(3));
              const pmParty = root.appState.partyManager.parties[pmIdx];
              if (pmParty) {
                axis.party = pmParty;
              }
            }
            this.changeParty(axisIdx);
            root.update({ party: true });
          },
        },
      });
      this.partySelects.push(partySelect);

      axisSection.appendChild(
        _("div", { style: { marginBottom: "4px" } }, [
          _("span", {}, [
            _(
              "text",
              ConstText.get("TRIPLE_AXIS_LABEL").replace("{n}", axisIdx + 1),
            ),
          ]),
          axisNotationLabel,
        ]),
      );
      axisSection.appendChild(
        _("div", { style: { marginBottom: "4px" } }, [partySelect]),
      );
      axisSection.appendChild(senseBox);
      axisSection.appendChild(slotsContainer);
      axisSection.appendChild(calcResult);

      axisWrapper.appendChild(axisSection);

      const swappable = new Draggable.Swappable(slotsContainer, {
        draggable: "span",
        distance: 10,
        delay: 0,
      });
      this.swappables.push(swappable);

      let swapSource, swapTarget, slots;
      const axisSlots = { charaSlot, posterSlot, accessorySlot };
      swappable.on("swappable:start", (e) => {
        if (!e.data.dragEvent.data.originalSource.dataset.id) return e.cancel();
      });
      swappable.on("swappable:swap", (e) => {
        const event = e.data.dragEvent.data;
        const source = event.originalSource;
        const target = event.over;
        if (source.dataset.slotKey !== target.dataset.slotKey)
          return e.cancel();
        slots = axisSlots[source.dataset.slotKey];
        swapSource = slots.indexOf(source);
        swapTarget = target.parentNode.dataset.idx;
      });
      swappable.on("swappable:stop", (e) => {
        if (swapSource === undefined || swapTarget === undefined) return;
        if (swapSource === swapTarget) return;
        const sSrc = swapSource;
        const sTgt = swapTarget;
        const party = this.axes[axisIdx].party;
        const sourceSlot = slots[swapSource];
        const dataKey = sourceSlot.dataset.dataKey;
        {
          const temp = slots[sSrc];
          slots[sSrc] = slots[sTgt];
          slots[sTgt] = temp;
        }
        {
          const tempData = party[dataKey][sSrc];
          party[dataKey][sSrc] = party[dataKey][sTgt];
          party[dataKey][sTgt] = tempData;
        }
        root.update({ party: true });
      });
    }

    this.fillNotationSelects();
  }

  setTripleCastNotation(tripleCastId) {
    const tripleCast = GameDb.TripleCast[tripleCastId];
    if (!tripleCast) return false;
    [
      tripleCast.SenseNotationMasterId1,
      tripleCast.SenseNotationMasterId2,
      tripleCast.SenseNotationMasterId3,
    ].forEach((notationId, idx) => {
      this.axes[idx].notationId = notationId | 0;
    });
    this.updateAxisNotationLabels();
    return true;
  }

  getSelectedTripleCastId() {
    const notationIds = this.axes.map((axis) => axis.notationId | 0);
    const tripleCast = Object.values(GameDb.TripleCast).find(
      (i) =>
        (i.SenseNotationMasterId1 | 0) === notationIds[0] &&
        (i.SenseNotationMasterId2 | 0) === notationIds[1] &&
        (i.SenseNotationMasterId3 | 0) === notationIds[2],
    );
    return tripleCast ? String(tripleCast.Id) : "";
  }

  updateAxisNotationLabels() {
    const labels = ["1 (マチネ)", "2 (ジュルネ)", "3 (ソワレ)"];
    this.axisNotationLabels?.forEach((label, idx) => {
      const notationId = this.axes[idx].notationId;
      label.textContent = notationId ? ` ${notationId} - ${labels[idx]}` : "";
    });
  }

  getTripleCastDateText(tripleCast) {
    return String(tripleCast.DisplayStartAt || tripleCast.Id).split(/[T\s]/)[0];
  }

  fillNotationSelects() {
    if (this.tripleCastSelect) {
      removeAllChilds(this.tripleCastSelect);
      this.tripleCastSelect.appendChild(
        _("option", { value: "" }, [_("text", "请选择")]),
      );
      Object.values(GameDb.TripleCast)
        .slice()
        .sort((a, b) => {
          if (a.DisplayStartAt === b.DisplayStartAt) return a.Id - b.Id;
          return a.DisplayStartAt < b.DisplayStartAt ? 1 : -1;
        })
        .forEach((i) => {
          this.tripleCastSelect.appendChild(
            _("option", { value: i.Id }, [
              _("text", this.getTripleCastDateText(i)),
            ]),
          );
        });
      this.tripleCastSelect.value = this.getSelectedTripleCastId();
    }
    this.updateAxisNotationLabels();
    for (let i = 0; i < 3; i++) {
      this.renderAxisSenseNote(i);
      this.fillPartySelect(i);
      if (this.partyNameInputs[i])
        this.partyNameInputs[i].value = this.axes[i].party.name;
    }
  }

  renderAxisSenseNote(axisIdx) {
    const id = this.axes[axisIdx].notationId;
    const data = GameDb.SenseNotation[id];
    const senseBox = this.senseBoxes[axisIdx];
    removeAllChilds(senseBox);
    if (!data || !data.Details) return;
    for (let i = 0; i < 5; i++) {
      senseBox.appendChild(
        _("div", { className: "sense-lane" }, [
          _("div", { className: "sense-lane-ct" }),
          _("div", { className: "sense-lane-box" }),
        ]),
      );
    }
    const timings = data.Details.slice();
    timings.sort((a, b) => a.TimingSecond - b.TimingSecond);
    if (timings.length === 0) return;
    const totalDuration = timings.slice(-1)[0].TimingSecond;
    timings.forEach((i) => {
      const lane = senseBox.children[i.Position - 1].children[1];
      lane.appendChild(
        _(
          "div",
          {
            className: "sense-node",
            style: {
              left: `calc(calc(100% - 40px) * ${i.TimingSecond / totalDuration})`,
              fontSize: i.TimingSecond > 99 ? "14px" : "",
            },
          },
          [_("text", i.TimingSecond)],
        ),
      );
    });
  }

  changeParty(axisIdx) {
    const party = this.axes[axisIdx].party;
    const leaderSel = this.leaderSelections[axisIdx];
    const charaIcons = this.charaSlots[axisIdx];
    const posterIcons = this.posterSlots[axisIdx];
    const accessoryIcons = this.accessorySlots[axisIdx];

    leaderSel.forEach((select, idx) => {
      select.checked =
        null !== party.leader && party.characters[idx] === party.leader;
    });
    charaIcons.forEach((icon, idx) => {
      icon.dataset.id = party.characters[idx]
        ? party.characters[idx].cardIconId
        : "";
    });
    posterIcons.forEach((icon, idx) => {
      icon.dataset.id = party.posters[idx] ? party.posters[idx].id : "";
    });
    accessoryIcons.forEach((icon, idx) => {
      icon.dataset.id = party.accessories[idx] ? party.accessories[idx].id : "";
    });
  }

  fillPartySelect(axisIdx) {
    const select = this.partySelects[axisIdx];
    if (!select) return;
    removeAllChilds(select);
    select.appendChild(
      _("option", { value: "", disabled: true }, [_("text", "请选择")]),
    );
    const pm = root.appState?.partyManager;
    let autoDefault = "";
    const targetName = `(TripleCast)グループ${axisIdx + 1}`;
    if (pm) {
      pm.parties.forEach((party, idx) => {
        if (!party.name.includes("(TripleCast)")) return;
        const val = `pm_${idx}`;
        select.appendChild(
          _("option", { value: val }, [_("text", party.name)]),
        );
        if (party.name === targetName && !autoDefault) autoDefault = val;
      });
    }
    const axis = this.axes[axisIdx];
    const cached = axis.selectedPartyKey;
    const chosen =
      cached && select.querySelector(`option[value="${cached}"]`)
        ? cached
        : autoDefault;
    select.value = chosen || "";
    if (chosen) {
      const pmIdx = parseInt(chosen.slice(3));
      const pmParty = pm?.parties[pmIdx];
      if (pmParty) {
        axis.party = pmParty;
      }
    }
  }

  addParty(axisIdx) {
    const axis = this.axes[axisIdx];
    const clone = Party.fromJSON(axis.party.toJSON());
    clone.name =
      ConstText.get("PARTY_DEFAULT_NAME") +
      ` ${axisIdx + 1}-${axis.parties.length + 1}`;
    axis.parties.push(clone);
    axis.currentPartyIdx = axis.parties.length - 1;
    axis.party = clone;
    this.fillPartySelect(axisIdx);
    this.changeParty(axisIdx);
    root.update({ party: true });
  }

  removeParty(axisIdx) {
    const axis = this.axes[axisIdx];
    if (axis.parties.length === 1)
      return alert(ConstText.get("PARTY_DELETE_LAST"));
    if (!confirm(ConstText.get("PARTY_DELETE_CONFIRM"))) return;
    axis.parties.splice(axis.currentPartyIdx, 1);
    if (axis.currentPartyIdx >= axis.parties.length) {
      axis.currentPartyIdx = axis.parties.length - 1;
    }
    axis.party = axis.parties[axis.currentPartyIdx];
    this.fillPartySelect(axisIdx);
    this.changeParty(axisIdx);
    root.update({ party: true });
  }

  update() {
    if (!this.leaderSelections || this.leaderSelections.length === 0) return;
    for (let i = 0; i < 3; i++) {
      this.changeParty(i);
    }
  }

  changeLeader(e, axisIdx, idx) {
    const party = this.axes[axisIdx].party;
    this.leaderSelections[axisIdx].forEach((select, otherIdx) => {
      if (idx === otherIdx) return;
      select.checked = false;
    });
    party.leader = party.characters[idx];
    root.update({ party: true });
  }

  changeChara(chara, axisIdx, idx) {
    const party = this.axes[axisIdx].party;
    const prevLeaderIdx = party.characters.indexOf(party.leader);
    if (!chara) {
      party.characters[idx] = null;
      party.leader = party.characters[prevLeaderIdx];
      root.update({ party: true });
      return;
    }
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

  changePoster(poster, axisIdx, idx) {
    const party = this.axes[axisIdx].party;
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

  changeAccessory(accessory, axisIdx, idx) {
    const party = this.axes[axisIdx].party;
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
    const itemIdx = pick.dataset.idx | 0;
    const { type, axisIdx, slotIdx } = this.currentPicking;
    switch (type) {
      case "chara": {
        if (itemIdx >= 0) {
          this.changeChara(
            root.appState.characters[itemIdx] || null,
            axisIdx,
            slotIdx,
          );
        } else {
          this.changeChara(null, axisIdx, slotIdx);
        }
        break;
      }
      case "poster": {
        if (itemIdx >= 0) {
          this.changePoster(
            root.appState.posters[itemIdx] || null,
            axisIdx,
            slotIdx,
          );
        } else {
          this.changePoster(null, axisIdx, slotIdx);
        }
        break;
      }
      case "accessory": {
        if (itemIdx >= 0) {
          this.changeAccessory(
            root.appState.accessories[itemIdx] || null,
            axisIdx,
            slotIdx,
          );
        } else {
          this.changeAccessory(null, axisIdx, slotIdx);
        }
        break;
      }
    }
    this.pickingOverlay.remove();
  }

  pickCharacter(e, axisIdx, idx) {
    console.log(
      "pickCharacter called, characters:",
      root.appState.characters.length,
    );
    if (root.appState.characters.length === 0) return;
    this.currentPicking = { type: "chara", axisIdx, slotIdx: idx };
    this.createPickingOverlay();
    const currentSelection = {};
    const party = this.axes[axisIdx].party;
    const items = this.highEndFilter?.checked
      ? root.appState.characters.filter((c) => c.data.Rarity === "Rare4")
      : root.appState.characters;
    party.characters.forEach((chara, i) => {
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

  pickPoster(e, axisIdx, idx) {
    this.currentPicking = { type: "poster", axisIdx, slotIdx: idx };
    this.createPickingOverlay();
    const currentSelection = {};
    const party = this.axes[axisIdx].party;
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
    if (party.posters[idx] === null) {
      this.pickingContainer.lastChild.classList.add("selected");
    }
    const posterItems = this.highEndFilter?.checked
      ? root.appState.posters.filter((p) => p.data.Rarity === "SSR")
      : root.appState.posters;
    party.posters.forEach((poster, i) => {
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

  pickAccessory(e, axisIdx, idx) {
    this.currentPicking = { type: "accessory", axisIdx, slotIdx: idx };
    this.createPickingOverlay();
    const currentSelection = {};
    const party = this.axes[axisIdx].party;
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
    if (party.accessories[idx] === null) {
      this.pickingContainer.lastChild.classList.add("selected");
    }
    const accItems = this.highEndFilter?.checked
      ? root.appState.accessories.filter((a) => a.level >= 10)
      : root.appState.accessories;
    party.accessories.forEach((accessory, i) => {
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

  toJSON() {
    return [
      this.axes.map((axis) => axis.parties.map((p) => p.toJSON())),
      this.axes.map((axis) => axis.notationId),
      this.axes.map((axis) => axis.selectedPartyKey || ""),
    ];
  }

  static fromJSON(data) {
    const manager = new TripleCastManager();
    if (Array.isArray(data) && data.length >= 2) {
      const partiesData = data[0];
      const notationIds = data[1];
      if (Array.isArray(partiesData)) {
        for (let i = 0; i < Math.min(3, partiesData.length); i++) {
          if (!partiesData[i]) continue;
          if (Array.isArray(partiesData[i])) {
            if (typeof partiesData[i][0] === "string") {
              manager.axes[i].parties = [Party.fromJSON(partiesData[i])];
            } else {
              manager.axes[i].parties = partiesData[i].map((pd) =>
                Party.fromJSON(pd),
              );
            }
          }
          manager.axes[i].party = manager.axes[i].parties[0];
          manager.axes[i].currentPartyIdx = 0;
        }
      }
      if (Array.isArray(notationIds)) {
        for (let i = 0; i < Math.min(3, notationIds.length); i++) {
          manager.axes[i].notationId = notationIds[i] | 0;
        }
      }
      const selectedKeys = data[2];
      if (Array.isArray(selectedKeys)) {
        for (let i = 0; i < Math.min(3, selectedKeys.length); i++) {
          manager.axes[i].selectedPartyKey = selectedKeys[i] || "";
        }
      }
    }
    return manager;
  }
}
