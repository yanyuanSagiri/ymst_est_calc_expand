# Yumesute 自动组队 API

## 概述

此工具用于自动生成 Yumesute 游戏的最优阵容。可通过命令行调用，支持任意前端项目接入。

## 安装

### 方式一：使用打包好的 exe（推荐）

复制以下文件到你的项目：
- `dist/Start.exe`
- `data/` 文件夹（包含游戏数据）

### 方式二：从源码构建

```bash
# 安装 Python 3.10+
pip install aiohttp

# 构建 exe
.\build-python.ps1
```

## 使用方法

### 命令行调用

```bash
echo '<json数据>' | Start.exe
```

### Node.js 调用

```javascript
const { spawn } = require('child_process');

function runFormation(userData, options = {}) {
    return new Promise((resolve, reject) => {
        const args = [];
        if (options.dataDir) args.push('-d', options.dataDir);
        if (options.mandatoryCharacters) args.push('-mc', ...options.mandatoryCharacters.map(String));
        if (options.mandatoryPosters) args.push('-mp', ...options.mandatoryPosters.map(String));

        const process = spawn('Start.exe', args, { stdio: ['pipe', 'pipe', 'pipe'] });
        const results = [];
        let stderr = '';

        process.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            for (const line of lines) {
                try {
                    const msg = JSON.parse(line);
                    if (msg.FIN) {
                        resolve(results);
                    } else if (!msg.error) {
                        results.push(msg);
                    }
                } catch (e) {}
            }
        });

        process.stderr.on('data', (data) => { stderr += data.toString(); });
        process.on('error', reject);
        process.on('close', (code) => {
            if (code !== 0) reject(new Error(`进程退出码 ${code}: ${stderr}`));
            else resolve(results);
        });

        process.stdin.write(JSON.stringify(userData) + '\n');
        process.stdin.end();
    });
}

// 使用示例
const userData = {
    characters: [142420, 150010, 150020, 150030, 150040],
    posters: [230110, 230640, 231010, 330250, 330390],
    accessories: [330210, 332720, 430200, 430210, 430220]
};

runFormation(userData).then(results => {
    console.log('找到', results.length, '个阵容');
});
```

### Electron 调用

#### main.js（主进程）

```javascript
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    mainWindow.loadFile('index.html');
}

// 获取 Start.exe 路径
function getExePath() {
    // 打包后从 resources 读取
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'Start.exe');
    }
    // 开发环境从项目目录读取
    return path.join(__dirname, '..', 'dist', 'Start.exe');
}

// 获取 data 目录路径
function getDataPath() {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'data');
    }
    return path.join(__dirname, '..', 'data');
}

// 调用组队脚本
ipcMain.handle('run-formation', async (event, userData, options = {}) => {
    return new Promise((resolve, reject) => {
        const exePath = getExePath();
        const dataPath = getDataPath();
        
        if (!fs.existsSync(exePath)) {
            reject(new Error('Start.exe not found at: ' + exePath));
            return;
        }

        const args = ['-d', dataPath];
        
        // 可选参数
        if (options.mandatoryCharacters && options.mandatoryCharacters.length === 10) {
            args.push('-mc', ...options.mandatoryCharacters.map(String));
        }
        if (options.mandatoryPosters && options.mandatoryPosters.length === 10) {
            args.push('-mp', ...options.mandatoryPosters.map(String));
        }

        const process = spawn(exePath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        const results = [];
        let stderrOutput = '';

        process.stdout.on('data', (data) => {
            const lines = data.toString().split('\n').filter(l => l.trim());
            for (const line of lines) {
                try {
                    const msg = JSON.parse(line);
                    if (msg.FIN) {
                        resolve(results);
                    } else if (msg.error) {
                        reject(new Error(msg.error));
                    } else {
                        results.push(msg);
                        // 实时发送结果到渲染进程
                        mainWindow.webContents.send('formation-progress', msg);
                    }
                } catch (e) {}
            }
        });

        process.stderr.on('data', (data) => {
            stderrOutput += data.toString();
        });

        process.on('error', reject);
        process.on('close', (code) => {
            if (code !== 0 && results.length === 0) {
                reject(new Error(`进程退出码 ${code}: ${stderrOutput}`));
            } else {
                resolve(results);
            }
        });

        process.stdin.write(JSON.stringify(userData) + '\n');
        process.stdin.end();
    });
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
```

#### preload.js

```javascript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    runFormation: (userData, options) => ipcRenderer.invoke('run-formation', userData, options),
    onProgress: (callback) => ipcRenderer.on('formation-progress', (event, data) => callback(data))
});
```

#### renderer.js（渲染进程）

