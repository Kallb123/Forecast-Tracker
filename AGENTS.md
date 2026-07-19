# AGENTS.md

Guidance for AI coding agents and human contributors working on Forecast-Tracker.

## What this project is

Forecast-Tracker captures weather forecast snapshots over time so predictions for the same day can
be compared as it approaches. A Node.js collector (`tracker/`) fetches daily forecasts from
Open-Meteo every 4 hours and writes them to InfluxDB 2 as line protocol; an Express + Vue 3 app
(`ui/`) queries InfluxDB and visualizes how each day's forecast evolved, plus accuracy statistics
by forecast horizon. Docker Compose ties the two services and InfluxDB together.

**Read [ARCHITECTURE.md](ARCHITECTURE.md) before making non-trivial changes.** It covers the data
model (the `forecast_daily` measurement schema), the collection cycle, the API routes, the
provider extension point, and the design decisions that constrain changes here.

## Repository map

| Path | What it is |
|------|------------|
| `tracker/` | Collector service — CommonJS, Node ≥ 18, **zero runtime dependencies** |
| `tracker/src/index.js` | Entry point: scheduler + collection cycle |
| `tracker/src/config.js` | Env-var parsing and validation |
| `tracker/src/sources/` | Forecast providers (add new providers here) |
| `tracker/src/influx/` | Line-protocol builder + Influx write client |
| `tracker/test/` | `node:test` unit tests |
| `ui/` | Web app — ES modules, Express 5 API (`server.js`) + Vue 3 SPA (`src/App.vue`) |
| `docker-compose.yml` | Full stack: tracker + ui + InfluxDB 2 |
| `.github/workflows/` | CI: collector tests, UI build, GHCR image publish on release |

## Building and testing

Each service is an independent npm package — run commands from inside its directory.

```bash
# Collector
cd tracker
npm test                                     # unit tests (node --test)
find src -name '*.js' -exec node --check {} \;   # syntax check (CI does this)
DRY_RUN=true LATITUDE=51.5 LONGITUDE=-0.1 npm run smoke   # one real fetch, prints line protocol

# UI
cd ui
npm ci
npm run build        # must succeed — this is the CI gate for ui/ changes
npm start            # API server on :3000 (needs INFLUX_* env to return data)
npm run dev          # Vite dev server with HMR, proxies /api to :3000
```

There is no linter or formatter configured; match the style of surrounding code. CI runs on PRs to
`main` only for the paths each workflow watches (`tracker/**` or `ui/**`).

## Rules and gotchas

- **The InfluxDB schema is a cross-service contract.** Tags and fields of `forecast_daily` are
  enumerated explicitly in `tracker/src/influx/forecastToLineProtocol.js`, in the Flux queries and
  pivot field lists in `ui/server.js`, and in the frontend rendering in `ui/src/App.vue`. Adding or
  renaming a field means updating all three, plus the schema table in ARCHITECTURE.md and the field
  list in README.md. Data already in InfluxDB is append-only history — never assume old points can
  be rewritten to match a new schema.
- **Keep the tracker dependency-free.** It deliberately uses native `fetch`, `node:test`, and
  hand-built line protocol. Don't add npm dependencies to `tracker/` without strong justification.
- **Validate anything interpolated into Flux.** `ui/server.js` builds Flux queries by string
  interpolation. Every user-supplied value must pass the existing validators (`isSafeLocation`,
  `RE_DATE`) or an equivalently strict check before it touches a query. The Influx token lives only
  in the server; never expose it to the browser or add client-side Influx calls.
- **Module systems differ.** `tracker/` is CommonJS (`require`/`module.exports`); `ui/` is ESM
  (`import`/`export`). Don't mix them.
- **`intensity` is a custom 1–10 score**, mapped from WMO weather codes in
  `tracker/src/sources/openMeteoSource.js` (1 = clear, 10 = severe snow/thunderstorm, unknown → 5).
  The UI's emoji axis ticks and accuracy table assume this scale.
- **Adding a forecast provider** touches three places: a new class in `tracker/src/sources/`
  returning the normalized forecast shape, registration in `createSource()`
  (`tracker/src/index.js`), and the `FORECAST_SOURCE` allow-list in `tracker/src/config.js`. See
  ARCHITECTURE.md → "Extensibility".
- **Config is env-vars only** — document any new variable in `.env.example`, `docker-compose.yml`,
  and README.md. The collection interval (4 hours) is currently hard-coded in
  `tracker/src/config.js`, not an env var.
- **Versioning:** `tracker/package.json` and `ui/package.json` are versioned independently and
  historically bumped in small increments alongside changes; Docker images are published to GHCR
  only when a GitHub release is published.

## Conventions

- Small, focused commits with imperative-mood messages (e.g. "Add latest intensity and UV index to
  summary"), typically merged via PRs to `main`.
- Log lines are prefixed with the service name: `[forecast-tracker]` / `[forecast-ui]`.
- Tests exist only for the collector's pure logic (`tracker/test/`); when changing
  `forecastToLineProtocol.js` or adding pure functions to the tracker, extend those tests. UI
  changes are verified by `npm run build` and manual checking.
- Keep secrets out of the repo — compose and `.env.example` use `CHANGE_ME_*`/placeholder values
  only.
