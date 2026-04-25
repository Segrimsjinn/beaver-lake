// ── Config ──────────────────────────────────────────────────────────
const NWS_POINT = 'https://api.weather.gov/points/36.42,-93.85';
const USGS_SITE = '07049000';
const USGS_CURRENT = `https://waterservices.usgs.gov/nwis/iv/?sites=${USGS_SITE}&parameterCd=00010&format=json`;
const USGS_7DAY = `https://waterservices.usgs.gov/nwis/iv/?sites=${USGS_SITE}&parameterCd=00010&period=P7D&format=json`;
const STATION_ORDER = ['KROG', 'KASG', 'KXNA']; // nearest first
const NWS_ALERTS = 'https://api.weather.gov/alerts/active?point=36.42,-93.85';


// ── Helpers ─────────────────────────────────────────────────────────
const cToF = (c) => Math.round(c * 9 / 5 + 32);
const paToInHg = (pa) => +(pa / 3386.39).toFixed(2);
const kmhToMph = (k) => Math.round(k * 0.621371);
const degToCompass = (deg) => {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
};

function pressureTier(inHg) {
  if (inHg >= 30.20) return { zone: 'deep',    color: '#1e3a5f', label: 'Deep (15–30+ ft)', lure: 'Jigs, drop shots, Texas rigs', fishY: 120 };
  if (inHg >= 29.80) return { zone: 'mid',     color: '#059669', label: 'Mid-column (8–15 ft)', lure: 'Crankbaits, swimbaits, spinnerbaits', fishY: 70 };
  return               { zone: 'surface', color: '#d97706', label: 'Surface (0–5 ft)', lure: 'Topwater: buzzbaits, poppers, frogs', fishY: 25 };
}

function renderWaterColumn(inHg) {
  if (inHg === null) return '';
  const t = pressureTier(inHg);
  const fishY = { surface: 12, mid: 40, deep: 72 }[t.zone];
  return `
    <div class="card">
      <h2>Fish Depth — ${inHg} inHg</h2>
      <div style="display:flex;align-items:center;gap:16px">
        <svg viewBox="0 0 45 90" width="40" height="80" style="flex-shrink:0">
          <defs>
            <linearGradient id="wg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#bfdbfe"/>
              <stop offset="100%" stop-color="#1e3a5f"/>
            </linearGradient>
          </defs>
          <rect x="2" y="0" width="32" height="90" rx="5" fill="url(#wg)" stroke="var(--border)" stroke-width="1"/>
          <line x1="2" y1="6" x2="34" y2="6" stroke="#93c5fd" stroke-width="0.5" stroke-dasharray="2,2"/>
          <g transform="translate(18, ${fishY})">
            <ellipse rx="8" ry="4" fill="${t.color}" opacity="0.9"/>
            <polygon points="8,0 13,3 13,-3" fill="${t.color}" opacity="0.9"/>
            <circle cx="-4" cy="-1" r="1" fill="#fff"/>
          </g>
          <text x="43" y="10" font-size="7" fill="var(--muted)" text-anchor="end">5'</text>
          <text x="43" y="48" font-size="7" fill="var(--muted)" text-anchor="end">15'</text>
          <text x="43" y="88" font-size="7" fill="var(--muted)" text-anchor="end">30'</text>
        </svg>
        <div>
          <div style="font-weight:700;font-size:1rem;color:${t.color}">${t.label}</div>
          <div style="color:var(--muted);margin-top:2px;font-size:0.85rem">${t.lure}</div>
          <div style="margin-top:6px;font-size:0.7rem;color:var(--muted)">
            <span style="color:#d97706">●</span> &lt;29.80 Surface
            <span style="color:#059669;margin-left:4px">●</span> 29.80–30.20 Mid
            <span style="color:#1e3a5f;margin-left:4px">●</span> &gt;30.20 Deep
          </div>
        </div>
      </div>
    </div>`;
}

function waterTier(tempF) {
  if (tempF < 60) return { tier: 'cold-shock', label: 'Cold-Shock Danger', rec: 'Wetsuit required. Limit exposure time.' };
  if (tempF < 65) return { tier: 'very-cold',  label: 'Very Cold',        rec: 'Wetsuit strongly recommended for any water activity.' };
  if (tempF < 70) return { tier: 'chilly',     label: 'Chilly',           rec: 'Comfortable with a rashguard or light wetsuit.' };
  if (tempF < 78) return { tier: 'comfortable', label: 'Comfortable',     rec: 'Great conditions for swimming and paddling.' };
  return              { tier: 'warm',        label: 'Warm',             rec: 'Warm water — stay hydrated, watch for algae.' };
}

