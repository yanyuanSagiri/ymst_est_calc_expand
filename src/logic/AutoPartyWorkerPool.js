export default class AutoPartyWorkerPool {
  constructor() {
    this.workers = [];
    this.isRunning = false;
    this.shouldStop = false;
  }

  async runSearch(params) {
    const { onProgress, saThreshold = 1 } = params;
    const maxCores = navigator.hardwareConcurrency || 4;
    const defaultWorkerCount = Math.max(1, maxCores - 2);
    const workerCount = Math.max(1, Math.min(params.workerCount || defaultWorkerCount, maxCores));

    // 终止旧 Worker
    for (const w of this.workers) {
      try { w.terminate(); } catch (_) {}
    }
    this.isRunning = true;
    this.shouldStop = false;
    this.workers = [];
    console.log(`[Pool] runSearch: workerCount=${workerCount}, comboData=${params.comboData ? params.comboData.length : 'N/A'}`);

    let completedWorkers = 0;
    const workerProgresses = new Array(workerCount).fill(0);
    const workerPhases = new Array(workerCount).fill('counting');
    const workerPhase1Totals = new Array(workerCount).fill(0);
    const workerPhase2Totals = new Array(workerCount).fill(0);

    let bestScore = -1;
    let bestIndices = null;
    let globalBestScore = -1;

    // CPU 两阶段协调：收集各 worker 的 maxSA，广播全局阈值
    const workerMaxSAs = new Array(workerCount).fill(0);
    let phase1DoneCount = 0;
    let thresholdBroadcast = false;

    // 阶段时间跟踪
    const searchStartTime = performance.now();
    let phase2StartTime = null;  // 第二阶段开始时间（首个 worker 进入 scoring）
    let allWorkersInPhase2 = false;
    let phase1EndTime = null;    // 第一阶段结束时间（所有 worker 进入 scoring）

    return new Promise((resolve, reject) => {
      for (let i = 0; i < workerCount; i++) {
        const worker = new Worker(
          new URL('./AutoPartyWorker.js', import.meta.url),
          { type: 'module' }
        );
        this.workers.push(worker);

        worker.onmessage = (e) => {
          const { type, data } = e.data;

          switch (type) {
            case 'PROGRESS': {
              const prevPhase = workerPhases[i];
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
                phase1EndTime = performance.now();
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
              workerMaxSAs[i] = data.maxSA || 0;
              phase1DoneCount++;
              console.log(`[Pool] Worker ${i} PHASE1_DONE, ${phase1DoneCount}/${workerCount}`);
              if (phase1DoneCount === workerCount && !thresholdBroadcast) {
                thresholdBroadcast = true;
                const globalMaxSA = Math.max(...workerMaxSAs);
                const globalThreshold = Math.max(0, globalMaxSA - saThreshold);
                console.log(`autoParty: CPU threshold=${globalThreshold} (maxSA=${globalMaxSA}, offset=${saThreshold})`);
                for (const w of this.workers) {
                  w.postMessage({ type: 'GLOBAL_THRESHOLD', data: { threshold: globalThreshold } });
                }
              }
              break;
            }
            case 'COMPLETE': {
              if (data.bestScore > bestScore) {
                bestScore = data.bestScore;
                bestIndices = data.bestIndices;
              }
              completedWorkers++;
              console.log(`[Pool] Worker ${i} COMPLETE, ${completedWorkers}/${workerCount}, bestScore=${data.bestScore}`);

              if (completedWorkers === workerCount) {
                this.isRunning = false;
                const searchEndTime = performance.now();
                resolve({
                  bestScore,
                  bestIndices,
                  filterDuration: phase2StartTime ? (phase2StartTime - searchStartTime) : 0,
                  scoringDuration: phase2StartTime ? (searchEndTime - phase2StartTime) : (searchEndTime - searchStartTime),
                });
              }
              break;
            }
          }
        };

        worker.onerror = (err) => {
          console.error(`Worker ${i} error:`, err);
          completedWorkers++;
          if (completedWorkers === workerCount) {
            this.isRunning = false;
            const searchEndTime = performance.now();
            resolve({
              bestScore,
              bestIndices,
              filterDuration: phase2StartTime ? (phase2StartTime - searchStartTime) : 0,
              scoringDuration: phase2StartTime ? (searchEndTime - phase2StartTime) : (searchEndTime - searchStartTime),
            });
          }
        };

        const { onProgress: _op, onWorkerProgress: _owp, totalCombinations: _tc, comboData, ...workerData } = params;
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
    this.workers.forEach(worker => {
      worker.postMessage({ type: 'STOP_SEARCH' });
    });
    setTimeout(() => {
      this.workers.forEach(worker => {
        try { worker.terminate(); } catch (_) {}
      });
      this.workers = [];
      this.isRunning = false;
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
