/**
 * app.js
 * The Orchestrator — Data Loading, KPI Computation, D3 Charts, AI Coordination
 *
 * Execution Phases:
 *   Phase 1 (Sync) : Load CSV → computeSummary() → detectAllAnomalies()
 *   Phase 2 (Sync) : Render KPI cards, D3 charts, raw alert list
 *   Phase 3 (Async): Promise.allSettled → AI title, SCR story, insights
 */


// ═══════════════════════════════════════════════════════════════════════════
// 1. UTILITY HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function parseNum(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  // Remove any commas (which might be used as thousands separator) and parse
  const num = parseFloat(String(val).trim().replace(/,/g, ''));
  return isNaN(num) ? 0 : num;
}

/**
 * parseDate — Parse DD/MM/YYYY strings into Date objects.
 * Falls back to native Date parsing if format doesn't match.
 */
function parseDate(str) {
  if (!str) return null;
  const trimmed = String(str).trim();

  // Try DD/MM/YYYY
  const ddmmyyyy = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const [, d, m, y] = ddmmyyyy;
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  }

  // Try MM/DD/YYYY (common US format)
  const mmddyyyy = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mmddyyyy) {
    const [, m, d, y] = mmddyyyy;
    return new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
  }

  // Fallback: native parse
  const native = new Date(trimmed);
  return isNaN(native.getTime()) ? null : native;
}

