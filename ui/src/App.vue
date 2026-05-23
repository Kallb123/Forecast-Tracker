<script setup>
import { ref, watch, onMounted, onUnmounted, nextTick } from "vue";
import { Chart, registerables } from "chart.js";

Chart.register(...registerables);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const locations = ref([]);
const selectedLocation = ref("");
const forecastDates = ref([]);
const selectedDate = ref("");
const historyData = ref([]);
const loading = ref(false);
const error = ref("");
const chartRef = ref(null);

let chartInstance = null;

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function apiFetch(path) {
  const res = await fetch(path);
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}

// ---------------------------------------------------------------------------
// Data loaders
// ---------------------------------------------------------------------------
async function loadLocations() {
  error.value = "";
  try {
    const { locations: locs } = await apiFetch("/api/locations");
    locations.value = locs;
    if (locs.length) selectedLocation.value = locs[0];
  } catch (e) {
    error.value = `Could not load locations: ${e.message}`;
  }
}

async function loadForecastDates() {
  if (!selectedLocation.value) return;
  forecastDates.value = [];
  selectedDate.value = "";
  error.value = "";
  destroyChart();
  historyData.value = [];
  try {
    const { dates } = await apiFetch(
      `/api/forecast-dates?location=${encodeURIComponent(selectedLocation.value)}`
    );
    forecastDates.value = dates;
    // Default to the nearest upcoming date, or the last available date
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = dates.filter((d) => d >= today);
    selectedDate.value = upcoming[0] ?? dates[dates.length - 1] ?? "";
  } catch (e) {
    error.value = `Could not load forecast dates: ${e.message}`;
  }
}

async function loadForecastHistory() {
  if (!selectedDate.value || !selectedLocation.value) return;
  loading.value = true;
  error.value = "";
  historyData.value = [];
  destroyChart();
  try {
    const { data } = await apiFetch(
      `/api/forecast-history?date=${selectedDate.value}&location=${encodeURIComponent(selectedLocation.value)}`
    );
    historyData.value = data;
    await nextTick();
    renderChart(data);
  } catch (e) {
    error.value = `Could not load forecast history: ${e.message}`;
  } finally {
    loading.value = false;
  }
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------
function destroyChart() {
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }
}

