// 2026-11 の QA で見つかった計算・入力の不具合の再発防止（偽の Supabase・外部接続なし）。
//   ①単価の欄への貼り付けが、数式でない文（USD 1,200/20GP・日付・1,000-1,500）を勝手に計算しない
//   ②航空の CW 合計は「総実重量」と「総容積重量」の大きい方（品目ごとの CW の足し算ではない）
//   ③外貨→円の換算で、小数の誤差のせいで 1 円多くならない（100 × 161.3 ＝ 16,130）
//   ④サブコン名に「"」があっても、案件を開ける
//   node scripts/design-tests/qa-calc-test.js        （THEME=1 で Industry／EDITOR=v2 で新画面）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { try { return require('playwright-core'); } catch (e2) { return require('playwright'); } } })();
const http = require('http'), fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..', '..');
async function start(opts = {}) {
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ME = 'me@x.com';
  async function newCtx(o = {}) {
    const ctx = await b.newContext({ viewport: o.viewport || { width: 1400, height: 900 }, locale: 'ja-JP' });
    await ctx.addInitScript(({ ME, seed }) => {
      try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
      if (seed && seed.__theme) {}
      window.__delay = 0; window.__log = [];
      const db = window.__db = { quote_presets: seed || [] };
      let idn = 100;
      const qb = t => {
        const st = { op: 'select', filters: [], payload: null, single: false };
        const api = {
          select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, or() { return api; }, is() { return api; }, ilike() { return api; },
          gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; }, filter() { return api; }, lt() { return api; }, gt() { return api; },
          eq(k, v) { st.filters.push(r => r[k] === v); return api; }, in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
          update(o) { st.op = 'update'; st.payload = o; return api; }, insert(o) { st.op = 'insert'; st.payload = o; return api; }, delete() { st.op = 'delete'; return api; }, upsert(o) { st.op='upsert'; st.payload=o; return api; },
          single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
          then(res, rej) {
            const run = () => {
              const rows = (db[t] = db[t] || []);
              let data = null;
              window.__log.push(t + ':' + st.op);
              if (st.op === 'update') { data = rows.filter(r => st.filters.every(f => f(r))); data.forEach(r => { Object.assign(r, JSON.parse(JSON.stringify(st.payload))); r.updated_at = new Date().toISOString(); }); }
              else if (st.op === 'delete') { db[t] = rows.filter(r => !st.filters.every(f => f(r))); data = []; }
              else if (st.op === 'insert' || st.op === 'upsert') { const arr = Array.isArray(st.payload) ? st.payload : [st.payload]; data = arr.map(p => { const r = Object.assign({ id: 'n' + (idn++), updated_at: new Date().toISOString() }, JSON.parse(JSON.stringify(p))); rows.push(r); return r; }); if (st.single) data = data[0]; }
              else { data = rows.filter(r => st.filters.every(f => f(r))); if (st.single) data = data[0] || null; }
              return { data, error: null };
            };
            const d = (t === 'quote_presets' && st.op !== 'select') ? window.__delay : 0;
            return new Promise(r => setTimeout(() => r(run()), d)).then(res, rej);
          },
        };
        return api;
      };
      const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() { return Promise.resolve(); }, presenceState() { return {}; } };
      const user = { id: 'u1', email: ME, user_metadata: { full_name: 'Me' } };
      const client = {
        from: qb, channel: () => ch, removeChannel() {},
        rpc: (name) => Promise.resolve({ data: name === 'get_my_role' ? 'admin' : name === 'quote_acquire_lock' ? 'OK' : name === 'quote_renew_lock' ? true : null, error: null }),
        auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signInWithOAuth() { return Promise.resolve({}); }, signOut() { return Promise.resolve({}); } },
        storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), createSignedUrls: async () => ({ data: [], error: null }), list: async()=>({data:[],error:null}) }) },
      };
      window.supabase = { createClient: () => client };
    }, { ME, seed: o.seed });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    return ctx;
  }
  async function openPage(ctx, q = '') {
    const p = await ctx.newPage();
    p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
    p.on('dialog', d => { p.__dialogs = (p.__dialogs || []); p.__dialogs.push(d.message()); d.accept(); });
    p.setDefaultTimeout(10000);
    await p.goto(URL + q, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
    await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
    return p;
  }
  return { b, srv, newCtx, openPage, URL, close: async () => { await b.close(); srv.close(); } };
}

// 2026-11 の QA で見つかった「古い日付のまま出力できる」「外貨の行に課税の印」の再発防止（偽の Supabase・外部接続なし）。
//   ①コピーした案件は、発行日＝今日・有効期限＝今月末・提出期限なし（日付でない有効期限はそのまま）
//   ②出力前の確認ガイドに、過ぎた有効期限・発行日より前の有効期限・30 日より前の発行日・未来の受信日を出す
//   ③外貨で請求する行に「課税」が付いていたら確認ガイドで知らせ、御見積書に「*」を付けない

