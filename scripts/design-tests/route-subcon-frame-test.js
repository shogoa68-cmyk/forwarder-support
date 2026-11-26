// 費用入力：② ルートで入力したサブコンから枠をつくる（明細が無いときの案内・「＋ サブコンを追加」の吹き出し）と
// 「ルートのサブコンで枠をつくる」（旧「この構成でプリセット適用」）の確認
//   node scripts/design-tests/route-subcon-frame-test.js   （THEME=classic で現行・EDITOR=v2 で新画面・W=390 でスマホ幅）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.end(fs.readFileSync(f)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const v2 = process.env.EDITOR === 'v2', th = process.env.THEME, W = +process.env.W || 1400;
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=${v2 ? 'v2' : 'v1'}${th ? '&theme=' + th : ''}`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, locale: 'ja-JP' });
  await ctx.addInitScript(() => { try { localStorage.setItem('fwd.uiMode', 'detail'); localStorage.setItem('fwd.sfEmpty', '1'); localStorage.setItem('fbFabHintDone_v1', '1'); localStorage.setItem('quoteRemarkSheetSeen_v1', '1'); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); p.setDefaultTimeout(8000); const errs = []; p.on('pageerror', e => errs.push(e.message));
  let dialogs = 0; p.on('dialog', d => { dialogs++; d.accept(); });
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
  const fresh = async () => {
    await p.evaluate(() => { try { window.qpNewQuote(); } catch (e) {} }); await p.waitForTimeout(900);
    // ② ルート：出発地側 A陸運・幹線 ONE・到着地側 B代理店（＋ 表記ゆれの「ａ陸運」は 1 社として数える）
    await p.evaluate(() => {
      const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); };
      toggleZone(1); set('z1DefaultSc', 'A陸運');
      addDefaultScEntry(1); const e2 = document.querySelectorAll('#z1DefaultScArea .sc-input'); e2[e2.length - 1].value = 'Ａ陸運';
      set('z2Carrier', 'ONE'); set('z2Pol', 'TOKYO'); set('z2Pod', 'SHANGHAI');
      toggleZone(3); set('z3DefaultSc', 'B代理店');
    });
    if (v2) { await p.evaluate(() => { const b = document.querySelector('[data-e2s="4"]'); b && b.click(); }); await p.waitForTimeout(400); }
    await p.evaluate(() => window.updateFrameHint && window.updateFrameHint()); await p.waitForTimeout(150);
  };
  const realRows = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr:not([data-virtual])')].filter(t => !t.dataset.type).map(t => { const id = t.id.replace('row-', ''); return { sv: document.getElementById('sv-' + id)?.value || '', cat: document.getElementById('cat-' + id)?.value || '', pt: document.getElementById('pt-' + id)?.value || '' }; }));
  const chips = sel => p.evaluate(s => [...document.querySelectorAll(s + ' .sf-rt-chip')].map(c => ({ t: c.querySelector('.sf-rt-side').textContent + ':' + c.querySelector('.sf-rt-name').textContent, added: c.classList.contains('is-added') })), sel);

  await fresh();
  ok('routeSubcons：出発地側・幹線・到着地側の順に 3 社（表記ゆれは 1 社）', await p.evaluate(() => JSON.stringify(window.routeSubcons().map(x => x.sideLabel + ':' + x.name))) === JSON.stringify(['出発地側:A陸運', '幹線輸送:ONE', '到着地側:B代理店']));
  let c = await chips('#sfHint');
  ok('明細が無いときの案内に「ルートで入力したサブコンから選ぶ」の 3 つのボタン', c.length === 3 && c[0].t === '出発地側:A陸運' && c[1].t === '幹線輸送:ONE' && c[2].t === '到着地側:B代理店', c);
  ok('「すべて追加（3社）」のボタンがある', /3社/.test(await p.evaluate(() => document.querySelector('#sfHint .sf-rt-all')?.textContent || '')));
  await p.evaluate(() => [...document.querySelectorAll('#sfHint .sf-rt-chip')][1].click()); await p.waitForTimeout(400);
  let rows = await realRows();
  ok('ONE を押すと、最初の空の行がその枠になる（行は増えない）・カテゴリは幹線の運賃', rows.length === 1 && rows[0].sv === 'ONE' && rows[0].cat === 'ocean', rows);
  ok('サブコン見出し「ONE」ができる', await p.evaluate(() => [...document.querySelectorAll('#tableBody tr.subcon-group-header')].some(h => h.dataset.svLabel === 'ONE')));
  // 「＋ サブコンを追加」の吹き出しにも候補（ONE は追加済み）
  await p.evaluate(() => window.openAddSubconFrame(document.body)); await p.waitForTimeout(150);
  c = await chips('#sfPop');
  ok('吹き出しにも候補が出て、ONE は「追加済み」（押せない）', c.length === 3 && c[1].added && !c[0].added && !c[2].added, c);
  ok('吹き出しの「すべて追加」は残り 2 社', /2社/.test(await p.evaluate(() => document.querySelector('#sfPop .sf-rt-all')?.textContent || '')));
  await p.evaluate(() => document.querySelector('#sfPop .sf-rt-all').click()); await p.waitForTimeout(500);
  rows = await realRows();
  ok('「すべて追加」で残りの 2 社の枠ができる（全部で 3 行・カテゴリつき）', rows.length === 3 && rows.some(r => r.sv === 'A陸運' && r.cat === 'domestic') && rows.some(r => r.sv === 'B代理店' && r.cat === 'overseas'), rows);
  ok('吹き出しは閉じる', await p.evaluate(() => !document.getElementById('sfPop')));
  await p.evaluate(() => window.openAddSubconFrame(document.body)); await p.waitForTimeout(150);
  ok('全部追加したあとは「すべて追加」は出ず、3 つとも追加済み', await p.evaluate(() => !document.querySelector('#sfPop .sf-rt-all') && document.querySelectorAll('#sfPop .sf-rt-chip.is-added').length === 3));
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);

  // ルートのサブコンが無いときは候補の欄を出さない
  await p.evaluate(() => { try { window.qpNewQuote(); } catch (e) {} }); await p.waitForTimeout(900);
  if (v2) { await p.evaluate(() => { const b = document.querySelector('[data-e2s="4"]'); b && b.click(); }); await p.waitForTimeout(300); }
  await p.evaluate(() => window.updateFrameHint()); await p.waitForTimeout(100);
  ok('ルートにサブコンが無いときは候補の欄を出さない', await p.evaluate(() => !document.querySelector('#sfHint .sf-rt')));

  // 「ルートのサブコンで枠をつくる」（旧「この構成でプリセット適用」）
  ok('ボタン名が「ルートのサブコンで枠をつくる」（旧名は残っていない）', await p.evaluate(() => /ルートのサブコンで枠をつくる/.test(document.querySelector('.btn-zone-preset').textContent) && !document.body.innerHTML.includes('この構成でプリセット適用')));
  await fresh();
  dialogs = 0;
  await p.evaluate(() => applyZoneBasedPreset()); await p.waitForTimeout(500);
  rows = await realRows();
  ok('明細が無いときは確認なしで、空の行と置き換えて枠をつくる（空の行が残らない）', dialogs === 0 && rows.length >= 3 && rows.every(r => r.sv), { dialogs, rows });
  ok('幹線は航路ごと（パターン＝POL → POD）', rows.some(r => r.sv === 'ONE' && r.pt === 'TOKYO → SHANGHAI'), rows);
  ok('ページのエラーなし', !errs.length, errs);
  await b.close(); srv.close();
  console.log(fails ? `\n${fails} FAIL` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
