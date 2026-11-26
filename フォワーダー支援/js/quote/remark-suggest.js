// 全体リマークの「🎯 おすすめ」（2026-11）
//  段階 1：プリセットに「どんな見積のときに使うか」の条件を持たせ、条件に合う見積では定型文のタブの先頭に出す
//  段階 2：プリセットを押したときの見積の条件を記録し（remark_preset_uses）、似た条件でよく使われる文もおすすめに出す
//  段階 3：過去の見積の全体リマークから、何件もの案件で手書きされている文を探し「プリセット候補」として出す（読み取りだけ）
//  ボタンを描くのは ui.js renderRemarkPresets()（ここは判定と、条件の入力欄・道具の行・候補の画面だけ）。
//  SQL：docs/sql/remark-presets-conditions.sql（未実行でも動く＝共有プリセットに条件を付けられず、記録を送らないだけ）
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t, ms) => { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(m, t || 'info', ms); };
  const nfkc = s => { try { return String(s || '').normalize('NFKC'); } catch (e) { return String(s || ''); } };

  // ---------------- 条件の項目 ----------------
  const MODES = [['fcl', 'FCL'], ['lcl', 'LCL'], ['roro', 'RO/RO'], ['break', '在来船'], ['sea', '海上（すべて）'], ['air', '航空'], ['land', '陸上'], ['domestic', '国内']];
  const MODE_OF = t => {
    t = String(t || '');
    if (/FCL/.test(t)) return 'fcl'; if (/LCL/.test(t)) return 'lcl'; if (/RORO|RO\/RO/i.test(t)) return 'roro'; if (/在来/.test(t)) return 'break';
    if (/^航空/.test(t)) return t.includes('陸上') ? 'airland' : 'air';
    if (/^海上/.test(t)) return 'sealand';
    if (/陸上のみ/.test(t)) return 'land'; if (/国内/.test(t)) return 'domestic';
    return '';
  };
  const SEA = ['fcl', 'lcl', 'roro', 'break', 'sealand'], AIR = ['air', 'airland'];
  const modeHit = (want, m) => !!m && (want === m || (want === 'sea' && SEA.includes(m)) || (want === 'air' && AIR.includes(m)) || (want === 'land' && m === 'land'));
  const DIRS = [['export', '輸出'], ['import', '輸入']];
  const dirHit = (want, d) => !!d && (d === want || (d === 'export_import' || d === 'import_export'));
  const INCOS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
  const HAZ = [['dg', '危険品'], ['temp', '温度管理'], ['heavy', '重量物'], ['other', 'その他の特殊']];
  const HAZ_OF = t => { t = String(t || ''); if (/危険/.test(t)) return 'dg'; if (/温度/.test(t)) return 'temp'; if (/重量|大型/.test(t)) return 'heavy'; if (/その他/.test(t)) return 'other'; return ''; };
  const lab = (list, k) => (list.find(x => x[0] === k) || [k, k])[1];
  const normPort = s => nfkc(s).toUpperCase().replace(/\s+/g, ' ').trim();
  const normTxt = s => nfkc(s).toLowerCase().replace(/\s+/g, '');
  const ccLabel = c => (typeof window.countryLabel === 'function' ? (window.countryLabel(c) || c) : c).replace(/（[A-Z]{2}）$/, '');

  function countryOf(t) { const c = typeof window.findCountry === 'function' && t ? window.findCountry(String(t)) : null; return c ? c.code : ''; }
  function countryOfPort(name) {
    const v = String(name || '').trim(); if (!v) return '';
    try {
      const all = typeof window.mdGetAll === 'function' ? window.mdGetAll('port') : [];
      const m = all.find(x => x.value === v) || all.find(x => { try { return window.nameSame && window.nameSame('port', x.value, v); } catch (e) { return false; } });
      const code = m && (m.details || {}).country; if (code && countryOf(code)) return countryOf(code);
    } catch (e) {}
    const g = typeof window.guessPortCountry === 'function' ? window.guessPortCountry(v) : '';
    return g ? countryOf(g) : '';
  }

  // 見積の項目（id → 値）から条件の材料を作る。いまの画面と過去の案件（data.fields）の両方で使う
  function ctxFromFields(f) {
    f = f || {};
    const ports = [], cc = new Set();
    const addPort = (p, cty) => { const n = normPort(p); if (n) ports.push(n); const c = countryOf(cty) || countryOfPort(p); if (c) cc.add(c); };
    addPort(f.z2Pol, f.z2PolCountry); addPort(f.z2Pod, f.z2PodCountry);
    try {
      const rs = JSON.parse(f['z2-routes-data'] || '[]');
      if (Array.isArray(rs)) { const on = rs.filter(r => r && r.enabled !== false); (on.length ? on : rs).forEach(r => { addPort(r.pol); addPort(r.pod); }); }
    } catch (e) {}
    const cargoText = String(f['cond-cargo'] || '');
    const cargo = new Set(); if (f.remarkCargoSel) cargo.add(f.remarkCargoSel);
    const types = typeof window.rsCargoTypes === 'function' ? window.rsCargoTypes() : [];
    if (cargoText) types.forEach(d => { if ((d.keywords || []).some(k => k && cargoText.includes(k))) cargo.add(d.key); });
    const inco = (/^([A-Z]{3})/.exec(String(f['cond-incoterms'] || '')) || [])[1] || '';
    return { mode: MODE_OF(f['cond-mode']), dir: String(f['cond-direction'] || ''), inco, haz: HAZ_OF(f['cond-hazmat']), cc: [...cc], port: [...new Set(ports)], cargo: [...cargo], cargoText };
  }
  const FIELD_IDS = ['cond-mode', 'cond-direction', 'cond-incoterms', 'cond-hazmat', 'cond-cargo', 'z2Pol', 'z2Pod', 'z2PolCountry', 'z2PodCountry', 'z2-routes-data', 'remarkCargoSel'];
  function readNow() { const f = {}; FIELD_IDS.forEach(id => { const el = $(id); if (el) f[id] = el.value; }); return ctxFromFields(f); }

  // ---------------- 条件の判定 ----------------
  // 標準の定型文に最初から付けておく条件（コードの中・直せない）
  const BUILTIN_COND = {
    '☣️ 危険品': { haz: ['dg', 'temp'] },
    '📦 重量・容積': { mode: ['lcl', 'air'] },
    '🌀 遅延の免責': { mode: ['sea'] },
    '💊 薬機法（輸入時の注意）': { cargo: ['医療機器・健康効果'], dir: ['import'] },
  };
  const DIMS = ['mode', 'dir', 'cc', 'port', 'cargo', 'kw', 'inco', 'haz'];
  function cleanCond(c) {
    if (!c || typeof c !== 'object') return null;
    const o = {};
    DIMS.forEach(k => { const v = Array.isArray(c[k]) ? c[k].map(x => String(x || '').trim()).filter(Boolean) : []; if (v.length) o[k] = [...new Set(v)].slice(0, 30); });
    return Object.keys(o).length ? o : null;
  }
  function condOf(p) {
    if (!p) return null;
    const own = cleanCond(p.cond || p.conditions);
    if (own) return own;
    if (!p.id && !p._user && !p._cargoLocal) return cleanCond(BUILTIN_COND[p.label]);
    return null;
  }
  function matchCond(cond, x) {
    if (!cond) return null;
    let n = 0;
    for (const k of Object.keys(cond)) {
      const want = cond[k]; let ok = false;
      if (k === 'mode') ok = want.some(w => modeHit(w, x.mode));
      else if (k === 'dir') ok = want.some(w => dirHit(w, x.dir));
      else if (k === 'cc') ok = want.some(w => x.cc.includes(w.toUpperCase()));
      else if (k === 'port') ok = want.some(w => { const a = normPort(w); return a && x.port.some(p => p === a || p.includes(a) || a.includes(p)); });
      else if (k === 'cargo') ok = want.some(w => x.cargo.includes(w));
      else if (k === 'kw') { const t = normTxt(x.cargoText); ok = !!t && want.some(w => { const a = normTxt(w); return a && t.includes(a); }); }
      else if (k === 'inco') ok = want.some(w => w.toUpperCase() === x.inco);
      else if (k === 'haz') ok = want.some(w => w === x.haz);
      if (!ok) return null;
      n++;
    }
    return n;
  }
  function condText(cond) {
    if (!cond) return '';
    const parts = [];
    if (cond.mode) parts.push(cond.mode.map(k => lab(MODES, k)).join('／'));
    if (cond.dir) parts.push(cond.dir.map(k => lab(DIRS, k)).join('／'));
    if (cond.cc) parts.push(cond.cc.map(ccLabel).join('／'));
    if (cond.port) parts.push(cond.port.join('／'));
    if (cond.cargo) { const types = window.rsCargoTypes ? window.rsCargoTypes() : []; parts.push(cond.cargo.map(k => ((types.find(d => d.key === k) || {}).label || k).replace(/^\S+\s/, '')).join('／')); }
    if (cond.kw) parts.push('品名に「' + cond.kw.join('」「') + '」');
    if (cond.inco) parts.push(cond.inco.join('／'));
    if (cond.haz) parts.push(cond.haz.map(k => lab(HAZ, k)).join('／'));
    return parts.join('・');
  }
  window.rsHasCond = p => !!condOf(p);
  window.rsCondText = p => condText(condOf(p));
  window.rsMatch = (cond, ctx) => matchCond(cleanCond(cond), ctx || readNow());
  window.rsCtxFromFields = ctxFromFields;

  // ---------------- 段階 2：使った記録 ----------------
  const LOCAL_USES = 'rsLocalUses_v1', SESSION_USES = 'rsUses_v1', MIN_USES = 3;
  let _uses = null, _usesBusy = false, _usesMissing = false, _usesFor = '';
  function keyOf(p) {
    if (!p || !p.label) return '';
    if (p.id) return 's:' + p.id;
    if (p._user) return 'u:' + p.label;
    if (p._cargoLocal) return 'u:c:' + (p._cargoKey || '') + ':' + p.label;
    if (p._cargoType && p._builtin) return 'c:' + p.label;
    return 'b:' + p.label;
  }
  // 記録する条件（金額・お客様名・港の名前・本文は入れない）
  function usageCtx(x) {
    const o = {};
    if (x.mode) o.mode = x.mode; if (x.dir) o.dir = x.dir; if (x.inco) o.inco = x.inco; if (x.haz) o.haz = x.haz;
    const cc = x.cc.filter(c => c !== 'JP'); if (cc.length) o.cc = cc.slice(0, 6);
    if (x.cargo.length) o.cargo = x.cargo.slice(0, 6);
    return o;
  }
  const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
  const isMissing = e => !!e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST204' || /does not exist|schema cache|remark_preset_uses/i.test(e.message || ''));
  const me = () => { const u = window.quoteCloudUser && window.quoteCloudUser(); return (u && u.email) || ''; };

  async function loadUses() {
    const c = window.quoteCloudClient && window.quoteCloudClient(); const em = me();
    if (!c || !em || _usesBusy || _usesMissing) return;
    if (_uses && _usesFor === em) return;
    try { const s = JSON.parse(sessionStorage.getItem(SESSION_USES) || 'null'); if (s && s.email === em && Date.now() - s.at < 20 * 60e3 && Array.isArray(s.rows)) { _uses = s.rows; _usesFor = em; return; } } catch (e) {}
    _usesBusy = true;
    try {
      const since = new Date(Date.now() - 400 * 864e5).toISOString();
      const { data, error } = await c.from('remark_preset_uses').select('preset_key, ctx').gte('used_at', since).order('used_at', { ascending: false }).limit(2000);
      if (error) { if (isMissing(error)) _usesMissing = true; return; }
      _uses = (data || []).map(r => ({ k: r.preset_key, x: r.ctx || {} })); _usesFor = em;
      try { sessionStorage.setItem(SESSION_USES, JSON.stringify({ email: em, at: Date.now(), rows: _uses })); } catch (e) {}
      kick();
    } catch (e) {} finally { _usesBusy = false; }
  }
  window.rsRecordUse = function (p) {
    const k = keyOf(p); if (!k) return;
    const x = usageCtx(readNow()); if (!Object.keys(x).length) return;   // 条件が何も無い見積では記録しない
    if (k.startsWith('u:')) { const a = lsGet(LOCAL_USES, []); a.unshift({ k, x }); lsSet(LOCAL_USES, a.slice(0, 500)); return; }
    if (_uses) { _uses.unshift({ k, x }); try { sessionStorage.removeItem(SESSION_USES); } catch (e) {} }
    const c = window.quoteCloudClient && window.quoteCloudClient();
    if (!c || !me() || _usesMissing) return;
    Promise.resolve(c.from('remark_preset_uses').insert({ preset_key: k, ctx: x })).then(r => { if (r && r.error && isMissing(r.error)) _usesMissing = true; }).catch(() => {});
  };
  function simDims(u, x) {
    const d = [];
    if (u.mode && x.mode && (u.mode === x.mode)) d.push('mode');
    if (u.dir && x.dir && u.dir === x.dir) d.push('dir');
    if (u.inco && x.inco && u.inco === x.inco) d.push('inco');
    if (u.haz && x.haz && u.haz === x.haz) d.push('haz');
    if (Array.isArray(u.cc) && u.cc.some(c => x.cc.includes(c))) d.push('cc');
    if (Array.isArray(u.cargo) && u.cargo.some(c => x.cargo.includes(c))) d.push('cargo');
    return d;
  }
  function ctxDimCount(x) { let n = 0; if (x.mode) n++; if (x.dir) n++; if (x.inco) n++; if (x.haz) n++; if (x.cc.some(c => c !== 'JP')) n++; if (x.cargo.length) n++; return n; }
  function dimLabel(dim, x) {
    if (dim === 'mode') return lab(MODES, x.mode) || (SEA.includes(x.mode) ? '海上' : AIR.includes(x.mode) ? '航空' : x.mode);
    if (dim === 'dir') return /^export/.test(x.dir) ? '輸出' : '輸入';
    if (dim === 'inco') return x.inco;
    if (dim === 'haz') return lab(HAZ, x.haz);
    if (dim === 'cc') return x.cc.filter(c => c !== 'JP').map(ccLabel).join('／');
    if (dim === 'cargo') { const types = window.rsCargoTypes ? window.rsCargoTypes() : []; return x.cargo.map(k => ((types.find(d => d.key === k) || {}).label || k).replace(/^\S+\s/, '')).join('／'); }
    return '';
  }

  // ---------------- おすすめの一覧（ui.js が描画のたびに呼ぶ） ----------------
  let _sig = '';
  window.rsSuggest = function (pool) {
    const x = readNow();
    if (me() && !_uses && !_usesMissing) loadUses();
    const out = [], seen = new Set();
    // ① 条件に合うもの（条件の項目が多い＝細かく決めたものが先）
    const condHits = [];
    (pool || []).forEach(p => { const cond = condOf(p); const n = matchCond(cond, x); if (n) condHits.push({ p, n, cond }); });
    // ② 似た条件でよく使われているもの
    const need = Math.min(2, ctxDimCount(x));
    const usage = new Map();
    if (need > 0) {
      const all = (_uses || []).concat(lsGet(LOCAL_USES, []));
      all.forEach(u => { const d = simDims(u.x || {}, x); if (d.length >= need) { const e = usage.get(u.k) || { n: 0, dims: {} }; e.n++; d.forEach(k => e.dims[k] = (e.dims[k] || 0) + 1); usage.set(u.k, e); } });
    }
    const useN = p => (usage.get(keyOf(p)) || { n: 0 }).n;
    condHits.sort((a, b) => b.n - a.n || useN(b.p) - useN(a.p));
    condHits.forEach(({ p, cond }) => {
      const t = (p.text || '').trim(); if (!t || seen.has(t)) return; seen.add(t);
      const u = useN(p);
      out.push({ ...p, _suggest: true, _whyShort: '🎯', _why: '🎯 おすすめの条件に合っています（' + condText(cond) + '）' + (u ? '\n似た条件の見積で ' + u + ' 回使われています' : '') });
    });
    const byKey = new Map((pool || []).map(p => [keyOf(p), p]));
    [...usage.entries()].filter(([, e]) => e.n >= MIN_USES).sort((a, b) => b[1].n - a[1].n).forEach(([k, e]) => {
      const p = byKey.get(k); if (!p) return;
      const t = (p.text || '').trim(); if (!t || seen.has(t)) return; seen.add(t);
      const dims = Object.keys(e.dims).filter(d => e.dims[d] >= e.n * 0.6).map(d => dimLabel(d, x)).filter(Boolean);
      out.push({ ...p, _suggest: true, _whyShort: e.n + '回', _why: '📈 似た条件の見積でよく使われています（' + (dims.join('・') || '似た条件') + '・' + e.n + ' 回）' });
    });
    const res = out.slice(0, 10);
    _sig = res.map(keyOf).join('|');
    return res;
  };
  window.rsSignature = () => _sig;

  // 見積の条件が変わったら描き直す（おすすめの顔ぶれが変わったときだけ）
  let _kickT = null;
  function kick() { clearTimeout(_kickT); _kickT = setTimeout(check, 250); }
  function check() {
    const w = $('presetBtns'); if (!w || typeof window.rsPresetPool !== 'function') return;
    const tab = $('tab-quote-make'); if (!tab || !tab.classList.contains('active') || document.hidden) return;
    let sig; try { window.rsSuggest(window.rsPresetPool()); sig = _sig; } catch (e) { return; }
    if (sig !== (w.dataset.rsSig || '') && typeof window.renderRemarkPresets === 'function') window.renderRemarkPresets();
  }
  document.addEventListener('change', e => { if (e.target && FIELD_IDS.includes(e.target.id)) kick(); }, true);
  document.addEventListener('input', e => { if (e.target && (e.target.id === 'cond-cargo' || e.target.id === 'z2Pod' || e.target.id === 'z2PodCountry' || e.target.id === 'z2Pol' || e.target.id === 'z2PolCountry')) kick(); }, true);
  setInterval(check, 2000);   // 画面から変えたとき change が出ない欄（隠しの select へ値を入れるボタン）にも追従

  // ---------------- 条件の入力欄（プリセットの追加・直す画面に足す） ----------------
  function chipRow(k, title, items) {
    return '<div class="rs-row" data-k="' + k + '"><span class="rs-k">' + title + '</span><div class="rs-chips">' +
      items.map(([v, l]) => '<button type="button" class="rs-chip" data-v="' + esc(v) + '" aria-pressed="false">' + esc(l) + '</button>').join('') + '</div></div>';
  }
  function textRow(k, title, ph) {
    return '<div class="rs-row" data-k="' + k + '"><label class="rs-k" for="rsIn_' + k + '">' + title + '</label><div class="rs-in"><input type="text" id="rsIn_' + k + '" class="bm-form-input" placeholder="' + esc(ph) + '" autocomplete="off"><div class="rs-hint" id="rsHint_' + k + '"></div></div></div>';
  }
  function ensureForm() {
    if ($('rsForm')) return true;
    const dest = $('rpDestRow'); if (!dest) return false;
    const types = window.rsCargoTypes ? window.rsCargoTypes() : [];
    const box = document.createElement('div'); box.id = 'rsForm'; box.className = 'bm-form-row rs-form';
    box.innerHTML =
      '<div class="rs-head"><b>🎯 おすすめに出す条件</b><span class="rs-sub">任意。決めた項目をすべて満たす見積で、定型文の「おすすめ」に出ます（項目の中はどれか 1 つで可）</span></div>' +
      '<div class="rs-acts"><button type="button" class="rs-mini" id="rsFillNow">この見積の条件を入れる</button><button type="button" class="rs-mini" id="rsClearCond">条件を外す</button></div>' +
      chipRow('mode', '輸送モード', MODES) + chipRow('dir', '輸出入', DIRS) +
      textRow('cc', '国', '例：インド, VN（積み地・揚げ地のどちらか）') + textRow('port', '港', '例：NHAVA SHEVA（任意）') +
      chipRow('cargo', '品物の区分', types.map(d => [d.key, d.label])) + textRow('kw', '品名に含む言葉', '例：電池, 冷凍') +
      chipRow('inco', '貿易条件', INCOS.map(v => [v, v])) + chipRow('haz', '危険品・特殊', HAZ) +
      '<div class="rs-sum" id="rsSum"></div>';
    const enRow = document.createElement('div'); enRow.className = 'bm-form-row'; enRow.id = 'rsEnRow';
    enRow.innerHTML = '<label class="bm-form-label" for="rsEn">英文（「英語で出力」のときに使う・任意）</label><textarea id="rsEn" class="bm-form-textarea" rows="3" placeholder="例：Shipper is responsible for ..."></textarea><div class="rs-note" id="rsSqlNote" hidden>チーム共有のプリセットに条件・英文を保存するには、管理者が docs/sql/remark-presets-conditions.sql を実行する必要があります（いまは個人のプリセットにだけ保存できます）。</div>';
    dest.before(box); dest.before(enRow);
    box.addEventListener('click', e => {
      const b = e.target.closest('.rs-chip'); if (b) { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(on)); b.classList.toggle('is-on', on); sum(); return; }
      if (e.target.id === 'rsFillNow') { setCond(Object.assign({}, cleanCond(nowCond()) || {})); sum(); }
      if (e.target.id === 'rsClearCond') { setCond(null); sum(); }
    });
    box.addEventListener('input', () => sum());
    return true;
  }
  const splitList = v => String(v || '').split(/[,、，\n]+/).map(s => s.trim()).filter(Boolean);
  function readCc() {
    const raw = splitList($('rsIn_cc') && $('rsIn_cc').value); const ok = [], bad = [];
    raw.forEach(t => { const c = countryOf(t); if (c) ok.push(c); else bad.push(t); });
    return { ok: [...new Set(ok)], bad };
  }
  function nowCond() {
    const x = readNow(); const c = {};
    if (x.mode) c.mode = [SEA.includes(x.mode) && !['fcl', 'lcl', 'roro', 'break'].includes(x.mode) ? 'sea' : AIR.includes(x.mode) ? 'air' : x.mode];
    const cc = x.cc.filter(v => v !== 'JP'); if (cc.length) c.cc = cc;
    if (x.cargo.length) c.cargo = x.cargo;
    if (x.haz) c.haz = [x.haz];
    return c;
  }
  function setCond(cond) {
    const box = $('rsForm'); if (!box) return;
    box.querySelectorAll('.rs-row').forEach(r => {
      const k = r.dataset.k, v = (cond && cond[k]) || [];
      r.querySelectorAll('.rs-chip').forEach(b => { const on = v.includes(b.dataset.v); b.setAttribute('aria-pressed', String(on)); b.classList.toggle('is-on', on); });
      const inp = r.querySelector('input'); if (inp) inp.value = k === 'cc' ? v.map(ccLabel).join(', ') : v.join(', ');
    });
  }
  function getCond() {
    const box = $('rsForm'); if (!box) return null; const c = {};
    box.querySelectorAll('.rs-row').forEach(r => {
      const k = r.dataset.k;
      const chips = [...r.querySelectorAll('.rs-chip.is-on')].map(b => b.dataset.v); if (chips.length) c[k] = chips;
      const inp = r.querySelector('input');
      if (inp) { const v = k === 'cc' ? readCc().ok : k === 'port' ? splitList(inp.value).map(normPort) : splitList(inp.value); if (v.length) c[k] = v; }
    });
    return cleanCond(c);
  }
  function sum() {
    const cc = readCc(); const h = $('rsHint_cc');
    if (h) h.innerHTML = (cc.ok.length ? '✓ ' + esc(cc.ok.map(c => ccLabel(c) + '（' + c + '）').join('、')) : '') + (cc.bad.length ? ' <span class="rs-bad">⚠ 国として読めない：' + esc(cc.bad.join('、')) + '</span>' : '');
    const s = $('rsSum'); if (!s) return;
    const c = getCond(); const n = c ? matchCond(c, readNow()) : null;
    s.innerHTML = c ? '条件：<b>' + esc(condText(c)) + '</b>' + (n ? '　<span class="rs-ok">いまの見積に合います</span>' : '　<span class="rs-muted">いまの見積には合いません</span>') : '<span class="rs-muted">条件なし＝おすすめには出ません（チーム共有・個人のタブから使えます）</span>';
  }
  window.rsFormSet = function (cond, en, o) {
    if (!ensureForm()) return;
    setCond(cleanCond(cond)); const e = $('rsEn'); if (e) e.value = en || '';
    const st = typeof window.rpCondColsState === 'function' ? window.rpCondColsState() : null;
    const note = $('rsSqlNote'); if (note) note.hidden = !(o && o.shared && st === false);
    sum();
  };
  window.rsFormGet = () => ({ cond: getCond(), en: ($('rsEn') && $('rsEn').value) || '' });

  // ---------------- 道具の行（文章の欄の下） ----------------
  function ensureTools() {
    if ($('rsTools')) return;
    const ta = $('remarkTextarea'); if (!ta) return;
    const row = document.createElement('div'); row.id = 'rsTools'; row.className = 'rs-tools';
    row.innerHTML = '<button type="button" class="rs-tool" id="rsMakeBtn" title="文章の欄で選んだ文（選んでいなければカーソルのある行）を、プリセットとして登録します。いまの見積の条件が「おすすめの条件」に入った状態で開きます">⭐ 選んだ文をプリセットにする</button>' +
      '<button type="button" class="rs-tool" id="rsCandBtn" title="過去の見積の全体リマークから、何件もの案件で手書きされている文を探します（読むだけ・外部には送りません）">🔎 よく書く文からプリセット候補を探す<span class="rs-badge" id="rsCandBadge" hidden></span></button>';
    ta.after(row);
    $('rsMakeBtn').addEventListener('mousedown', e => e.preventDefault());   // 押しても文章の欄の選択を外さない
    $('rsMakeBtn').addEventListener('click', makeFromSelection);
    $('rsCandBtn').addEventListener('click', openCandidates);
  }
  function makeFromSelection() {
    const ta = $('remarkTextarea'); if (!ta) return;
    let t = ta.value.slice(ta.selectionStart || 0, ta.selectionEnd || 0).trim();
    if (!t) { const v = ta.value, p = ta.selectionStart || 0; const s = v.lastIndexOf('\n', p - 1) + 1, e = v.indexOf('\n', p); t = v.slice(s, e < 0 ? v.length : e).trim(); }
    if (!t) { toast('⚠️ 文章の欄で、プリセットにしたい文を選んでから押してください', 'warn', 4000); return; }
    if (typeof window.rpOpenWith !== 'function') return;
    window.rpOpenWith({ text: t, label: t.replace(/\s+/g, ' ').slice(0, 18), cond: cleanCond(nowCond()) });
  }

  // ---------------- 段階 3：過去のリマークから候補を探す ----------------
  const DISMISS = 'rsCandDismiss_v1';
  const BULLET = /^[\s・\-\*※●○◆■□▶►•＊]+|^[（(]?[0-9０-９①-⑳]+[\.．、)）]\s*/;
  const keyLine = s => nfkc(s).replace(BULLET, '').replace(/\s+/g, ' ').trim();
  const maskNum = s => s.replace(/[0-9]+([.,][0-9]+)*/g, '9');
  function splitSentences(text) {
    const out = [];
    String(text || '').split(/\n/).forEach(l => { const t = l.trim(); if (!t) return; if (t.length > 80 && t.includes('。')) t.split(/(?<=。)/).forEach(x => { if (x.trim()) out.push(x.trim()); }); else out.push(t); });
    return out;
  }
  function presetLineSet() {
    const set = new Set(); const pool = window.rsPresetPool ? window.rsPresetPool() : [];
    pool.forEach(p => splitSentences(p.text).forEach(l => set.add(maskNum(keyLine(l)))));
    return set;
  }
  let _candCache = null;
  async function collectCandidates() {
    let rows = typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : [];
    if (!rows.length && typeof window.cloudListPresets === 'function' && me()) { try { await window.cloudListPresets(true); } catch (e) {} rows = window.cloudGetAllRows ? window.cloudGetAllRows() : []; }
    const known = presetLineSet(); const dismissed = new Set(lsGet(DISMISS, []));
    const groups = new Map(); let cases = 0;
    rows.forEach(r => {
      const f = r && r.data && r.data.fields; if (!f) return;
      const lines = splitSentences(f.remarkTextarea); if (!lines.length) return;
      cases++;
      const x = ctxFromFields(f); const seenHere = new Set();
      lines.forEach(orig => {
        const kl = keyLine(orig); if (kl.length < 10 || /^[=＝\-─_ー~〜]{4,}$/.test(kl)) return;
        const key = maskNum(kl); if (known.has(key) || dismissed.has(key) || seenHere.has(key)) return;
        seenHere.add(key);
        const g = groups.get(key) || { key, n: 0, texts: new Map(), ctx: [] };
        g.n++; g.texts.set(kl, (g.texts.get(kl) || 0) + 1); g.ctx.push(x); groups.set(key, g);
      });
    });
    const min = cases < 10 ? 2 : 3;
    const list = [...groups.values()].filter(g => g.n >= min).sort((a, b) => b.n - a.n).slice(0, 40).map(g => {
      const text = [...g.texts.entries()].sort((a, b) => b[1] - a[1])[0][0];
      return { key: g.key, n: g.n, text, variants: g.texts.size, cond: proposeCond(g.ctx) };
    });
    _candCache = { list, cases, rows: rows.length, min };
    return _candCache;
  }
  // 候補の文を使っていた案件の 8 割以上が同じなら、その条件を案として出す
  function proposeCond(ctxs) {
    const n = ctxs.length, c = {};
    const top = arr => { const m = new Map(); arr.forEach(v => v && m.set(v, (m.get(v) || 0) + 1)); const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0]; return best && best[1] >= n * 0.8 ? best[0] : ''; };
    const mode = top(ctxs.map(x => x.mode)); if (mode) c.mode = [mode === 'sealand' ? 'sea' : mode === 'airland' ? 'air' : mode];
    const cc = top(ctxs.map(x => x.cc.filter(v => v !== 'JP')[0] || '')); if (cc) c.cc = [cc];
    const cargo = top(ctxs.map(x => x.cargo[0] || '')); if (cargo) c.cargo = [cargo];
    const haz = top(ctxs.map(x => x.haz)); if (haz) c.haz = [haz];
    return cleanCond(c);
  }
  function ensureCandModal() {
    if ($('rsCandModal')) return;
    const m = document.createElement('div'); m.id = 'rsCandModal'; m.className = 'bm-modal-overlay rs-cand-overlay';
    m.innerHTML = '<div class="bm-modal-box rs-cand-box" role="dialog" aria-labelledby="rsCandTitle"><div class="bm-modal-head"><h3 id="rsCandTitle">🔎 プリセット候補（よく書く文）</h3><button type="button" class="bm-modal-close" data-rs="close" aria-label="閉じる">✕</button></div><div class="rs-cand-body" id="rsCandBody"></div></div>';
    document.body.appendChild(m);
    m.addEventListener('click', e => {
      if (e.target === m || e.target.closest('[data-rs="close"]')) { closeCand(); return; }
      const b = e.target.closest('[data-rs]'); if (!b) return;
      const it = _candCache && _candCache.list[+b.dataset.i]; if (!it) return;
      if (b.dataset.rs === 'make') { closeCand(); window.rpOpenWith && window.rpOpenWith({ text: it.text, label: it.text.replace(/\s+/g, ' ').slice(0, 18), cond: it.cond }); }
      if (b.dataset.rs === 'skip') { const a = lsGet(DISMISS, []); a.push(it.key); lsSet(DISMISS, a.slice(-500)); _candCache.list.splice(+b.dataset.i, 1); renderCand(); updateBadge(true); }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('rsCandModal') && $('rsCandModal').classList.contains('open')) { e.stopPropagation(); closeCand(); } }, true);
  }
  function closeCand() { const m = $('rsCandModal'); if (m) m.classList.remove('open'); }
  function renderCand() {
    const body = $('rsCandBody'); if (!body) return; const d = _candCache;
    if (!d) { body.innerHTML = '<p class="rs-muted">探しています…</p>'; return; }
    const head = '<p class="rs-cand-desc">チームの見積 ' + d.cases + ' 件の全体リマークから、<b>' + d.min + ' 件以上の案件</b>で手書きされている文を探しました（プリセットにある文は除く・数字だけ違う文はまとめています）。読むだけで、外部には送りません。</p>';
    if (!d.list.length) { body.innerHTML = head + '<div class="rs-cand-empty">✅ いまプリセットにできそうな文はありません。' + (d.rows ? '' : '<br>（案件の一覧が読み込まれていません。ログインしてダッシュボードを開いてから試してください）') + '</div>'; return; }
    body.innerHTML = head + '<ol class="rs-cand-list">' + d.list.map((it, i) =>
      '<li class="rs-cand"><div class="rs-cand-text">' + esc(it.text) + '</div><div class="rs-cand-meta"><span class="rs-cand-n">' + it.n + ' 件の案件</span>' + (it.variants > 1 ? '<span class="rs-muted">数字違い ' + it.variants + ' 通り</span>' : '') +
      (it.cond ? '<span class="rs-cand-cond">🎯 条件の案：' + esc(condText(it.cond)) + '</span>' : '') + '</div>' +
      '<div class="rs-cand-acts"><button type="button" class="bm-btn-save" data-rs="make" data-i="' + i + '">⭐ プリセットにする</button><button type="button" class="bm-btn-cancel" data-rs="skip" data-i="' + i + '">今後出さない</button></div></li>').join('') + '</ol>';
  }
  async function openCandidates() {
    ensureCandModal(); _candCache = null; renderCand();
    $('rsCandModal').classList.add('open');
    await collectCandidates(); renderCand(); updateBadge(true);
  }
  let _badgeRows = -1;
  async function updateBadge(force) {
    const b = $('rsCandBadge'); if (!b) return;
    const rows = typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : [];
    if (!force && rows.length === _badgeRows) return; _badgeRows = rows.length;
    if (!rows.length) { b.hidden = true; return; }
    const d = force && _candCache ? _candCache : await collectCandidates();
    b.hidden = !d.list.length; b.textContent = d.list.length ? String(d.list.length) : '';
  }
  window.rsOpenCandidates = openCandidates;
  window.rsCollectCandidates = collectCandidates;

  function init() { ensureTools(); ensureForm(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('load', init);
  setInterval(() => { const t = $('tab-quote-make'); if (t && t.classList.contains('active') && !document.hidden) updateBadge(false); }, 60000);
})();