function formatLabel(isoTime) {
  const dt = new Date(isoTime);
  return dt.toLocaleString("en-GB", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function renderChart(data) {
  if (!chartRef.value || !data.length) return;

  const labels = data.map((d) => formatLabel(d.time));

  chartInstance = new Chart(chartRef.value, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Max Temp (°C)",
          data: data.map((d) => d.maxTempC),
          borderColor: "#f97316",
          backgroundColor: "rgba(249,115,22,0.08)",
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 7,
          tension: 0.35,
          fill: false,
          yAxisID: "yTemp"
        },
        {
          label: "Min Temp (°C)",
          data: data.map((d) => d.minTempC),
          borderColor: "#6366f1",
          backgroundColor: "rgba(99,102,241,0.08)",
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 7,
          tension: 0.35,
          fill: false,
          yAxisID: "yTemp"
        },
        {
          label: "Rain Chance (%)",
          data: data.map((d) => d.rainChancePct),
          borderColor: "#0ea5e9",
          backgroundColor: "rgba(14,165,233,0.12)",
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 7,
          tension: 0.35,
          fill: true,
          borderDash: [6, 4],
          yAxisID: "yRain"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          position: "top",
          labels: { padding: 20, usePointStyle: true, font: { size: 13 } }
        },
        title: {
          display: true,
          text: `Forecast evolution for ${selectedDate.value}`,
          font: { size: 15, weight: "bold" },
          padding: { top: 10, bottom: 20 }
        },
        tooltip: {
          backgroundColor: "rgba(15,23,42,0.92)",
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            afterTitle(items) {
              const d = data[items[0].dataIndex];
              const label =
                d.horizonDays === 0
                  ? "Same day"
                  : `${d.horizonDays} day${d.horizonDays === 1 ? "" : "s"} before`;
              return label;
            }
          }
        }
      },
      scales: {
        x: {
          title: {
            display: true,
            text: "When forecast was issued",
            font: { size: 12 }
          },
          ticks: { maxRotation: 45, font: { size: 11 } },
          grid: { color: "rgba(0,0,0,0.06)" }
        },
        yTemp: {
          type: "linear",
          position: "left",
          title: {
            display: true,
            text: "Temperature (°C)",
            font: { size: 12 },
            color: "#f97316"
          },
          grid: { color: "rgba(0,0,0,0.06)" }
        },
        yRain: {
          type: "linear",
          position: "right",
          min: 0,
          max: 100,
          title: {
            display: true,
            text: "Rain Chance (%)",
            font: { size: 12 },
            color: "#0ea5e9"
          },
          grid: { drawOnChartArea: false }
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Watchers & lifecycle
// ---------------------------------------------------------------------------
watch(selectedLocation, loadForecastDates);
watch(selectedDate, loadForecastHistory);
onMounted(loadLocations);
onUnmounted(destroyChart);

// ---------------------------------------------------------------------------
// Computed helpers for summary
// ---------------------------------------------------------------------------
const first = () => historyData.value[0];
const last = () => historyData.value.at(-1);
</script>

<template>
  <div class="app">
    <!-- Header -->
    <header class="header">
      <div class="header-inner">
        <span class="brand-icon" aria-hidden="true">🌤️</span>
        <div>
          <h1 class="brand-title">Forecast Tracker</h1>
          <p class="brand-sub">See how forecasts evolve as the date approaches</p>
        </div>
      </div>
    </header>

    <div class="container">
      <!-- Controls -->
      <section class="card controls-card" aria-label="Filters">
        <div class="controls">
          <div class="control-group">
            <label class="ctrl-label" for="loc-select">Location</label>
            <select id="loc-select" v-model="selectedLocation" class="select">
              <option v-for="l in locations" :key="l" :value="l">{{ l }}</option>
            </select>
          </div>

          <div class="control-group">
            <label class="ctrl-label" for="date-select">Forecast Date</label>
            <select
              id="date-select"
              v-model="selectedDate"
              class="select"
              :disabled="!forecastDates.length"
            >
              <option v-if="!forecastDates.length" value="">No dates available</option>
              <option v-for="d in forecastDates" :key="d" :value="d">{{ d }}</option>
            </select>
          </div>
        </div>
      </section>

      <!-- Error banner -->
      <div v-if="error" class="error-banner" role="alert">
        <span aria-hidden="true">⚠️</span>
        <span>{{ error }}</span>
      </div>

      <!-- Chart card -->
      <section class="card chart-card" aria-label="Forecast history chart">
        <!-- Loading overlay -->
        <div v-if="loading" class="state-overlay">
          <div class="spinner" role="status" aria-label="Loading"></div>
          <p>Loading forecast data…</p>
        </div>

        <!-- Empty state -->
        <div v-else-if="!historyData.length" class="state-overlay">
          <span class="empty-icon" aria-hidden="true">📭</span>
          <p>
            {{
              selectedDate
                ? "No forecast history found for this date."
                : "Select a date above to view its forecast history."
            }}
          </p>
        </div>

        <div class="chart-wrap">
          <canvas ref="chartRef" aria-label="Forecast evolution chart"></canvas>
        </div>
      </section>

      <!-- Summary strip -->
      <section v-if="historyData.length" class="card summary-card" aria-label="Summary">
        <h2 class="summary-heading">📊 Summary</h2>
        <div class="summary-grid">
          <div class="summary-item">
            <div class="summary-value">{{ historyData.length }}</div>
            <div class="summary-label">Snapshots recorded</div>
          </div>
          <div class="summary-item">
            <div class="summary-value">{{ first()?.issueDate || "—" }}</div>
            <div class="summary-label">
              First forecast
              <span v-if="first()?.horizonDays != null"
                >({{ first().horizonDays }}d ahead)</span
              >
            </div>
          </div>
          <div class="summary-item">
            <div class="summary-value">{{ last()?.issueDate || "—" }}</div>
            <div class="summary-label">
              Latest forecast
              <span v-if="last()?.horizonDays != null"
                >({{ last().horizonDays }}d ahead)</span
              >
            </div>
          </div>
          <div class="summary-item">
            <div class="summary-value">
              {{ last()?.maxTempC ?? "—" }}°C / {{ last()?.minTempC ?? "—" }}°C
            </div>
            <div class="summary-label">Latest max / min temp</div>
          </div>
          <div class="summary-item">
            <div class="summary-value">{{ last()?.rainChancePct ?? "—" }}%</div>
            <div class="summary-label">Latest rain chance</div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style>
/* ── Reset ─────────────────────────────────────────────────── */
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

/* ── Design tokens ─────────────────────────────────────────── */
:root {
  --primary: #2563eb;
  --primary-dark: #1d4ed8;
  --surface: #ffffff;
  --bg: #f1f5f9;
  --text: #0f172a;
  --text-muted: #64748b;
  --border: #e2e8f0;
  --radius: 12px;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 16px rgba(0, 0, 0, 0.06);
}

/* ── Base ──────────────────────────────────────────────────── */
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  line-height: 1.5;
}

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* ── Header ────────────────────────────────────────────────── */
.header {
  background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%);
  color: #fff;
  padding: 1.5rem 0;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.18);
}

