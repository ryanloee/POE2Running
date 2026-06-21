# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

POE2 BD 智能配装助手 — an Electron desktop app for Path of Exile 2 (Chinese server / WeGame). Users paste a share code to view full build data and get AI-powered analysis. All UI text is in Chinese.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Start Vite dev server + Electron with hot reload |
| `npm run build` | Build renderer to `dist-renderer/` |
| `npm start` | Launch Electron in production mode (loads built assets) |

There are no tests, linters, or formatters configured.

## Architecture

**Electron + Vue 3 + Vite.** Plain JavaScript throughout (no TypeScript).

### Process Boundary

- **Main process** (`electron/`): Node.js, handles all network/file I/O. Registers IPC handlers via `ipcMain.handle()`.
- **Preload** (`electron/preload.js`): Exposes `window.api.*` to renderer via `contextBridge`. Uses a `plain()` deep-copy to strip Vue Proxy objects before IPC serialization.
- **Renderer** (`src/`): Pure Vue 3 Composition API (`<script setup>`). Calls `window.api.xxx()` for all backend work. No Node.js access.

### IPC Channels

All communication flows through named channels defined in `preload.js` → handled in `main.js`:
- `poe2:fetch` — WeGame BD data fetch (7 API endpoints in `services/poe2.js`)
- `ai:analyze` / `ai:chunk` / `ai:test` — LLM streaming (SSE) analysis
- `export:report` — Text report generation
- `doc:parse` — Document upload parsing (docx/pptx/txt/md/images)
- `settings:get` / `settings:save` — Persist config to `userData/settings.json`
- `knowledge:*` / `kb:progress` — RAG knowledge base operations

### State & Routing

No Vuex/Pinia, no Vue Router. `App.vue` holds global state (`tab`, `settings`, `bd`, etc.) and passes it as props to child views. Tab navigation is a `ref` + `v-show`.

### Services (`electron/services/`)

| File | Role |
|---|---|
| `poe2.js` | WeGame API client — fetches BD, parses equipment mods, skill groups |
| `ai.js` | LLM client — supports OpenAI-compatible and Anthropic streaming APIs |
| `doc.js` | Document parser — mammoth (docx), jszip (pptx), plain text/images |
| `export.js` | Prompt templates + text report builder (single/compare/doc scenes) |
| `knowledge/builder.js` | Downloads PoB2 Lua data from GitHub, parses to `documents.json` |
| `knowledge/indexer.js` | Embeds documents via OpenAI-compatible `/v1/embeddings` API |
| `knowledge/retriever.js` | Cosine similarity search over vector store |

### Styling

Single global stylesheet `src/style.css` with CSS custom properties (dark theme, gold accent `--accent: #c9a96a`). Component-scoped styles via `<style scoped>`.

## Key Patterns

- **IPC payload safety**: All renderer→main data must go through `plain()` in `preload.js` to avoid Vue Proxy serialization errors.
- **AI streaming**: SSE parsing in `ai.js` pushes deltas via `ai:chunk` channel; renderer accumulates them reactively.
- **Knowledge base (RAG)**: fetcher → luaparse → documents.json → embedding indexer → vectors.json → cosine retriever. Injected into AI system prompts.
- **Module system split**: Electron main uses CommonJS (`require`); renderer/Vite uses ES modules (`import`).
