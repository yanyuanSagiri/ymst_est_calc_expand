const { app, BrowserWindow, nativeImage, ipcMain } = require("electron");
const path = require("path");
const { spawn } = require("child_process");
const iconPath = path.join(__dirname, "..", "tbm.ico");
const appIcon = nativeImage.createFromPath(iconPath);

let mainWindow;
let formationProcess = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  const isDev = process.env.NODE_ENV === "development";

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Python 配队脚本：调用 Start.exe
function getFormationExePath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "pyScript", "dist", "Start.exe");
  }
  return path.join(__dirname, "..", "pyScript", "dist", "Start.exe");
}

function getFormationDataPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "pyScript", "data");
  }
  return path.join(__dirname, "..", "pyScript", "data");
}

ipcMain.handle("run-formation", async (event, userData) => {
  return new Promise((resolve, reject) => {
    const exePath = getFormationExePath();
    const dataPath = getFormationDataPath();
    const args = [
      "-d", dataPath,
      "-mc", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0",
      "-mp", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0",
    ];

    console.log("[run-formation] exe:", exePath);
    console.log("[run-formation] data:", dataPath);
    console.log("[run-formation] input:", JSON.stringify(userData));

    formationProcess = spawn(exePath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: path.dirname(exePath),
    });
    let resultCount = 0;
    let finReceived = false;
    let stderrOutput = "";

    formationProcess.stdout.on("data", (data) => {
      const raw = data.toString();
      const lines = raw.split("\n").filter((l) => l.trim());
      console.log(`[run-formation] stdout chunk: ${lines.length} lines, first=${lines[0]?.substring(0, 100)}`);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.FIN) {
            finReceived = true;
            console.log("[run-formation] FIN received from Python");
            if (mainWindow && !mainWindow.isDestroyed())
              mainWindow.webContents.send("formation-result", { FIN: true });
          } else if (msg.error) {
            if (mainWindow && !mainWindow.isDestroyed())
              mainWindow.webContents.send("formation-result", { error: msg.error });
          } else {
            resultCount++;
            if (mainWindow && !mainWindow.isDestroyed())
              mainWindow.webContents.send("formation-result", msg);
          }
        } catch (e) {}
      }
    });

    formationProcess.stderr.on("data", (data) => {
      stderrOutput += data.toString();
    });

    formationProcess.on("error", (err) => {
      formationProcess = null;
      reject(err);
    });

    formationProcess.on("close", (code) => {
      console.log("[run-formation] close, code:", code, "results:", resultCount, "finReceived:", finReceived);
      formationProcess = null;
      if (!finReceived) {
        console.log("[run-formation] FIN not received before close, sending fallback");
        if (mainWindow && !mainWindow.isDestroyed())
          mainWindow.webContents.send("formation-result", { FIN: true });
      }
      if (code !== 0 && resultCount === 0) {
        reject(new Error(`进程退出码 ${code}: ${stderrOutput}`));
      } else {
        resolve({ count: resultCount });
      }
    });

    const inputJson = JSON.stringify(userData) + "\n";
    console.log("[run-formation] input to Python:", inputJson);
    formationProcess.stdin.write(inputJson);
    formationProcess.stdin.end();

    // 5分钟超时
    const timeout = setTimeout(() => {
      if (formationProcess) {
        console.log("[run-formation] timeout, killing process");
        formationProcess.kill();
      }
    }, 300000);
  });
});

ipcMain.handle("stop-formation", async () => {
  if (formationProcess) {
    formationProcess.kill();
    formationProcess = null;
  }
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});
