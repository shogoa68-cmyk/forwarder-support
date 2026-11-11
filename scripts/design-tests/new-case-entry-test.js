// ダッシュボードの「新しい見積を始める」入口の試験（Design 回答 2026-11：A＋C）。偽の Supabase（案件の一覧だけ返す）。
//   node scripts/design-tests/new-case-entry-test.js   （OUT=<dir> で 0 件の案内の画像、THEME=1 で Industry）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');

(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const out = [];
  const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  const mkCase = (i) => ({ id: '00000000-0000-4000-8000-00000000000' + i, name: '案件' + i, status: 'draft', customer: 'C' + i, person: 'P', owner_email: 's@example.com', created_by: 's@example.com', updated_at: new Date().toISOString(), data: { fields: { 'qf-memo': '案件名' + i }, rows: [], _rowFormat: 'v3-mixed-rows' } });

  async function open(mode, nCases) {
    const cases = Array.from({ length: nCases }, (_, i) => mkCase(i + 1));
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
    await ctx.addInitScript(({ mode, cases }) => {
      try { localStorage.setItem('fwd.uiMode', mode); } catch (e) {}
      const tbl = t => (t === 'quote_presets' ? cases : []);
      const mk = t => { const st = { one: false }; const bb = new Proxy({}, { get(_, k) {
        if (k === 'then') return (res, rej) => Promise.resolve({ data: st.one ? (tbl(t)[0] || null) : tbl(t), error: null }).then(res, rej);
        if (k === 'single' || k === 'maybeSingle') return () => { st.one = true; return bb; };
        return () => bb; } }); return bb; };
      const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, presenceState() { return {}; }, unsubscribe() { return Promise.resolve(); }, send() { return Promise.resolve(); } };
      const user = { email: 's@example.com', user_metadata: { full_name: 'S' } };
      const client = { from: mk, rpc: () => Promise.resolve({ data: null, error: null }), channel: () => ch, removeChannel() {}, storage: { from: () => ({}) },
        auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signOut: () => Promise.resolve({}), signInWithOAuth: () => Promise.resolve({}) } };
      window.supabase = { createClient: () => client };
    }, { mode, cases });
    if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
    p.setDefaultTimeout(8000);
    await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
    await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1800);
    return { ctx, p, errs };
  }
  const vis = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, sel);

  // 1) かんたん表示・案件あり：先頭に点線カード
  {
    const { ctx, p, errs } = await open('simple', 2);
    const L = '[かんたん・案件あり] ';
    const first = await p.evaluate(() => { const w = document.getElementById('qpdListWrap'); const c = w && w.firstElementChild; return c ? c.className : null; });
    ok(L + '一覧の先頭が点線の「＋ 新しい見積を作る」カード', first === 'qpd-newcard', first);
    ok(L + '主役ボタンは「＋ 新しい見積を作る」・高さ 48px 以上', await p.evaluate(() => { const b = document.querySelector('#qpDashboard .qpd-new'); const t = b.querySelector('.lbl-s'); return getComputedStyle(t).display !== 'none' && t.textContent.includes('新しい見積を作る') && b.getBoundingClientRect().height >= 47; }));
    ok(L + '「詳細表示」用の文言は隠れている', await p.evaluate(() => getComputedStyle(document.querySelector('#qpDashboard .qpd-new .lbl-d')).display === 'none'));
    ok(L + '0 件の案内は出ない', !(await vis(p, '.qpd-welcome')));
    await p.click('#qpdListWrap .qpd-newcard'); await p.waitForTimeout(900);
    ok(L + '点線カードを押すと見積入力が開く（新規）', await p.evaluate(() => !!document.querySelector('#tab-quote-make.active') && document.body.classList.contains('qp-dash-active') === false), null);
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }
  // 2) かんたん表示・リスト表示：点線カードは出さない（行の一覧）
  {
    const { ctx, p, errs } = await open('simple', 2);
    await p.evaluate(() => { const b = [...document.querySelectorAll('#qpDashboard button')].find(x => /リスト/.test(x.textContent)); b && b.click(); }); await p.waitForTimeout(500);
    ok('[かんたん・リスト] 点線カードは出さない', !(await vis(p, '#qpdListWrap .qpd-newcard')));
    ok('[かんたん・リスト] JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }
  // 3) かんたん表示・0 件：大きな案内
  {
    const { ctx, p, errs } = await open('simple', 0);
    const L = '[かんたん・0件] ';
    ok(L + '大きな案内（最初の見積を作ってみましょう）', await vis(p, '#qpdListWrap .qpd-welcome') && (await p.textContent('#qpdListWrap .qpd-welcome h3')).includes('最初の見積を作ってみましょう'));
    ok(L + '手順 ①条件 ②貨物 ③費用 ④出力', (await p.$$eval('#qpdListWrap .qpd-welcome-step', els => els.map(e => e.textContent.replace(/\s/g, '')))).join() === '1条件,2貨物,3費用,4出力');
    ok(L + '案内のボタンは高さ 52px 以上', await p.evaluate(() => document.querySelector('#qpdListWrap .qpd-welcome-btn').getBoundingClientRect().height >= 51));
    if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, 'welcome.png') });
    await p.click('#qpdListWrap .qpd-welcome-btn'); await p.waitForTimeout(900);
    ok(L + '案内のボタンを押すと見積入力が開く', await p.evaluate(() => !!document.querySelector('#tab-quote-make.active')));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }
  // 4) 詳細表示：点線カード・案内は出さず、文言は従来どおり
  {
    const { ctx, p, errs } = await open('detail', 2);
    const L = '[詳細・案件あり] ';
    ok(L + '点線カードは出さない（従来どおり）', !(await vis(p, '#qpdListWrap .qpd-newcard')));
    ok(L + '主役ボタンの文言は従来の「🆕 新規見積を作成」', await p.evaluate(() => { const b = document.querySelector('#qpDashboard .qpd-new'); return getComputedStyle(b.querySelector('.lbl-d')).display !== 'none' && b.querySelector('.lbl-d').textContent.includes('新規見積を作成'); }));
    ok(L + '主役ボタンは高さ 48px 以上', await p.evaluate(() => document.querySelector('#qpDashboard .qpd-new').getBoundingClientRect().height >= 47));
    ok(L + 'JS エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  console.log(out.join('\n'));
  console.log(out.some(l => l.startsWith('FAIL')) ? 'NG' : 'OK');
  await b.close(); srv.close();
  process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
