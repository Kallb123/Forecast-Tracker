const WEATHER_CODE_MAP = {
  0: "clear",
  1: "mainly_clear",
  2: "partly_cloudy",
  3: "overcast",
  45: "fog",
  48: "depositing_rime_fog",
  51: "light_drizzle",
  53: "moderate_drizzle",
  55: "dense_drizzle",
  56: "freezing_drizzle",
  57: "dense_freezing_drizzle",
  61: "slight_rain",
  63: "moderate_rain",
  65: "heavy_rain",
  66: "light_freezing_rain",
  67: "heavy_freezing_rain",
  71: "slight_snowfall",
  73: "moderate_snowfall",
  75: "heavy_snowfall",
  77: "snow_grains",
  80: "slight_rain_showers",
  81: "moderate_rain_showers",
  82: "violent_rain_showers",
  85: "slight_snow_showers",
  86: "heavy_snow_showers",
  95: "thunderstorm",
  96: "thunderstorm_hail",
  99: "thunderstorm_hail_heavy"
};

class OpenMeteoSource {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetchImpl = fetchImpl;
    this.name = "open-meteo";
  }

  getDescription(weatherCode) {
    return WEATHER_CODE_MAP[weatherCode] ?? "unknown";
  }

  async fetchDailyForecast({ latitude, longitude, forecastDays }) {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      forecast_days: String(forecastDays),
      timezone: "UTC",
      daily:
        "temperature_2m_min,temperature_2m_max,precipitation_probability_max,weather_code"
    });

    const response = await this.fetchImpl(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Open-Meteo request failed with status ${response.status}`);
    }

    const body = await response.json();
    const daily = body.daily;
    if (!daily?.time?.length) {
      throw new Error("Open-Meteo returned an empty daily forecast");
    }

    return daily.time.map((date, idx) => {
      const weatherCode = daily.weather_code[idx];
      return {
        source: this.name,
        forecastDate: date,
        minTempC: daily.temperature_2m_min[idx],
        maxTempC: daily.temperature_2m_max[idx],
        rainChancePct: daily.precipitation_probability_max[idx] ?? 0,
        weatherCode,
        description: this.getDescription(weatherCode)
      };
    });
  }
}

module.exports = { OpenMeteoSource };
