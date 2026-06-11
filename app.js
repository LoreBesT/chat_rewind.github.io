/* ===========================
   CHAT REWIND — app.js
   =========================== */

'use strict';

// ──────────────────────────────────────────────
//  1. PARSING
// ──────────────────────────────────────────────

/**
 * Parse a WhatsApp .txt export.
 * Supported format: DD/MM/YY, HH:MM - Author: message
 *   (also handles DD/MM/YYYY)
 * Returns array of { date: Date, author: string, text: string }
 */
function parseWhatsApp(raw) {
  // Regex: date (DD/MM/YY or DD/MM/YYYY), time (HH:MM), author, message
  const lineRe = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})\s*-\s*([^:]+):\s*([\s\S]*?)(?=\n\d{1,2}\/\d{1,2}\/\d{2,4},|\n*$)/gm;

  const messages = [];

  // First pass: split into raw entries using the timestamp pattern
  const entryRe = /(\d{1,2}\/\d{1,2}\/\d{2,4}),\s*(\d{1,2}:\d{2})\s*-\s*/g;
  const parts = [];
  let match;
  let lastIndex = 0;
  let lastMeta = null;

  // Split by message boundaries
  const boundaryRe = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})\s*-\s*/gm;
  const lines = raw.split('\n');

  // Reconstruct entries (handles multiline messages)
  const entries = [];
  const startRe = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),\s*(\d{1,2}):(\d{2})\s*-\s*(.+?):\s*(.*)/;

  let buffer = null;
  for (const line of lines) {
    const m = startRe.exec(line);
    if (m) {
      if (buffer) entries.push(buffer);
      buffer = { raw: line, day: m[1], month: m[2], year: m[3], hour: m[4], min: m[5], author: m[6].trim(), text: m[7] };
    } else {
      if (buffer) buffer.text += '\n' + line;
      // else: preamble lines (encryption notice, etc.) — skip
    }
  }
  if (buffer) entries.push(buffer);

  for (const e of entries) {
    let year = parseInt(e.year, 10);
    if (year < 100) year += 2000;
    const date = new Date(year, parseInt(e.month, 10) - 1, parseInt(e.day, 10),
                          parseInt(e.hour, 10), parseInt(e.min, 10));
    messages.push({ date, author: e.author, text: e.text.trim() });
  }

  return messages;
}

// ──────────────────────────────────────────────
//  2. STATS COMPUTATION
// ──────────────────────────────────────────────

