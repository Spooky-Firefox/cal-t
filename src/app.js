'use strict';

// ═══════════════════════════════════════════════════════════ Storage helpers ══

const NS = 'cal-t:';
const KEYS = {
  weight:  NS + 'weightEntries',
  cal:     NS + 'calorieEntries',
  presets: NS + 'foodPresets',
};

function load(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}
function save(key, data) { localStorage.setItem(key, JSON.stringify(data)); }
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ═══════════════════════════════════════════════════════════════ Data access ══

function getWeightEntries() { return load(KEYS.weight); }
function getCalEntries()    { return load(KEYS.cal); }
function getPresets()       { return load(KEYS.presets); }

function addWeightEntry(timestamp, weight_kg) {
  const arr = getWeightEntries();
  arr.push({ id: uid(), timestamp, weight_kg: +weight_kg });
  arr.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  save(KEYS.weight, arr);
}

function delWeightEntry(id) {
  save(KEYS.weight, getWeightEntries().filter(e => e.id !== id));
}

function addCalEntry(timestamp, calories, label, presetId) {
  const arr = getCalEntries();
  // label and calories are stored as snapshots — independent of the preset
  arr.push({
    id: uid(),
    timestamp,
    calories: +calories,
    label: label || '',
    presetId: presetId || null,
  });
  arr.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  save(KEYS.cal, arr);
}

function delCalEntry(id) {
  save(KEYS.cal, getCalEntries().filter(e => e.id !== id));
}

function addPreset(name, calories) {
  const arr = getPresets();
  arr.push({ id: uid(), name, calories: +calories });
  save(KEYS.presets, arr);
}

function updatePreset(id, name, calories) {
  // Deliberately does NOT touch calorieEntries — those snapshots are immutable
  save(KEYS.presets,
    getPresets().map(p => p.id === id ? { ...p, name, calories: +calories } : p)
  );
}

function delPreset(id) {
  save(KEYS.presets, getPresets().filter(p => p.id !== id));
}

// ═══════════════════════════════════════════════════════════════ Date helpers ══

/** Return the YYYY-MM-DD portion of a datetime-local string. */
function toDateStr(ts) { return ts.slice(0, 10); }

/** Add n days to a YYYY-MM-DD string, returns YYYY-MM-DD. */
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Difference in days: b − a (both YYYY-MM-DD). DST-safe via UTC. */
function daysDiff(a, b) {
  const msPerDay = 86400000;
  const da = Date.UTC(...a.split('-').map((v, i) => i === 1 ? +v - 1 : +v));
  const db = Date.UTC(...b.split('-').map((v, i) => i === 1 ? +v - 1 : +v));
  return (db - da) / msPerDay;
}