let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
const SV = 'A"社 (x\\y)';
(async () => {
  const H = await start();
  const ctx = await H.newCtx({ seed: [{ id: 'c1', name: '案件c1', status: '受注', customer: 'A社', created_by: 'me@x.com', owner_email: 'me@x.com', tags: [], editors: [],
    updated_at: '2026-01-01T00:00:00Z', data: { fields: { 'qf-customer': 'A社', 'qf-ref': 'R-1' },
      rows: [{ cells: ['domestic', 'THC', '', '1', 'BL', 'JPY', '10000', '3000', 'JPY'], sv: SV, pt: 'FCL案' }] } }] });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  const p = await H.openPage(ctx, process.env.EDITOR === 'v2' ? '?editor=v2' : '');

  // ① 貼り付け
  const id = await p.evaluate(() => { const tr = document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])'); return tr.id.slice(4); });
  const paste = (text) => p.evaluate(([id, text]) => {
    const el = document.getElementById('pp-' + id); el.value = '777';
    const dt = new DataTransfer(); dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return el.value;
  }, [id, text]);
  for (const [t, bad] of [['USD 1,200/20GP', '60'], ['2026-11-24', '1991'], ['1,000-1,500', '-500'], ['1e3+1', '14']]) {
    const v = await paste(t);
    ok('① 「' + t + '」を貼り付けても計算しない', v !== bad, v);
  }
  ok('① 「100*1.1」は計算する', await paste('100*1.1') === '110', await paste('100*1.1'));
  ok('① 「=50+25」は計算する', await paste('=50+25') === '75');
  ok('① 「1,200」はそのまま 1200', await paste('1,200') === '1200');
  ok('① 「1500-200」（引き算）は計算する', await paste('1500-200') === '1300');

  // ② 航空 CW
  const cw = await p.evaluate(async () => {
    window.switchCategory && window.switchCategory('calc', document.querySelector('.cat-btn[aria-controls="tab-calc"]'));
    const wrap = document.getElementById('air-rows-wrap');
    while (wrap.querySelectorAll('.calc-multi-row').length < 2) window.addCalcRow('air');
    const rows = wrap.querySelectorAll('.calc-multi-row');
    const set = (r, o) => Object.entries(o).forEach(([k, v]) => { r.querySelector('[data-key="' + k + '"]').value = v; });
    set(rows[0], { l: 10, w: 10, h: 10, weight: 100, qty: 1 });
    set(rows[1], { l: 100, w: 100, h: 60, weight: 10, qty: 1 });
    const d = document.getElementById('air-divisor'); if (d) d.value = '6000';
    window.calcAirCW();
    const t = document.getElementById('air-result').textContent;
    const m = t.match(/CW 合計[^0-9]*[^k]*?([\d,.]+) kg/);
    // 1 行・2 個：品目ごとの切り上げをしない（10.2kg ×2 → 20.5 ではなく 20.4→20.5）
    return { t: t.slice(0, 200), total: m && m[1] };
  });
  ok('② 2 品目の CW 合計は 110 kg（200 kg ではない）', cw.total === '110' || cw.total === '110.0', cw);
  const cw2 = await p.evaluate(() => {
    const wrap = document.getElementById('air-rows-wrap');
    const rows = wrap.querySelectorAll('.calc-multi-row');
    rows.forEach((r, i) => { if (i > 0) { const b = r.querySelector('.btn-del-row, [onclick*="removeCalcRow"], .calc-row-del'); b ? b.click() : r.remove(); } });
    const r = wrap.querySelector('.calc-multi-row');
    [['l', 1], ['w', 1], ['h', 1], ['weight', 10.2], ['qty', 3]].forEach(([k, v]) => { r.querySelector('[data-key="' + k + '"]').value = v; });
    window.calcAirCW();
    const t = document.getElementById('air-result').textContent;
    const m = t.match(/CW 合計 \(×3個\)\s*([\d,.]+) kg/);
    return { t: t.slice(-120), total: m && m[1] };
  });
  ok('② 10.2kg × 3 個の CW 合計は 31.0 kg（1 個ごとに 10.5 へ切り上げた 31.5 ではない）', /^31(\.0)?$/.test(cw2.total || ''), cw2);

  // ③ 1 円のずれ
  const jpy = await p.evaluate(() => {
    const fx = window.SharedFX.toJPY(100, 'USD', { USD: 161.3 });
    return { fx, ceil: Math.ceil(fx), round: window.SharedCalc.jpyRound(100 * 161.3) };
  });
  ok('③ 100 USD × 161.3 は ¥16,130（16,131 ではない）', jpy.ceil === 16130 && jpy.round === 16130, jpy);

  // ④ サブコン名に「"」
  await p.evaluate(() => window.switchCategory && window.switchCategory('quote-make', document.querySelector('.cat-btn[aria-controls="tab-quote-make"]')));
  await p.waitForTimeout(400);
  await p.evaluate(([id, SV]) => { const el = document.getElementById('sv-' + id) || document.querySelector('#row-' + id + ' [data-field="sv"]');
    el.value = SV; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    const d = JSON.parse(JSON.stringify(window.gatherAllData()));
    window.__db.quote_presets.push({ id: 'c2', name: '案件c2', status: '受注', created_by: 'me@x.com', owner_email: 'me@x.com', tags: [], editors: [], updated_at: '2026-01-02T00:00:00Z', data: d });
  }, [id, SV]);
  await p.waitForTimeout(300);
  await p.evaluate(() => { window.cloudLoadPreset('c1'); }); await p.waitForTimeout(1200);
  await p.evaluate(() => { window.cloudLoadPreset('c2'); }); await p.waitForTimeout(1500);
  const sv = await p.evaluate(() => [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]) [data-field="sv"]')].map(e => e.value));
  ok('④ サブコン名に「"」「\\」があっても案件を開ける', sv.includes(SV), sv);

  ok('ページエラーなし', p.__errs.length === 0, p.__errs);
  await H.close();
  console.log(fails ? fails + ' 件 FAIL' : '全項目 PASS');
  process.exit(fails ? 1 : 0);
})();