function computeStats(messages) {
  if (!messages.length) return null;

  // Identify participants (take the two most-frequent authors)
  const authorCount = {};
  for (const m of messages) {
    authorCount[m.author] = (authorCount[m.author] || 0) + 1;
  }
  const sorted = Object.entries(authorCount).sort((a, b) => b[1] - a[1]);
  // Main two participants
  const p1 = sorted[0]?.[0] || 'Persona 1';
  const p2 = sorted[1]?.[0] || 'Persona 2';

  // Per-day map
  const dayMap = {}; // 'YYYY-MM-DD' -> { total, [p1]: n, [p2]: n }
  const monthMap = {}; // 'YYYY-MM' -> count
  const yearMap = {};  // 'YYYY'    -> count
  const hourMap = new Array(24).fill(0);

  for (const m of messages) {
    const d = m.date;
    const dayKey   = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const monthKey = `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
    const yearKey  = `${d.getFullYear()}`;

    if (!dayMap[dayKey]) dayMap[dayKey] = { total: 0 };
    dayMap[dayKey].total++;
    dayMap[dayKey][m.author] = (dayMap[dayKey][m.author] || 0) + 1;

    monthMap[monthKey] = (monthMap[monthKey] || 0) + 1;
    yearMap[yearKey]   = (yearMap[yearKey]   || 0) + 1;
    hourMap[d.getHours()]++;
  }

  // Sort day keys
  const dayKeys = Object.keys(dayMap).sort();

  // Record day
  let recordDay = dayKeys[0];
  for (const k of dayKeys) {
    if (dayMap[k].total > dayMap[recordDay].total) recordDay = k;
  }

  // Streak computation
  const daySet = new Set(dayKeys);
  let maxStreak = 0, maxStreakStart = '', maxStreakEnd = '';
  let curStreak = 0, curStart = '';

  for (let i = 0; i < dayKeys.length; i++) {
    const key = dayKeys[i];
    if (i === 0) { curStreak = 1; curStart = key; continue; }
    const prev = dayKeys[i - 1];
    const diff = (new Date(key) - new Date(prev)) / 86400000;
    if (diff === 1) {
      curStreak++;
    } else {
      if (curStreak > maxStreak) {
        maxStreak = curStreak; maxStreakStart = curStart; maxStreakEnd = dayKeys[i-1];
      }
      curStreak = 1; curStart = key;
    }
  }
  // Check last segment
  if (curStreak > maxStreak) {
    maxStreak = curStreak;
    maxStreakStart = curStart;
    maxStreakEnd = dayKeys[dayKeys.length - 1];
  }

  // Top 10 days
  const topDays = [...dayKeys].sort((a, b) => dayMap[b].total - dayMap[a].total).slice(0, 10);

  // Messages per month (chronological)
  const monthKeys = Object.keys(monthMap).sort();
  const yearKeys  = Object.keys(yearMap).sort();

  return {
    total: messages.length,
    p1, p2,
    p1Count: authorCount[p1] || 0,
    p2Count: authorCount[p2] || 0,
    totalDays: dayKeys.length,
    avgPerDay: (messages.length / dayKeys.length).toFixed(1),
    recordDay, recordCount: dayMap[recordDay].total,
    maxStreak, maxStreakStart, maxStreakEnd,
    firstDate: dayKeys[0],
    lastDate:  dayKeys[dayKeys.length - 1],
    totalMonths: monthKeys.length,
    dayMap, monthMap, monthKeys, yearMap, yearKeys, hourMap,
    topDays, topDayMap: dayMap,
    p1Color: '#7c6ef7',
    p2Color: '#56cfb2',
  };
}

function pad(n) { return String(n).padStart(2, '0'); }

// ──────────────────────────────────────────────
//  3. UI HELPERS
// ──────────────────────────────────────────────

function formatDateKey(key) {
  // 'YYYY-MM-DD' → localized
  const [y, m, d] = key.split('-');
  return new Date(+y, +m-1, +d).toLocaleDateString('it-IT', { day:'2-digit', month:'long', year:'numeric' });
}

function formatMonthKey(key) {
  const [y, m] = key.split('-');
  return new Date(+y, +m-1, 1).toLocaleDateString('it-IT', { month:'long', year:'numeric' });
}

function animateValue(el, target, duration = 800) {
  const isFloat = String(target).includes('.');
  const num = parseFloat(target);
  const start = performance.now();
  function update(now) {
    const t = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    const val = num * ease;
    el.textContent = isFloat ? val.toFixed(1) : Math.round(val).toLocaleString('it-IT');
    if (t < 1) requestAnimationFrame(update);
  }
  requestAnimationFrame(update);
}

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// ──────────────────────────────────────────────
//  4. CHART DEFAULTS
// ──────────────────────────────────────────────

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      backgroundColor: '#18182a',
      borderColor: 'rgba(255,255,255,0.1)',
      borderWidth: 1,
      titleColor: '#e8e8f4',
      bodyColor: '#7a7a9a',
      padding: 12,
      cornerRadius: 8,
    }
  },
  scales: {
    x: {
      grid: { color: 'rgba(255,255,255,0.04)' },
      ticks: { color: '#7a7a9a', font: { size: 11, family: 'Inter' } },
    },
    y: {
      grid: { color: 'rgba(255,255,255,0.04)' },
      ticks: { color: '#7a7a9a', font: { size: 11, family: 'Inter' } },
      beginAtZero: true,
    }
  },
};

// Active charts registry for cleanup
const charts = {};

function destroyCharts() {
  for (const k of Object.keys(charts)) {
    charts[k]?.destroy();
    delete charts[k];
  }
}

// ──────────────────────────────────────────────
//  5. RENDER DASHBOARD
// ──────────────────────────────────────────────

function renderDashboard(stats) {
  // Show dashboard, hide hero
  document.getElementById('hero').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');

  /* Participants */
  const p1Pct = Math.round((stats.p1Count / stats.total) * 100);
  const p2Pct = 100 - p1Pct;

  document.getElementById('p1Avatar').textContent = initials(stats.p1);
  document.getElementById('p2Avatar').textContent = initials(stats.p2);
  document.getElementById('p1Name').textContent = stats.p1;
  document.getElementById('p2Name').textContent = stats.p2;
  document.getElementById('p1Msgs').textContent = `${stats.p1Count.toLocaleString('it-IT')} msg · ${p1Pct}%`;
  document.getElementById('p2Msgs').textContent = `${stats.p2Count.toLocaleString('it-IT')} msg · ${p2Pct}%`;

  setTimeout(() => {
    document.getElementById('p1Bar').style.width = p1Pct + '%';
    document.getElementById('p2Bar').style.width = p2Pct + '%';
  }, 200);

  /* KPIs */
  animateValue(document.getElementById('kpiTotalVal'), stats.total);
  animateValue(document.getElementById('kpiDaysVal'), stats.totalDays);
  animateValue(document.getElementById('kpiAvgDayVal'), stats.avgPerDay);
  animateValue(document.getElementById('kpiRecordVal'), stats.recordCount);
  document.getElementById('kpiRecordDate').textContent = formatDateKey(stats.recordDay);
  animateValue(document.getElementById('kpiStreakVal'), stats.maxStreak, 1000);
  document.getElementById('kpiStreakDates').textContent =
    stats.maxStreak > 1
      ? `${formatDateKey(stats.maxStreakStart)} → ${formatDateKey(stats.maxStreakEnd)}`
      : '—';
  document.getElementById('kpiFirstVal').textContent = formatDateKey(stats.firstDate);
  document.getElementById('kpiLastVal').textContent  = formatDateKey(stats.lastDate);
  animateValue(document.getElementById('kpiMonthsVal'), stats.totalMonths);

  /* Staggered card animation */
  document.querySelectorAll('.kpi-card').forEach((el, i) => {
    el.style.animationDelay = `${i * 60}ms`;
  });

  /* Charts */
  destroyCharts();
  renderDailyChart(stats);
  renderMonthlyChart(stats);
  renderYearlyChart(stats);
  renderHourlyChart(stats);

  /* Top Days Table */
  renderTopDays(stats);
}

// ─── Daily Chart ───
function renderDailyChart(stats) {
  const dayKeys = Object.keys(stats.dayMap).sort();

  // Downsample for readability if too many days
  let labels, data;
  if (dayKeys.length > 90) {
    // Weekly buckets
    const weekMap = {};
    for (const k of dayKeys) {
      const date = new Date(k);
      // Week start (Monday)
      const day = date.getDay() || 7;
      const monday = new Date(date);
      monday.setDate(date.getDate() - day + 1);
      const wk = monday.toISOString().slice(0, 10);
      weekMap[wk] = (weekMap[wk] || 0) + stats.dayMap[k].total;
    }
    const wks = Object.keys(weekMap).sort();
    labels = wks.map(k => {
      const d = new Date(k);
      return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' });
    });
    data = wks.map(k => weekMap[k]);
  } else {
    labels = dayKeys.map(k => {
      const [y,m,d] = k.split('-');
      return `${d}/${m}/${y.slice(2)}`;
    });
    data = dayKeys.map(k => stats.dayMap[k].total);
  }

  const ctx = document.getElementById('chartDaily').getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 220);
  gradient.addColorStop(0, 'rgba(124,110,247,0.5)');
  gradient.addColorStop(1, 'rgba(124,110,247,0)');

  charts.daily = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: '#7c6ef7',
        backgroundColor: gradient,
        fill: true,
        tension: 0.35,
        pointRadius: data.length > 60 ? 0 : 3,
        pointHoverRadius: 5,
        borderWidth: 2,
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: {
            label: ctx => ` ${ctx.parsed.y} messaggi`,
          }
        }
      }
    }
  });
}

// ─── Monthly Chart ───
function renderMonthlyChart(stats) {
  const labels = stats.monthKeys.map(k => formatMonthKey(k));
  const data   = stats.monthKeys.map(k => stats.monthMap[k]);

  const ctx = document.getElementById('chartMonthly').getContext('2d');
  charts.monthly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: stats.monthKeys.map((_, i) =>
          `hsla(${248 + i * 5}, 80%, 68%, 0.75)`),
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: { label: ctx => ` ${ctx.parsed.y} messaggi` }
        }
      },
      scales: {
        ...CHART_DEFAULTS.scales,
        x: { ...CHART_DEFAULTS.scales.x, ticks: { ...CHART_DEFAULTS.scales.x.ticks, maxRotation: 45 } }
      }
    }
  });
}

// ─── Yearly Chart ───
function renderYearlyChart(stats) {
  const ctx = document.getElementById('chartYearly').getContext('2d');
  charts.yearly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: stats.yearKeys,
      datasets: [{
        data: stats.yearKeys.map(k => stats.yearMap[k]),
        backgroundColor: '#56cfb2cc',
        borderRadius: 8,
        borderSkipped: false,
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: { label: ctx => ` ${ctx.parsed.y.toLocaleString('it-IT')} messaggi` }
        }
      }
    }
  });
}

// ─── Hourly Chart ───
function renderHourlyChart(stats) {
  const ctx = document.getElementById('chartHourly').getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 220);
  gradient.addColorStop(0, 'rgba(247,134,106,0.7)');
  gradient.addColorStop(1, 'rgba(247,134,106,0.1)');

  charts.hourly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Array.from({ length: 24 }, (_, i) => `${pad(i)}:00`),
      datasets: [{
        data: stats.hourMap,
        backgroundColor: gradient,
        borderRadius: 4,
        borderSkipped: false,
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        ...CHART_DEFAULTS.plugins,
        tooltip: {
          ...CHART_DEFAULTS.plugins.tooltip,
          callbacks: { label: ctx => ` ${ctx.parsed.y} messaggi` }
        }
      }
    }
  });
}

// ─── Top Days Table ───
function renderTopDays(stats) {
  const body = document.getElementById('topDaysBody');
  body.innerHTML = '';
  const maxVal = stats.dayMap[stats.topDays[0]]?.total || 1;

  stats.topDays.forEach((key, i) => {
    const count = stats.dayMap[key].total;
    const pct = Math.round((count / maxVal) * 100);
    const rank = i + 1;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="${rank <= 3 ? `rank-${rank}` : ''}">${rank <= 3 ? ['🥇','🥈','🥉'][rank-1] : rank}</td>
      <td>${formatDateKey(key)}</td>
      <td><strong>${count.toLocaleString('it-IT')}</strong></td>
      <td>
        <div class="mini-bar-wrap">
          <div class="mini-bar" style="width: ${pct}%"></div>
        </div>
      </td>
    `;
    body.appendChild(tr);
  });
}

