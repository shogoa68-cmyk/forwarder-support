// 2026-11 QA 第 4 弾の再発防止（架空データ・外部接続なし）。
//   ①為替を手入力した通貨は、為替の注記に「open.er-api.com から取得」と書かず「手入力の値」と書く
//     （自動取得すると記録は消える・保存して開き直しても残る）
//   ②「javascript:」「data:」で始まるリンクは、押しても開かない（ページ全体で止める）・ブックマークに保存できない
//   node scripts/design-tests/qa-fx-links-test.js        （THEME=1 で Industry）
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
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('dialog', d => d.accept());
  p.setDefaultTimeout(10000);
  let fails = 0;
  const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };

  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1200);
  const id = await p.evaluate(() => document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').id.replace('row-', ''));
  await p.evaluate(id => { const s = (k, v) => { const el = document.getElementById(k + '-' + id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    s('nm', 'Ocean Freight'); s('un', '20GP'); s('pq', '1'); s('pc', 'USD'); s('bc', 'USD'); s('pp', '1000'); s('mk', '100'); }, id);
  await p.waitForTimeout(300);
  const line = () => p.evaluate(() => getFxAuditMeta().fxLine);

  // ① 為替の手入力
  await p.evaluate(() => { localStorage.setItem(SharedStorage.KEYS.FX_LAST_FETCHED, '2026-10-28T06:13:00Z'); localStorage.removeItem('fxManual_v1'); });
  let t = await line();
  ok('（前提）取得した値だけなら「open.er-api.com 中値（… 取得）」', /^為替：open\.er-api\.com 中値（/.test(t), t);
  await p.evaluate(() => updateFxRate('USD', String((_fxRates.USD || 150) + 3)));
  t = await line();
  ok('① 使っている外貨（USD）を手入力したら「USD は手入力の値（… 入力）」と書く', /^為替：USD は手入力の値（\d{4}\/\d{2}\/\d{2} \d{2}:\d{2} 入力）／参考値/.test(t), t);
  ok('① 手入力しかない見積では「open.er-api.com … 取得」と書かない', !/open\.er-api/.test(t), t);
  await p.evaluate(() => updateFxRate('EUR', String((_fxRates.EUR || 160) + 1)));
  t = await line();
  ok('① 見積で使っていない通貨（EUR）の手入力は注記に出さない', !/EUR/.test(t), t);
  // 外貨の行を足して EUR も使うと、手入力の USD と取得の値（EUR 以外）を書き分ける
  await p.evaluate(() => { const m = JSON.parse(localStorage.getItem('fxManual_v1')); delete m.EUR; localStorage.setItem('fxManual_v1', JSON.stringify(m)); });
  await p.evaluate(async () => { addRow(); await new Promise(r => setTimeout(r, 200));
    const tr = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type])')].pop(); const id = tr.id.slice(4);
    const s = (k, v) => { const el = document.getElementById(k + '-' + id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    s('nm', 'THC'); s('pq', '1'); s('pc', 'EUR'); s('bc', 'EUR'); s('pp', '100'); });
  await p.waitForTimeout(200);
  t = await line();
  ok('① 手入力と取得が混ざるときは「USD は手入力の値（…）、その他は open.er-api.com 中値（… 取得）」', /^為替：USD は手入力の値（[^）]+）、その他は open\.er-api\.com 中値（/.test(t), t);
  ok('① 御見積書の注記も同じ文面', await p.evaluate(() => { const d = document.createElement('div'); d.innerHTML = buildQuoteDocHTML(); return (d.querySelector('.qd-fxnote') || {}).textContent || ''; }).then(x => /USD は手入力の値/.test(x)), null);
  // 保存データ（fxSnapshot）に入る → 開き直しても残る
  const snap = await p.evaluate(() => gatherAllData().fxSnapshot);
  ok('① 保存データ（fxSnapshot）に手入力の通貨が入る', snap && snap.manual && snap.manual.USD, snap);
  await p.evaluate(s => { localStorage.removeItem('fxManual_v1'); const d = gatherAllData(); d.fxSnapshot = s; _applyQuoteData(d); }, snap);
  await p.waitForTimeout(400);
  ok('① 開き直しても「USD は手入力の値」が残る', /USD は手入力の値/.test(await line()), await line());
  await p.evaluate(s => { const d = gatherAllData(); delete d.fxSnapshot.manual; _applyQuoteData(d); }, snap);
  await p.waitForTimeout(400);
  ok('① 手入力の記録が無い古い保存データは、取得した値として扱う', !/手入力/.test(await line()), await line());
  // 自動取得すると記録は消える
  await p.evaluate(async () => { markFxManual('USD'); window.SharedFX.fetchRates = async () => ({ USD: 1 / 150, EUR: 1 / 160 }); await fetchAutoFxRates(); });
  ok('① 自動取得に成功すると手入力の記録は消える', await p.evaluate(() => !localStorage.getItem('fxManual_v1')) && !/手入力/.test(await line()), await line());

  // ② 危ないリンク
  const r2 = await p.evaluate(async () => {
    window.__pwned = 0;
    const mk = h => { const a = document.createElement('a'); a.href = h; a.textContent = 'x'; document.body.appendChild(a); return a; };
    const bad = [mk('javascript:window.__pwned++'), mk(' JavaScript:window.__pwned++'), mk('java\tscript:window.__pwned++')];
    bad.forEach(a => a.click());
    const good = mk('#qa-ok'); let followed = false; good.addEventListener('click', e => { followed = !e.defaultPrevented; e.preventDefault(); }); good.click();
    await new Promise(r => setTimeout(r, 300));
    return { pwned: window.__pwned, followed, unsafe: [isUnsafeUrl('javascript:alert(1)'), isUnsafeUrl('data:text/html,x'), isUnsafeUrl('https://example.com'), isUnsafeUrl('mailto:a@b.c')] };
  });
  ok('② javascript: のリンクは押してもスクリプトが動かない（大文字・空白・タブを挟んでも）', r2.pwned === 0, r2);
  ok('② ふつうのリンクは今までどおり開く（止めない）', r2.followed === true, r2);
  ok('② 判定：javascript:／data: は危ない、https:／mailto: は安全', JSON.stringify(r2.unsafe) === '[true,true,false,false]', r2);
  const r3 = await p.evaluate(async () => {
    const box = document.createElement('div'); box.innerHTML = '<input id="bmFormId"><input id="bmFormLabel" value="悪いリンク"><input id="bmFormUrl" value="javascript:alert(1)"><select id="bmFormType"><option>general</option></select><input id="bmFormCarrier"><select id="bmFormFunction"><option>未分類</option></select><textarea id="bmFormNote"></textarea>';
    ['bmFormId','bmFormLabel','bmFormUrl','bmFormType','bmFormCarrier','bmFormFunction','bmFormNote'].forEach(i => { const o = document.getElementById(i); if (o && !box.contains(o)) o.id = i + '_orig'; });
    document.body.appendChild(box);
    let wrote = false; const prev = window.SupabaseClient;
    window.SupabaseClient = { from() { const api = { select() { return api; }, eq() { return api; }, is() { return api; }, limit: async () => ({ data: [] }), insert() { wrote = true; return api; }, update() { wrote = true; return api; }, then(r) { r({ data: null, error: null }); } }; return api; }, storage: { from: () => ({}) } };
    let toast = ''; const pt = window.quoteShowToast; window.quoteShowToast = m => { toast = m; };
    await saveBm();
    window.quoteShowToast = pt; window.SupabaseClient = prev; box.remove();
    return { wrote, toast };
  });
  ok('② javascript: の URL はブックマークに保存しない（案内を出す）', !r3.wrote && /安全でない/.test(r3.toast), r3);

  ok('ページエラーなし', errs.length === 0, errs);
  await b.close(); srv.close();
  console.log(fails ? fails + ' 件 FAIL' : '全項目 PASS');
  process.exit(fails ? 1 : 0);
})();
