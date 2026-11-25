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


// 2026-11 の QA で見つかった「入力が消える・誤った見積が出る」不具合の再発防止（偽の Supabase・外部接続なし）。
//   node scripts/design-tests/qa-dataloss-test.js        （THEME=1 で Industry）
let fails = 0;
const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
const mk = (id, cust, extra) => ({ id, name: '案件' + id, status: '下書き中', customer: cust, created_by: 'me@x.com', owner_email: 'me@x.com', tags: [], editors: [],
  updated_at: '2026-11-01T00:00:00Z', data: { fields: Object.assign({ 'qf-customer': cust }, extra || {}), rows: [] } });
(async () => {
  const H = await start();
  const ctx = await H.newCtx({ seed: [mk('c1', 'A社'), mk('c2', 'B社', { 'qf-status': '受注', 'qf-valid-until': '2027-03-31', 'qf-core-ref': 'CORE-B' }),
    mk('c3', 'C社', { 'cond-mode': '海上（FCL）', 'cond-container-data': JSON.stringify([{ type: "20'GP", count: 2 }]) })] });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  const p = await H.openPage(ctx, process.env.EDITOR === 'v2' ? '?editor=v2' : '');
  const dirty = () => p.evaluate(() => window.quoteIsDirty());
  const openEdit = async (id) => {
    await p.evaluate(id => { window.cloudLoadPreset(id); }, id || 'c1'); await p.waitForTimeout(700);
    if (await p.evaluate(() => document.getElementById('qpLeaveConfirm')?.classList.contains('open'))) { await p.click('#qpLeaveConfirm .qplc-discard'); await p.waitForTimeout(700); }
    await p.evaluate(() => window.quoteModeEdit()); await p.waitForTimeout(500);
  };

  // ① 行の追加・削除・入力完了は「未保存」に数える
  await openEdit('c1');
  ok('（前提）開いた直後は未保存なし', !(await dirty()));
  await p.evaluate(() => window.addRow()); await p.waitForTimeout(300);
  ok('① 行を追加すると未保存になる', await dirty());
  await p.evaluate(() => window.cloudSaveCurrent({ stay: true })); await p.waitForTimeout(800);
  await p.evaluate(() => window.quoteModeEdit()); await p.waitForTimeout(600);
  ok('（前提）保存して編集し直すと未保存なし', !(await dirty()));
  await p.evaluate(() => { const b = document.querySelector('#tableBody tr[id^="row-"]:not([data-virtual]) .row-hidequote-btn'); b && b.click(); }); await p.waitForTimeout(200);
  ok('① 「見積書に出さない」を押すと未保存になる', await dirty());

  // ② 別の案件を開く前に確認を出す（以前は類似案件の「全体を読み込む」などで、確認なしに入力が消えた）
  await openEdit('c1');
  await p.fill('#qf-person', '山田'); await p.waitForTimeout(100);
  await p.evaluate(() => { window.cloudLoadPreset('c2'); }); await p.waitForTimeout(400);
  ok('② 別の案件を開こうとすると、未保存の確認が出る', await p.evaluate(() => document.getElementById('qpLeaveConfirm')?.classList.contains('open')));
  await p.click('#qpLeaveConfirm .qplc-cancel'); await p.waitForTimeout(500);
  ok('② キャンセルすると入力が残る', await p.evaluate(() => document.getElementById('qf-person').value === '山田' && document.getElementById('qf-customer').value === 'A社'));
  await p.evaluate(() => window.qpShowDashboard()); await p.waitForTimeout(300);
  await p.evaluate(() => { window.qpNewQuoteChoose(); }); await p.waitForTimeout(400);
  ok('② 新規見積の入口でも、先に未保存の確認が出る', await p.evaluate(() => document.getElementById('qpLeaveConfirm')?.classList.contains('open') && !document.getElementById('nqOverlay')));
  await p.click('#qpLeaveConfirm .qplc-discard'); await p.waitForTimeout(500);
  ok('② 「保存せずに進む」を選ぶと、選ぶ画面が開く・同じ確認は続けて出ない', await p.evaluate(() => !!document.getElementById('nqOverlay') && !window.quoteIsDirty()));
  await p.evaluate(() => { const o = document.getElementById('nqOverlay'); o && o.remove(); });

  // ③ 保存の通信中は入力を止める
  await openEdit('c1');
  await p.fill('#qf-person', '保存中'); await p.waitForTimeout(100);
  await p.evaluate(() => { window.__delay = 600; window.__sv = window.cloudSaveCurrent({ stay: true }); });
  await p.waitForTimeout(150);
  ok('③ 保存の通信中は入力欄を触れない（inert）', await p.evaluate(() => document.querySelector('#tab-quote-make .quote-main').inert === true));
  await p.evaluate(() => window.__sv); await p.waitForTimeout(900);
  await p.evaluate(() => { window.__delay = 0; });
  ok('③ 保存できた内容がサーバへ', await p.evaluate(() => window.__db.quote_presets.find(r => r.id === 'c1').data.fields['qf-person'] === '保存中'));

  // ④ 閲覧中は Ctrl+S で保存しない
  await p.evaluate(() => { window.cloudLoadPreset('c2'); }); await p.waitForTimeout(700);
  const before = await p.evaluate(() => window.__log.filter(x => x === 'quote_presets:update').length);
  await p.evaluate(() => { document.getElementById('tab-quote-make').focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })); });
  await p.waitForTimeout(600);
  ok('④ 閲覧中に Ctrl+S を押しても保存（上書き）しない', await p.evaluate(b => window.__log.filter(x => x === 'quote_presets:update').length === b, before));

  // ⑤ 「内容を引用」でも、ステータス・日付・基幹 REF# は今の案件の値のまま
  await openEdit('c1');
  await p.evaluate(() => { const set = (id, v) => { const e = document.getElementById(id); if (e) { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); } };
    set('qf-valid-until', '2026-12-31'); set('qf-core-ref', 'CORE-A'); });
  const st0 = await p.evaluate(() => document.getElementById('qf-status').value);
  await p.evaluate(() => window.cloudPreviewPreset('c2')); await p.waitForTimeout(600);
  await p.evaluate(() => window.cloudQuoteFromPreview()); await p.waitForTimeout(900);
  const kept = await p.evaluate(() => ({ st: document.getElementById('qf-status').value, vu: document.getElementById('qf-valid-until').value, cr: document.getElementById('qf-core-ref').value, d: window.quoteIsDirty() }));
  ok('⑤ 内容を引用しても、ステータス・有効期限・基幹 REF# は今の値のまま', kept.st === st0 && kept.vu === '2026-12-31' && kept.cr === 'CORE-A', kept);
  ok('⑤ 引用した内容は未保存として扱う', kept.d, kept);
  await p.evaluate(() => window.cloudSaveCurrent({ stay: true })); await p.waitForTimeout(800);

  // ⑥ コピーの連打で 2 件できない
  const n0 = await p.evaluate(() => window.__db.quote_presets.length);
  await p.evaluate(() => { window.cloudDuplicatePreset('c2'); window.cloudDuplicatePreset('c2'); });
  await p.waitForTimeout(1800);
  ok('⑥ 「コピー」を続けて 2 回押しても 1 件だけ', await p.evaluate(n => window.__db.quote_presets.length === n + 1, n0), await p.evaluate(() => window.__db.quote_presets.length));

  // ⑦ 国内手配・LCL に変えたら、FCL のコンテナは条件にも表示条件にも残らない
  await openEdit('c3');
  const r7 = await p.evaluate(async () => {
    const fcl = getConditions().container;
    addRow(); await new Promise(r => setTimeout(r, 200));
    const tr = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual])')].pop();
    const id = tr.id.slice(4);
    const nm = document.getElementById('nm-' + id); nm.value = 'CY CHARGE'; nm.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('cn-' + id).value = JSON.stringify({ k: 'cnt', o: 'ge', a: '1' });
    refreshRowConditions(); await new Promise(r => setTimeout(r, 150));
    const inFcl = rowCondEval(tr).status;
    setTransport('domestic'); await new Promise(r => setTimeout(r, 150));
    const dom = getConditions().container;
    setTransport('lcl'); await new Promise(r => setTimeout(r, 150)); refreshRowConditions(); await new Promise(r => setTimeout(r, 150));
    return { fcl, dom, inFcl, inLcl: rowCondEval(tr).status, out: tr.dataset.outRange || '' };
  });
  ok('（前提）FCL ではコンテナが条件に出て、本数の表示条件に合う', /20'GP/.test(r7.fcl) && r7.inFcl === 'ok', r7);
  ok('⑦ 「国内手配のみ」に変えると、コンテナを御見積書の条件に出さない', r7.dom === '', r7);
  ok('⑦ LCL に変えると、コンテナ本数の表示条件に合わず外れる', r7.inLcl === 'out' && r7.out === '1', r7);

  // ⑧ 数量の欄が空の行は「判定できません」（合計から黙って外さない）
  const r8 = await p.evaluate(async () => {
    addRow(); await new Promise(r => setTimeout(r, 200));
    const tr = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual])')].pop(); const id = tr.id.slice(4);
    document.getElementById('nm-' + id).value = 'X';
    document.getElementById('pq-' + id).value = '';
    document.getElementById('cn-' + id).value = JSON.stringify({ k: 'qty', o: 'ge', a: '1' });
    refreshRowConditions(); await new Promise(r => setTimeout(r, 150));
    return rowCondEval(tr).status;
  });
  ok('⑧ 数量が空の行の表示条件は「判定できません」', r8 === 'unknown', r8);

  ok('ページエラーなし', p.__errs.length === 0, p.__errs);
  await H.close();
  console.log(fails ? fails + ' 件 FAIL' : '全項目 PASS');
  process.exit(fails ? 1 : 0);
})();
