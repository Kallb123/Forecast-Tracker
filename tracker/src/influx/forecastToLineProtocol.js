function escapeTag(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll(" ", "\\ ").replaceAll(",", "\\,").replaceAll("=", "\\=");
}

function escapeFieldString(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function dateDiffInDays(fromIsoDate, toIsoDate) {
  const from = new Date(`${fromIsoDate}T00:00:00Z`);
  const to = new Date(`${toIsoDate}T00:00:00Z`);
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

function toLineProtocol({ measurement = "forecast_daily", locationName, issueDate, generatedAt, forecast }) {
  const horizonDays = dateDiffInDays(issueDate, forecast.forecastDate);
  const tags = [
    `source=${escapeTag(forecast.source)}`,
    `location=${escapeTag(locationName)}`,
    `forecast_date=${escapeTag(forecast.forecastDate)}`,
    `issue_date=${escapeTag(issueDate)}`
  ].join(",");

  const fields = [
    `min_temp_c=${Number(forecast.minTempC)}`,
    `max_temp_c=${Number(forecast.maxTempC)}`,
    `rain_chance_pct=${Number(forecast.rainChancePct)}`,
    `weather_code=${Number(forecast.weatherCode)}`,
    `intensity=${Number(forecast.intensity)}`,
    `uv_index=${Number(forecast.uvIndex)}`,
    `horizon_days=${horizonDays}i`,
    `description="${escapeFieldString(forecast.description)}"`
  ].join(",");

  const timestampSeconds = Math.floor(new Date(generatedAt).getTime() / 1000);
  return `${measurement},${tags} ${fields} ${timestampSeconds}`;
}

function buildPayload(input) {
  return input.forecasts.map((forecast) => toLineProtocol({ ...input, forecast })).join("\n");
}

module.exports = { buildPayload, toLineProtocol, dateDiffInDays };
