// 入力完了の記録（押した日時・ユーザー名）と、行ごとの「更新日」の廃止の試験。
//   node scripts/design-tests/done-record-test.js   （THEME=1 Industry／MODE=simple かんたん／W=390 スマホ幅）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
const OUT = process.env.OUT || require('os').tmpdir() + '/design-tests-out'; fs.mkdirSync(OUT, { recursive: true });
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(x))); };
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const W = +process.env.W || 1500, H = 900, narrow = W < 700;
  const ctx = await b.newContext({ viewport: { width: W, height: H }, locale: 'ja-JP', hasTouch: false });
  await ctx.addInitScript((mode) => { try { localStorage.setItem('fwd.uiMode', mode); localStorage.removeItem('quoteRemarkSheetH_v1'); } catch (e) {} }, process.env.MODE || 'detail');
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1200);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(800);
  const login = who => p.evaluate(who => { window.cloudCurrentUser = () => who ? { email: who } : null; window.cloudNameFor = e => (e && e.startsWith('taro')) ? '山田太郎' : (e && e.startsWith('hana') ? '鈴木花子' : (e ? e.split('@')[0] : '—')); }, who);
  await login('taro.yamada@example.com');
  // 2 行（円・外貨）を作る
  await p.evaluate(() => {
    const set = (id, f, v) => { const el = document.querySelector(`#tableBody tr#row-${id} [data-field="${f}"]`); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
    const first = document.querySelector('#tableBody tr[id^="row-"]').id.replace('row-', '');
    set(first, 'nm', 'THC 20'); set(first, 'sv', 'INTERASIA'); set(first, 'un', "20'GP"); set(first, 'pq', '1'); set(first, 'pp', '34900');
    addRow();
    const rows = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type])')];
    const id2 = rows[rows.length - 1].id.replace('row-', '');
    set(id2, 'nm', 'OCEAN FREIGHT'); set(id2, 'sv', 'INTERASIA'); set(id2, 'un', "40'HC"); set(id2, 'pq', '1'); set(id2, 'pp', '1200'); set(id2, 'pc', 'USD'); set(id2, 'bc', 'USD');
  }); await p.waitForTimeout(500);
  const R = i => p.evaluate(i => { const trs = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type])')]; const tr = trs[i]; const d = tr.querySelector('.st-doneinfo'); const b = tr.querySelector('.row-done-btn');
    return { done: tr.dataset.done || '', at: tr.dataset.doneAt || '', by: tr.dataset.doneBy || '', h: Math.round(tr.getBoundingClientRect().height), info: d && !d.hidden ? d.textContent.replace(/\s+/g, ' ').trim() : '', when: d ? (d.querySelector('.di-when')?.textContent || '') : '', name: d ? (d.querySelector('.di-name')?.textContent || '') : '', title: b.title, on: b.classList.contains('is-on'), chip: !!tr.querySelector('.st-state .state-chip.is-done') }; }, i);

  // ---- 更新日の廃止 ----
  ok('行ごとの「更新日」の入力欄（.w-updated／data-field="lu"）は無い', await p.evaluate(() => !document.querySelector('#tableBody .w-updated, #tableBody [data-field="lu"], #tableBody input[id^="lu-"]')));
  ok('サブコン見出しの「🕒 更新・今日」（.grp-updated）も無い', await p.evaluate(() => !document.querySelector('#tableBody .grp-updated, #tableBody .grp-updated-input, #tableBody .grp-updated-today')));
  ok('「最終更新日」の文言が画面に残っていない（行・見出し）', await p.evaluate(() => !/最終更新日|🕒 更新/.test(document.getElementById('tableBody').textContent)));
  const before = await R(1); const h0Before = (await R(0)).h, h1Before = before.h;
  // ---- 入力完了の記録 ----
  ok('押す前は、入力完了の記録（日時・ユーザー）は出ない', !before.done && !before.info && !before.on);
  const t0 = Date.now();
  await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type]) .row-done-btn')[0].click()); await p.waitForTimeout(400);
  let r0 = await R(0);
  ok('押すと入力完了になり、日時とユーザー（メール）が行に記録される', r0.done === '1' && r0.by === 'taro.yamada@example.com' && Math.abs(new Date(r0.at).getTime() - t0) < 15000, r0);
  ok('小計セルに「日時」と「ユーザー名」が出る（例：11/13 14:05／山田太郎）', /^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/.test(r0.when) && r0.name === '山田太郎' && /\d{2}:\d{2} 山田太郎$/.test(r0.info), r0);
  ok('完了ボタンの吹き出しにも日時・ユーザーが入る', /入力完了（\d{1,2}\/\d{1,2} \d{2}:\d{2} 山田太郎）（クリックで解除）/.test(r0.title) && r0.on, r0.title);
  if (process.env.THEME) ok('Industry：状態チップ「入力完了」も出る', r0.chip, r0);
  const r1b = await R(1);
  ok('押していない行には記録が出ない', !r1b.done && !r1b.info, r1b);
  // 行の高さが伸びない（Industry は 3 段固定）
  await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type]) .row-done-btn')[1].click()); await p.waitForTimeout(400);
  const r1 = await R(1);
  ok('外貨の行（2 段目に円換算が出る行）も、完了で日時・ユーザーが出る', r1.done === '1' && r1.name === '山田太郎', r1);
  if (process.env.THEME) ok('Industry：完了しても行の高さは、完了前と同じ（3 段固定の行が伸びない）', r0.h === h0Before && r1.h === h1Before, { r0h: r0.h, h0Before, r1h: r1.h, h1Before });
  if (+process.env.W && +process.env.W < 700) {
    await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type]) .row-done-btn')[0].click()); await p.waitForTimeout(500);
    await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type]) .row-done-btn')[0].click()); await p.waitForTimeout(700);
    const mc = await p.evaluate(() => [...document.querySelectorAll('#mcList .mc-tag.t-done')].map(e => e.textContent.replace(/\s+/g, ' ').trim()));
    ok('スマホ幅：一覧の「✓ 入力完了」の札に、日時とユーザー名が付く', mc.length >= 1 && mc.every(t => /^✓ 入力完了 \d{1,2}\/\d{1,2} \d{2}:\d{2} 山田太郎$/.test(t)), mc);
    await p.evaluate(() => document.querySelector('#mcList .mc-row')?.click()); await p.waitForTimeout(500);
    const sh = await p.evaluate(() => { const e = document.getElementById('mcsDoneInfo'); return e && !e.hidden ? e.textContent : ''; });
    ok('スマホ幅：編集シートの状態ボタンの下に「✓ 入力完了：日時 ユーザー名」が出る', /^✓ 入力完了：\d{1,2}\/\d{1,2} \d{2}:\d{2} 山田太郎$/.test(sh), sh);
    await p.screenshot({ path: OUT + '/done-record-mobile.png' });
  }
  await p.screenshot({ path: OUT + '/done-record.png' });
  // ---- 解除・排他・一括解除 ----
  await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type]) .row-done-btn')[0].click()); await p.waitForTimeout(300);
  r0 = await R(0);
  ok('もう一度押して解除すると、完了と一緒に日時・ユーザーの記録も消える', !r0.done && !r0.at && !r0.by && !r0.info && !r0.on, r0);
  await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type]) .row-done-btn')[0].click()); await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type]) .row-pending-btn')[0].click()); await p.waitForTimeout(300);
  r0 = await R(0);
  ok('「要調査」にすると完了は外れ、記録も消える（排他）', !r0.done && !r0.at && !r0.by && !r0.info, r0);
  await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type]) .row-pending-btn')[0].click());
  // 別のユーザーが押す／未ログインで押す
  await login('hana.suzuki@example.com');
  await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type]) .row-done-btn')[0].click()); await p.waitForTimeout(300);
  r0 = await R(0);
  ok('押したユーザーが記録される（別のメンバーなら、そのメンバーの名前）', r0.by === 'hana.suzuki@example.com' && r0.name === '鈴木花子', r0);
  await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type]) .row-done-btn')[0].click());
  await login(null);
  await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type]) .row-done-btn')[0].click()); await p.waitForTimeout(300);
  r0 = await R(0);
  ok('ログインしていないときは、日時だけ記録する（ユーザー名は出ない）', r0.done === '1' && !r0.by && !!r0.when && !r0.name, r0);
  await login('taro.yamada@example.com');
  // ---- 保存・復元 ----
  await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type]) .row-done-btn')[0].click());   // 一度解除
  await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type]) .row-done-btn')[0].click()); await p.waitForTimeout(300);   // 山田で完了
  const saved = await p.evaluate(() => { const d = gatherAllData(); const rows = d.rows.filter(r => r._type === 'data'); return { n: rows.length, r0: { done: rows[0].done, doneAt: rows[0].doneAt, doneBy: rows[0].doneBy }, r1: { done: rows[1].done, doneAt: rows[1].doneAt, doneBy: rows[1].doneBy }, lu: rows[0].cells[ROW_CELL_FIELDS_IDX()] }; function ROW_CELL_FIELDS_IDX() { return 22; } });
  ok('保存する行データに、done・doneAt・doneBy が入る', saved.r0.done === true && /^\d{4}-\d{2}-\d{2}T/.test(saved.r0.doneAt) && saved.r0.doneBy === 'taro.yamada@example.com' && saved.r1.done === true, saved);
  const restored = await p.evaluate(async () => { const d = JSON.parse(JSON.stringify(gatherAllData())); window.cloudCurrentUser = () => ({ email: 'hana.suzuki@example.com' }); _applyQuoteData(d); await new Promise(r => setTimeout(r, 600));
    const tr = document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type])')[0]; const di = tr.querySelector('.st-doneinfo');
    return { by: tr.dataset.doneBy, at: tr.dataset.doneAt, name: di ? di.querySelector('.di-name')?.textContent : '', title: tr.querySelector('.row-done-btn').title, on: tr.classList.contains('row-input-done') }; });
  ok('保存したデータを読み込むと、日時・ユーザーも復元される（読み込んだ人ではなく、押した人の名前）', restored.on && restored.by === 'taro.yamada@example.com' && restored.name === '山田太郎' && /山田太郎/.test(restored.title), restored);
  await login('taro.yamada@example.com');
  // 旧データ：done だけで記録が無い行は「入力完了」のまま（日時・名前は出ない）
  const legacy = await p.evaluate(async () => { const d = JSON.parse(JSON.stringify(gatherAllData())); d.rows.filter(r => r._type === 'data').forEach(r => { r.done = true; delete r.doneAt; delete r.doneBy; }); _applyQuoteData(d); await new Promise(r => setTimeout(r, 600));
    const tr = document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type])')[0]; const di = tr.querySelector('.st-doneinfo'); return { on: tr.classList.contains('row-input-done'), shown: !!(di && !di.hidden), title: tr.querySelector('.row-done-btn').title }; });
  ok('記録の無い旧データの完了行は、「入力完了」だけ（日時・ユーザーは出さず、エラーにもならない）', legacy.on && !legacy.shown && /^入力完了（クリックで解除）$/.test(legacy.title), legacy);
  // 旧データの「更新日」（lu）：読み込んでも他の項目がずれない・エラーにならない
  const luCompat = await p.evaluate(async () => { const d = JSON.parse(JSON.stringify(gatherAllData())); const rows = d.rows.filter(r => r._type === 'data'); const idx = 1 + ['cat','sv','tx','nm','pq','un','bq','pc','bc','pp','bp','cd','mk','nt','zc','vf','vt','ac','pt','ps','co','lu'].indexOf('lu');
    const before = rows.map(r => r.cells.slice()); rows.forEach(r => { r.cells[idx] = '2026-10-01'; }); _applyQuoteData(d); await new Promise(r => setTimeout(r, 600));
    const nm = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type]) [data-field="nm"]')].map(e => e.value); const pp = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual]):not([data-type]) [data-field="pp"]')].map(e => e.value);
    const back = gatherAllData().rows.filter(r => r._type === 'data').map(r => r.cells[idx]);
    return { nm, pp, back, noLuField: !document.querySelector('[data-field="lu"]') }; });
  ok('旧データの「更新日」（lu）が入っていても、読み込める・他の項目はずれない・画面には出ない', luCompat.nm.join() === 'THC 20,OCEAN FREIGHT' && luCompat.pp.join() === '34900,1200' && luCompat.noLuField, luCompat);
  ok('保存し直すと、更新日（lu）は空で保存される（以後は書かない）', luCompat.back.every(v => v === '' || v === undefined), luCompat.back);
  ok('JS エラーなし', errs.length === 0, errs);
  await b.close(); srv.close(); console.log(fails ? `\nFAIL=${fails}` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
