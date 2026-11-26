// 2026-11 の QA で見つかった「出力前の確認ガイド」の穴の再発防止（偽の Supabase・外部接続なし）。
//   ①粗利率の目安は右パネルの診断（5% 未満＝低め・15% 以上＝高め）と同じ。実費・発生時のみ・参考の行は数えない
//   ②条件と明細の食い違い：輸出 FOB の運賃・輸入 CIF の運賃・輸出 CIF の保険なし・危険品の割増なし・POL＝POD・航空の FOB・LCL のコンテナ単位
//   ③PROFIT SHARE・見積書に出さない行には「単価を入力してください」を出さない
//   node scripts/design-tests/qa-gate-test.js        （THEME=1 で Industry／EDITOR=v2 で新画面）
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
(async () => {
  const H = await start();
  const ctx = await H.newCtx({ seed: [] });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  const p = await H.openPage(ctx, process.env.EDITOR === 'v2' ? '?editor=v2' : '');
  await p.evaluate(() => window.qpNewQuote && window.qpNewQuote()); await p.waitForTimeout(800);
  const fld = (k, v) => p.evaluate(([k, v]) => { const el = document.getElementById(k); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [k, v]);
  await fld('qf-ref', 'R-1'); await fld('qf-customer', 'A社'); await fld('qf-person', '山田');
  const row = async (o) => p.evaluate(o => {
    window.addRow(); const trs = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')];
    let tr = trs.find(t => !t.querySelector('[data-field="nm"]').value) || trs[trs.length - 1]; const id = tr.id.slice(4);
    for (const [k, v] of Object.entries(o)) { const el = document.getElementById(k + '-' + id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    return id;
  }, o);
  const gate = async () => { await p.evaluate(() => { const g = document.getElementById('pvWarnGuide'); if (g) g.style.display = 'none'; window.preOutputValidationGate('PDF 出力（印刷）', () => {}); }); await p.waitForTimeout(300);
    return p.evaluate(() => [...document.querySelectorAll('#pvWarnGuideList .pv-wg-item')].map(li => li.textContent).join(' | ')); };

  // ① 粗利率 10%（仕入 9,000＋乗せ幅 1,000）→ 標準なので出ない
  const r1 = await row({ cat: 'domestic', nm: '国内作業', un: 'BL', pq: '1', pp: '9000', mk: '1000' });
  let g = await gate();
  ok('① 粗利率 10% は目安の範囲なので出さない（以前は「20〜40% より低め」）', !/粗利率/.test(g), g);
  await fld('mk-' + r1, '200');
  g = await gate();
  ok('① 粗利率 2% は「低め」と出す（診断と同じ目安）', /粗利率（売上に対する利益の割合） 2\.2% — 目安（5% 未満は低め/.test(g), g);
  await fld('mk-' + r1, '1000');
  // 実費の行（仕入 100 万）は数えない
  const r2 = await row({ cat: 'domestic', nm: '実費の行', un: 'BL', pq: '1', pp: '1000000', mk: '0' });
  await p.evaluate(id => { document.getElementById('row-' + id).dataset.actual = '1'; }, r2);
  g = await gate();
  ok('① 実費の行は粗利率に数えない', !/粗利率/.test(g), g);
  await p.evaluate(id => window.delRow ? window.delRow(id) : document.getElementById('row-' + id).remove(), r2); await p.waitForTimeout(200);

  // ② 条件と明細
  const setDir = d => p.evaluate(d => window.setDirection(d), d);
  const setInco = v => fld('cond-incoterms', v);
  const rOcean = await row({ cat: 'ocean', nm: 'OCEAN FREIGHT', un: "20'GP", pq: '1', pp: '100000', mk: '12000' });
  await setDir('export'); await setInco('FOB（本船渡し）');
  g = await gate();
  ok('② 輸出 FOB で海上運賃の行があると知らせる', /輸出の FOB では、幹線の運賃.*買主.*OCEAN FREIGHT/.test(g), g);
  await setDir('import'); await setInco('CIF（運賃・保険料込み）');
  g = await gate();
  ok('② 輸入 CIF で海上運賃の行があると知らせる', /輸入の CIF では、幹線の運賃.*売主/.test(g), g);
  ok('② 輸入 CIF では保険の行が無くても知らせない（保険は売主の手配）', !/保険料の行がありません/.test(g), g);
  await setDir('export');
  g = await gate();
  ok('② 輸出 CIF で保険料の行が無いと知らせる', /輸出の CIF は売主が保険を手配する条件ですが、保険料の行がありません/.test(g), g);
  ok('② 輸出 CIF の海上運賃は売主の負担なので知らせない', !/幹線の運賃/.test(g), g);
  await row({ cat: 'insurance', nm: '貨物保険', un: 'BL', pq: '1', pp: '3000', mk: '300' });
  g = await gate();
  ok('② 保険料の行を足すと知らせない', !/保険料の行がありません/.test(g), g);
  await fld('cond-hazmat', '危険品あり（クラス要確認）');
  g = await gate();
  ok('② 危険品なのに DG の行が無いと知らせる', /危険品の割増・申告料/.test(g), g);
  await row({ cat: 'surcharge', nm: 'DG SURCHARGE', un: "20'GP", pq: '1', pp: '20000', mk: '2000' });
  g = await gate();
  ok('② DG の行を足すと知らせない', !/危険品の割増/.test(g), g);
  await p.evaluate(() => { const el = document.getElementById('z2Pol'), el2 = document.getElementById('z2Pod');
    [el, el2].forEach(e => { if (e) { e.value = 'TOKYO'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); } }); });
  await p.waitForTimeout(200);
  g = await gate();
  ok('② POL と POD が同じなら知らせる', /積み港（POL）と揚げ港（POD）が同じ「TOKYO」/.test(g), g);
  await fld('cond-mode', '航空（AIR）'); await setInco('FOB（本船渡し）');
  g = await gate();
  ok('② 航空で FOB を選ぶと知らせる', /FOB は海上・内陸水路の専用の条件です/.test(g), g);
  ok('② 航空でコンテナ単位の行があると知らせる', /コンテナ単位（20'GP など）の行があります/.test(g), g);
  await fld('cond-mode', '海上（FCL）'); await setInco('FCA（運送人渡し）'); await setDir('import');
  await fld('cond-hazmat', 'なし（一般貨物）');
  await p.evaluate(() => { const e = document.getElementById('z2Pod'); e.value = 'SINGAPORE'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
  g = await gate();
  ok('② 食い違いが無ければ何も出さない', !/幹線の運賃|保険料の行|危険品|POL|専用の条件|コンテナ単位/.test(g), g);

  // ③ PS・見積書に出さない行
  const rPs = await row({ cat: 'other', nm: 'PROFIT SHARE', un: 'BL', pq: '1', pp: '40', mk: '0' });
  await p.evaluate(id => { const b = document.querySelector('#row-' + id + ' .ps-mode-btn'); if (b) b.click(); else document.getElementById('row-' + id).dataset.profitShare = '1'; }, rPs);
  const rH = await row({ cat: 'other', nm: '社内だけの行', un: 'BL', pq: '1', pp: '0', mk: '0' });
  await p.evaluate(id => { document.getElementById('row-' + id).dataset.hideQuote = '1'; }, rH);
  await p.waitForTimeout(200);
  g = await gate();
  ok('③ PROFIT SHARE の行に「単価を入力」を出さない', !/PROFIT SHARE/.test(g), g);
  ok('③ 見積書に出さない行に「単価を入力」を出さない', !/社内だけの行/.test(g), g);

  ok('ページエラーなし', p.__errs.length === 0, p.__errs);
  await H.close();
  console.log(fails ? fails + ' 件 FAIL' : '全項目 PASS');
  process.exit(fails ? 1 : 0);
})();