/** YYYY-MM-DD of (today − days). Returns null when days is falsy (All). */
function cutoffDate(days) {
  if (!days) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * ISO 8601 week key, e.g. "2024-W03". Uses UTC arithmetic to avoid DST edge
 * cases near year boundaries.
 */
function isoWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Move to the Thursday of this ISO week
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const isoYear  = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const weekNo   = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${isoYear}-W${String(weekNo).padStart(2, '0')}`;
}

/** Current local time as a value compatible with datetime-local inputs. */
function nowLocalIso() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

/** Format a stored timestamp for display (e.g. "Jun 15, 14:30"). */
function fmtDate(ts) {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Format a YYYY-MM-DD label for chart tick display. */
function fmtLabel(label) {
  if (!label) return '';
  if (label.includes('W')) return label; // ISO week — show as-is
  return new Date(label + 'T00:00:00').toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
  });
}

/** Escape HTML special characters (prevents XSS in innerHTML). */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ══════════════════════════════════════════════════════ Weight interpolation ══

/**
 * Build the weight chart dataset.
 *
 * Returns:
 *   labels   — one entry per day (YYYY-MM-DD)
 *   line     — interpolated weight for each label day
 *   dots     — actual measured weight (null on days without a measurement)
 */
function buildWeightDataset(entries, rangeDays) {
  if (!entries.length) return { labels: [], line: [], dots: [] };

  const sorted = [...entries].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Map date → weight (last measurement per day wins)
  const known = {};
  for (const e of sorted) known[toDateStr(e.timestamp)] = e.weight_kg;

  const knownDays = Object.keys(known).sort();
  const firstDay  = knownDays[0];
  const lastDay   = knownDays[knownDays.length - 1];

  // Build full day span from first to last measurement
  const allDays = [];
  for (let d = firstDay; d <= lastDay; d = addDays(d, 1)) allDays.push(d);

  // Apply range cutoff (if any)
  const cut  = cutoffDate(rangeDays);
  const days = cut ? allDays.filter(d => d >= cut) : allDays;

  if (!days.length) return { labels: [], line: [], dots: [] };

  /** Linear interpolation for a given day. */
  function lerp(day) {
    if (known[day] !== undefined) return known[day];

    let prev = null, next = null;
    for (const kd of knownDays) {
      if (kd < day) prev = kd;
      else if (kd > day) { next = kd; break; }
    }

    if (prev !== null && next !== null) {
      const t = daysDiff(prev, day) / daysDiff(prev, next);
      return known[prev] + t * (known[next] - known[prev]);
    }
    // Edge: before first or after last measurement
    return known[prev !== null ? prev : next];
  }

  return {
    labels: days,
    line:   days.map(lerp),
    dots:   days.map(d => (known[d] !== undefined ? known[d] : null)),
  };
}

// ═════════════════════════════════════════════════════ Calorie aggregation ══

/**
 * Aggregate calorie entries into chart data.
 *
 * mode: 'daily'  → one bar per YYYY-MM-DD
 *       'weekly' → one bar per ISO week (2024-W03)
 */
function buildCalDataset(entries, rangeDays, mode) {
  const cut      = cutoffDate(rangeDays);
  const filtered = cut
    ? entries.filter(e => toDateStr(e.timestamp) >= cut)
    : entries;

  if (!filtered.length) return { labels: [], data: [] };

  const agg = {};
  for (const e of filtered) {
    const key = mode === 'weekly'
      ? isoWeek(toDateStr(e.timestamp))
      : toDateStr(e.timestamp);
    agg[key] = (agg[key] || 0) + e.calories;
  }

  const labels = Object.keys(agg).sort();
  return { labels, data: labels.map(k => agg[k]) };
}

// ══════════════════════════════════════════════════════════ Chart instances ══

let wChart = null;
let cChart = null;
let wRange = 30;   // days; 0 = All
let cRange = 30;
let cMode  = 'daily';

// Dirty flags: set when data changes while dashboard is not visible.
// Charts are rebuilt lazily when the dashboard tab is activated.
let wDirty = false;
let cDirty = false;

function dashboardVisible() {
  return document.getElementById('tab-dashboard').classList.contains('active');
}

const tickCfg = {
  maxTicksLimit: 12,
  color: '#718096',
  callback(val) { return fmtLabel(this.getLabelForValue(val)); },
};

const gridCfg  = { color: '#2d3748' };
const zoomCfg  = {
  zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
  pan:  { enabled: true, mode: 'x' },
};

function initCharts() {
  Chart.defaults.color       = '#718096';
  Chart.defaults.borderColor = '#2d3748';

  // ── Weight chart (line, two datasets: interpolated + measured) ─────────────
  wChart = new Chart(
    document.getElementById('weightChart').getContext('2d'),
    {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Interpolated',
            data: [],
            borderColor: '#63b3ed',
            backgroundColor: 'rgba(99,179,237,0.10)',
            fill: true,
            tension: 0,
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: 'Measured',
            data: [],
            borderColor: '#f6ad55',
            backgroundColor: '#f6ad55',
            showLine: false,
            pointRadius: 5,
            pointHoverRadius: 7,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: tickCfg, grid: gridCfg },
          y: {
            ticks: { color: '#718096' },
            grid: gridCfg,
            title: { display: true, text: 'kg', color: '#718096' },
          },
        },
        plugins: {
          legend: { display: false },
          zoom: zoomCfg,
          tooltip: {
            filter: item => item.raw !== null,
            callbacks: {
              label: ctx => {
                if (ctx.raw === null) return null;
                return `${ctx.dataset.label}: ${(+ctx.raw).toFixed(1)} kg`;
              },
            },
          },
        },
      },
    }
  );

  // ── Calorie chart (bar) ───────────────────────────────────────────────────
  cChart = new Chart(
    document.getElementById('calChart').getContext('2d'),
    {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          label: 'kcal',
          data: [],
          backgroundColor: 'rgba(104,211,145,0.70)',
          borderColor:     'rgba(104,211,145,1)',
          borderWidth: 1,
          borderRadius: 3,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { ...tickCfg, maxTicksLimit: 14 }, grid: gridCfg },
          y: {
            beginAtZero: true,
            ticks: { color: '#718096' },
            grid: gridCfg,
            title: { display: true, text: 'kcal', color: '#718096' },
          },
        },
        plugins: {
          legend: { display: false },
          zoom: zoomCfg,
        },
      },
    }
  );
}

function refreshWeightChart() {
  if (!dashboardVisible()) { wDirty = true; return; }
  const { labels, line, dots } = buildWeightDataset(getWeightEntries(), wRange);
  wChart.data.labels             = labels;
  wChart.data.datasets[0].data   = line;
  wChart.data.datasets[1].data   = dots;
  wChart.resetZoom();
  wChart.update('none');
  wDirty = false;
}

function refreshCalChart() {
  if (!dashboardVisible()) { cDirty = true; return; }
  const { labels, data } = buildCalDataset(getCalEntries(), cRange, cMode);
  cChart.data.labels           = labels;
  cChart.data.datasets[0].data = data;
  cChart.resetZoom();
  cChart.update('none');
  cDirty = false;
}

// ════════════════════════════════════════════════════════════ Presets render ══

function renderPresets() {
  const tbody   = document.getElementById('presetsBody');
  const presets = getPresets();

  if (!presets.length) {
    tbody.innerHTML =
      '<tr><td colspan="3" class="empty-row">No presets yet.</td></tr>';
    return;
  }

  tbody.innerHTML = presets.map(p => `
    <tr>
      <td>${esc(p.name)}</td>
      <td>${p.calories}</td>
      <td>
        <button class="btn-sm"        data-action="edit-preset" data-id="${p.id}">Edit</button>
        <button class="btn-sm danger" data-action="del-preset"  data-id="${p.id}">Delete</button>
      </td>
    </tr>`).join('');
}

function fillPresetForm(id) {
  const p = getPresets().find(p => p.id === id);
  if (!p) return;
  document.getElementById('presetEditId').value  = p.id;
  document.getElementById('presetName').value    = p.name;
  document.getElementById('presetCal').value     = p.calories;
  document.getElementById('presetCancel').hidden = false;
  document.getElementById('presetName').focus();
}

function resetPresetForm() {
  document.getElementById('presetEditId').value  = '';
  document.getElementById('presetName').value    = '';
  document.getElementById('presetCal').value     = '';
  document.getElementById('presetCancel').hidden = true;
}

// ════════════════════════════════════════════════════════════ Preset select ══

function refreshPresetSelect() {
  const sel     = document.getElementById('calPreset');
  const current = sel.value;
  const presets = getPresets();

  sel.innerHTML = '<option value="">— none —</option>' +
    presets.map(p =>
      `<option value="${p.id}" data-cal="${p.calories}">` +
      `${esc(p.name)} (${p.calories} kcal)</option>`
    ).join('');

  if (presets.some(p => p.id === current)) sel.value = current;
}

// ════════════════════════════════════════════════════════ Recent entries ══════

function renderRecent() {
  const wEntries = getWeightEntries().map(e => ({ ...e, _t: 'w' }));
  const cEntries = getCalEntries().map(e => ({ ...e, _t: 'c' }));

  const all = [...wEntries, ...cEntries]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 30);

  const tbody = document.getElementById('recentBody');

  if (!all.length) {
    tbody.innerHTML =
      '<tr><td colspan="4" class="empty-row">No entries yet.</td></tr>';
    return;
  }

  tbody.innerHTML = all.map(e => {
    if (e._t === 'w') {
      return `<tr>
        <td>${fmtDate(e.timestamp)}</td>
        <td class="type-weight">Weight</td>
        <td>${(+e.weight_kg).toFixed(1)}&thinsp;kg</td>
        <td>
          <button class="btn-sm danger"
                  data-action="del-weight" data-id="${e.id}">✕</button>
        </td>
      </tr>`;
    }
    return `<tr>
      <td>${fmtDate(e.timestamp)}</td>
      <td class="type-cal">${esc(e.label || 'Calories')}</td>
      <td>${e.calories}&thinsp;kcal</td>
      <td>
        <button class="btn-sm danger"
                data-action="del-cal" data-id="${e.id}">✕</button>
      </td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════════════ Boot ══════

document.addEventListener('DOMContentLoaded', () => {

  // ── Default datetime inputs to now ─────────────────────────────────────────
  document.getElementById('weightDate').value = nowLocalIso();
  document.getElementById('calDate').value    = nowLocalIso();

  // ── Tab switching ──────────────────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');

      const tab = btn.dataset.tab;
      if (tab === 'dashboard') { refreshWeightChart(); refreshCalChart(); }
      if (tab === 'log')       { refreshPresetSelect(); renderRecent(); }
      if (tab === 'presets')   { renderPresets(); }
    });
  });

  // ── Weight range buttons ───────────────────────────────────────────────────
  document.querySelectorAll('[data-chart="weight"]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-chart="weight"]')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      wRange = +btn.dataset.range;
      refreshWeightChart();
    });
  });

  // ── Cal range buttons ──────────────────────────────────────────────────────
  document.querySelectorAll('[data-chart="cal"]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-chart="cal"]')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      cRange = +btn.dataset.range;
      refreshCalChart();
    });
  });

  // ── Calorie mode toggle ────────────────────────────────────────────────────
  document.getElementById('calModeDaily').addEventListener('click', () => {
    cMode = 'daily';
    document.getElementById('calModeDaily').classList.add('active');
    document.getElementById('calModeWeekly').classList.remove('active');
    refreshCalChart();
  });
  document.getElementById('calModeWeekly').addEventListener('click', () => {
    cMode = 'weekly';
    document.getElementById('calModeWeekly').classList.add('active');
    document.getElementById('calModeDaily').classList.remove('active');
    refreshCalChart();
  });

  // ── Reset zoom buttons ─────────────────────────────────────────────────────
  document.getElementById('resetZoomWeight')
    .addEventListener('click', () => wChart.resetZoom());
  document.getElementById('resetZoomCal')
    .addEventListener('click', () => cChart.resetZoom());

  // ── Weight form ────────────────────────────────────────────────────────────
  document.getElementById('weightForm').addEventListener('submit', e => {
    e.preventDefault();
    const ts  = document.getElementById('weightDate').value;
    const val = document.getElementById('weightVal').value;
    if (!ts || !val) return;
    addWeightEntry(ts, val);
    document.getElementById('weightVal').value   = '';
    document.getElementById('weightDate').value  = nowLocalIso();
    refreshWeightChart();
    renderRecent();
  });

  // ── Preset selector → pre-fill cal value + label ──────────────────────────
  document.getElementById('calPreset').addEventListener('change', e => {
    const opt = e.target.selectedOptions[0];
    if (!opt || !opt.value) return;
    document.getElementById('calVal').value   = opt.dataset.cal || '';
    // Strip the " (NNN kcal)" suffix to get just the name
    document.getElementById('calLabel').value =
      opt.text.replace(/ \(\d+ kcal\)$/, '');
  });

  // ── Calorie form ───────────────────────────────────────────────────────────
  document.getElementById('calForm').addEventListener('submit', e => {
    e.preventDefault();
    const ts       = document.getElementById('calDate').value;
    const calories = document.getElementById('calVal').value;
    const label    = document.getElementById('calLabel').value.trim();
    const presetId = document.getElementById('calPreset').value || null;
    if (!ts || !calories) return;
    addCalEntry(ts, calories, label, presetId);
    document.getElementById('calVal').value    = '';
    document.getElementById('calLabel').value  = '';
    document.getElementById('calPreset').value = '';
    document.getElementById('calDate').value   = nowLocalIso();
    refreshCalChart();
    renderRecent();
  });

  // ── Preset form ────────────────────────────────────────────────────────────
  document.getElementById('presetForm').addEventListener('submit', e => {
    e.preventDefault();
    const id  = document.getElementById('presetEditId').value;
    const nm  = document.getElementById('presetName').value.trim();
    const cal = document.getElementById('presetCal').value;
    if (!nm || !cal) return;
    if (id) updatePreset(id, nm, +cal);
    else    addPreset(nm, +cal);
    resetPresetForm();
    renderPresets();
    refreshPresetSelect();
  });

  document.getElementById('presetCancel')
    .addEventListener('click', resetPresetForm);

  // ── Event delegation: presets table ───────────────────────────────────────
  document.getElementById('presetsBody').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;

    if (action === 'edit-preset') {
      fillPresetForm(id);

    } else if (action === 'del-preset') {
      if (!confirm('Delete this preset?\n\nExisting calorie entries are not affected.')) return;
      delPreset(id);
      renderPresets();
      refreshPresetSelect();
    }
  });

  // ── Event delegation: recent entries table ─────────────────────────────────
  document.getElementById('recentBody').addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;

    if (action === 'del-weight') {
      delWeightEntry(id);
      renderRecent();
      refreshWeightChart();

    } else if (action === 'del-cal') {
      delCalEntry(id);
      renderRecent();
      refreshCalChart();
    }
  });

  // ── Initialise charts and populate dashboard ───────────────────────────────
  initCharts();
  refreshWeightChart();
  refreshCalChart();
});
