# Yumesute 自动组队 API

## 概述

此工具用于枚举并剪枝 Yumesute 的候选阵容。主入口通过 stdin 接收账号数据，通过 stdout 流式返回角色、海报和饰品组合，可供命令行或前端进程调用；最终评分不属于 `Start.py` 的职责。

## 安装

### 方式一：使用打包好的 exe（推荐）

复制以下文件到你的项目：
- `dist/Start.exe`
- `data/` 文件夹（包含游戏数据）

### 方式二：从源码构建

```bash
# 安装 Python 3.10+ 与打包工具
pip install pyinstaller

# 构建 exe
.\build-python.ps1
```

仅实验性的 `StartForServer.py` / `src/pipeline.py` 需要额外安装 `aiohttp`。

## 使用方法

### 命令行调用

```bash
echo '<json数据>' | Start.exe
```

`Start.py` / `Start.exe` 当前只从 stdin 读取用户数据；虽然参数解析器仍接受位置参数 `user`，主入口不会使用该文件名。

### Node.js 调用

```javascript
const { spawn } = require('child_process');

function runFormation(userData, options = {}) {
    return new Promise((resolve, reject) => {
        const args = [];
        if (options.dataDir) args.push('-d', options.dataDir);

        for (const [flag, values] of [
            ['-mc', options.mandatoryCharacters],
            ['-mp', options.mandatoryPosters]
        ]) {
            if (values === undefined) continue;
            if (!Array.isArray(values) || values.length !== 10 || !values.every(Number.isInteger)) {
                reject(new TypeError(`${flag} 必须是恰好 10 个整数`));
                return;
            }
            args.push(flag, ...values.map(String));
        }

        const process = spawn('Start.exe', args, { stdio: ['pipe', 'pipe', 'pipe'] });
        const results = [];
        let stderr = '';
        let stdoutBuffer = '';
        let settled = false;

        const succeed = () => {
            if (!settled) {
                settled = true;
                resolve(results);
            }
        };
        const fail = (error) => {
            if (!settled) {
                settled = true;
                reject(error);
            }
        };

        function consumeLine(line) {
            if (!line.trim()) return;
            let msg;
            try {
                msg = JSON.parse(line);
            } catch {
                return; // 当前版本的 stdout 还会混入普通诊断日志
            }

            if (Array.isArray(msg) && msg.length === 15) {
                results.push(msg);
            } else if (msg && msg.error) {
                fail(new Error(msg.error));
            } else if (msg && msg.FIN) {
                succeed();
            }
        }

        process.stdout.on('data', (data) => {
            stdoutBuffer += data.toString();
            const lines = stdoutBuffer.split(/\r?\n/);
            stdoutBuffer = lines.pop();
            for (const line of lines) consumeLine(line);
        });

        process.stderr.on('data', (data) => { stderr += data.toString(); });
        process.on('error', fail);
        process.on('close', (code) => {
            if (stdoutBuffer.trim()) consumeLine(stdoutBuffer);
            if (code !== 0) fail(new Error(`进程退出码 ${code}: ${stderr}`));
            else succeed();
        });

        // 一次性调用可以立即关闭 stdin；如需暂停/继续，请保留 stdin，见“运行时控制消息”。
        process.stdin.write(JSON.stringify(userData) + '\n');
        process.stdin.end();
    });
}

// 使用示例
const userData = {
    characters: [[142420], [150010], [150020], [150030], [150040]],
    posters: [[230120, 12, 5], [230640, 10, 0], [231010, 10, 0], [330250, 10, 4], [330380, 10, 4]],
    accessories: [[330210], [332720], [430200], [430210], [430220]]
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
        for (const [flag, values] of [
            ['-mc', options.mandatoryCharacters],
            ['-mp', options.mandatoryPosters]
        ]) {
            if (values === undefined) continue;
            if (!Array.isArray(values) || values.length !== 10 || !values.every(Number.isInteger)) {
                reject(new TypeError(`${flag} 必须是恰好 10 个整数`));
                return;
            }
            args.push(flag, ...values.map(String));
        }

        const process = spawn(exePath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
        const results = [];
        let stderrOutput = '';
        let stdoutBuffer = '';
        let settled = false;

        const succeed = () => {
            if (!settled) {
                settled = true;
                resolve(results);
            }
        };
        const fail = (error) => {
            if (!settled) {
                settled = true;
                reject(error);
            }
        };

        function consumeLine(line) {
            if (!line.trim()) return;
            let msg;
            try {
                msg = JSON.parse(line);
            } catch {
                return; // 忽略当前版本混入 stdout 的普通诊断日志
            }

            if (Array.isArray(msg) && msg.length === 15) {
                results.push(msg);
                mainWindow.webContents.send('formation-progress', msg);
            } else if (msg && msg.error) {
                fail(new Error(msg.error));
            } else if (msg && msg.FIN) {
                succeed();
            }
        }

        process.stdout.on('data', (data) => {
            stdoutBuffer += data.toString();
            const lines = stdoutBuffer.split(/\r?\n/);
            stdoutBuffer = lines.pop();
            for (const line of lines) consumeLine(line);
        });

        process.stderr.on('data', (data) => {
            stderrOutput += data.toString();
        });

        process.on('error', fail);
        process.on('close', (code) => {
            if (stdoutBuffer.trim()) consumeLine(stdoutBuffer);
            if (code !== 0) fail(new Error(`进程退出码 ${code}: ${stderrOutput}`));
            else succeed();
        });

        // 一次性调用可以立即关闭 stdin；如需暂停/继续，请保留 stdin，见“运行时控制消息”。
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
        characters: [[142420], [150010], [150020], [150030], [150040]],
        posters: [[230120, 12, 5], [230640, 10, 0], [231010, 10, 0], [330250, 10, 4], [330380, 10, 4]],
        accessories: [[330210], [332720], [430200], [430210], [430220]]
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

    def append_constraint(flag, values):
        if values is None:
            return
        if len(values) != 10 or any(type(value) is not int for value in values):
            raise ValueError(f'{flag} 必须是恰好 10 个整数')
        args.extend([flag, *map(str, values)])

    if options:
        if options.get('data_dir'):
            args.extend(['-d', options['data_dir']])
        append_constraint('-mc', options.get('mandatory_characters'))
        append_constraint('-mp', options.get('mandatory_posters'))
    
    process = subprocess.Popen(
        args,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    
    stdout, stderr = process.communicate(json.dumps(user_data) + '\n')
    if process.returncode != 0:
        raise RuntimeError(f'进程退出码 {process.returncode}: {stderr}')

    results = []
    for line in stdout.splitlines():
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue  # 忽略当前版本混入 stdout 的普通诊断日志

        if isinstance(msg, list) and len(msg) == 15:
            results.append(msg)
        elif isinstance(msg, dict) and msg.get('error'):
            raise RuntimeError(msg['error'])

    return results

# 使用示例
user_data = {
    "characters": [[142420], [150010], [150020], [150030], [150040]],
    "posters": [[230120, 12, 5], [230640, 10, 0], [231010, 10, 0], [330250, 10, 4], [330380, 10, 4]],
    "accessories": [[330210], [332720], [430200], [430210], [430220]]
}
results = run_formation(user_data)
```