.header-inner {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 1.5rem;
  display: flex;
  align-items: center;
  gap: 1rem;
}

.brand-icon {
  font-size: 2.75rem;
  line-height: 1;
}

.brand-title {
  font-size: 1.8rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.brand-sub {
  font-size: 0.9rem;
  opacity: 0.75;
  margin-top: 0.2rem;
}

/* ── Layout ────────────────────────────────────────────────── */
.container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 2rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  flex: 1;
}

/* ── Card ──────────────────────────────────────────────────── */
.card {
  background: var(--surface);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 1.5rem;
}

/* ── Controls ──────────────────────────────────────────────── */
.controls {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1;
  min-width: 180px;
}

.ctrl-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--text-muted);
}

.select {
  padding: 0.55rem 0.85rem;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  font-size: 0.95rem;
  background: #fff;
  color: var(--text);
  cursor: pointer;
  appearance: auto;
  transition: border-color 0.15s;
}

.select:focus {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
}

.select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Error banner ──────────────────────────────────────────── */
.error-banner {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: var(--radius);
  color: #b91c1c;
  padding: 0.9rem 1.2rem;
  font-size: 0.95rem;
}

/* ── Chart card ────────────────────────────────────────────── */
.chart-card {
  position: relative;
  min-height: 460px;
  padding: 1.25rem;
}

.chart-wrap {
  height: 420px;
  position: relative;
}

/* ── State overlays ────────────────────────────────────────── */
.state-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.9rem;
  color: var(--text-muted);
  font-size: 0.95rem;
  z-index: 1;
  pointer-events: none;
}

.empty-icon {
  font-size: 2.75rem;
}

.spinner {
  width: 38px;
  height: 38px;
  border: 3px solid var(--border);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Summary ───────────────────────────────────────────────── */
.summary-heading {
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--text-muted);
  margin-bottom: 1rem;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 1rem;
}

.summary-item {
  background: var(--bg);
  border-radius: 8px;
  padding: 0.85rem 1rem;
}

.summary-value {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--primary-dark);
  word-break: break-word;
}

.summary-label {
  font-size: 0.78rem;
  color: var(--text-muted);
  margin-top: 0.2rem;
}

/* ── Responsive ────────────────────────────────────────────── */
@media (max-width: 600px) {
  .brand-title {
    font-size: 1.35rem;
  }

  .chart-wrap {
    height: 280px;
  }

  .chart-card {
    min-height: 310px;
  }
}
</style>
