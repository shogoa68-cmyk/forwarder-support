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
//   node scripts/design-tests/qa-dates-test.js        （THEME=1 で Industry／EDITOR=v2 で新画面）
let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
const mk = (id, extra) => ({ id, name: '案件' + id, status: '受注', customer: 'A社', created_by: 'me@x.com', owner_email: 'me@x.com', tags: [], editors: [],
  updated_at: '2026-01-01T00:00:00Z', data: { fields: Object.assign({ 'qf-customer': 'A社', 'qf-person': '山田', 'qf-ref': 'R-' + id, 'cond-incoterms': 'FOB' }, extra || {}), rows: [] } });
const p2 = n => String(n).padStart(2, '0');
const D = new Date(), TODAY = D.getFullYear() + '-' + p2(D.getMonth() + 1) + '-' + p2(D.getDate());
const E = new Date(D.getFullYear(), D.getMonth() + 1, 0), EOM = E.getFullYear() + '-' + p2(E.getMonth() + 1) + '-' + p2(E.getDate());
(async () => {
  const H = await start();
  const ctx = await H.newCtx({ seed: [
    mk('c1', { 'qf-date': '2025-04-01', 'qf-valid-until': '2025-04-30', 'qf-due': '2025-04-10', 'qf-received': '2025-03-28' }),
    mk('c2', { 'qf-date': '2025-04-01', 'qf-valid-until': '本船 ONE APUS まで' }),
  ] });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  const p = await H.openPage(ctx, process.env.EDITOR === 'v2' ? '?editor=v2' : '');

  // ① コピー
  const n0 = await p.evaluate(() => window.__db.quote_presets.length);
  await p.evaluate(() => window.cloudDuplicatePreset('c1')); await p.waitForTimeout(1500);
  const cp = await p.evaluate(n => { const r = window.__db.quote_presets[n]; return r && r.data.fields; }, n0);
  ok('① コピーした案件の発行日は今日', cp && cp['qf-date'] === TODAY, cp);
  ok('① コピーした案件の有効期限は今月末', cp && cp['qf-valid-until'] === EOM, cp);
  ok('① コピーした案件には提出期限を引き継がない', cp && !cp['qf-due'], cp);
  ok('① 依頼受信日はコピー元のまま（従来どおり）', cp && cp['qf-received'] === '2025-03-28', cp);
  await p.evaluate(() => window.cloudDuplicatePreset('c2')); await p.waitForTimeout(1500);
  const cp2 = await p.evaluate(n => { const r = window.__db.quote_presets[n + 1]; return r && r.data.fields; }, n0);
  ok('① 日付でない有効期限（本船〇〇まで）はそのまま', cp2 && cp2['qf-valid-until'] === '本船 ONE APUS まで' && cp2['qf-date'] === TODAY, cp2);

  // ② 出力前の確認ガイド
  await p.evaluate(() => { window.cloudLoadPreset('c1'); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.quoteModeEdit()); await p.waitForTimeout(500);
  const id = await p.evaluate(() => { const tr = document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])') || (addRow(), document.querySelector('#tableBody tr[id^="row-"]:not([data-virtual])')); return tr.id.slice(4); });
  await p.evaluate(id => { const s = (k, v) => { const el = document.getElementById(k + '-' + id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    s('nm', 'THC'); s('un', 'BL'); s('pq', '1'); s('pp', '10000'); s('mk', '3000'); }, id);
  await p.waitForTimeout(300);
  const gate = async () => { await p.evaluate(() => { const g = document.getElementById('pvWarnGuide'); if (g) g.style.display = 'none'; window.preOutputValidationGate('PDF 出力（印刷）', () => {}); }); await p.waitForTimeout(300);
    return p.evaluate(() => [...document.querySelectorAll('#pvWarnGuideList .pv-wg-item')].map(li => li.textContent).join(' | ')); };
  let g = await gate();
  ok('② 過ぎた有効期限を知らせる', /有効期限 2025\/04\/30 はもう過ぎています/.test(g), g);
  ok('② 30 日より前の発行日を知らせる', /発行日が 2025\/04\/01（\d+ 日前）のまま/.test(g), g);
  const setDate = async (k, v) => p.evaluate(([k, v]) => { const el = document.getElementById(k); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]);
  await setDate('qf-date', TODAY); await setDate('qf-valid-until', '2099-01-01');
  g = await gate();
  ok('② 今日の発行日・先の有効期限なら日付の注意は出ない', !/有効期限|発行日/.test(g), g);
  await setDate('qf-date', '2099-02-01');
  g = await gate();
  ok('② 有効期限が発行日より前なら知らせる', /有効期限 2099\/01\/01 が発行日 2099\/02\/01 より前/.test(g), g);
  await setDate('qf-date', TODAY); await setDate('qf-received', '2099-01-01');
  g = await gate();
  ok('② 未来の依頼受信日を知らせる', /依頼受信日 2099\/01\/01 が未来/.test(g), g);
  await setDate('qf-received', TODAY);

  // ③ 外貨で請求する行の「課税」
  await p.evaluate(id => { const s = (k, v) => { const el = document.getElementById(k + '-' + id); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); };
    s('pc', 'USD'); s('bc', 'USD'); const tx = document.getElementById('tx-' + id); tx.checked = true; tx.dispatchEvent(new Event('change', { bubbles: true })); }, id);
  await p.waitForTimeout(300);
  g = await gate();
  ok('③ 外貨の行に課税が付いていると確認ガイドで知らせる', /外貨で請求する行に「課税」が付いています（1 件：THC）/.test(g), g);
  const pdf = await p.evaluate(async () => { window.openQuoteDoc(); await new Promise(r => setTimeout(r, 800));
    const tds = [...document.querySelectorAll('#qdPreview td.qd-item')]; const hit = tds.find(td => /THC/.test(td.textContent)); return hit ? hit.innerHTML : '(なし)'; });
  ok('③ 御見積書の外貨の行に「*」を付けない', !/qd-tax/.test(pdf) && /THC/.test(pdf), pdf);

  ok('ページエラーなし', p.__errs.length === 0, p.__errs);
  await H.close();
  console.log(fails ? fails + ' 件 FAIL' : '全項目 PASS');
  process.exit(fails ? 1 : 0);
})();
