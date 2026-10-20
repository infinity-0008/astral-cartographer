# M3 — The Astral Cartographer

**A dark, developer-first repository atlas for JavaScript and TypeScript.** Paste a public GitHub URL or upload a ZIP, then explore module dependencies, inspect source and AST-derived metrics, identify circular imports and architectural hotspots, estimate change impact, and find a contributor-friendly learning path.

This repo is built against the attached *M3 Astral Cartographer: Full Build Guide*. It includes a React/Vite frontend and a Node/Express analysis backend, with MongoDB job metadata and gzip-compressed analysis results on disk.

## Features

### Frontend

- Dark-mode repository launch page with GitHub URL validation, ZIP drag/drop, recent analyses, a workflow overview and FAQs.
- Analysis progress screen streamed over Server-Sent Events (SSE), with API polling fallback.
- Interactive Cytoscape dependency atlas with file/folder views, zoom/focus, health/folder/complexity/churn coloring, extension/risk/cycle filters, source lookup and a live development FPS meter. Repositories with 500+ source files open folder-first to keep the initial canvas manageable.
- Read-only source panel with line numbers, function inventory, import/export information, complexity, health flags, fan-in/fan-out, blast radius, and unresolved dependency diagnostics.
- Hotspot scatter plot, risk-ranked file table, cycles explorer, folder composition tiles, starter-file ranking and dependency-first learning levels.
- Pull-request/change impact checker estimating affected files and test paths from the static import graph.
- Desktop/laptop-optimized layout that adapts key workflows for mobile screens.

### Backend

- Public GitHub URL validation and safe ZIP ingestion.
- Source scanning for `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs` (no other languages claimed).
- Babel AST parsing in a Piscina worker pool; per-file compressed parse cache and whole-analysis compressed cache.
- Import/re-export/`require()`/dynamic-import collection, export mapping, static best-effort call-graph resolution, TypeScript path aliases, workspace packages and extension fallbacks.
- Iterative Tarjan strongly-connected components and readable cycle paths; fan metrics, blast radius, affected-test estimates and dependency-first learning levels.
- Health/risk scoring, risk flags, change churn from usable Git history, contributor starter ranking and optional GitHub `good first issue` matching.
- REST API, bounded job queue, SSE progress, analysis status persistence in MongoDB.
- Resource limits, shell-free Git invocation, timeout guards, safe ZIP paths, duplicate-entry rejection, per-job temp folders and cleanup.

## Requirements

- Node.js 20 or later (npm included)
- Git installed and available on `PATH`
- Docker Desktop / Docker Engine for local MongoDB, or MongoDB 7+ running locally
- Network access for `npm install` and public GitHub clones

## Windows + VS Code setup

Open the extracted `astral-cartographer` folder in VS Code. From the project root terminal, run the following in order.

1. Start MongoDB:

   ```powershell
   docker compose up -d mongo
   ```

2. Copy the server environment template:

   ```powershell
   Copy-Item server/.env.example server/.env
   ```

3. (Optional) Configure the API URL for Vite. The default works locally, so this step is only needed if your API runs on a different host/port:

   ```powershell
   Copy-Item client/.env.example client/.env
   ```

4. Install dependencies for both workspaces from the project root:

   ```powershell
   npm install
   ```

5. Start API and frontend together:

   ```powershell
   npm run dev
   ```

6. Open **http://localhost:5173**. The API health endpoint is **http://localhost:4000/api/health**.

Use `Ctrl+C` in the terminal to stop the frontend and API. MongoDB can remain running. Stop it with `docker compose down` when it is no longer needed.

### macOS / Linux

```bash
docker compose up -d mongo
cp server/.env.example server/.env
npm install
npm run dev
```

### Run processes separately

```bash
npm run dev:server
npm run dev:client
```

### Build and test

```bash
npm test       # backend algorithm/API/ZIP safety tests
npm run build  # production frontend build
npm run bench  # serial-vs-worker parser benchmark on fixture directories
```

The benchmark script can also accept public repository URLs as arguments. Run the benchmark on the machine used for the demo and keep the generated `server/bench/results.md`; the <5-second parse and 60-FPS goals are not claimed until measured on a representative repository and browser.

## Validation status for this delivered snapshot

Static verification completed in the packaging environment: backend JavaScript syntax checks, frontend JSX parsing, CSS parsing, JSON configuration parsing, and relative frontend import checks passed. The fixture at `server/test/fixtures/syntaxError/broken.js` is intentionally invalid and exists to test parser error recovery.

The npm registry was unreachable from the packaging environment and the package metadata was not available in the local npm cache. Therefore, dependency installation, the Vitest suite, and the production Vite build were **not run here**. After installing dependencies locally, run `npm test` and `npm run build` before your submission/demo. Do not treat static syntax checks as a substitute for those tests.

## Typical demo flow

1. Start the app and show the launch page / supported source scope.
2. Paste a public GitHub repository URL or upload a ZIP archive.
3. Point out the progress stages: ingest, scan, parse, resolve, analyze, score, onboarding and persist.
4. In the Atlas, click nodes to inspect source, imports/exports, complexity, health flags and impact radius. Switch to folder view and compare node colors.
5. Open **Cycles** to inspect circular dependency paths; open **Hotspots** to inspect risk and complexity/change activity.
6. Open **Onboarding** to show recommended starter files and dependency-first learning levels.
7. Open **Impact** and paste changed repository paths to estimate downstream affected files and suggested tests.

