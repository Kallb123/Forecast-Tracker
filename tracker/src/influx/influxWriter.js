class InfluxWriter {
  constructor({ fetchImpl = fetch } = {}) {
    this.fetchImpl = fetchImpl;
  }

  async writeForecastPayload({ url, org, bucket, token, payload }) {
    const writeUrl = new URL("/api/v2/write", url);
    writeUrl.searchParams.set("org", org);
    writeUrl.searchParams.set("bucket", bucket);
    writeUrl.searchParams.set("precision", "s");

    const response = await this.fetchImpl(writeUrl, {
      method: "POST",
      headers: {
        Authorization: `Token ${token}`,
        "Content-Type": "text/plain; charset=utf-8"
      },
      body: payload
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Influx write failed (${response.status}): ${errBody}`);
    }
  }
}

module.exports = { InfluxWriter };
