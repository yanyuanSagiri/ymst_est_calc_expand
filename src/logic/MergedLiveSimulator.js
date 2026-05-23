export default class MergedLiveSimulator {
  constructor(calcs, senseBoxes) {
    this.calcs = calcs;
    this.liveSims = calcs.map((c) => c?.liveSim ?? null);
    this.senseBoxes = senseBoxes;
  }

  run() {
    this.liveSims.forEach((sim, idx) => {
      if (!sim) return;
      if (sim.calc.members.some((m) => !m)) return;
      sim.senseBox = this.senseBoxes[idx] || sim.senseBox;
      sim.prepare(null);
    });

    const allEvents = [];
    this.liveSims.forEach((sim, axisIdx) => {
      if (!sim) return;
      if (sim.calc.members.some((m) => !m)) return;
      sim.senseTiming.forEach((timing) => {
        allEvents.push({ timing, axisIdx });
      });
    });
    allEvents.sort((a, b) => {
      const dt = a.timing.TimingSecond - b.timing.TimingSecond;
      return dt !== 0 ? dt : a.axisIdx - b.axisIdx;
    });

    allEvents.forEach((event) => {
      const sim = this.liveSims[event.axisIdx];
      if (!sim) return;

      const axisIdx = event.axisIdx;
      sim.calc.extra.tripleCastScoreProvider = (time) => {
        let sum = 0;
        for (let i = 0; i < 3; i++) {
          if (i === axisIdx || !this.liveSims[i]) continue;
          sum += this.getAxisScoreAtTime(i, time);
        }
        return sum;
      };

      sim.processTiming(event.timing, null);
    });

    this.liveSims.forEach((sim) => {
      if (!sim) return;
      sim.finalize(null);
    });
  }

  getAxisScoreAtTime(axisIdx, time) {
    const sim = this.liveSims[axisIdx];
    const baseScore = sim.baseScore;
    const lastTiming = sim.lastSenseTiming;
    const timeline = sim.scoreTimeline;

    let sense = 0,
      starAct = 0;
    for (let i = timeline.length - 1; i >= 0; i--) {
      if (timeline[i].time <= time) {
        sense = timeline[i].cumulativeSenseScore;
        starAct = timeline[i].cumulativeStarActScore;
        break;
      }
    }
    return (baseScore * time) / lastTiming + sense + starAct;
  }
}