```javascript
document.getElementById('start').addEventListener('click', async () => {
    const userData = {
        characters: [142420, 150010, 150020, 150030, 150040],
        posters: [230110, 230640, 231010, 330250, 330390],
        accessories: [330210, 332720, 430200, 430210, 430220]
    };

    const options = {
        mandatoryCharacters: [150010, 1, 150020, 0, 0, 0, 0, 0, 0, 0],
        mandatoryPosters: [330380, 150030, 0, 0, 0, 0, 0, 0, 0, 0]
    };

    try {
        // 监听实时进度
        window.api.onProgress((result) => {
            console.log('新阵容:', result);
            // 更新 UI 显示
        });

        // 开始计算
        const allResults = await window.api.runFormation(userData, options);
        console.log('完成，共', allResults.length, '个阵容');
    } catch (error) {
        console.error('错误:', error.message);
    }
});
```

#### Electron 打包配置（package.json）

```json
{
    "build": {
        "extraResources": [
            {
                "from": "../dist/Start.exe",
                "to": "Start.exe"
            },
            {
                "from": "../data",
                "to": "data"
            }
        ]
    }
}
```

### Python 调用

```python
import subprocess
import json

def run_formation(user_data, options=None):
    args = ['Start.exe']
    if options:
        if options.get('data_dir'):
            args.extend(['-d', options['data_dir']])
        if options.get('mandatory_characters'):
            args.extend(['-mc'] + [str(x) for x in options['mandatory_characters']])
        if options.get('mandatory_posters'):
            args.extend(['-mp'] + [str(x) for x in options['mandatory_posters']])
    
    process = subprocess.Popen(
        args,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    
    stdout, stderr = process.communicate(json.dumps(user_data) + '\n')
    results = []
    for line in stdout.strip().split('\n'):
        if line:
            msg = json.loads(line)
            if not msg.get('FIN') and not msg.get('error'):
                results.append(msg)
    return results

# 使用示例
user_data = {
    "characters": [142420, 150010, 150020, 150030, 150040],
    "posters": [230110, 230640, 231010, 330250, 330390],
    "accessories": [330210, 332720, 430200, 430210, 430220]
}
results = run_formation(user_data)
```

## 输入格式

### 用户数据（通过 stdin 传入 JSON）

```json
{
    "characters": [142420, 150010, 150020, 150030, 150040],
    "posters": [230110, 230640, 231010, 330250, 330390],
    "accessories": [330210, 332720, 430200, 430210, 430220]
}
```

**自动格式化**：工具会自动将简单数组转换为嵌套数组：
- `characters: [1,2,3]` → `[[1],[2],[3]]`
- `posters: [1,2,3]` → `[[1,10,0],[2,10,0],[3,10,0]]`（默认等级=10，额外值=0）
- `accessories: [1,2,3]` → `[[1],[2],[3]]`

### 命令行参数

| 参数 | 缩写 | 类型 | 默认值 | 说明 |
|------|------|------|--------|------|
| `-d` | `--data` | string | `data` | 游戏数据目录路径 |
| `-mc` | `--mandatory_characters` | int[10] | 见下文 | 必选角色及其固定位置 |
| `-mp` | `--mandatory_posters` | int[10] | 见下文 | 必选海报及其绑定角色 |

**必选角色格式**：`角色ID1 位置1 角色ID2 位置2 ...`（10个数字，不选填0）
```bash
-mc 150010 1 150020 0 0 0 0 0 0 0
```

**必选海报格式**：`海报ID1 角色ID1 海报ID2 角色ID2 ...`（10个数字，不选填0）
```bash
-mp 330380 150030 0 0 0 0 0 0 0 0
```

## 输出格式

### stdout（JSON 行）

每行一个阵容结果，是一个包含 15 个元素的数组：
```json
[c1, c2, c3, c4, c5, p1, p2, p3, p4, p5, a1, a2, a3, a4, a5]
```

**字段说明：**
| 索引 | 说明 | 示例 |
|------|------|------|
| 0-4 | 角色 ID（5个） | `[142420, 150010, 150020, 150030, 150040]` |
| 5-9 | 海报 ID（5个） | `[230110, 230640, 231010, 330250, 330390]` |
| 10-14 | 饰品 ID（5个） | `[331710, 331710, 331710, 331710, 331710]` |

**示例输出：**
```json
[142420, 150010, 150020, 150030, 150040, 230110, 230640, 231010, 330250, 330390, 331710, 331710, 331710, 331710, 331710]
```

**解析示例：**
```javascript
const result = JSON.parse(line);
const characters = result.slice(0, 5);   // 角色
const posters = result.slice(5, 10);     // 海报
const accessories = result.slice(10, 15); // 饰品
```

### 结束标志
```json
{"FIN": true}
```

### stderr

错误信息（如有）。

## 目录结构

```
你的项目/
├── Start.exe                    # 主程序
└── data/                        # 游戏数据（必需）
    ├── CharacterMaster.json
    ├── PosterAbilityMaster.json
    ├── accessory_processed.json
    └── EffectMaster.json
```

## 注意事项

1. `data/` 文件夹必须与 `Start.exe` 在同一目录，或使用 `-d` 参数指定路径
2. 处理时间取决于角色/海报数量（通常 5-30 秒）
3. 结果会实时输出，找到一个输出一个
4. 如果角色/海报数量较多，建议异步调用避免阻塞