/** Format a number as compact IDR-style currency string */
function fmt(num) {
  if (isNaN(num)) return '$0';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

/** Set text content of an element by ID, gracefully */
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ─── AI Result Cache (localStorage) ─────────────────────────────────────────
const AI_CACHE_KEY = 'ai_dashboard_cache';
const AI_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 jam dalam milidetik

/**
 * Buat sidik jari (fingerprint) dari data summary.
 * Jika datanya tidak berubah, fingerprintnya akan sama.
 */
function makeSummaryFingerprint(summary) {
  return [
    Math.round(summary.totalSales),
    Math.round(summary.totalProfit),
    summary.totalOrders,
    summary.topCategory,
    summary.topRegion,
  ].join('|');
}

/** Simpan hasil AI ke localStorage */
function saveAICache(fingerprint, data) {
  try {
    const payload = { fingerprint, data, savedAt: Date.now() };
    localStorage.setItem(AI_CACHE_KEY, JSON.stringify(payload));
    console.log('[cache] Hasil AI disimpan ke localStorage.');
  } catch (e) {
    console.warn('[cache] Gagal menyimpan cache:', e);
  }
}

/**
 * Ambil hasil AI dari localStorage.
 * Mengembalikan data cache jika fingerprint cocok dan belum expired.
 * Mengembalikan null jika tidak ada / beda data / sudah expired.
 */
function loadAICache(fingerprint) {
  try {
    const raw = localStorage.getItem(AI_CACHE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    const isExpired = (Date.now() - payload.savedAt) > AI_CACHE_TTL;
    if (isExpired) {
      console.log('[cache] Cache sudah expired (>24 jam), akan minta ulang ke AI.');
      localStorage.removeItem(AI_CACHE_KEY);
      return null;
    }
    if (payload.fingerprint !== fingerprint) {
      console.log('[cache] Data berubah, cache tidak valid, akan minta ulang ke AI.');
      return null;
    }
    console.log('[cache] ✓ Cache valid ditemukan! Memuat hasil AI dari cache.');
    return payload.data;
  } catch (e) {
    console.warn('[cache] Gagal membaca cache:', e);
    return null;
  }
}

/** Set markdown content of an element by ID using marked.js */
function setMarkdown(id, value) {
  const el = document.getElementById(id);
  if (el) {
    if (typeof marked !== 'undefined') {
      el.innerHTML = marked.parse(value);
    } else {
      el.textContent = value;
    }
  }
}

/** Set innerHTML of an element by ID, gracefully */
function setHTML(id, value) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = value;
}


// ═══════════════════════════════════════════════════════════════════════════
// 2. SUMMARY COMPUTATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * computeSummary — Aggregates raw data rows into key business KPIs.
 *
 * @param {object[]} data — Parsed CSV rows with _sales, _profit, _date
 * @returns {object} summary stats object
 */
function computeSummary(data) {
  let totalSales  = 0;
  let totalProfit = 0;
  const orderIds  = new Set();

  const categoryMap    = {};
  const regionMap      = {};
  const subCategoryMap = {};
  const monthlyMap     = {};
  const segmentMap     = {};
  const cityMap        = {};
  const regionSubCatMap = {};

  const aiContext = {
    regions: {},
    subCategories: {},
    segments: {},
  };

  data.forEach(row => {
    totalSales  += row._sales;
    totalProfit += row._profit;

    if (row['Order ID']) orderIds.add(row['Order ID']);

    const cat = row.Category || row.category || 'Unknown';
    if (!categoryMap[cat]) categoryMap[cat] = { sales: 0, profit: 0 };
    categoryMap[cat].sales += row._sales;
    categoryMap[cat].profit += row._profit;

    const reg = row.Region || row.region || 'Unknown';
    if (!regionMap[reg]) regionMap[reg] = 0;
    regionMap[reg] += row._profit;

    const sub = row['Sub-Category'] || row.sub_category || 'Unknown';
    if (!subCategoryMap[sub]) subCategoryMap[sub] = 0;
    subCategoryMap[sub] += row._profit;

    if (!regionSubCatMap[reg]) regionSubCatMap[reg] = {};
    if (!regionSubCatMap[reg][sub]) regionSubCatMap[reg][sub] = 0;
    regionSubCatMap[reg][sub] += row._profit;

    if (row._date) {
      const ym = `${row._date.getFullYear()}-${String(row._date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthlyMap[ym]) monthlyMap[ym] = 0;
      monthlyMap[ym] += row._sales;
    }

    const seg = row.Segment || row.segment || 'Unknown';
    if (!segmentMap[seg]) segmentMap[seg] = 0;
    segmentMap[seg] += row._sales;

    const city = row.City || row.city || 'Unknown';
    if (!cityMap[city]) cityMap[city] = 0;
    cityMap[city] += row._profit;

    // Build AI Context Data
    if (!aiContext.regions[reg]) aiContext.regions[reg] = { sales: 0, profit: 0 };
    aiContext.regions[reg].sales += row._sales;
    aiContext.regions[reg].profit += row._profit;

    if (!aiContext.subCategories[sub]) aiContext.subCategories[sub] = { sales: 0, profit: 0 };
    aiContext.subCategories[sub].sales += row._sales;
    aiContext.subCategories[sub].profit += row._profit;

    if (!aiContext.segments[seg]) aiContext.segments[seg] = { sales: 0, profit: 0 };
    aiContext.segments[seg].sales += row._sales;
    aiContext.segments[seg].profit += row._profit;
  });

  const profitMargin = totalSales !== 0 ? (totalProfit / totalSales) * 100 : 0;

  const topCategory = Object.entries(categoryMap)
    .sort((a, b) => b[1].sales - a[1].sales)[0]?.[0] || 'N/A';

  const topRegion = Object.entries(regionMap)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

  const worstSubCat = Object.entries(subCategoryMap)
    .sort((a, b) => a[1] - b[1])[0]?.[0] || 'N/A';

  return {
    totalSales,
    totalProfit,
    totalOrders: orderIds.size,
    profitMargin,
    topCategory,
    topRegion,
    worstSubCat,
    categoryMap,
    regionMap,
    subCategoryMap,
    monthlyMap,
    segmentMap,
    cityMap,
    regionSubCatMap,
    aiContext,
  };
}


// ═══════════════════════════════════════════════════════════════════════════
// 3. KPI CARDS RENDERER
// ═══════════════════════════════════════════════════════════════════════════

function renderKPICards(summary) {
  const container = document.getElementById('summary-cards');
  if (!container) return;

  const cards = [
    {
      label: 'Total Sales',
      value: fmt(summary.totalSales),
      sub:   `${summary.totalOrders.toLocaleString('id-ID')} pesanan`,
      color: 'yellow',
    },
    {
      label: 'Total Profit',
      value: fmt(summary.totalProfit),
      sub:   summary.totalProfit >= 0 ? '↑ Profitable' : '↓ Loss',
      color: summary.totalProfit >= 0 ? 'green' : 'red',
    },
    {
      label: 'Profit Margin',
      value: `${summary.profitMargin.toFixed(1)}%`,
      sub:   summary.profitMargin >= 15 ? 'Sehat' : summary.profitMargin >= 5 ? 'Perlu Perhatian' : 'Kritis',
      color: summary.profitMargin >= 15 ? 'green' : summary.profitMargin >= 5 ? 'yellow' : 'red',
    },
    {
      label: 'Top Kategori',
      value: summary.topCategory,
      sub:   `Best: ${summary.topRegion}`,
      color: 'blue',
    },
  ];

  container.innerHTML = cards.map(c => `
    <div class="kpi-card ${c.color}" role="figure" aria-label="${c.label}: ${c.value}">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-value mono">${c.value}</div>
      <div class="kpi-sub">${c.sub}</div>
    </div>
  `).join('');
}


// ═══════════════════════════════════════════════════════════════════════════
// 4. ALERT LIST RENDERER
// ═══════════════════════════════════════════════════════════════════════════

function renderAlerts(anomalies) {
  const list    = document.getElementById('alert-list');
  const counter = document.getElementById('alert-count');
  if (!list) return;

  const all = [
    ...anomalies.profitOutliers.map(o => ({ severity: o.severity, message: o.message })),
    ...anomalies.momSpikes.map(s => ({ severity: s.severity, message: s.message })),
  ];

  if (counter) counter.textContent = `${all.length} anomali`;

  if (all.length === 0) {
    list.innerHTML = `<div class="alert-item warning">
      <span class="alert-dot"></span>
      <span>Tidak ada anomali signifikan terdeteksi.</span>
    </div>`;
    return;
  }

  list.innerHTML = all.map(a => `
    <div class="alert-item ${a.severity}" role="alert">
      <span class="alert-dot" aria-hidden="true"></span>
      <span>${a.message}</span>
    </div>
  `).join('');
}


// ═══════════════════════════════════════════════════════════════════════════
// 5. D3 CHARTS
// ═══════════════════════════════════════════════════════════════════════════

/** Shared tooltip singleton */
const tooltip = d3.select('#d3-tooltip');

function showTooltip(html, event) {
  tooltip
    .style('opacity', '1')
    .style('left', `${event.clientX + 14}px`)
    .style('top',  `${event.clientY - 28}px`)
    .html(html);
}
function hideTooltip() {
  tooltip.style('opacity', '0');
}

// ── Claymorphism SVG helper ──
const NEO = {
  bg:        'transparent',
  barNormal: 'var(--clay-blue-dark)',
  barAnomaly:'var(--clay-red-dark)',
  barHover:  'var(--clay-yellow-dark)',
  textColor: 'var(--text-secondary)',
  stroke:    'rgba(0, 0, 0, 0.1)',
  gridLine:  'rgba(0, 0, 0, 0.05)',
  axisFont:  '11px "Nunito", sans-serif',
};

/**
 * drawHorizontalBar — Generic horizontal bar chart renderer
 *
 * @param {string}   svgId      — ID of the <svg> element
 * @param {object[]} data       — [{ label, value }]
 * @param {Set}      anomalySet — Set of anomalous labels (colored red)
 * @param {object}   opts       — { title, formatVal, height }
 */
function drawHorizontalBar(svgId, data, anomalySet = new Set(), opts = {}) {
  const svgEl = document.getElementById(svgId);
  if (!svgEl) return;

  // Responsive width from parent
  const parentW = svgEl.parentElement.clientWidth || 500;
  const margin  = { top: 16, right: 20, bottom: 20, left: 130 };
  const height  = opts.height || Math.max(220, data.length * 32);
  const width   = parentW;
  const innerW  = width - margin.left - margin.right;
  const innerH  = height - margin.top - margin.bottom;

  // Clear previous render
  d3.select(`#${svgId}`).selectAll('*').remove();

  const svg = d3.select(`#${svgId}`)
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('overflow', 'visible');

  // Background rect (neo-brutalist)
  svg.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', NEO.bg);

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Scales
  const xMax = d3.max(data, d => Math.abs(d.value)) || 1;
  const xScale = d3.scaleLinear()
    .domain([Math.min(0, d3.min(data, d => d.value)), xMax])
    .range([0, innerW])
    .nice();

  const yScale = d3.scaleBand()
    .domain(data.map(d => d.label))
    .range([0, innerH])
    .padding(0.28);

  // Zero line
  const zeroX = xScale(0);
  g.append('line')
    .attr('x1', zeroX).attr('x2', zeroX)
    .attr('y1', 0).attr('y2', innerH)
    .attr('stroke', NEO.stroke)
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '4 3')
    .attr('opacity', 0.4);

  // Bars
  g.selectAll('.bar')
    .data(data)
    .enter()
    .append('rect')
      .attr('class', 'bar')
      .attr('x', d => d.value >= 0 ? zeroX : xScale(d.value))
      .attr('y', d => yScale(d.label))
      .attr('width',  d => Math.abs(xScale(d.value) - zeroX))
      .attr('height', yScale.bandwidth())
      .attr('fill', d => anomalySet.has(d.label) ? NEO.barAnomaly : NEO.barNormal)
      .attr('stroke', NEO.stroke)
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('mousemove', function(event, d) {
        d3.select(this).attr('fill', NEO.barHover);
        const valStr = opts.formatVal ? opts.formatVal(d.value) : d.value.toFixed(2);
        showTooltip(
          `<span style="color:var(--neon-yellow)">${d.label}</span><br/>
           <span class="mono">${valStr}</span>
           ${anomalySet.has(d.label) ? '<br/><span style="color:var(--neon-red)">⚠ ANOMALI</span>' : ''}`,
          event
        );
      })
      .on('mouseleave', function(event, d) {
        d3.select(this).attr('fill', anomalySet.has(d.label) ? NEO.barAnomaly : NEO.barNormal);
        hideTooltip();
      });

  // Value labels on bars
  g.selectAll('.bar-label')
    .data(data)
    .enter()
    .append('text')
      .attr('class', 'bar-label')
      .attr('x', d => {
        const bw = Math.abs(xScale(d.value) - zeroX);
        if (d.value >= 0) return zeroX + bw + 4;
        // Jika negatif, taruh di dalam/dekat dengan zero line agar tidak menabrak label Y-axis
        return zeroX - 4;
      })
      .attr('y', d => yScale(d.label) + yScale.bandwidth() / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', d => d.value >= 0 ? 'start' : 'end')
      .attr('fill', d => anomalySet.has(d.label) ? NEO.barAnomaly : NEO.textColor)
      .style('font', NEO.axisFont)
      .text(d => opts.formatVal ? opts.formatVal(d.value) : fmt(d.value));

  // Y Axis (category labels)
  g.append('g')
    .call(d3.axisLeft(yScale).tickSize(0))
    .select('.domain').remove();

  g.selectAll('.tick text')
    .attr('fill', d => anomalySet.has(d) ? NEO.barAnomaly : NEO.textColor)
    .style('font', NEO.axisFont)
    .attr('dx', '-8');
}


/**
 * drawLineChart — Line chart for time-series trend
 */
function drawLineChart(svgId, data, opts = {}) {
  const svgEl = document.getElementById(svgId);
  if (!svgEl) return;

  const parentW = svgEl.parentElement.clientWidth || 500;
  const margin  = { top: 16, right: 30, bottom: 40, left: 60 };
  const height  = opts.height || 260;
  const width   = parentW;
  const innerW  = width - margin.left - margin.right;
  const innerH  = height - margin.top - margin.bottom;

  d3.select(`#${svgId}`).selectAll('*').remove();

  const svg = d3.select(`#${svgId}`)
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('overflow', 'visible');

  svg.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', NEO.bg);

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  data.sort((a, b) => a.label.localeCompare(b.label));

  const xScale = d3.scalePoint()
    .domain(data.map(d => d.label))
    .range([0, innerW])
    .padding(0.5);

  const yMax = d3.max(data, d => d.value) || 1;
  const yScale = d3.scaleLinear()
    .domain([0, yMax])
    .range([innerH, 0])
    .nice();

  // Grid lines
  g.append('g')
    .attr('class', 'grid')
    .call(d3.axisLeft(yScale).tickSize(-innerW).tickFormat('').ticks(5))
    .selectAll('line')
    .attr('stroke', NEO.gridLine)
    .attr('stroke-width', 1);
  g.select('.grid .domain').remove();

  // Line generator
  const line = d3.line()
    .x(d => xScale(d.label))
    .y(d => yScale(d.value))
    .curve(d3.curveMonotoneX);

  // Path
  g.append('path')
    .datum(data)
    .attr('fill', 'none')
    .attr('stroke', 'var(--clay-blue-dark)')
    .attr('stroke-width', 3)
    .attr('d', line);

  // Dots
  g.selectAll('.dot')
    .data(data)
    .enter()
    .append('circle')
      .attr('class', 'dot')
      .attr('cx', d => xScale(d.label))
      .attr('cy', d => yScale(d.value))
      .attr('r', 4)
      .attr('fill', 'var(--bg-light)')
      .attr('stroke', 'var(--clay-blue-dark)')
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .on('mousemove', function(event, d) {
        d3.select(this).attr('fill', 'var(--clay-blue-dark)').attr('r', 6);
        showTooltip(
          `<span style="color:var(--neon-yellow)">${d.label}</span><br/>
           <span class="mono">${fmt(d.value)}</span>`,
          event
        );
      })
      .on('mouseleave', function(event, d) {
        d3.select(this).attr('fill', 'var(--bg-light)').attr('r', 4);
        hideTooltip();
      });

  // X Axis
  const xAxis = g.append('g')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).tickSize(0));
    
  xAxis.select('.domain').attr('stroke', '#333');
  
  xAxis.selectAll('.tick text')
    .attr('fill', NEO.textColor)
    .style('font', NEO.axisFont)
    .attr('dy', '12')
    .each(function(d, i) {
      if (data.length > 12 && i % 2 !== 0) {
        d3.select(this).remove();
      } else {
        const el = d3.select(this);
        const parts = d.split('-');
        if (parts.length === 2) {
          const date = new Date(parseInt(parts[0]), parseInt(parts[1])-1, 1);
          el.text(date.toLocaleDateString('id-ID', {month: 'short', year:'2-digit'}));
        }
      }
    });

  // Y Axis
  g.append('g')
    .call(d3.axisLeft(yScale).ticks(5).tickFormat(v => fmt(v)))
    .select('.domain').remove();

  g.selectAll('.tick text')
    .attr('fill', NEO.textColor)
    .style('font', NEO.axisFont);
}

/**
 * drawDonutChart — Donut chart for category proportion
 */
function drawDonutChart(svgId, data, opts = {}) {
  const svgEl = document.getElementById(svgId);
  if (!svgEl) return;

  const parentW = svgEl.parentElement.clientWidth || 300;
  const height  = opts.height || 260;
  const width   = parentW;
  const radius  = Math.min(width, height) / 2 - 20;

  d3.select(`#${svgId}`).selectAll('*').remove();

  const svg = d3.select(`#${svgId}`)
    .attr('width', width)
    .attr('height', height)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .style('overflow', 'visible');

  svg.append('rect')
    .attr('width', width)
    .attr('height', height)
    .attr('fill', NEO.bg);

  const g = svg.append('g')
    .attr('transform', `translate(${width / 2},${height / 2})`);

  const colorScale = d3.scaleOrdinal()
    .domain(data.map(d => d.label))
    .range(['var(--clay-blue-dark)', 'var(--clay-green-dark)', 'var(--clay-yellow-dark)', 'var(--clay-red-dark)', '#8b5cf6']);

  const pie = d3.pie()
    .value(d => d.value)
    .sort(null);

  const arc = d3.arc()
    .innerRadius(radius * 0.5)
    .outerRadius(radius);
    
  const arcHover = d3.arc()
    .innerRadius(radius * 0.5)
    .outerRadius(radius + 8);

  const arcs = g.selectAll('.arc')
    .data(pie(data))
    .enter()
    .append('g')
    .attr('class', 'arc');

  arcs.append('path')
    .attr('d', arc)
    .attr('fill', d => colorScale(d.data.label))
    .attr('stroke', NEO.bg)
    .attr('stroke-width', 4)
    .style('cursor', 'pointer')
    .on('mousemove', function(event, d) {
      d3.select(this).transition().duration(100).attr('d', arcHover);
      showTooltip(
        `<span style="color:var(--neon-yellow)">${d.data.label}</span><br/>
         <span class="mono">${fmt(d.data.value)}</span>`,
        event
      );
    })
    .on('mouseleave', function(event, d) {
      d3.select(this).transition().duration(100).attr('d', arc);
      hideTooltip();
    });

  // Legend
  const legend = svg.append('g')
    .attr('transform', `translate(10, 10)`);
    
  data.forEach((d, i) => {
    const lg = legend.append('g').attr('transform', `translate(0, ${i * 20})`);
    lg.append('rect').attr('width', 10).attr('height', 10).attr('fill', colorScale(d.label));
    lg.append('text').attr('x', 16).attr('y', 9).text(d.label)
      .attr('fill', NEO.textColor).style('font', NEO.axisFont);
  });
}

// ─── Chart Renderers ────────────────────────────────────────────────────────

function renderTrendChart(summary) {
  const data = Object.entries(summary.monthlyMap || {})
    .map(([label, value]) => ({ label, value }));
  drawLineChart('chart-trend', data, { height: 280 });
}

function renderSubCategoryChart(summary, anomalies) {
  const anomalySet = new Set(anomalies.profitOutliers.map(o => o.subCat));
  const data = Object.entries(summary.subCategoryMap)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => a.value - b.value);
  drawHorizontalBar('chart-subcategory', data, anomalySet, { height: Math.max(300, data.length * 34), formatVal: v => fmt(v) });
}

function renderCategoryChart(summary) {
  const data = Object.entries(summary.categoryMap)
    .map(([label, stat]) => ({ label, value: stat.sales }))
    .sort((a, b) => b.value - a.value);
  drawDonutChart('chart-category', data, { height: 260 });
}

function renderSegmentChart(summary) {
  const data = Object.entries(summary.segmentMap)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  drawDonutChart('chart-segment', data, { height: 260 });
}

function renderCityChart(summary) {
  // Get top 10 cities by absolute profit (positive or negative)
  const data = Object.entries(summary.cityMap)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 10)
    .sort((a, b) => a.value - b.value); // Sort ascending for horizontal bar

  const lossCities = new Set(data.filter(d => d.value < 0).map(d => d.label));
  drawHorizontalBar('chart-city', data, lossCities, { height: Math.max(260, data.length * 34), formatVal: v => fmt(v) });
}

