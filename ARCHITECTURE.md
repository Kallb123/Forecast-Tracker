# Architecture

Forecast-Tracker records weather forecasts over time so that predictions for the same day can be
compared as that day approaches. It answers questions like *"what did Tuesday's forecast look like
ten days out, five days out, and on the day itself?"* and *"how accurate is a forecast N days
ahead, on average?"*.

## System overview

The system is three services, wired together by Docker Compose (`docker-compose.yml`):

```
                 ┌─────────────────────┐
                 │   Open-Meteo API    │  (external, free, no API key)
                 │ api.open-meteo.com  │
                 └──────────┬──────────┘
                            │ HTTPS GET (daily forecast JSON)
                            ▼
┌───────────────────────────────────────┐
│  tracker/  — collector (Node.js)      │
│  Scheduled fetch → normalize →        │
│  line protocol → Influx write API     │
└──────────────────┬────────────────────┘
                   │ POST /api/v2/write (line protocol)
                   ▼
        ┌─────────────────────┐
        │  InfluxDB 2         │  measurement: forecast_daily
        │  (official image)   │  bucket: weather_forecasts
        └──────────┬──────────┘
                   │ POST /api/v2/query (Flux, annotated CSV)
                   ▼
┌───────────────────────────────────────┐
│  ui/  — Express API + Vue 3 SPA       │
│  server.js queries Influx, serves     │
│  JSON API + built static frontend     │
└──────────────────┬────────────────────┘
                   │ GET /api/* (JSON)
                   ▼
              Browser (Chart.js charts + accuracy table)
```

There is no shared code between `tracker/` and `ui/`; they are independent npm packages that agree
only on the InfluxDB schema (and on reading the same `INFLUX_*` environment variables). The tracker
never talks to the UI and vice versa — InfluxDB is the sole integration point.

## The core data model

Everything hinges on the *forecast snapshot*: each collection run writes one point per forecast day,
tagged with both the date being predicted and the date the prediction was made.

**Measurement:** `forecast_daily` (written by `tracker/src/influx/forecastToLineProtocol.js`)

| Kind  | Name              | Meaning                                                        |
|-------|-------------------|----------------------------------------------------------------|
| tag   | `source`          | Forecast provider (currently always `open-meteo`)              |
| tag   | `location`        | Human-chosen location name (`LOCATION_NAME`)                   |
| tag   | `forecast_date`   | The future date being predicted (`YYYY-MM-DD`)                 |
| tag   | `issue_date`      | The date the forecast was generated (`YYYY-MM-DD`)             |
| field | `min_temp_c`      | Minimum temperature (°C, float)                                |
| field | `max_temp_c`      | Maximum temperature (°C, float)                                |
| field | `rain_chance_pct` | Max precipitation probability (%, float)                       |
| field | `weather_code`    | WMO weather code from the provider (float)                     |
| field | `intensity`       | Custom 1–10 impact score derived from the weather code (float) |
| field | `uv_index`        | Max UV index (float)                                           |
| field | `horizon_days`    | `forecast_date − issue_date` in days (integer, `i` suffix)     |
| field | `description`     | Weather-code name, e.g. `"overcast"` (string)                  |

The point timestamp is the collection time (`generatedAt`, second precision). Because
`forecast_date` and `issue_date` are **tags**, Flux queries can filter and group on them cheaply —
this is what makes "show every prediction ever made for date X" a simple query. A point with
`horizon_days == 0` (issued on the target day itself) is treated as the *reference* value when
computing accuracy: the UI compares every longer-horizon prediction against it.

Changing this schema is a cross-cutting change: the writer (`forecastToLineProtocol.js`), the Flux
queries and field lists in `ui/server.js`, and the frontend rendering in `ui/src/App.vue` all
enumerate the fields explicitly and must be updated together.

## The collector (`tracker/`)

A dependency-free CommonJS Node.js app (Node ≥ 18, relies on global `fetch`). Layout:

```
tracker/
├── src/
│   ├── index.js                        # entry point: scheduler + collection cycle
│   ├── config.js                       # env-var parsing → config object
│   ├── sources/
│   │   └── openMeteoSource.js          # provider: fetch + normalize + code maps
│   └── influx/
│       ├── forecastToLineProtocol.js   # normalized forecast → line protocol
│       └── influxWriter.js             # POST to Influx /api/v2/write
├── test/
│   └── forecastToLineProtocol.test.js  # node:test unit tests
├── Dockerfile
└── package.json                        # zero runtime dependencies
```

### Flow of a collection cycle (`runCollectionCycle` in `src/index.js`)

1. `getConfig()` (`config.js`) reads environment variables into `{ app, source, influx }`.
   `FORECAST_DAYS` is clamped to 7–14; `validateConfig` requires finite lat/long and, unless
   `DRY_RUN=true`, all four `INFLUX_*` values.