## 输入格式

### 用户数据（通过 stdin 传入 JSON）

```json
{
    "characters": [[142420], [150010], [150020], [150030], [150040]],
    "posters": [[230120, 12, 5], [230640, 10, 0], [231010, 10, 0], [330250, 10, 4], [330380, 10, 4]],
    "accessories": [[330210], [332720], [430200], [430210], [430220]]
}
```

首次写入 stdin 的用户数据必须是完整的单行 JSON。各列表元素至少满足以下结构；账号导出数据中的其余字段可以保留：

| 字段 | 最小元素格式 | 本模块使用的值 |
|------|--------------|----------------|
| `characters` | `[角色卡ID]` | 第 1 项，即角色卡 ID |
| `posters` | `[海报ID, 等级, 额外等级]` | 前 3 项 |
| `accessories` | `[饰品ID]` | 第 1 项，即饰品 ID |

当前实现不会把 `[1, 2, 3]` 这样的扁平 ID 数组自动转换为嵌套数组。

可选 master 数据覆盖字段可以和 `characters` 同级传入：

| 字段 | 对应本地文件 | 说明 |
|------|-------------|------|
| `characters_data` | `CharacterMaster.json` | 角色主数据。传入后优先使用该字段，不再读取本地角色主数据文件。 |
| `posters_ability_data` | `PosterAbilityMaster.json` | 海报能力主数据。传入后优先使用该字段，不再读取本地海报能力文件。 |
| `effects_data` | `EffectMaster.json` | 效果主数据。传入后优先使用该字段，不再读取本地效果文件。 |

