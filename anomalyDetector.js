function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((s, v) => s + Math.pow(v - m, 2), 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function zScore(value, m, sd) {
  if (sd === 0) return 0;
  return (value - m) / sd;
}


function findProfitOutliers(data) {
  const grouped = {};
  data.forEach(row => {
    const key = row['Sub-Category'] || row['sub_category'] || 'Unknown';
    if (!grouped[key]) grouped[key] = { sales: 0, profit: 0 };
    grouped[key].sales  += row._sales;
    grouped[key].profit += row._profit;
  });

  const margins = Object.entries(grouped).map(([subCat, { sales, profit }]) => ({
    subCat,
    sales,
    profit,
    margin: sales !== 0 ? (profit / sales) * 100 : 0,
  }));

  const marginValues = margins.map(d => d.margin);
  const m  = mean(marginValues);
  const sd = stdDev(marginValues);

  const outliers = [];
  margins.forEach(d => {
    const z = zScore(d.margin, m, sd);
    if (z < -2) {
      outliers.push({ ...d, z, severity: 'severe',
        message: `Sub-Kategori "${d.subCat}" memiliki margin profit sangat rendah (${d.margin.toFixed(1)}%) — Z-Score: ${z.toFixed(2)}` });
    } else if (z < -1) {
      outliers.push({ ...d, z, severity: 'warning',
        message: `Sub-Kategori "${d.subCat}" memiliki margin profit di bawah rata-rata (${d.margin.toFixed(1)}%) — Z-Score: ${z.toFixed(2)}` });
    }
  });

  return outliers.sort((a, b) => a.z - b.z);
}


function findMoMSpikes(data) {
  const monthly = {};
  data.forEach(row => {
    if (!row._date) return;
    const key = `${row._date.getFullYear()}-${String(row._date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthly[key]) monthly[key] = 0;
    monthly[key] += row._sales;
  });

  const months = Object.keys(monthly).sort();

  const spikes = [];
  for (let i = 1; i < months.length; i++) {
    const prev    = monthly[months[i - 1]];
    const curr    = monthly[months[i]];
    const momPct  = prev !== 0 ? ((curr - prev) / prev) * 100 : 0;

    if (momPct < -20) {
      spikes.push({
        month: months[i],
        prevMonth: months[i - 1],
        sales: curr,
        prevSales: prev,
        momPct,
        severity: 'severe',
        message: `Penjualan ${months[i]} turun ${Math.abs(momPct).toFixed(1)}% dari bulan sebelumnya (${months[i - 1]})`,
      });
    } else if (momPct > 20) {
      spikes.push({
        month: months[i],
        prevMonth: months[i - 1],
        sales: curr,
        prevSales: prev,
        momPct,
        severity: 'warning',
        message: `Lonjakan penjualan ${months[i]}: +${momPct.toFixed(1)}% dari ${months[i - 1]}`,
      });
    }
  }

  return spikes;
}


function detectAllAnomalies(rawData) {
  const profitOutliers = findProfitOutliers(rawData);
  const momSpikes      = findMoMSpikes(rawData);
  return { profitOutliers, momSpikes };
}


async function narrateAllAlerts(anomalies) {
  const { profitOutliers, momSpikes } = anomalies;

  const profitLines = profitOutliers.map(o =>
    `  - [${o.severity.toUpperCase()}] ${o.message}`
  ).join('\n') || '  - Tidak ada outlier profit yang signifikan.';

  const momLines = momSpikes.map(s =>
    `  - [${s.severity.toUpperCase()}] ${s.message}`
  ).join('\n') || '  - Tidak ada lonjakan MoM yang signifikan.';

  const prompt = `
Kamu adalah analis bisnis senior. Berikut adalah daftar anomali yang terdeteksi secara statistik dari dataset penjualan bisnis:

=== OUTLIER PROFIT SUB-KATEGORI (berdasarkan Z-Score) ===
${profitLines}

=== ANOMALI MONTH-OVER-MONTH (MoM) PENJUALAN ===
${momLines}

Tugas kamu: Rangkum temuan di atas menjadi TEPAT 3 poin bullet dalam Bahasa Indonesia.
Setiap poin harus dimulai dengan "- " (tanda minus diikuti spasi) dan berisi 1 kalimat padat yang menjelaskan risiko bisnis nyata.
Jangan gunakan nomor urut. Langsung ke poin tanpa pengantar.
`.trim();

  return await callOpenRouter(prompt);
}
