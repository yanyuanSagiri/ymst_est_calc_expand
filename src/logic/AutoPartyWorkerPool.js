export default class AutoPartyWorkerPool {
  constructor() {
    this.workers = [];
    this.isRunning = false;
    this.shouldStop = false;
    this._settleCurrentRun = null;
  }

  async runSearch(params) {
    const { onProgress, onTotalReady, saThreshold = 1 } = params;
    const maxCores = navigator.hardwareConcurrency || 4;
    const defaultWorkerCount = Math.max(1, maxCores - 2);
    const workerCount = Math.max(1, Math.min(params.workerCount || defaultWorkerCount, maxCores));

    if (this._settleCurrentRun) {
      this._settleCurrentRun();
    }

    // 终止旧 Worker
    for (const w of this.workers) {
      try {
        w.terminate();
      } catch {
        // The worker may already have terminated.
      }
    }
    this.isRunning = true;
    this.shouldStop = false;
    this.workers = [];
    console.log(`[Pool] runSearch: workerCount=${workerCount}, comboData=${params.comboData ? params.comboData.length : 'N/A'}`);

    let completedWorkers = 0;
    let totalReadyNotified = false;
    const workerProgresses = new Array(workerCount).fill(0);
    const workerPhases = new Array(workerCount).fill('counting');
    const workerPhase1Totals = new Array(workerCount).fill(0);
    const workerPhase2Totals = new Array(workerCount).fill(0);

    let bestScore = -1;
    let bestIndices = null;
    let globalBestScore = -1;

    // CPU 两阶段协调：收集各 worker 的 maxSA，广播全局阈值
    const workerMaxSAs = new Array(workerCount).fill(0);
    const workerPhase1Finished = new Array(workerCount).fill(false);
    const workerCompleted = new Array(workerCount).fill(false);
    let phase1DoneCount = 0;
    let thresholdBroadcast = false;

    // 阶段时间跟踪
    const searchStartTime = performance.now();
    let phase2StartTime = null;  // 第二阶段开始时间（首个 worker 进入 scoring）
    let allWorkersInPhase2 = false;

    return new Promise((resolve, reject) => {
      let settled = false;
      const buildResult = () => {
        const searchEndTime = performance.now();
        return {
          bestScore,
          bestIndices,
          filterDuration: phase2StartTime ? (phase2StartTime - searchStartTime) : 0,
          scoringDuration: phase2StartTime ? (searchEndTime - phase2StartTime) : (searchEndTime - searchStartTime),
        };
      };
      const settleRun = () => {
        if (settled) return;
        settled = true;
        this.isRunning = false;
        this._settleCurrentRun = null;
        resolve(buildResult());
      };
      this._settleCurrentRun = settleRun;

      const markPhase1Done = (workerIndex, maxSA = 0) => {
        if (workerPhase1Finished[workerIndex]) return;
        workerPhase1Finished[workerIndex] = true;
        workerMaxSAs[workerIndex] = maxSA;
        phase1DoneCount++;
        console.log(
          `[Pool] Worker ${workerIndex} phase 1 settled, ${phase1DoneCount}/${workerCount}`,
        );
        if (phase1DoneCount === workerCount && !thresholdBroadcast) {
          thresholdBroadcast = true;
          const globalMaxSA = Math.max(...workerMaxSAs);
          const globalThreshold = Math.max(0, globalMaxSA - saThreshold);
          console.log(
            `autoParty: CPU threshold=${globalThreshold} (maxSA=${globalMaxSA}, offset=${saThreshold})`,
          );
          for (const activeWorker of this.workers) {
            try {
              activeWorker.postMessage({
                type: 'GLOBAL_THRESHOLD',
                data: { threshold: globalThreshold },
              });
            } catch (err) {
              console.warn('[Pool] Failed to broadcast threshold:', err);
            }
          }
        }
      };

      const markWorkerComplete = (workerIndex) => {
        if (workerCompleted[workerIndex]) return false;
        workerCompleted[workerIndex] = true;
        completedWorkers++;
        return true;
      };

      for (let i = 0; i < workerCount; i++) {
        const worker = new Worker(
          new URL('./AutoPartyWorker.js', import.meta.url),
          { type: 'module' }
        );
        this.workers.push(worker);

        worker.onmessage = (e) => {
          if (settled) return;
          const { type, data } = e.data;

          switch (type) {
            case 'PLAN_READY': {
              if (!totalReadyNotified) {
                totalReadyNotified = true;
                if (typeof onTotalReady === 'function') {
                  onTotalReady(data.totalCombinations, false);
                }
              }
              break;
            }
            case 'PROGRESS': {
              workerPhases[i] = data.phase || 'counting';
              workerProgresses[i] = data.current;
              if (data.phase === 'counting') {
                workerPhase1Totals[i] = data.total || 0;
              } else if (data.phase === 'scoring') {
                workerPhase2Totals[i] = data.total || 0;
                // 记录第二阶段开始时间
                if (!phase2StartTime) phase2StartTime = performance.now();
              }
              // 检测所有 worker 是否都进入第二阶段
              if (!allWorkersInPhase2 && workerPhases.every(p => p === 'scoring')) {
                allWorkersInPhase2 = true;
              }
              // 聚合全局最高分
              if (data.bestScore > globalBestScore) {
                globalBestScore = data.bestScore;
              }

              // 计算跨阶段的进度
              let phase1Current = 0;
              let phase1Total = 0;
              let phase2Current = 0;
              let phase2Total = 0;
              for (let j = 0; j < workerCount; j++) {
                if (workerPhases[j] === 'scoring') {
                  // 已完成第一阶段，加上第一阶段配额
                  phase1Current += workerPhase1Totals[j];
                  phase1Total += workerPhase1Totals[j];
                  phase2Current += workerProgresses[j];
                  phase2Total += workerPhase2Totals[j];
                } else {
                  phase1Current += workerProgresses[j];
                  phase1Total += workerPhase1Totals[j];
                }
              }

              if (onProgress) {
                const hasPhase2 = phase2Total > 0;
                if (hasPhase2) {
                  onProgress({
                    phase: 'scoring',
                    phase1Current,
                    phase1Total,
                    phase2Current,
                    phase2Total,
                    bestScore: globalBestScore,
                  });
                } else {
                  onProgress({
                    phase: 'counting',
                    phase1Current,
                    phase1Total,
                    phase2Current: 0,
                    phase2Total: 0,
                    bestScore: globalBestScore,
                  });
                }
              }
              break;
            }
            case 'PHASE1_DONE': {
              markPhase1Done(i, data.maxSA || 0);
              break;
            }
            case 'COMPLETE': {
              // A worker can fail before PHASE1_DONE. Count it as settled so
              // the remaining workers still receive their global threshold.
              markPhase1Done(i, 0);
              if (data.bestScore > bestScore) {
                bestScore = data.bestScore;
                bestIndices = data.bestIndices;
              }
              if (!markWorkerComplete(i)) break;
              console.log(`[Pool] Worker ${i} COMPLETE, ${completedWorkers}/${workerCount}, bestScore=${data.bestScore}`);

              if (completedWorkers === workerCount) {
                settleRun();
              }
              break;
            }
          }
        };

        worker.onerror = (err) => {
          if (settled) return;
          console.error(`Worker ${i} error:`, err);
          markPhase1Done(i, 0);
          if (!markWorkerComplete(i)) return;
          if (completedWorkers === workerCount) {
            settleRun();
          }
        };

        const { comboData } = params;
        const workerData = Object.fromEntries(
          Object.entries(params).filter(
            ([key, value]) =>
              key !== 'comboData' &&
              key !== 'totalCombinations' &&
              typeof value !== 'function',
          ),
        );
        const msg = {
          type: 'START_SEARCH',
          data: {
            ...workerData,
            workerId: i,
            totalWorkers: workerCount,
          }
        };
        // comboData: 为每个 Worker 创建副本（transfer 后原 buffer 不可用）
        if (comboData) {
          msg.data.comboData = new Uint32Array(comboData);
        }
        worker.postMessage(msg);
      }
    });
  }

  stop() {
    this.shouldStop = true;
    const stoppedWorkers = this.workers.slice();
    this.workers = [];
    stoppedWorkers.forEach(worker => {
      try {
        worker.postMessage({ type: 'STOP_SEARCH' });
      } catch {
        // The worker may already have terminated.
      }
    });
    if (this._settleCurrentRun) {
      this._settleCurrentRun();
    } else {
      this.isRunning = false;
    }
    setTimeout(() => {
      stoppedWorkers.forEach(worker => {
        try {
          worker.terminate();
        } catch {
          // The worker may already have terminated.
        }
      });
    }, 500);
  }

  static permCount(n, k) {
    if (n < k) return 0;
    let result = 1;
    for (let i = 0; i < k; i++) {
      result *= (n - i);
    }
    return result;
  }
}
