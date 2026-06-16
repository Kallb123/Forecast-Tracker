# Forecast-Tracker

Node.js service that runs in Docker, fetches free 7–14 day forecasts regularly, and writes historical forecast snapshots into InfluxDB 2 through the HTTP write API.

## What this collects

Each daily run fetches forecast days from Open-Meteo and stores:
- minimum temperature (`min_temp_c`)
- maximum temperature (`max_temp_c`)
- chance of rainfall (`rain_chance_pct`)
- weather summary (`description`, e.g. overcast/sunny/thunderstorm)
- weather code (`weather_code`)
- intensity (`intensity`), a custom 1–10 weather impact score derived from the forecast weather code
- UV index maximum (`uv_index`)

To compare forecast consistency over time, each point includes:
- `forecast_date` (the future date being predicted)
- `issue_date` (the day the forecast was generated)
- `horizon_days` (days between issue and forecast date)
- `source` (forecast provider, currently `open-meteo`)
- `location`

This makes it easy to query how the prediction for the same `forecast_date` changes as `issue_date` gets closer.

## Extensibility

Forecast providers are source abstractions. `OpenMeteoSource` is one implementation.  
Additional providers can be added by implementing a source that returns the normalized forecast shape:

```js
{
  source,
  forecastDate,
  minTempC,
  maxTempC,
  rainChancePct,
  weatherCode,
  description,
  intensity,
  uvIndex
}
```

Intensity is a custom 1–10 score, where 1 represents clear/full sun and 10 represents severe heavy snow or thunderstorms.

## Environment variables

Copy `.env.example` and set:

- `LATITUDE`, `LONGITUDE`, `LOCATION_NAME`
- `FORECAST_DAYS` (clamped to 7..14)
- `INFLUX_URL`, `INFLUX_ORG`, `INFLUX_BUCKET`, `INFLUX_TOKEN`
- `RUN_ON_START` (default `true`)
- `DRY_RUN` (default `false`, prints line protocol without writing)

## Run locally

```bash
npm test
npm start
```

## Run in Docker

```bash
docker build -t forecast-tracker .
docker run --rm --env-file .env forecast-tracker
```

## Run with Docker Compose

A `docker-compose.yml` is provided that starts both the forecast-tracker and an InfluxDB 2 instance.

The sample values in the file are pre-wired so the two services connect automatically. Before running, update `LATITUDE`, `LONGITUDE`, `LOCATION_NAME`, and — importantly — replace the `CHANGE_ME_*` credential placeholders with strong, unique values in both the `forecast-tracker` and `influxdb` service sections.

```bash
docker compose up -d
```

InfluxDB will be available at <http://localhost:8086>. Log in with the username and password set in the `influxdb` service environment (`admin` / `adminpassword` by default).