2. `createSource()` maps `FORECAST_SOURCE` to a source class — currently only `OpenMeteoSource`.
3. The source's `fetchDailyForecast({ latitude, longitude, forecastDays })` calls the Open-Meteo
   daily-forecast endpoint (UTC timezone) and returns an array of **normalized forecast objects**:

   ```js
   { source, forecastDate, minTempC, maxTempC, rainChancePct,
     weatherCode, description, intensity, uvIndex }
   ```

4. `buildPayload()` converts each forecast into one line-protocol line (computing `horizon_days`
   from `issue_date` vs `forecast_date`, and escaping tag/field strings per the line-protocol
   rules).
5. If `DRY_RUN=true` the payload is printed and nothing is written; otherwise
   `InfluxWriter.writeForecastPayload()` POSTs it to `/api/v2/write?precision=s`.

### Scheduling

`startScheduler()` runs a cycle immediately when `RUN_ON_START=true` (default) and then every
`intervalMs` via `setInterval`. The interval is hard-coded in `config.js` as `DAY_MS / 6` — i.e.
**every 4 hours**, not configurable by env var. Errors in a cycle are logged and swallowed so the
scheduler keeps running. Because each run stamps points with the current time, multiple runs per day
produce multiple snapshots per `issue_date`; the UI's history endpoint returns all of them.

### Extensibility: adding a forecast provider

Sources are the designed extension point. A provider is a class with a `name` and an async
`fetchDailyForecast({ latitude, longitude, forecastDays })` returning the normalized shape above.
To add one:

1. Create `tracker/src/sources/<provider>Source.js` implementing that contract.
2. Register it in `createSource()` in `tracker/src/index.js`.
3. Allow its name in the `FORECAST_SOURCE` check in `tracker/src/config.js`.

The `source` tag keeps providers separable in InfluxDB, so multiple providers can coexist in the
same bucket. `intensity` is a provider responsibility: Open-Meteo derives it from the WMO weather
code via `INTENSITY_MAP` (1 = clear/full sun … 10 = severe snow/thunderstorm, unknown codes → 5);
new providers should map their own condition vocabulary onto the same 1–10 scale.

### Testability

`OpenMeteoSource` and `InfluxWriter` both accept a `fetchImpl` constructor override for injecting a
fake `fetch` in tests. Tests use the built-in `node:test` runner (`npm test` → `node --test`).
`npm run smoke` performs one real collection cycle (used with `DRY_RUN=true` in CI, so it hits the
real Open-Meteo API but writes nothing).

## The UI (`ui/`)

An ES-module npm package with two halves that ship in one container:

```
ui/
├── server.js         # Express 5 API server + static file server
├── index.html        # SPA entry
├── vite.config.js    # Vue plugin, __APP_VERSION__ define, dev proxy for /api
├── src/
│   ├── main.js       # mounts the Vue app
│   └── App.vue       # entire frontend: state, API calls, charts, styles
└── Dockerfile        # stage 1: vite build → dist/; stage 2: server.js + dist/
```

### Backend (`server.js`)

Express 5 server that is the only thing allowed to hold the Influx token — the browser never talks
to InfluxDB directly. For each request it builds a Flux query, POSTs it to `/api/v2/query`, parses
the annotated-CSV response with a small hand-rolled parser (`parseInfluxCSV`), and returns JSON.

Routes (all under `/api`, rate-limited to 120 req/min/IP via `express-rate-limit`):

| Route                      | Query params        | Returns                                                       |
|----------------------------|---------------------|---------------------------------------------------------------|
| `GET /api/locations`       | —                   | Distinct `location` tag values                                |
| `GET /api/forecast-dates`  | `location`          | Distinct `forecast_date` values for a location                |
| `GET /api/forecast-history`| `date`, `location`  | Every snapshot for one `forecast_date`, sorted by time        |
| `GET /api/latest-outlook`  | `location`          | Newest snapshot per upcoming day, next 14 days                |
| `GET /api/accuracy-by-horizon` | `location`      | MAE + variance per horizon (0–14) vs the horizon-0 reference  |
| `GET /api/health`          | —                   | `{ status, version }`                                         |

Because user-supplied strings are interpolated into Flux query text, inputs are validated before
use: `location` must match `RE_SAFE` (`[a-zA-Z0-9 _-.]`, ≤128 chars) and `date` must match
`YYYY-MM-DD` and be a real calendar date. **Any new route that accepts query parameters must apply
the same validation pattern** — this is the injection boundary of the app.

`/api/latest-outlook` answers "what does the forecast look like right now": it pivots the last
seven days of snapshots, drops forecast dates already in the past, keeps the newest snapshot for
each remaining date, and returns the first 14. It is the only route that reads `weather_code` and
`description` — the UI maps the WMO code to an emoji for the look-ahead cards.