function renderRegionChart(summary) {
  const lossRegions = new Set(
    Object.entries(summary.regionMap).filter(([, v]) => v < 0).map(([k]) => k)
  );
  const data = Object.entries(summary.regionMap)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => a.value - b.value);
  drawHorizontalBar('chart-region', data, lossRegions, { height: 260, formatVal: v => fmt(v) });
}

function renderCategorySummaryTable(summary) {
  const tbody = document.getElementById('category-summary-tbody');
  if (!tbody) return;

  const html = Object.entries(summary.categoryMap)
    .sort((a, b) => b[1].sales - a[1].sales)
    .map(([cat, stat]) => {
      const margin = stat.sales !== 0 ? (stat.profit / stat.sales) * 100 : 0;
      let marginColor = 'var(--text-color)';
      if (margin >= 15) marginColor = 'var(--neon-green)';
      else if (margin < 0) marginColor = 'var(--neon-red)';
      else if (margin < 5) marginColor = 'var(--neon-yellow)';

      return `
        <tr style="border-bottom: 1px solid var(--grid-line);">
          <td style="padding: 10px 8px;">${cat}</td>
          <td style="padding: 10px 8px; text-align: right;" class="mono">${fmt(stat.sales)}</td>
          <td style="padding: 10px 8px; text-align: right;" class="mono">${fmt(stat.profit)}</td>
          <td style="padding: 10px 8px; text-align: right; color: ${marginColor};" class="mono">${margin.toFixed(1)}%</td>
        </tr>
      `;
    }).join('');

  tbody.innerHTML = html;
}


