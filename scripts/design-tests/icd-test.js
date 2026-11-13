// 幹線輸送：POD の国がインドのとき ICD（インランドデポ）を入力でき、御見積書（PDF）の条件欄・画面プレビューに出る試験。
//   node scripts/design-tests/icd-test.js   （THEME=1 Industry）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(x))); };
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {} });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1200);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(800);
  const vis = () => p.evaluate(() => { const r = document.getElementById('z2IcdRow'); return !!r && !r.hidden && getComputedStyle(r).display !== 'none'; });
  const setV = (id, v, evs = ['input', 'change']) => p.evaluate(([id, v, evs]) => { const el = document.getElementById(id); el.value = v; evs.forEach(e => el.dispatchEvent(new Event(e, { bubbles: true }))); }, [id, v, evs]);
  await p.evaluate(() => window.rfOpenCarrier && window.rfOpenCarrier());

  ok('最初は ICD の欄が出ない', !(await vis()));
  await setV('z2PodCountry', 'ベトナム'); await p.waitForTimeout(200);
  ok('POD の国が対象外（ベトナム）なら出ない', !(await vis()));
  await setV('z2PodCountry', 'インド'); await p.waitForTimeout(200);
  ok('POD の国がインドになると ICD の欄が出る', await vis());
  ok('欄の案内に「ICDはまだ登録がありません」', await p.evaluate(() => /まだ登録がありません/.test(document.getElementById('z2IcdNote').textContent)));
  // マスターの ICD（インド）と別国のものを用意
  await p.evaluate(() => {
    const M = [{ field: 'icd', value: 'ICD Tughlakabad' }, { field: 'icd', value: 'ICD Dadri' }, { field: 'icd', value: 'ICD Dhaka' }];
    const D = { 'ICD Tughlakabad': { country: 'IN', furigana: 'とぅぐらかばど' }, 'ICD Dadri': { country: 'IN' }, 'ICD Dhaka': { country: 'BD' } };
    window.statsGetMasters = () => M; window.mdGet = (f, v) => f === 'icd' && D[v] ? { details: D[v] } : null;
    window.icdRefresh();
  });
  ok('候補は、インドのICDだけ（別の国は出ない）', await p.evaluate(() => [...document.getElementById('z2IcdList').options].map(o => o.value).join() === 'ICD Dadri,ICD Tughlakabad'));
  ok('案内に「インドの登録済みICD 2 件」', await p.evaluate(() => /インドの登録済みICD 2 件/.test(document.getElementById('z2IcdNote').textContent)));
  ok('入力欄は候補（z2IcdList）を引く', await p.evaluate(() => document.getElementById('z2Icd').getAttribute('list') === 'z2IcdList'));

  // 入力 → 出力
  await setV('z2Pol', 'NAGOYA'); await setV('z2Pod', 'NHAVA SHEVA'); await setV('z2Icd', 'ICD Tughlakabad');
  const cond = () => p.evaluate(() => window.getConditions().icd);
  ok('条件（getConditions）に ICD が入る', (await cond()) === 'ICD Tughlakabad', await cond());
  // 航路の登録（チップ）にも残る
  await setV('z2Carrier', 'ONE'); await p.evaluate(() => window.addRouteEntry && window.addRouteEntry()); await p.waitForTimeout(300);
  ok('航路を登録すると、航路のチップに ICD が出る', await p.evaluate(() => /🚉 ICD Tughlakabad/.test(document.getElementById('z2RouteList').textContent)));
  ok('航路登録のあとも ICD の入力欄は残る（POL/POD と同じ）', await p.evaluate(() => document.getElementById('z2Icd').value === 'ICD Tughlakabad'));
  ok('航路の保存データ（z2-routes-data）に icd が入る', await p.evaluate(() => JSON.parse(document.getElementById('z2-routes-data').value)[0].icd === 'ICD Tughlakabad'));
  ok('航路登録後も条件の ICD は同じ', (await cond()) === 'ICD Tughlakabad');
  // 編集で書き戻し
  await setV('z2Icd', ''); await p.evaluate(() => window.editRouteEntry(0)); await p.waitForTimeout(200);
  ok('航路を編集（✎）すると ICD も入力欄に戻る', await p.evaluate(() => document.getElementById('z2Icd').value === 'ICD Tughlakabad'));
  await p.evaluate(() => window.addRouteEntry()); await p.waitForTimeout(200);

  // プレビュー（画面）：条件欄は #previewTableWrap の外（引き合い条件の箱）に出る
  await p.evaluate(() => { const id = document.querySelector('#tableBody tr[id^="row-"]').id.replace('row-', ''); const set = (f, v) => { const el = document.querySelector(`#tableBody tr#row-${id} [data-field="${f}"]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }; set('nm', '海上運賃'); set('sv', 'A海運'); set('un', "40'GP"); set('pq', '1'); set('pp', '1000'); });
  await p.evaluate(() => { openPreview(); if (typeof pvWarnGuideSkip === 'function' && !document.querySelector('#previewOverlay.open')) pvWarnGuideSkip(); }); await p.waitForTimeout(900);
  ok('画面プレビューの条件欄に「ICD（インランドデポ）」が出る', await p.evaluate(() => /ICD（インランドデポ）：ICD Tughlakabad/.test((document.getElementById('pvCondBox') || {}).innerText || '')), await p.evaluate(() => ((document.getElementById('pvCondBox') || {}).innerText || '').slice(0, 300)));
  await p.evaluate(() => { try { window.closePreview && window.closePreview(); } catch (e) {} }); await p.waitForTimeout(200);
  // 御見積書 PDF（HTML 生成）の条件欄
  const doc = en => p.evaluate(en => { localStorage.setItem('quoteDocLangEn_v1', en ? '1' : '0'); localStorage.setItem('quoteDocIncoDiagram_v1', '0'); const d = document.createElement('div'); d.innerHTML = buildQuoteDocHTML(); return [...d.querySelectorAll('.qd-srow')].map(r => ({ k: ((r.querySelector('.qd-sk') || {}).textContent || ''), v: ((r.querySelector('.qd-sv') || {}).textContent || '').trim() })); }, en);
  let rows = await doc(false); let i = rows.findIndex(r => /ICD/.test(r.k));
  ok('御見積書（日本語）：条件欄に「ICD（インランドデポ）」の行が出る', i >= 0 && rows[i].v === 'ICD Tughlakabad', rows.slice(0, 8));
  ok('ICD の行は、航路・POD の行より後ろにある', i > rows.findIndex(r => /航路|POD|積み地/.test(r.k)), rows.map(r => r.k));
  rows = await doc(true); i = rows.findIndex(r => /ICD/.test(r.k));
  ok('御見積書（英語）：「ICD (Inland Container Depot)」で出る', i >= 0 && rows[i].k === 'ICD (Inland Container Depot)' && rows[i].v === 'ICD Tughlakabad', rows.slice(0, 8));
  await p.evaluate(() => localStorage.setItem('quoteDocLangEn_v1', '0'));
  // 保存・復元
  const rt = await p.evaluate(() => { const d = gatherAllData(); const saved = JSON.parse(d.fields['z2-routes-data'] || '[]')[0]; const z = d.fields['z2Icd']; document.getElementById('z2Icd').value = ''; _applyQuoteData(JSON.parse(JSON.stringify(d))); return { saved: saved && saved.icd, field: z, after: document.getElementById('z2Icd').value, show: !document.getElementById('z2IcdRow').hidden }; });
  ok('案件データに保存され、読み込むと復元される（欄も出る）', rt.saved === 'ICD Tughlakabad' && rt.after === 'ICD Tughlakabad' && rt.show, rt);
  await p.evaluate(() => document.getElementById('z2IcdRow').scrollIntoView({ block: 'center' })); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(process.env.OUT || '/tmp', 'icd-row.png') }).catch(() => {});
  // 国を変えても、値が入っていれば欄は隠さない
  await setV('z2PodCountry', 'ベトナム'); await p.waitForTimeout(200);
  ok('国を変えても、ICD が入っていれば欄は隠さない（入力済みを気づかず消さない）', await vis());
  await setV('z2Icd', ''); await p.waitForTimeout(200);
  ok('ICD を空にして国が対象外なら隠れる', !(await vis()));
  // 未登録の ICD の登録確認
  await setV('z2PodCountry', 'インド'); await p.waitForTimeout(200);
  await setV('z2Icd', 'ICD Nowhere', ['input', 'change']); await p.waitForTimeout(400);
  ok('マスターに無い ICD を確定すると、インドのICDとして登録する確認が出る', await p.evaluate(() => /ICD（インランドデポ）のマスターに未登録/.test(document.body.innerText) && /インドのICD（インランドデポ）として/.test(document.body.innerText)));
  ok('ページエラーなし', errs.length === 0, errs);
  console.log(fails ? `\n${fails} 件 FAIL` : '\n全項目 PASS');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
