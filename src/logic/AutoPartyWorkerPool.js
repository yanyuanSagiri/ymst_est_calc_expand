export default class AutoPartyWorkerPool {
  constructor() {
    this.workers = [];
    this.isRunning = false;
    this.shouldStop = false;
  }

  async runSearch(params) {
    const { onProgress } = params;
    const navigatorConcurrency = navigator.hardwareConcurrency || 4;
    const workerCount = Math.min(navigatorConcurrency, 4);

    this.isRunning = true;
    this.shouldStop = false;
    this.workers = [];

    let completedWorkers = 0;
    const overallTotal = params.totalCombinations || 1;
    const workerProgresses = new Array(workerCount).fill(0);

    let bestScore = -1;
    let bestIndices = null;

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
              workerProgresses[i] = data.current;
              const aggregateCurrent = workerProgresses.reduce((s, v) => s + v, 0);
              if (onProgress) {
                const progressTotal = data.phase === 'scoring' ? params.topN * workerCount : overallTotal;
                onProgress(aggregateCurrent, progressTotal, data.bestScore);
              }
              break;
            }
            case 'COMPLETE': {
              if (data.bestScore > bestScore) {
                bestScore = data.bestScore;
                bestIndices = data.bestIndices;
              }
              completedWorkers++;

              if (completedWorkers === workerCount) {
                this.isRunning = false;
                resolve({ bestScore, bestIndices });
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
            resolve({ bestScore, bestIndices });
          }
        };

        const { onProgress: _op, onWorkerProgress: _owp, totalCombinations: _tc, ...workerData } = params;
        worker.postMessage({
          type: 'START_SEARCH',
          data: {
            ...workerData,
            workerId: i,
            totalWorkers: workerCount,
            topN: params.topN || 0,
          }
        });
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