// ═══════════════════════════════════════════════════════════════════════════
// 6. CUSTOM QUESTION HANDLER (exposed globally for HTML onclick)
// ═══════════════════════════════════════════════════════════════════════════

let _cachedSummary   = null; // will be set after Phase 1
let _cachedAnomalies = null; // will be set after Phase 1

async function askCustomQuestion() {
  const input  = document.getElementById('custom-question-input');
  const output = document.getElementById('custom-answer');
  const btn    = document.getElementById('ask-btn');
  if (!input || !output || !_cachedSummary) return;

  const question = input.value.trim();
  if (!question) {
    input.focus();
    return;
  }

  // UI loading state
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-hourglass-half fa-spin"></i> Memproses…';
  output.style.display = 'block';
  output.innerHTML = '<span class="loading-pulse">AI sedang menjawab</span>';

  try {
    const answer = await getInsight(_cachedSummary, question);
    output.innerHTML = marked.parse(answer);
  } catch (err) {
    output.textContent = `⚠ Error: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = '<i class="fa-solid fa-paper-plane"></i> Tanya';
  }
}


// ═══════════════════════════════════════════════════════════════════════════
// 7. MAIN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  // ── Show model badge ──────────────────────────────────────────────────────
  const modelShort = CONFIG.OPENROUTER_MODEL.split('/').pop();
  setText('model-badge-text', modelShort);
  setText('model-name-header', CONFIG.OPENROUTER_MODEL);

  // ── Load Data (Supabase atau CSV fallback) ──────────────────────────────
  let rawData;
  try {
    if (CONFIG.DATA_SOURCE === 'supabase') {
      // ── Supabase path ──────────────────────────────────────────────────
      // supabaseLoader.js menangani fetch + normalizeRow (_sales, _profit, _date)
      rawData = await loadFromSupabase();
    } else {
      // ── CSV fallback path ──────────────────────────────────────────────
      rawData = await d3.csv('Sales_BY_Category_Fixed_Final.csv');
      // Normalkan field numerik & tanggal untuk CSV
      rawData.forEach(row => {
        row._sales  = parseNum(row.Sales  || row.sales  || row.Penjualan  || 0);
        row._profit = parseNum(row.Profit || row.profit || row.Keuntungan || 0);
        row._date   = parseDate(
          row['Order Date'] || row.order_date || row['Tanggal Order'] || ''
        );
      });
    }
  } catch (err) {
    console.error('[app] Gagal memuat data:', err);
    setHTML('narrative-title',
      `⚠ Gagal memuat data — ${err.message}`);
    const statusEl = document.getElementById('data-source-status');
    if (statusEl) statusEl.textContent = '⚠ ' + err.message;
    return;
  }

  // ══════════════════════════════════════════════════════════
  // PHASE 1 — Synchronous Computation
  // ══════════════════════════════════════════════════════════
  console.log('[app] Phase 1: Computing summary & anomalies…');
  const summary    = computeSummary(rawData);
  const anomalies  = detectAllAnomalies(rawData);
  _cachedSummary   = summary;   // cache for custom Q&A
  _cachedAnomalies = anomalies; // cache for resize handler

  // ══════════════════════════════════════════════════════════
  // PHASE 2 — Synchronous Visuals
  // ══════════════════════════════════════════════════════════
  console.log('[app] Phase 2: Rendering visuals…');

  renderKPICards(summary);
  renderAlerts(anomalies);
  renderTrendChart(summary);
  renderSubCategoryChart(summary, anomalies);
  renderCityChart(summary);
  renderCategoryChart(summary);
  renderSegmentChart(summary);
  renderRegionChart(summary);
  renderCategorySummaryTable(summary);

  // ══════════════════════════════════════════════════════════
  // PHASE 3 — Async AI (Global Database Cache)
  // ══════════════════════════════════════════════════════════
  console.log('[app] Phase 3: Dispatching AI requests (Checking DB Cache)…');

  const fingerprint = makeSummaryFingerprint(summary);

  // Buat minimum delay 2 detik agar UI "Sedang Diproses AI" selalu terlihat
  const delayPromise = new Promise(resolve => setTimeout(resolve, 2000));
  
  // Ambil dari Supabase (global cache) bukan localStorage
  const fetchDbPromise = typeof getAiCacheFromSupabase === 'function' 
    ? getAiCacheFromSupabase(fingerprint) 
    : Promise.resolve(null);

  // Tunggu keduanya selesai (cache fetch & 2s delay)
  const [dbAiData] = await Promise.all([fetchDbPromise, delayPromise]);

  let aiData = dbAiData;

  if (!aiData) {
    // Cache miss — panggil API secara bergantian
    console.log('[cache] Cache Supabase kosong. Memanggil AI API (sequential)…');
    const titleVal   = await generateTitle(summary, anomalies);
    const storyVal   = await generateStory(summary, anomalies);
    const insightVal = await getInsight(summary, 'Berikan 3 insight utama dari data ini dalam format bullet point.');
    const alertVal   = await narrateAllAlerts(anomalies);

    aiData = { title: titleVal, story: storyVal, insight: insightVal, alert: alertVal };
    
    // Simpan ke Supabase agar device lain bisa pakai
    if (typeof saveAiCacheToSupabase === 'function') {
      await saveAiCacheToSupabase(fingerprint, aiData);
    }
  } else {
    console.log('[cache] Berhasil memuat data AI dari Supabase Cache!');
  }

  // ── Render hasil AI (dari cache atau API baru) ────────────────────────────
  setText('narrative-title', aiData.title.replace(/\*/g, ''));

  const scr = parseStoryResponse(aiData.story);
  setMarkdown('setup-text',      scr.setup      || aiData.story);
  setMarkdown('conflict-text',   scr.conflict   || '—');
  setMarkdown('resolution-text', scr.resolution || '—');

  setMarkdown('insight-output',   aiData.insight);
  setMarkdown('ai-alert-summary', aiData.alert);

  console.log('[app] ✓ All phases complete.');
}

// ── Boot on DOMContentLoaded ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', main);

// ── Resize handler: re-render charts on window resize ───────────────────────
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (_cachedSummary) {
      // Re-compute anomalies reference from cache (no re-fetch needed)
      // We only need subCategoryMap, categoryMap, regionMap from summary
      renderTrendChart(_cachedSummary);
      renderSubCategoryChart(_cachedSummary, _cachedAnomalies || { profitOutliers: [], momSpikes: [] });
      renderCityChart(_cachedSummary);
      renderCategoryChart(_cachedSummary);
      renderSegmentChart(_cachedSummary);
      renderRegionChart(_cachedSummary);
      renderCategorySummaryTable(_cachedSummary);
    }
  }, 200);
});
