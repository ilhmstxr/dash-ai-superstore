async function supabaseFetchAll(table, select = '*') {
  const allRows = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url = `${CONFIG.SUPABASE_URL}/rest/v1/${table}?select=${select}&limit=${limit}&offset=${offset}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey':        CONFIG.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=representation',
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Supabase error ${res.status}: ${errText}`);
    }

    const chunk = await res.json();
    allRows.push(...chunk);

    if (chunk.length < limit) {
      break;
    }
    offset += limit;
  }

  return allRows;
}


function normalizeRow(row) {
  const map = CONFIG.COLUMN_MAP;

  function get(key) {
    const colName = map[key];
    if (colName && row[colName] !== undefined) return row[colName];
    const lower = key.toLowerCase();
    if (row[lower] !== undefined) return row[lower];
    return row[key];
  }

  const normalized = {};

  normalized['Order ID']      = get('order_id');
  normalized['Category']      = get('category');
  normalized['Sub-Category']  = get('sub_category');
  normalized['Region']        = get('region');
  normalized['Sales']         = get('sales');
  normalized['Profit']        = get('profit');
  normalized['Segment']       = get('segment');
  normalized['City']          = get('city');
  normalized['CountryRegion'] = get('country_region');
  normalized['Province']      = get('province');
  normalized['ShipMethod']    = get('ship_method');

  normalized._sales  = parseNum(get('sales'));
  normalized._profit = parseNum(get('profit'));

  const tahun = get('tahun');
  const bulan = get('bulan');
  if (tahun && bulan) {
    normalized._date = new Date(parseInt(tahun), parseInt(bulan) - 1, 1);
    normalized['Order Date'] = `01/${String(bulan).padStart(2, '0')}/${tahun}`;
  } else {
    normalized._date = parseDate(String(get('order_date') || ''));
  }

  return normalized;
}


async function loadFromSupabase() {
  console.log(`[supabaseLoader] Mengambil data dari tabel "${CONFIG.SUPABASE_TABLE}"…`);

  showLoadingStatus('AI sedang mengambil data transaksi...', true);

  const raw = await supabaseFetchAll(CONFIG.SUPABASE_TABLE);

  if (!raw || raw.length === 0) {
    throw new Error(`Tabel "${CONFIG.SUPABASE_TABLE}" kosong atau tidak ditemukan.`);
  }

  console.log(`[supabaseLoader] ${raw.length} baris diterima.`);
  showLoadingStatus(`AI sedang menganalisis ${raw.length} data transaksi...`, true);

  return raw.map(normalizeRow);
}


function showLoadingStatus(msg, isLoading = true) {
  const el = document.getElementById('data-source-status');
  if (el) {
    if (isLoading) {
      el.innerHTML = `<i class="fa-solid fa-robot fa-spin"></i> <span class="loading-pulse">${msg}</span>`;
    } else {
      el.innerHTML = `<i class="fa-solid fa-robot"></i> ${msg}`;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL AI CACHE (SUPABASE)
// ═══════════════════════════════════════════════════════════════════════════

async function getAiCacheFromSupabase(fingerprint) {
  try {
    const url = `${CONFIG.SUPABASE_URL}/rest/v1/aiRagil?fingerprint=eq.${encodeURIComponent(fingerprint)}&limit=1`;
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey':        CONFIG.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        'Content-Type':  'application/json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.length > 0) {
      return {
        title: data[0].title,
        story: data[0].story,
        insight: data[0].insight,
        alert: data[0].alert
      };
    }
  } catch (err) {
    console.warn('[supabaseLoader] Gagal membaca cache AI dari Supabase:', err);
  }
  return null;
}

async function saveAiCacheToSupabase(fingerprint, aiData) {
  try {
    const url = `${CONFIG.SUPABASE_URL}/rest/v1/aiRagil`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey':        CONFIG.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({
        fingerprint: fingerprint,
        title: aiData.title,
        story: aiData.story,
        insight: aiData.insight,
        alert: aiData.alert
      })
    });
    if (!res.ok) {
      console.warn('[supabaseLoader] Gagal menyimpan cache AI:', await res.text());
    } else {
      console.log('[supabaseLoader] Berhasil menyimpan cache AI ke Supabase.');
    }
  } catch (err) {
    console.warn('[supabaseLoader] Gagal menyimpan cache AI ke Supabase:', err);
  }
}