function windNote(speedMph, gustMph) {
  const effective = gustMph || speedMph || 0;
  if (effective < 5)  return 'Calm — great for paddling';
  if (effective < 10) return 'Light breeze — nice conditions';
  if (effective < 15) return 'Moderate wind — stay near shore';
  if (effective < 20) return 'Choppy — experienced paddlers only';
  return 'Strong wind — stay off the water';
}

function formatTime(isoStr) {
  return new Date(isoStr).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
}

// ── Data fetching ───────────────────────────────────────────────────
async function fetchJSON(url) {
  const res = await fetch(url, { headers: { 'Accept': 'application/geo+json, application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchNWSEndpoints() {
  const data = await fetchJSON(NWS_POINT);
  return {
    forecast: data.properties.forecast,
    hourly: data.properties.forecastHourly,
    stationsUrl: data.properties.observationStations,
  };
}

async function fetchAllObservations() {
  // Fetch all stations in parallel, return map of stationId -> properties
  const results = await Promise.all(
    STATION_ORDER.map(async (stationId) => {
      try {
        const data = await fetchJSON(`https://api.weather.gov/stations/${stationId}/observations/latest`);
        return { station: stationId, obs: data.properties };
      } catch { return null; }
    })
  );
  return results.filter(Boolean);
}

// Pick the best station for a given field
function bestValue(allObs, field) {
  for (const { station, obs } of allObs) {
    if (obs[field] && obs[field].value !== null) {
      return { value: obs[field].value, station };
    }
  }
  return { value: null, station: null };
}

async function fetchAlerts() {
  const data = await fetchJSON(NWS_ALERTS);
  return (data.features || []).map(f => f.properties);
}

async function fetchForecast(url) {
  const data = await fetchJSON(url);
  return data.properties.periods;
}

async function fetchWaterTemp() {
  const data = await fetchJSON(USGS_CURRENT);
  const series = data.value.timeSeries[0];
  const latest = series.values[0].value[0];
  const tempC = parseFloat(latest.value);
  if (tempC <= -999999) return null;
  return {
    tempF: cToF(tempC),
    tempC: Math.round(tempC * 10) / 10,
    time: latest.dateTime,
    siteName: series.sourceInfo.siteName,
  };
}

async function fetchWaterHistory() {
  const data = await fetchJSON(USGS_7DAY);
  const values = data.value.timeSeries[0].values[0].value;
  return values
    .filter(v => parseFloat(v.value) > -999999)
    .map(v => ({
      time: new Date(v.dateTime),
      tempF: cToF(parseFloat(v.value)),
    }));
}

// ── Rendering ───────────────────────────────────────────────────────
function renderCompassSVG(deg) {
  if (deg === null || deg === undefined) return '<p class="compass-note">Wind direction unavailable</p>';
  return `
    <div class="compass-container">
      <svg viewBox="0 0 100 100" width="100" height="100">
        <circle cx="50" cy="50" r="45" fill="none" stroke="var(--border)" stroke-width="2"/>
        <text x="50" y="14" text-anchor="middle" font-size="10" fill="var(--muted)">N</text>
        <text x="90" y="54" text-anchor="middle" font-size="10" fill="var(--muted)">E</text>
        <text x="50" y="96" text-anchor="middle" font-size="10" fill="var(--muted)">S</text>
        <text x="10" y="54" text-anchor="middle" font-size="10" fill="var(--muted)">W</text>
        <g transform="rotate(${deg}, 50, 50)">
          <line x1="50" y1="22" x2="50" y2="65" stroke="var(--text)" stroke-width="2.5" stroke-linecap="round"/>
          <polygon points="50,18 45,28 55,28" fill="var(--text)"/>
        </g>
      </svg>
      <span style="font-weight:600">${degToCompass(deg)} (${Math.round(deg)}°)</span>
    </div>`;
}

let waterChart = null;

function renderWaterChart(history) {
  // Downsample to ~50 points for readability
  const step = Math.max(1, Math.floor(history.length / 50));
  const sampled = history.filter((_, i) => i % step === 0);

  const ctx = document.getElementById('water-chart');
  if (!ctx) return;

  if (waterChart) waterChart.destroy();

  waterChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: sampled.map(d => d.time.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' })),
      datasets: [{
        label: 'Water Temp (°F)',
        data: sampled.map(d => d.tempF),
        borderColor: '#0891b2',
        backgroundColor: 'rgba(8,145,178,0.1)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
      },
      scales: {
        x: {
          ticks: { maxTicksToShow: 7, maxRotation: 0, color: 'var(--muted)' },
          grid: { display: false },
        },
        y: {
          ticks: { callback: v => v + '°', color: 'var(--muted)' },
          grid: { color: 'var(--border)' },
        },
      },
    },
  });
}

function render(water, allObs, forecast, hourly, waterHistory, alerts) {
  const app = document.getElementById('app');
  const tier = water ? waterTier(water.tempF) : null;

  // Pick best value per field across all stations
  const wind = bestValue(allObs, 'windSpeed');
  const gust = bestValue(allObs, 'windGust');
  const dir = bestValue(allObs, 'windDirection');
  const hum = bestValue(allObs, 'relativeHumidity');
  const pres = bestValue(allObs, 'barometricPressure');
  const temp = bestValue(allObs, 'temperature');
  const dew = bestValue(allObs, 'dewpoint');
  const desc = allObs.length ? allObs[0].obs.textDescription : 'N/A';

  const windSpeed = wind.value !== null ? kmhToMph(wind.value) : null;
  const windGust = gust.value !== null ? kmhToMph(gust.value) : null;
  const windDir = dir.value;
  const humidity = hum.value !== null ? Math.round(hum.value) : null;
  const pressure = pres.value !== null ? paToInHg(pres.value) : null;
  const airTempF = temp.value !== null ? cToF(temp.value) : null;
  const dewPoint = dew.value !== null ? cToF(dew.value) : null;

  const footnote = (station) => station ? `<div style="font-size:0.65rem;color:var(--muted);margin-top:4px">${station}</div>` : '';

  let html = '';

  // Weather alerts
  if (alerts && alerts.length) {
    for (const a of alerts) {
      const sev = (a.severity || 'unknown').toLowerCase();
      html += `
        <div class="alert-banner alert-${sev}" onclick="this.classList.toggle('open')">
          <div class="alert-event">⚠ ${a.event}</div>
          <div class="alert-headline">${a.headline || ''}</div>
          <div class="alert-detail">${(a.description || '').replace(/\n/g, '<br>')}</div>
        </div>`;
    }
  }

  // Hero: Water Temp
  if (water) {
    html += `
      <div class="card tier-${tier.tier}">
        <h2>Water Temperature</h2>
        <div class="hero-temp">${water.tempF}°F</div>
        <div class="hero-status">${tier.label}</div>
        <div class="hero-rec">${tier.rec}</div>
        <div style="font-size:0.75rem;margin-top:8px;opacity:0.7">${water.siteName} · ${formatTime(water.time)}</div>
      </div>`;
  } else {
    html += '<div class="card"><h2>Water Temperature</h2><p class="error">Unavailable</p></div>';
  }

  // 7-day water temp chart
  html += `
    <div class="card">
      <h2>7-Day Water Temp Trend</h2>
      <div class="chart-container"><canvas id="water-chart"></canvas></div>
    </div>`;

  // Air conditions
  html += `
    <div class="card">
      <h2>Air Conditions</h2>
      <div class="hero-temp" style="font-size:2.5rem">${airTempF !== null ? airTempF + '°F' : '--'}</div>
      <div style="color:var(--muted);margin-top:4px">${desc}${dewPoint !== null ? ' · Dew point ' + dewPoint + '°F' : ''}</div>
      ${footnote(temp.station)}
    </div>`;

  // 2x2 grid
  html += `
    <div class="grid-2x2">
      <div class="card">
        <div class="value">${windSpeed !== null ? windSpeed : '--'}</div>
        <div class="label">Wind (mph)</div>
        ${footnote(wind.station)}
      </div>
      <div class="card">
        <div class="value">${windGust !== null ? windGust : '--'}</div>
        <div class="label">Gusts (mph)</div>
        ${footnote(gust.station)}
      </div>
      <div class="card">
        <div class="value">${humidity !== null ? humidity + '%' : '--'}</div>
        <div class="label">Humidity</div>
        ${footnote(hum.station)}
      </div>
      <div class="card">
        <div class="value">${pressure !== null ? pressure : '--'}</div>
        <div class="label">Pressure (inHg)</div>
        ${footnote(pres.station)}
      </div>
    </div>`;

  // Fish depth card
  html += renderWaterColumn(pressure);

  // Wind compass
  html += `
    <div class="card">
      <h2>Wind Direction</h2>
      ${renderCompassSVG(windDir)}
      <p class="compass-note">${windNote(windSpeed, windGust)}</p>
      ${footnote(dir.station)}
    </div>`;

  // Action buttons
  html += `
    <button class="refresh-btn" onclick="loadAll()">↻ Refresh</button>
    <div class="btn-row">
      <button onclick="document.getElementById('water-card-info').toggleAttribute('hidden')">Kayak today?</button>
      <button onclick="document.getElementById('swim-info').toggleAttribute('hidden')">Swim today?</button>
    </div>
    <div class="card" id="water-card-info" hidden>
      <h2>Kayaking Conditions</h2>
      <p style="font-size:0.85rem">
        Water: ${water ? water.tempF + '°F' : '--'} · Wind: ${windSpeed !== null ? windSpeed + ' mph' : '--'}${windGust ? ' (gusts ' + windGust + ')' : ''}<br>
        ${windNote(windSpeed, windGust)}. ${water ? tier.rec : ''}
      </p>
    </div>
    <div class="card" id="swim-info" hidden>
      <h2>Swimming Conditions</h2>
      <p style="font-size:0.85rem">
        Water: ${water ? water.tempF + '°F — ' + tier.label : '--'}<br>
        ${water ? tier.rec : 'Water temp data unavailable.'}
      </p>
    </div>`;

  // Hourly forecast (next 4 hours)
  if (hourly && hourly.length) {
    html += '<div class="card"><h2>Next 4 Hours</h2>';
    for (const p of hourly.slice(0, 4)) {
      const time = new Date(p.startTime).toLocaleString('en-US', {
        timeZone: 'America/Chicago', hour: 'numeric', minute: '2-digit',
      });
      html += `
        <div class="forecast-day">
          <span class="forecast-name">${time}</span>
          <span class="forecast-desc">${p.shortForecast} · ${p.windSpeed} ${p.windDirection}</span>
          <span class="forecast-temp">${p.temperature}°${p.temperatureUnit}</span>
        </div>`;
    }
    html += '</div>';
  }

  // Daily forecast (today + next 3 days = 4 days, day periods only = 4 cards,
  // but NWS returns day/night pairs — grab first 8 entries to cover 4 days)
  if (forecast && forecast.length) {
    html += '<div class="card"><h2>4-Day Forecast</h2>';
    for (const p of forecast.slice(0, 8)) {
      html += `
        <div class="forecast-day">
          <span class="forecast-name">${p.name}</span>
          <span class="forecast-desc">${p.shortForecast}</span>
          <span class="forecast-temp">${p.temperature}°${p.temperatureUnit}</span>
        </div>`;
    }
    html += '</div>';
  }

  // Footer
  html += `
    <footer>
      Data: <a href="https://www.weather.gov" target="_blank">NWS</a> ·
      <a href="https://waterservices.usgs.gov" target="_blank">USGS</a><br>
      Water gauge: War Eagle Creek (${USGS_SITE})
    </footer>`;

  app.innerHTML = html;

  // Render chart and map after DOM update
  if (waterHistory && waterHistory.length) {
    renderWaterChart(waterHistory);
  }
}

// ── Main ────────────────────────────────────────────────────────────
async function loadAll() {
  const app = document.getElementById('app');
  app.innerHTML = '<div class="loading">Fetching conditions...</div>';

  try {
    // Fetch NWS endpoints first (needed for forecast URLs)
    const endpoints = await fetchNWSEndpoints();

    // Fetch everything in parallel
    const [water, allObs, forecast, hourly, waterHistory, alerts] = await Promise.all([
      fetchWaterTemp().catch(() => null),
      fetchAllObservations().catch(() => []),
      fetchForecast(endpoints.forecast).catch(() => []),
      fetchForecast(endpoints.hourly).catch(() => []),
      fetchWaterHistory().catch(() => []),
      fetchAlerts().catch(() => []),
    ]);

    document.getElementById('last-updated').textContent =
      'Updated ' + new Date().toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });

    render(water, allObs, forecast, hourly, waterHistory, alerts);
  } catch (err) {
    app.innerHTML = `<div class="card"><p class="error">Failed to load data: ${err.message}</p><button onclick="loadAll()">Retry</button></div>`;
  }
}

loadAll();

// Auto-refresh every 10 minutes
setInterval(loadAll, 10 * 60 * 1000);