The accuracy computation lives server-side in `/api/accuracy-by-horizon`: it pivots all snapshots,
groups them by `forecast_date`, takes the horizon-0 snapshot as "actual", and accumulates absolute
errors per horizon into MAE and variance per metric. Fields missing on either side of a comparison
are skipped rather than coerced to 0.

In production, `server.js` also serves the built SPA from `dist/` with an SPA fallback to
`index.html`. If `dist/` is absent it warns and serves the API only.

### Frontend (`src/App.vue`)

A single-file Vue 3 component (Composition API, `<script setup>`) containing all state, API calls,
Chart.js rendering, template, and CSS. Data flow:

1. On mount, load locations; picking a location loads its forecast dates (defaulting to the nearest
   upcoming date) and kicks off the accuracy query.
2. Picking a date loads `/api/forecast-history` and renders three Chart.js line charts against the
   snapshot timeline (x-axis = when each forecast was issued):
   temperature + rain chance (dual y-axis), intensity (1–10 with emoji ticks), and UV index (with
   a custom plugin drawing WHO-style UV threshold lines).
3. Below the charts: a summary strip (latest snapshot values), a 14-day look-ahead of the newest
   forecast for each upcoming day (`/api/latest-outlook` — weather emoji, max/min temps, rain
   chance), and the accuracy-by-horizon table.

Chart instances are created/destroyed imperatively around each data load. The app version is baked
in at build time via the Vite `__APP_VERSION__` define from `package.json`.

In development, `vite` serves the frontend with HMR and proxies `/api` to `server.js` on port 3000
(`vite.config.js`), so both processes run side by side.

## Configuration

All configuration is via environment variables (see `.env.example`; compose sets them per service):

| Variable          | Used by      | Notes                                                     |
|-------------------|--------------|-----------------------------------------------------------|
| `LATITUDE`, `LONGITUDE` | tracker | Required (must be finite numbers)                          |
| `LOCATION_NAME`   | tracker, ui  | Tag value; UI uses it as the default location             |
| `FORECAST_DAYS`   | tracker      | Clamped to 7–14, default 14                               |
| `FORECAST_SOURCE` | tracker      | Only `open-meteo` accepted today                          |
| `INFLUX_URL/ORG/BUCKET/TOKEN` | tracker, ui | Must match the `influxdb` service settings     |
| `RUN_ON_START`    | tracker      | Default `true`                                            |
| `DRY_RUN`         | tracker      | Print line protocol instead of writing; default `false`   |
| `UI_PORT`         | ui           | Default 3000                                              |

The tracker validates its config at startup; the UI server deliberately does not (it falls back to
defaults and surfaces Influx errors per request).

## Deployment & CI

- **Images:** `tracker/Dockerfile` (single stage, prod deps + `src/`) and `ui/Dockerfile`
  (multi-stage: Vite build then runtime with `server.js` + `dist/`). Both are `node:20-alpine`.
- **Compose:** `docker-compose.yml` runs `forecast-tracker`, `forecast-ui` (port 3000), and
  `influxdb:2` (port 8086, persistent volume, healthcheck). Both app services wait for the Influx
  healthcheck. Credentials are `CHANGE_ME_*` placeholders that must be replaced, identically, in
  the app services and the Influx init variables.
- **CI (GitHub Actions):**
  - `test-collector.yml` — on PRs touching `tracker/`: `npm test`, `node --check` on every source
    file, and a `DRY_RUN=true` smoke run against the real Open-Meteo API.
  - `test-ui.yml` — on PRs touching `ui/`: `npm ci && npm run build` (build must succeed; there are
    no UI unit tests).
  - `docker-publish.yml` — on published GitHub releases: builds and pushes both images to GHCR
    (`ghcr.io/<repo>/tracker` and `.../ui`) tagged with the release semver and `latest`.
- **Versioning:** `tracker/package.json` and `ui/package.json` carry independent versions. The
  tracker logs its version at startup; the UI shows its version in the page footer and
  `/api/health`. Version bumps are made in ordinary commits; publishing happens via GitHub
  releases.

## Design decisions worth knowing

- **Zero runtime dependencies in the tracker.** HTTP is native `fetch`, tests are `node:test`, line
  protocol is built by hand. Keep it that way unless there's a strong reason not to.
- **Raw HTTP to InfluxDB, no client library** (both services). The write path speaks line protocol
  directly; the read path speaks Flux and parses annotated CSV by hand. The schema section above is
  the contract.
- **Append-only data.** Nothing ever updates or deletes points; accuracy is computed at read time
  from the full history. New snapshot runs simply add points at new timestamps.
- **The UI server is a thin trusted proxy.** It exists to keep the Influx token off the client and
  to validate inputs before they reach Flux. Business logic beyond aggregation should not
  accumulate there without good reason.