这些字段都是可选字段；不传时仍按 `-d/--data` 指定的数据目录读取本地文件。字段一旦存在就会直接作为覆盖值使用，因此不要传 `null`。饰品映射 `accessory_processed.json` 目前不能通过 stdin 覆盖，始终从 `-d/--data` 指定的目录读取。

### 运行时控制消息（暂停/继续）

首次写入 stdin 的 JSON 必须是用户数据。进程运行期间可以继续向 stdin 写入控制消息，每行一个 JSON 对象：

```json
{"Control": "stop"}
{"Control": "continue"}
{"FIN": true}
```

| 消息 | 说明 |
|------|------|
| `{"Control": "stop"}` | 暂停 stdout 输出新的阵容结果。计算任务可能仍会继续，输出队列满后会自然产生背压。 |
| `{"Control": "continue"}` | 恢复 stdout 输出阵容结果。 |
| `{"FIN": true}` | 结束 stdin 监听，但不会取消正在进行的阵容计算。若为了暂停/继续而保留 stdin，收到 stdout 的 `{"FIN": true}` 后应发送该消息或关闭 stdin，让进程正常退出。 |

Node.js 控制示例：

```javascript
const child = spawn('Start.exe', args, { stdio: ['pipe', 'pipe', 'pipe'] });

child.stdin.write(JSON.stringify(userData) + '\n');

function pauseFormation() {
    child.stdin.write(JSON.stringify({ Control: 'stop' }) + '\n');
}

function resumeFormation() {
    child.stdin.write(JSON.stringify({ Control: 'continue' }) + '\n');
}

function finishInput() {
    child.stdin.write(JSON.stringify({ FIN: true }) + '\n');
    child.stdin.end();
}
```

如果不需要暂停/继续，可以像前面的示例一样，在写入用户数据后立即调用 `stdin.end()`。

### 命令行参数

| 短参数 | 长参数 | 类型 | 默认值 | 说明 |
|--------|--------|------|--------|------|
| `-d` | `--data` | string | `data` | 游戏数据目录路径 |
| `-mc` | `--mandatory_characters` | 10 个整数 | `[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]` | 必选角色卡，以及可选的固定位置 |
| `-mp` | `--mandatory_posters` | 10 个整数 | `[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]` | 必选海报，以及可选的绑定角色卡 |

#### `-mc` 与 `-mp` 的共同输入规则

- 每个参数都必须紧跟 **恰好 10 个整数**，逻辑上是 5 组二元组。
- `-mc` 的每组是 `(角色卡ID, 阵容位置)`；`-mp` 的每组是 `(海报ID, 绑定角色卡ID)`。
- 五组二元组的书写顺序本身不代表阵容位置；位置由 `-mc` 的第二项或 `-mp` 所绑定角色的实际位置决定。
- 不足 5 组时，剩余组必须用 `0 0` 补齐。完全没有约束时可以直接省略整个参数。
- 命令行中应传入 10 个独立、以空格分隔的整数。不能传带 `[]`、逗号的 JSON 数组，也不能把整串数字放进同一对引号；进程参数数组应展开为“参数名 + 10 个值”共 11 项。
- ID 应来自本次用户数据：角色卡 ID 对应 `characters[*][0]`，海报 ID 对应 `posters[*][0]`。

