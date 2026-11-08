// スマホ幅（〜600px）の見積もりテーブル・段階 1（一覧）の試験。  node scripts/design-tests/mobile-cost-test.js （OUT=<dir>, THEME=1, MODE=simple）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const out = []; const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  async function open(W) {
    const ctx = await b.newContext({ viewport: { width: W, height: 844 }, locale: 'ja-JP' });
    await ctx.addInitScript((mode) => { try { localStorage.setItem('fwd.uiMode', mode); } catch (e) {} }, process.env.MODE || 'detail');
    if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); p.setDefaultTimeout(8000);
    await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
    await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
    await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(600);
    return { ctx, p, errs };
  }
  const vis = (p, s) => p.evaluate(x => { const e = document.querySelector(x); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, s);
  const setRow = (p, i, o) => p.evaluate(([i, o]) => {
    const trs = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')];
    while (trs.length <= i) { window.addRow(); trs.push(...[...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')].slice(trs.length)); }
    const tr = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')][i];
    Object.entries(o).forEach(([k, val]) => { const e = tr.querySelector('[data-field="' + k + '"]'); if (!e) return; e.value = val; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
  }, [i, o]);
  // PC 幅：一覧は出ない
  { const { ctx, p, errs } = await open(1400);
    ok('[PC] スマホ用の一覧は出ない・表がそのまま', !(await vis(p, '#mcList')) && await vis(p, '#quoteTable'));
    ok('[PC] JS エラーなし', errs.length === 0, errs); await ctx.close(); }
  // スマホ幅
  { const { ctx, p, errs } = await open(390);
    await p.evaluate(() => { const s = document.getElementById('section-table'); s.classList.remove('collapsed'); });
    await setRow(p, 0, { nm: '海上運賃', sv: 'サンプル運送', pt: 'FCL案', pq: '2', un: 'CNTR', pp: '1000', mk: '200' });
    await setRow(p, 1, { nm: 'THC', sv: 'サンプル運送', pt: 'LCL案', pq: '1', un: 'B/L', pp: '500', mk: '100' });
    await setRow(p, 2, { nm: '通関料', sv: '通関A', pq: '1', un: 'LOT', pp: '8000', mk: '2000' });
    await p.waitForTimeout(500);
    ok('[スマホ] 一覧が出て、PC の表は隠れる', await vis(p, '#mcList') && !(await vis(p, '#quoteTable')));
    const names = await p.$$eval('#mcList .mc-sv-name', els => els.map(e => e.textContent));
    ok('[スマホ] サブコン見出し（出てきた順）', names.join('|') === 'サンプル運送|通関A', names);
    ok('[スマホ] 行が 3 件・品名が出る', (await p.$$eval('#mcList .mc-row .mc-nm', els => els.map(e => e.textContent))).join('|') === '海上運賃|THC|通関料');
    ok('[スマホ] パターン見出し（変わるところだけ）', (await p.$$eval('#mcList .mc-pt', els => els.map(e => e.textContent))).join('|') === 'FCL案|LCL案');
    const sub = await p.textContent('#mcList .mc-row .mc-sub'); ok('[スマホ] 「数量 単位 × 売単価」', /2 CNTR × 1200/.test(sub), sub);
    ok('[スマホ] 金額が出る（2,400）', (await p.textContent('#mcList .mc-row .mc-amt')).includes('2,400'));
    ok('[スマホ] サブコン小計', (await p.textContent('#mcList .mc-sv-sum')).includes('3,000'), await p.textContent('#mcList .mc-sv-sum'));
    ok('[スマホ] 行の高さは 44px 以上・button 要素', await p.evaluate(() => { const b = document.querySelector('#mcList .mc-row'); return b.tagName === 'BUTTON' && b.getBoundingClientRect().height >= 44; }));
    // 状態：要調査・見積書に出さない
    await p.evaluate(() => { const tr = document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])'); tr.querySelector('.row-pending-btn').click(); const tr2 = [...document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])')][1]; tr2.querySelector('.row-hidequote-btn').click(); });
    await p.waitForTimeout(400);
    ok('[スマホ] 要調査の札と黄色の帯', await p.evaluate(() => { const r = document.querySelector('#mcList .mc-row'); return r.classList.contains('is-pending') && !!r.querySelector('.t-pend'); }));
    ok('[スマホ] 見積書に出さない行は札と取り消し線・合計から外れる', await p.evaluate(() => { const r = document.querySelectorAll('#mcList .mc-row')[1]; return r.classList.contains('is-hidden') && !!r.querySelector('.t-hide'); }) && (await p.textContent('#mcList .mc-sv-sum')).includes('2,400') && !(await p.textContent('#mcList .mc-sv-sum')).includes('3,000'));
    // 編集に追従
    await setRow(p, 0, { pp: '2000' }); await p.waitForTimeout(400);
    ok('[スマホ] 表の入力に一覧が追従（2,000+200=2,200 ×2 = 4,400）', (await p.textContent('#mcList .mc-row .mc-amt')).includes('4,400'), await p.textContent('#mcList .mc-row .mc-amt'));
    // 行追加
    const n0 = await p.$$eval('#mcList .mc-row', e => e.length); await p.click('#mcList [data-addrow]'); await p.waitForTimeout(500);
    ok('[スマホ] 「＋ 行を追加」で行が増える', (await p.$$eval('#mcList .mc-row', e => e.length)) === n0 + 1);
    await p.click('#mcList .mc-sv >> nth=1 >> button.mc-add'); await p.waitForTimeout(500);
    ok('[スマホ] サブコン見出しの「＋」でそのサブコンに行が増える', (await p.$$eval('#mcList .mc-row', e => e.length)) === n0 + 2);
    // 行タップ → 編集シート
    await p.click('#mcList .mc-row >> nth=0'); await p.waitForTimeout(400);
    ok('[シート] 行をタップすると編集シートが開く', await vis(p, '#mcSheet .mcs-box'));
    ok('[シート] 「n / 全体 行目」', /^1 \/ \d+ 行目$/.test(await p.textContent('#mcsPos')), await p.textContent('#mcsPos'));
    ok('[シート] 行の値が入っている（品名・サブコン・パターン・数量・仕入）', await p.evaluate(() => ['nm','sv','pt','pq','pp'].map(k => document.getElementById('mcs-' + k).value).join('|') === '海上運賃|サンプル運送|FCL案|2|2000'));
    ok('[シート] カテゴリ・通貨の選択肢が行と同じ', await p.evaluate(() => document.getElementById('mcs-cat').options.length > 5 && document.getElementById('mcs-bc').options.length > 2));
    ok('[シート] 売金額（自動）', (await p.textContent('#mcs-st')).includes('4,400'), await p.textContent('#mcs-st'));
    ok('[シート] 入力欄は高さ 44px 以上', await p.evaluate(() => document.getElementById('mcs-nm').getBoundingClientRect().height >= 44));
    // 編集 → 行の欄・計算に反映
    await p.fill('#mcs-nm', '海上運賃（改）'); await p.fill('#mcs-pp', '3000'); await p.waitForTimeout(300);
    const rowVals = await p.evaluate(() => { const tr = document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])'); return { nm: tr.querySelector('[data-field="nm"]').value, pp: tr.querySelector('[data-field="pp"]').value, st: tr.querySelector('[data-field="st"]').textContent }; });
    ok('[シート] 入力が行の欄に書き込まれ、行の計算が走る（3,000+200=3,200×2=6,400）', rowVals.nm === '海上運賃（改）' && rowVals.pp === '3000' && rowVals.st.includes('6,400'), rowVals);
    ok('[シート] シート上の売金額も更新', (await p.textContent('#mcs-st')).includes('6,400'), await p.textContent('#mcs-st'));
    // 状態ボタン → 既存ボタンの関数
    await p.click('#mcsState [data-state="done"]'); await p.waitForTimeout(200);
    ok('[シート] 「入力完了」は行の既存ボタンの処理（dataset.done）', await p.evaluate(() => document.querySelector('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').dataset.done === '1') && await p.evaluate(() => document.querySelector('#mcsState [data-state="done"]').classList.contains('is-on')));
    // 備考行を下に挿入
    const nrows0 = await p.evaluate(() => document.querySelectorAll('#tableBody tr').length);
    await p.fill('#mcs-nt', '要確認'); await p.click('#mcSheet [data-act="rem"]'); await p.waitForTimeout(300);
    ok('[シート] 備考行を下に挿入（既存の 💬 ボタンの処理）', (await p.evaluate(() => document.querySelectorAll('#tableBody tr').length)) > nrows0);
    // 前後移動
    await p.click('#mcSheet [data-nav="1"]'); await p.waitForTimeout(250);
    ok('[シート] ›で次の行へ（2 / n 行目・品名 THC）', /^2 \//.test(await p.textContent('#mcsPos')) && (await p.inputValue('#mcs-nm')) === 'THC', await p.textContent('#mcsPos'));
    ok('[シート] 前の行ボタンが効く', (await p.evaluate(() => !document.querySelector('#mcSheet [data-nav="-1"]').disabled)));
    // 直下に追加 → 新しい行が開く
    const n1 = await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').length);
    await p.click('#mcSheet [data-act="add"]'); await p.waitForTimeout(400);
    ok('[シート] 直下に追加すると新しい行が増え、その行のシートに切り替わる', (await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').length)) === n1 + 1 && (await p.inputValue('#mcs-nm')) === '', await p.textContent('#mcsPos'));
    await p.click('#mcSheet [data-act="dup"]'); await p.waitForTimeout(400);
    ok('[シート] 複製で行が増える', (await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').length)) === n1 + 2);
    await p.click('#mcSheet [data-act="del"]'); await p.waitForTimeout(500);
    ok('[シート] 削除（確認ダイアログを承諾）で行が減る', (await p.evaluate(() => document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-type]):not([data-virtual])').length)) === n1 + 1);
    // その他
    const moreVis = await p.evaluate(() => getComputedStyle(document.getElementById('mcsMore')).display !== 'none');
    ok('[シート] 「その他」は' + (process.env.MODE === 'simple' ? 'かんたん表示では出ない' : '畳んで出る'), process.env.MODE === 'simple' ? !moreVis : moreVis);
    if (process.env.MODE !== 'simple') { await p.click('#mcsMore > summary'); ok('[シート] その他：有効期間・更新日・単価のオプション', await vis(p, '#mcs-vf') && await vis(p, '#mcs-lu') && (await p.$$('#mcsModes .mcs-tg')).length >= 5); }
    // 完了で閉じる → 一覧に反映
    await p.click('#mcsDone'); await p.waitForTimeout(400);
    ok('[シート] 「完了」で閉じ、一覧に反映（品名・入力完了の札）', !(await vis(p, '#mcSheet .mcs-box')) && (await p.textContent('#mcList')).includes('海上運賃（改）') && !!(await p.$('#mcList .t-done')));
    // 背景タップ・Esc
    await p.click('#mcList .mc-row >> nth=0'); await p.waitForTimeout(300); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok('[シート] Esc で閉じる', !(await vis(p, '#mcSheet .mcs-box')));
    await p.click('#mcList .mc-row >> nth=0'); await p.waitForTimeout(300); await p.mouse.click(195, 30); await p.waitForTimeout(200);
    ok('[シート] 背景をタップして閉じる', !(await vis(p, '#mcSheet .mcs-box')));
    // 「表で編集する」へ
    await p.click('#mcModeBtn'); await p.waitForTimeout(300);
    ok('[スマホ] 「表で編集する」で実際の表（PC と同じ）に切り替わり、「一覧に戻る」で戻る', await vis(p, '#quoteTable')); await p.click('#mcModeBtn'); await p.waitForTimeout(200); ok('[スマホ] 一覧へ戻る', await vis(p, '#mcList .mc-row') && !(await vis(p, '#quoteTable')));
    if (process.env.OUT) { await p.evaluate(() => document.getElementById('section-table').scrollIntoView()); await p.waitForTimeout(200); await p.screenshot({ path: path.join(process.env.OUT, 'mobile-cost.png') }); await p.click('#mcList .mc-row >> nth=0'); await p.waitForTimeout(300); await p.screenshot({ path: path.join(process.env.OUT, 'mobile-sheet.png') }); await p.click('#mcsMore > summary').catch(() => {}); await p.evaluate(() => { document.querySelector('#mcSheet .mcs-body').scrollTop = 9999; }); await p.waitForTimeout(200); await p.screenshot({ path: path.join(process.env.OUT, 'mobile-sheet2.png') }); }
    ok('[スマホ] JS エラーなし', errs.length === 0, errs); await ctx.close(); }
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'NG' : 'OK');
  await b.close(); srv.close(); process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
