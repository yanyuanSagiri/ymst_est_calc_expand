# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

| Command | Description |
|---------|-------------|
| `pnpm run dev` | Start Vite dev server (port 5174) |
| `pnpm run build` | Vite production build + copy `draggable.min.js` to dist/ |
| `pnpm run preview` | Vite preview of built output |
| `pnpm run test` | Run all Jest tests |
| `pnpm run test-watch` | Jest in watch mode |
| `pnpm run lint` | ESLint check |
| `pnpm run lint-fix` | ESLint auto-fix |
| `pnpm run electron:dev` | Launch Electron in dev mode |
| `pnpm run electron:build` | Full Electron portable exe build |
| `pnpm run electron:pack-only` | Build portable exe only (no sign) |
| `pnpm run electron:preview` | Build web + preview in Electron |

- Single test file: `test/logic.test.js` — run individual tests with `pnpm run test -- -t "test name"`
- Jest is configured via Vite (no separate jest.config.js)
- Tests mock `fetch` to read local JSON files for GameDb data

## Project Overview

梦舞台 演技力计算器 (YumeSute Performance Calculator) — a score calculator and party optimizer for the mobile game "Dream Stage" (夢ステージ). Based on [esterTion/yumesute-calc](https://github.com/esterTion/yumesute-calc), extended with triple cast mode, album optimization, and Electron desktop support.

**Tech stack:** Vanilla JavaScript (no framework), Vite 8, pnpm, Jest, Electron + electron-builder, ESLint 9

## Key Architecture

### Entry Point
- `index.html` → `src/main.js` instantiates `RootLogic` on `window.root`
- All calculation logic and UI management flows through `RootLogic`

### Core Calculation (`src/logic/`)
- **`RootLogic.js`** — Main controller (~3400 lines). Manages app state, UI construction, event handling, save/load to localStorage, import/export as JSON. Has a version migration system (versions 2-7) for backward compatibility.
- **`ScoreCalculator.js`** — Orchestrates full score calculation. Applies all passive effects (album, poster, accessory, bloom, leader sense, theater, notation buffs, HighScore), runs stat calc, then delegates to `LiveSimulator` for the live simulation phase.
  - `calcPure()` — headless variant (no DOM rendering), used by auto-party workers.
  - `calcStarActCountOnly()` — lightweight variant that tracks only starAct triggers without computing full scores.
- **`LiveSimulator.js`** — Runs the performance timeline simulation. Tracks sense timings, light collection, StarAct conditions, life/principal gauge, and score accumulation. Produces a `scoreTimeline` array.
- **`MergedLiveSimulator.js`** — For triple cast mode: merges 3 independent axis simulations into a unified timeline with cross-axis score sharing.
- **`StatCalculator.js`** — Computes final character stats by applying percentage buffs and flat bonuses from 5 sources (album, actor, poster, accessory, other), respecting percentage caps per stat.
- **`AutoPartyWorkerPool.js` + `AutoPartyWorker.js`** — Web Worker pool for exhaustive party search. Two-phase protocol: Phase 1 collects max starAct counts from workers, broadcasts the global threshold; Phase 2 scores only combinations meeting the threshold.
- **`WebGPUStarActCounter.js`** — WGSL compute shader for GPU-accelerated pre-filtering of party combinations before the CPU scoring phase.

### Data Models (`src/character/`, `src/poster/`, `src/accessory/`)
- **CharacterData** — Character with stats, sense abilities (up to 5 slots), StarAct requirements, leader sense, bloom bonuses, categories, star rank
- **PosterData** — Poster with abilities (level + release), ability branches selected based on live context
- **AccessoryData** — Accessory with main effects and random effects
- Each model has `toJSON()`/`fromJSON()` for persistence and a DOM update cycle

### Effect System (`src/effect/`)
- Base **`Effect`** class reads from `GameDb.Effect[id]`, resolves active effect level
- **40+ subclasses** in `src/effect/types/` — each implementing `canTrigger()` and `applyEffect()` for a specific mechanic (stat ups, score gains, light management, life/principal gauge, sense cooldown, StarAct manipulation)
- Effects have `FireTimingType` (Passive, StartLive, OnSense, AfterSense, OnStarAct, Final), trigger conditions, range (Self/All), and calculation type (PercentageAddition/FixedAddition/Multiplication)

### Game Database (`src/db/`)
- **`GameDb.js`** — Static class that stores all game data fetched from remote CDN. Keys: Character, CharacterBase, Sense, StarAct, Effect, Poster, Accessory, SenseNotation, etc.
- **`AtlasDb.js`** — Sprite atlas CSS loading for card icons (fetched from CDN)
- **`Enum.js`** — Attribute/SenseType enums
- **`ConstText.js`** — Multi-language text system (zh/ja/en), auto-detects from browser, persists to localStorage

### UI Layer (`src/manager/`)
- **`PartyManager.js`** — Party management for normal mode: save/switch/delete parties, drag-and-drop reordering (via Shopify Draggable), character/poster/accessory slot assignment
- **`TripleCastManager.js`** — Three-axis party management for triple cast mode
- **`HighScoreBuffManager.js`** — HighScore challenge buff configuration
- **`FilterManager.js`** + filters/ — Filter/sort system for character, poster, accessory, and photo effect inventories
- **`SideMenuManager.js`** — Side navigation menu
- **`GachaViewer.js`** — Gacha simulation viewer
- DOM creation via `createElement.js` utility (`_` function — analogous to `h()` in virtual DOM libraries)

### Auto-Party / Formation Optimization
- **Web Workers** — `AutoPartyWorkerPool` distributes search across `navigator.hardwareConcurrency` workers. Each worker iterates character/poster/accessory permutations and evaluates scores via a bundled `ScoreCalculator`
- **WebGPU** — Optional GPU pre-filter using `WebGPUStarActCounter` (WGSL compute shader) to identify promising combinations before CPU scoring
- **Python Integration** — `pyScript/` contains a standalone Python-based formation optimizer (packaged as `Start.exe`). Communicates via stdin/stdout JSON-lines protocol. Integrated through `electron/main.js` IPC (spawns child process) or browser via `RootLogic.handleAutoPartyPythonStream()`.

### Electron (`electron/`)
- **`main.js`** — Electron main process. Loads Vite dev URL in dev mode, dist/index.html in production. Handles `run-formation` IPC for Python formation process.
- **`preload.js`** — `contextBridge` for secure IPC

### State Persistence
- `localStorage` key `"appState"` stores the full application state as JSON
- Auto-saves on `blur` and `unload` events
- Import/Export via JSON file download/upload
- Version field in the state enables forward-compatible migrations

### CDN References
- Game master data: `https://redive.estertion.win/wds/calc/master/`
- Sprite atlas: `https://redive.estertion.win/wds/sprite/`
- Dev proxy: `/wds-api` → `https://redive.estertion.win`

## Conventions
- Vanilla JS, no frameworks
- DOM manipulation via custom `_()` helper (`createElement.js`)
- Two-space indent, Unix line endings, `"eol-last": "always"`
- `window.root` is the global `RootLogic` singleton
- Configuration sidecars (`.json`, `.mjs`) at project root
- All game data is fetched at runtime, not bundled