## Architecture

```text
React + Vite + Zustand + Cytoscape
               | REST + SSE
               v
         Express API (4000)
               |
     bounded in-process job queue
               |
      ingest -> scan -> AST parse
               |       Piscina workers
      resolve imports/calls -> graph analysis
               |       Tarjan SCC / blast radius
      Git churn -> health score -> onboarding
               |
     MongoDB job metadata + gzip JSON cache
               + source snapshot on disk
```

The UI consumes the API's `AnalysisResult`-derived endpoints rather than parsing the repository itself. The pipeline result is a deterministic transformation of source files plus available Git history, which makes stages easier to test and cache.

## API overview

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | API and in-process queue status |
| `POST` | `/api/analyses` | `{ "url": "https://github.com/owner/repo" }` or multipart `zip` field |
| `GET` | `/api/analyses/:id` | Status, progress, metrics and errors |
| `GET` | `/api/analyses/:id/events` | SSE progress event stream (`progress`) |
| `GET` | `/api/analyses/:id/graph?view=file\|folder` | Cytoscape-ready nodes and edges |
| `GET` | `/api/analyses/:id/files/*` | File data, source snapshot, metrics, imports and functions |
| `GET` | `/api/analyses/:id/search?q=...` | File and function search matches |
| `GET` | `/api/analyses/:id/cycles` | Cycle inventory and readable paths |
| `GET` | `/api/analyses/:id/hotspots?limit=20` | Risk-ranked files and scatter-plot points |
| `GET` | `/api/analyses/:id/onboarding` | Starter recommendations and learning levels |
| `POST` | `/api/analyses/:id/impact` | `{ "files": ["src/app.js"] }` -> affected files/tests/risk |
| `GET` | `/api/analyses/:id/issues` | Optional good-first-issue file matches |

## Algorithms and complexity

- **AST parsing:** Babel parser/traverse collects imports, exports, functions, call candidates, tokens and cyclomatic complexity. Time is approximately `O(S)` in source size for a file.
- **Import resolution:** resolves relative paths, TypeScript path aliases, npm workspaces, TS ESM extension substitution and directory indexes. Expected work is about `O(I × K)` where `I` is import count and `K` is the small number of candidate extensions/path attempts.
- **Call graph:** uses Babel scope bindings for same-file functions and resolvable imported exports. Dynamic dispatch, callbacks, computed names and arbitrary object calls remain approximate/unresolved; the graph must not be presented as a runtime trace.
- **SCC/cycle detection:** iterative Tarjan runs in `O(V + E)` and avoids recursive stack overflow on deep graphs.
- **Blast radius:** reverse BFS is `O(V + E)` per file. Detailed affected paths are traversed when impact is requested; summary impact counts are calculated during graph analysis.
- **Health scoring:** with Git history, `risk = 0.40 × hotspot + 0.30 × godScore + 0.20 × inCycle + 0.10 × instabilityPenalty`; `health = round(100 × (1 − risk))`. Without usable history, structural weights are reweighted and results are explicitly marked approximate.
- **Onboarding:** ranks starter candidates by normalized blast radius, complexity, churn, LOC and test linkage. Learning levels are taken from the graph condensed by SCCs.

## Security notes and scope

- The backend accepts only HTTPS GitHub repository URLs matching `github.com/owner/repo`; it does not accept arbitrary hosts or clone URLs.
- Git is called through `execFile` with argument arrays, not a shell string.
- ZIP extraction blocks absolute/traversal paths and duplicate targets, with limits on compressed size, entries and declared uncompressed bytes.
- Repositories are read as text only. The analyzer does not import or execute user repository code or run its package scripts.
- Analysis start is rate-limited, source files and jobs have size/time caps, and per-job temporary directories are removed in `finally`.
- **This is a local contest prototype, not a public multi-tenant service.** It does not include user authentication or job ownership. Do not expose it to the public internet without adding authentication, authorization, rate/CPU/memory isolation, hardened deployment limits and persistent job scheduling.

## Honest limitations

- JavaScript and TypeScript files only, as scoped in the guide.
- Static call-graph resolution is best effort, not runtime-complete.
- Git churn needs usable Git history. ZIP analyses and shallow-history cases use approximate structural scoring.
- GitHub issue matching needs `GITHUB_TOKEN` in `server/.env` and is heuristic; without a token the endpoint may return unavailable or an API rate-limit error.
- Browser frame rate and parse-time goals depend on graph size, machine, browser and layout workload; measure them rather than claiming guaranteed 60 FPS or under-five-second analysis.
- ZIP content is size-limited and unsupported files are skipped; the UI does not claim those files were analyzed.

## Tool disclosure

- **Runtime/frameworks:** Node.js, Express, React, Vite and MongoDB/Mongoose.
- **Parsing/graph:** Babel parser and traverse, Piscina worker threads, Cytoscape and cytoscape-fcose.
- **UI utilities:** Zustand, Lucide React, custom CSS/SVG charts and components.
- **Ingestion/integrations:** Git via Node `execFile`, AdmZip and Octokit.
- **Security/ops:** Helmet, CORS and express-rate-limit.
- **Tests:** Vitest and Supertest.
- **AI assistance:** OpenAI ChatGPT assisted with project scaffolding, implementation, test planning and documentation. Review code and run tests before representing the system as production-ready.