// ──────────────────────────────────────────────
//  6. FILE HANDLING
// ──────────────────────────────────────────────

function handleFile(file) {
  if (!file || !file.name.endsWith('.txt')) {
    alert('Carica un file .txt esportato da WhatsApp.');
    return;
  }

  document.getElementById('loadingOverlay').classList.remove('hidden');

  const reader = new FileReader();
  reader.onload = (e) => {
    // Small delay to let the spinner render
    setTimeout(() => {
      try {
        const raw = e.target.result;
        const messages = parseWhatsApp(raw);

        if (messages.length === 0) {
          document.getElementById('loadingOverlay').classList.add('hidden');
          alert('Nessun messaggio trovato. Assicurati di caricare un file esportato da WhatsApp nel formato corretto.');
          return;
        }

        const stats = computeStats(messages);
        document.getElementById('loadingOverlay').classList.add('hidden');
        renderDashboard(stats);
      } catch (err) {
        document.getElementById('loadingOverlay').classList.add('hidden');
        alert('Errore durante il parsing del file: ' + err.message);
        console.error(err);
      }
    }, 300);
  };
  reader.readAsText(file, 'UTF-8');
}

// ──────────────────────────────────────────────
//  7. EVENT LISTENERS
// ──────────────────────────────────────────────

const uploadArea = document.getElementById('uploadArea');
const fileInput  = document.getElementById('fileInput');

fileInput.addEventListener('change', (e) => {
  handleFile(e.target.files[0]);
});

uploadArea.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadArea.classList.add('drag-over');
});
uploadArea.addEventListener('dragleave', () => {
  uploadArea.classList.remove('drag-over');
});
uploadArea.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadArea.classList.remove('drag-over');
  handleFile(e.dataTransfer.files[0]);
});

document.getElementById('resetBtn').addEventListener('click', () => {
  destroyCharts();
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('hero').classList.remove('hidden');
  fileInput.value = '';
});