#### `-mc`：必选角色与固定位置

格式：

```text
-mc 角色卡ID1 位置1 角色卡ID2 位置2 ... 角色卡ID5 位置5
```

第二个值的含义：

| 位置值 | 行为 |
|--------|------|
| `0` | 该角色必须入队，但可出现在任意尚未占用的位置 |
| `1`～`5` | 该角色必须入队，并固定在对应位置；分别对应输出的 `c1`～`c5` |

示例：

```bash
-mc 150010 1 150020 0 0 0 0 0 0 0
```

它表示：

- 角色卡 `150010` 必须位于第 1 位，即所有结果都满足 `characters[0] == 150010`。
- 角色卡 `150020` 必须入队，但可以位于第 2～5 位中的任意空位。
- 后三组 `0 0` 没有约束，其余位置由程序补全。

#### `-mp`：必选海报与角色绑定

格式：

```text
-mp 海报ID1 绑定角色卡ID1 海报ID2 绑定角色卡ID2 ... 海报ID5 绑定角色卡ID5
```

第二个值的含义：

| 绑定角色卡 ID | 行为 |
|---------------|------|
| `0` | 该海报必须入队，但可放在任意尚未占用的海报位置 |
| 非 `0` | 当该角色卡出现在阵容中时，把海报放到该角色卡的同一位置 |

示例：

```bash
-mp 330380 150030 230120 0 0 0 0 0 0 0
```

它表示：

- 若角色卡 `150030` 入队，海报 `330380` 必须与它处于同一位置。例如角色在 `c3`，海报就在 `p3`。
- 海报 `230120` 必须入队，但位置不限。
- `150030` 是角色卡 ID，**不是**位置编号，也不是 `CharacterBaseMasterId`。

`-mp` 不会自动强制它绑定的角色入队。如果角色卡 `150030` 没有出现在某个候选阵容中，当前实现会忽略该候选阵容上的 `330380 -> 150030` 约束。若要保证两者始终同时出现，应组合使用：

```bash
Start.exe -mc 150030 0 0 0 0 0 0 0 0 0 -mp 330380 150030 0 0 0 0 0 0 0 0
```

以上参数保证角色卡 `150030` 必定入队且位置不限，海报 `330380` 会跟随它放在同一位置。调用时仍需通过 stdin 提供用户数据。源码入口的参数写法相同：

```bash
python Start.py -mc 150030 0 0 0 0 0 0 0 0 0 -mp 330380 150030 0 0 0 0 0 0 0 0
```

#### 约束冲突与调用方校验

当前实现不主动校验 `-mc` / `-mp` 的库存、ID 合法性和约束冲突。调用方应确保：

- `-mc` 的位置只使用 `0`～`5`；不要使用负数或大于 `5` 的值。
- 同一角色卡不要重复填写，同一固定位置不要分配给多个角色卡。
- 同一海报不要重复填写，不要把多张海报绑定到同一角色卡。
- 所有指定的角色卡和海报均存在于本次用户数据中，并且组合符合游戏规则。

冲突项可能被后面的二元组静默覆盖，部分无效 ID 也可能直到生成阶段才报错，因此建议前端在启动进程前完成上述校验。

## 输出格式

### stdout（按行输出）

阵容结果是包含 15 个元素的 JSON 数组，每行一个：
```json
[c1, c2, c3, c4, c5, p1, p2, p3, p4, p5, a1, a2, a3, a4, a5]
```

当前版本还会把 `check data...`、`cost time...`、`Finished` 等普通诊断文本写入 stdout。因此调用方应按行维护缓冲区，仅处理能成功解析的 JSON；不要假设一次 `data` 事件恰好对应一整行。

**字段说明：**
| 索引 | 说明 | 示例 |
|------|------|------|
| 0-4 | 角色 ID（5个） | `[142420, 150010, 150020, 150030, 150040]` |
| 5-9 | 海报 ID（5个） | `[230110, 230640, 231010, 330250, 330390]` |
| 10-14 | 饰品 ID（5个） | `[331670, 331670, 331670, 331670, 331670]` |

**示例输出：**
```json
[142420, 150010, 150020, 150030, 150040, 230110, 230640, 231010, 330250, 330390, 331670, 331670, 331670, 331670, 331670]
```

**解析示例：**
```javascript
const result = JSON.parse(line);
if (Array.isArray(result) && result.length === 15) {
    const characters = result.slice(0, 5);    // 角色
    const posters = result.slice(5, 10);      // 海报
    const accessories = result.slice(10, 15); // 饰品
}
```

### 结束标志
```json
{"FIN": true}
```

stdout 输出该标志表示没有更多阵容结果。它不同于 stdin 控制消息中的 `{"FIN": true}`：前者由程序输出，后者由调用方输入，用于结束控制输入监听。

### 输入错误

缺少 stdin 用户数据、JSON 无效或缺少必填字段时，主入口会把错误对象写入 stdout，且进程可能仍以退出码 `0` 结束：

```json
{"error": "Missing required fields: ['posters']"}
```

调用方应同时检查 JSON 错误对象、进程退出码和 stderr。

### stderr

`argparse` 参数错误和未捕获异常通常写入 stderr，并以非零状态退出。

## 项目结构与调用链

与 `-mc` / `-mp` 相关的主调用链如下：

```text
Start.py / Start.exe
    ├─ src/args.py                 解析 -mc / -mp，各读取 10 个整数
    └─ src/ActorFormation.py       解释五组约束并生成角色、海报状态
         ├─ -mc -> CheckUnrepeated.urp_filter_i() / processor_character()
         ├─ -mp -> CheckUnrepeated.urp_filter_p() / processor_poster()
         └─ src/FindPosterSolutions.py  计算各角色可用的海报候选
              ↓
       src/FindAccessorySolutions.py    扩展饰品组合
              ↓
       Start.py stdout                  逐行输出完整阵容
```

仓库中的主要文件：

```text
YumesuteAutoTeamUp/
├─ Start.py                       主进程接口：stdin 输入、stdout 输出
├─ StartForServer.py              实验性的本地计算服务入口
├─ src/
│  ├─ args.py                     命令行参数定义
│  ├─ ActorFormation.py           角色/海报约束与阵容枚举
│  ├─ FindPosterSolutions.py      海报效果过滤与候选求解
│  ├─ FindAccessorySolutions.py   饰品组合扩展
│  ├─ FindCharacterSolutions.py   预留的角色预筛选模块
│  └─ pipeline.py                 实验性的 Server 请求流水线
├─ scripts/                       更新、启动与模块测试脚本
├─ data/                          游戏主数据及饰品预处理数据
├─ dist/                          PyInstaller 产物
└─ API.md                         进程接口文档
```

`StartForServer.py` / `src/pipeline.py` 当前不属于稳定公共 API，主调用方应使用 `Start.py` 或 `Start.exe`。

最小部署结构：

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

1. `-d/--data` 的相对路径以子进程的当前工作目录为基准，不是以 `Start.exe` 所在目录为基准。前端集成时建议传绝对路径。
2. 运行时至少需要 `CharacterMaster.json`、`PosterAbilityMaster.json`、`EffectMaster.json` 和 `accessory_processed.json`；即使通过 stdin 覆盖前三份 master，最后一份仍必须存在于数据目录。
3. 结果会实时输出，但内部使用集合枚举，顺序不保证稳定。
4. 候选结果数量可能很大，调用方应异步读取、按行缓冲，并及时处理 stdout 以形成背压。
