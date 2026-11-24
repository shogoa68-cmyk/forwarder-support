// Design 50 案A：ステップ④「費用」＝明細 1 行を 1 段（js/quote/cost-a.js）。
//   node scripts/design-tests/cost-a-test.js   （THEME=classic で現行・OUT=<dir> で写真）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const th = process.env.THEME;
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=v2${th ? '&theme=' + th : ''}`;
  const OUT = process.env.OUT;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('fbFabHintDone_v1', '1'); localStorage.setItem('fwd.editorV2', '1'); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('dialog', d => d.accept('5'));
  await p.goto(URL); await p.waitForTimeout(700);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(800);
  await p.evaluate(() => window.editorV2Go(4, true)); await p.waitForTimeout(300);
  await p.evaluate(() => {
    const rows = [['ONE', 'FCL案', '海上運賃', '2', '20GP', 'USD', '1000', '200', ''], ['ONE', 'FCL案', 'THC', '2', '20GP', 'JPY', '35000', '5000', '港で確認'], ['ONE', 'LCL案', 'LCL運賃', '3', 'RT', 'USD', '40', '10', ''], ['山田運送', '', '国内陸送', '1', '台', 'JPY', '45000', '5000', '']];
    rows.forEach((v, i) => { if (i) window.addRow(); const trs = [...document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type])')]; const tr = trs[trs.length - 1]; const f = (n, x) => { const e = tr.querySelector(`[data-field="${n}"]`); if (!e) return; e.value = x; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); }; f('sv', v[0]); f('pt', v[1]); f('nm', v[2]); f('pq', v[3]); f('un', v[4]); f('pc', v[5]); f('bc', v[5]); f('pp', v[6]); f('mk', v[7]); f('nt', v[8]); });
    [...document.querySelectorAll('#tableBody tr.ca-row, #tableBody tr:not([data-virtual]):not([data-type])')][1].querySelector('.row-pending-btn').click();
  });
  await p.waitForTimeout(700);
  const rows = () => p.evaluate(() => [...document.querySelectorAll('#tableBody tr.ca-row')].map(tr => ({ h: Math.round(tr.getBoundingClientRect().height), nm: tr.querySelector('[data-field="nm"]').value })));
  const r0 = await rows();
  ok('④：明細の行は 1 段（高さ 40〜50px）', r0.length === 4 && r0.every(x => x.h >= 38 && x.h <= 52), r0);
  const cols = await p.evaluate(() => { const tr = document.querySelector('#tableBody tr.ca-row'); const x = s => { const e = tr.querySelector(s); return e ? Math.round(e.getBoundingClientRect().left) : null; }; return { nm: x('[data-field="nm"]'), pq: x('[data-field="pq"]'), pc: x('select[data-field="pc"]'), pp: x('[data-field="pp"]'), mk: x('[data-field="mk"]'), bp: x('[data-field="bp"]'), st: x('td.subtotal-cell'), pr: x('td.profit-cell'), more: x('.row-acts-hint') }; });
  ok('④：左から 項目名｜数量×単位｜仕入（左に通貨）｜＋乗せ幅｜売｜小計｜粗利｜⋯', ['nm', 'pq', 'pc', 'pp', 'mk', 'bp', 'st', 'pr', 'more'].every((k, i, a) => i === 0 || cols[a[i - 1]] < cols[k]), cols);
  ok('④：サブコン・パターン・備考・カテゴリ・課税・売の通貨は行に出さない（行の詳細の中）', await p.evaluate(() => { const tr = document.querySelector('#tableBody tr.ca-row'); return ['[data-field="sv"]', '[data-field="pt"]', '[data-field="nt"]', 'select.w-cat', '[data-field="tx"]', 'select[data-field="bc"]'].every(s => { const e = tr.querySelector(s); return !!e && !e.getClientRects().length; }); }));
  ok('④：備考は項目名の後ろに灰で「· 備考」・要調査は橙の札', await p.evaluate(() => { const tr = document.querySelectorAll('#tableBody tr.ca-row')[1]; return tr.querySelector('.ca-note').textContent === '· 港で確認' && /要調査/.test(tr.querySelector('.ca-badge.is-warn').textContent); }));
  ok('④：外貨の行は小計の下に「≈ ¥」', await p.evaluate(() => /≈¥360,000/.test(document.querySelector('#tableBody tr.ca-row td.subtotal-cell').textContent)));
  ok('④：列見出しは「仕入｜＋乗せ幅｜売」・「小計（売）」・「粗利」', await p.evaluate(() => { const t = document.querySelector('#quoteTable thead tr').textContent; return /仕入/.test(t) && /＋乗せ幅/.test(t) && /小計（売）/.test(t) && /粗利/.test(t); }));
  // 上の操作の行
  ok('上の操作の行：［＋ サブコンを追加］（主）［📦 チャージから追加］［⋯］・見出しの説明は出さない', await p.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!e && !!e.getClientRects().length; }; return v('#tableWrap .quote-cmdbar [data-f="openAddSubconFrame"]') && /チャージから追加/.test(document.querySelector('#tableWrap .quote-cmdbar [data-f="lcOpenPicker"]').textContent) && v('#caMoreBtn') && !v('#e2CostBar') && !v('#tableWrap > .section-desc'); }));
  await p.click('#caMoreBtn'); await p.waitForTimeout(150);
  const bm = await p.evaluate(() => [...document.querySelectorAll('.ca-menu .ca-mi')].map(x => x.textContent));
  ok('［⋯］：すべて開く／閉じる・小計行・追加する位置・表の設定', ['すべて開く', 'すべて閉じる', '＝ 小計行を足す'].every(t => bm.includes(t)) && bm.some(t => /追加する位置/.test(t)) && bm.some(t => /表の設定/.test(t)), bm);
  await p.keyboard.press('Escape');
  // 行の詳細
  await p.evaluate(() => document.querySelectorAll('#tableBody tr.ca-row')[1].querySelector('td.qty-cell').click()); await p.waitForTimeout(200);
  const d = await p.evaluate(() => { const tr = document.querySelectorAll('#tableBody tr.ca-row')[1]; const pn = tr.querySelector('.row-detail-panel'); const v = s => { const e = pn.querySelector(s); return !!e && !!e.getClientRects().length; }; return { open: tr.classList.contains('ca-open'), w: Math.round(pn.getBoundingClientRect().width), tw: Math.round(document.getElementById('tableBody').getBoundingClientRect().width), title: pn.querySelector('.ca-dtitle').textContent, note: v('[data-field="nt"]'), cat: v('select.w-cat'), tax: v('[data-field="tx"]'), bc: v('select[data-field="bc"]'), chips: [...pn.querySelectorAll('.ca-chip[data-ca-q]')].map(x => x.textContent), more: pn.querySelector('.ca-dmore').hidden }; });
  ok('行の詳細：行の何もない所を押すと、行の下に全幅で開く', d.open && d.w >= d.tw - 4, d);
  ok('行の詳細：見出し「THC の詳細」・備考／カテゴリ／課税／売の通貨', d.title === 'THC の詳細' && d.note && d.cat && d.tax && d.bc, d);
  ok('行の詳細：単価の扱い［0円で載せる］［MIN］［幅］［%］＋［さらに ▾］（閉じている）', JSON.stringify(d.chips) === JSON.stringify(['0円で載せる', 'MIN', '幅', '%']) && d.more, d.chips);
  await p.evaluate(() => document.querySelectorAll('#tableBody tr.ca-row')[1].querySelector('[data-ca="more"]').click()); await p.waitForTimeout(100);
  ok('行の詳細：［さらに］で 単価のオプション・貿易条件・表示条件・有効期間 が出る', await p.evaluate(() => { const pn = document.querySelectorAll('#tableBody tr.ca-row')[1].querySelector('.ca-dmore'); return !pn.hidden && !!pn.querySelector('.row-mode-btns') && !!pn.querySelector('.ic-group') && !!pn.querySelector('.cn-group') && !!pn.querySelector('.w-valid'); }));
  await p.evaluate(() => { const tr = document.querySelectorAll('#tableBody tr.ca-row')[1]; tr.querySelector('.ca-chip[data-ca-q="min-mode-btn"]').click(); }); await p.waitForTimeout(150);
  ok('行の詳細：［MIN］を押すと元の MIN ボタンと同じ（MIN の欄が使える・チップが主色）', await p.evaluate(() => { const tr = document.querySelectorAll('#tableBody tr.ca-row')[1]; return tr.querySelector('.ca-chip[data-ca-q="min-mode-btn"]').classList.contains('is-on'); }));
  await p.evaluate(() => { const tr = document.querySelectorAll('#tableBody tr.ca-row')[1]; tr.querySelector('.ca-chip[data-ca-q="min-mode-btn"]').click(); });
  // 詳細の中の欄を直すと、行の計算に効く（同じ <tr> の中なので）
  await p.evaluate(() => { const tr = document.querySelectorAll('#tableBody tr.ca-row')[1]; const t = tr.querySelector('[data-field="tx"]'); t.checked = true; t.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(200);
  ok('行の詳細の「課税」を ON にすると、項目名の先頭に「*」（計算・保存は従来どおり）', await p.evaluate(() => /^\*/.test(document.querySelectorAll('#tableBody tr.ca-row')[1].querySelector('[data-field="nm"]').value)));
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok('行の詳細：Esc で閉じる', await p.evaluate(() => !document.querySelector('#tableBody tr.ca-open')));
  // 行の［⋯］
  await p.evaluate(() => document.querySelectorAll('#tableBody tr.ca-row')[0].querySelector('.row-acts-hint').click()); await p.waitForTimeout(150);
  const rm = await p.evaluate(() => [...document.querySelectorAll('.ca-menu .ca-mi')].map(x => x.textContent));
  ok('行の［⋯］：行の詳細・複製・入力完了・要調査・見積書に出さない・削除', ['行の詳細', '⧉ 複製', '削除'].every(t => rm.includes(t)) && rm.some(t => /入力完了/.test(t)) && rm.some(t => /要調査/.test(t)) && rm.some(t => /見積書に出さない/.test(t)), rm);
  await p.evaluate(() => [...document.querySelectorAll('.ca-menu .ca-mi')].find(x => /入力完了/.test(x.textContent)).click()); await p.waitForTimeout(150);
  ok('入力完了は札にせず、項目名の後ろに緑の ✓', await p.evaluate(() => { const tr = document.querySelector('#tableBody tr.ca-row'); return !!tr.querySelector('.ca-done') && !tr.querySelector('.ca-badge'); }));
  // 見出し・小計・合計
  const g = await p.evaluate(() => {
    const v = e => !!e && !!e.getClientRects().length;
    const ptSub = [...document.querySelectorAll('#tableBody tr.subcon-pattern-subtotal')].filter(v).length;
    const grpSub = [...document.querySelectorAll('#tableBody tr.subcon-group-subtotal')].filter(v).length;
    const ph = document.querySelector('#tableBody tr.subcon-subgroup-header.is-pattern:not(.is-pt-solo)');
    return { ptSub, grpSub, ptn: ph && ph.querySelector('.ca-ptn').textContent, cat: v(ph && ph.querySelector('.pt-cat-inline')), cost: v(ph && ph.querySelector('.gb-m-c')), add: [...document.querySelectorAll('#tableBody .subcon-subtotal-add-btn')].some(v), total: (document.getElementById('caTotal') || {}).textContent, tfoot: v(document.querySelector('#quoteTable tfoot tr')) };
  });
  ok('小計：パターンが 2 つ以上のサブコン（ONE）だけパターンの小計・サブコン小計は出さない', g.ptSub === 2 && g.grpSub === 0, g);
  ok('パターン見出し：「· 2行」・（カテゴリなし）と仕入は出さない', g.ptn === '· 2行' && !g.cat && !g.cost, g);
  ok('小計の行の［＋ 行追加］は出さない', !g.add, g);
  ok('合計は薄い 1 行「合計（JPY 換算）… 売 ¥… · 仕入 ¥… · 粗利 …%」（濃い帯は出さない）', /合計（JPY 換算）/.test(g.total) && /売 ¥512,500/.test(g.total) && /粗利 \d+\.\d%/.test(g.total) && !g.tfoot, g);
  if (OUT) await p.screenshot({ path: path.join(OUT, 'cost-a-pc' + (th ? '-' + th : '') + '.png') });
  // 選んだ行の帯
  await p.evaluate(() => [...document.querySelectorAll('#tableBody tr.ca-row .row-select-chk')].slice(0, 2).forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); })); await p.waitForTimeout(200);
  const sel = await p.evaluate(() => { const s = document.getElementById('caSel'); return { vis: !s.hidden && !!s.getClientRects().length, n: s.querySelector('.ca-sel-n').textContent, btns: [...s.querySelectorAll('button')].map(x => x.textContent), cm: !!document.querySelector('#tableWrap .quote-cmdbar .cmdbar-main').getClientRects().length }; });
  ok('選んだ行の帯：「2 行を選択」＋複製・別のサブコンへ移す・見積書に出さない・数量をまとめて変更・削除・選択を外す', sel.vis && sel.n === '2 行を選択' && ['⧉ 複製', '⇄ 別のサブコンへ移す', '見積書に出さない', '数量をまとめて変更', '削除', '✕ 選択を外す'].every(t => sel.btns.includes(t)) && !sel.cm, sel);
  if (OUT) await p.screenshot({ path: path.join(OUT, 'cost-a-select' + (th ? '-' + th : '') + '.png') });
  await p.evaluate(() => document.querySelector('#caSel [data-cs="qty"]').click()); await p.waitForTimeout(200);
  ok('数量をまとめて変更：選んだ 2 行の数量が 5 に', await p.evaluate(() => [...document.querySelectorAll('#tableBody tr.ca-row')].slice(0, 2).every(tr => tr.querySelector('[data-field="pq"]').value === '5')));
  await p.evaluate(() => document.querySelector('#caSel [data-cs="move"]').click()); await p.waitForTimeout(150);
  await p.fill('.ca-move-in', '新運送'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  ok('別のサブコンへ移す：サブコン欄を書き換える（パターン名はそのまま）', await p.evaluate(() => { const t = [...document.querySelectorAll('#tableBody tr.ca-row')].filter(tr => tr.querySelector('[data-field="sv"]').value === '新運送'); return t.length === 2 && t.every(tr => tr.querySelector('[data-field="pt"]').value === 'FCL案'); }));
  await p.evaluate(() => document.querySelector('#caSel [data-cs="clear"]') && document.querySelector('#caSel [data-cs="clear"]').click()); await p.waitForTimeout(150);
  ok('［✕ 選択を外す］で帯が消える', await p.evaluate(() => document.getElementById('caSel').hidden));
  // 保存データは変わらない（行の配列）
  ok('保存データ：行の項目はそのまま（gatherAllData の行数 4・品名あり）', await p.evaluate(() => { const d = window.gatherAllData(); const r = (d.rows || []).filter(x => x._type === 'data' || !x._type); return r.length >= 4; }));
  // Design 50r：項目名の欄は列いっぱい・行の［⋯］は枠つき 30px・「パターン」の文字なし・一括解除は［⋯］へ・カテゴリ未設定は「（なし）」
  const r50 = await p.evaluate(() => {
    const tr = document.querySelector('#tableBody tr.ca-row'); const nm = tr.querySelector('[data-field="nm"]'), cell = tr.querySelector('.ca-name');
    const hint = tr.querySelector('.row-acts-hint'), hs = getComputedStyle(hint);
    const leg = document.querySelector('#tableBody tr.subcon-subgroup-header .subcon-subgroup-leg');
    const rst = document.getElementById('doneResetBtn');
    return { nmW: Math.round(nm.getBoundingClientRect().width), cellW: Math.round(cell.getBoundingClientRect().width), hint: [Math.round(hint.getBoundingClientRect().width), Math.round(hint.getBoundingClientRect().height), hs.borderTopWidth],
      leg: leg ? getComputedStyle(leg, '::before').content : 'none', rst: !rst || !rst.getClientRects().length,
      cat0: tr.querySelector('select.w-cat option[value=""]').textContent };
  });
  ok('50r：項目名の欄は列いっぱい（最小 160px）', r50.nmW >= 160 && r50.nmW >= r50.cellW * 0.5, r50);
  ok('50r：行の［⋯］は枠つき 30px', r50.hint[0] === 30 && r50.hint[1] === 30 && r50.hint[2] !== '0px', r50.hint);
  ok('50r：パターン見出しに「パターン」の文字を出さない', r50.leg === 'none' || r50.leg === 'normal', r50.leg);
  ok('50r：カテゴリ未設定の選択肢は「（なし）」', r50.cat0 === '（なし）', r50.cat0);
  ok('50r：［↺ 一括解除］は上の行に出さない', r50.rst);
  await p.evaluate(() => document.getElementById('caMoreBtn').click()); await p.waitForTimeout(150);
  const mi50 = await p.evaluate(() => [...document.querySelectorAll('.ca-menu .ca-mi')].map(x => x.textContent));
  ok('50r：［⋯］に「入力完了をすべて外す（N行）」', mi50.some(t => /^入力完了をすべて外す（\d+行）$/.test(t)), mi50);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.ca-menu .ca-mi')].find(x => /入力完了をすべて外す/.test(x.textContent)); b && b.click(); }); await p.waitForTimeout(250);
  const cf = await p.evaluate(() => { const d = document.querySelector('.confirm-overlay, .confirm-dialog'); return d ? d.textContent : ''; });
  ok('50r：押すと確認（uiConfirm）', /入力完了をすべて外しますか/.test(cf), cf.slice(0, 80));
  await p.evaluate(() => { const b = [...document.querySelectorAll('.confirm-dialog button, .confirm-overlay button')].find(x => /すべて外す/.test(x.textContent)); b && b.click(); }); await p.waitForTimeout(300);
  ok('50r：確認すると入力完了がすべて外れる', await p.evaluate(() => !document.querySelector('#tableBody tr[data-done="1"]')));
  // 行の右端の［✓］（入力完了・いつも見える）
  const dv = await p.evaluate(() => { const rows = [...document.querySelectorAll('#tableBody tr.ca-row')]; return rows.length > 0 && rows.every(tr => { const b = tr.querySelector('td.handle-cell > .ca-done-btn'); const h = tr.querySelector('.row-acts-hint'); if (!b || !b.getClientRects().length) return false; const r = b.getBoundingClientRect(), hr = h.getBoundingClientRect(); return r.width >= 28 && r.right <= hr.left + 1 && Math.abs(r.top - hr.top) < 6; }); });
  ok('［✓］：全ての明細行の右端（［⋯］の左）にいつも見える', dv);
  await p.evaluate(() => document.querySelectorAll('#tableBody tr.ca-row')[0].querySelector('.ca-done-btn').click()); await p.waitForTimeout(200);
  ok('［✓］：押すと入力完了（緑・記録あり）・行の詳細は開かない', await p.evaluate(() => { const tr = document.querySelectorAll('#tableBody tr.ca-row')[0]; const b = tr.querySelector('.ca-done-btn'); return tr.dataset.done === '1' && !!tr.dataset.doneAt && b.classList.contains('is-on') && b.getAttribute('aria-pressed') === 'true' && /押すと外す/.test(b.title) && !tr.classList.contains('ca-open'); }));
  await p.evaluate(() => document.querySelectorAll('#tableBody tr.ca-row')[0].querySelector('.ca-done-btn').click()); await p.waitForTimeout(200);
  ok('［✓］：もう一度押すと外れる', await p.evaluate(() => { const tr = document.querySelectorAll('#tableBody tr.ca-row')[0]; return tr.dataset.done !== '1' && !tr.querySelector('.ca-done-btn').classList.contains('is-on'); }));
  // 7. スマホ（〜600px）：見出し＝名前・行数・売・［⋯］・［＋ 明細を追加］／1 行＝2 段のカード
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(600);
  const mc = await p.evaluate(() => {
    const L = document.getElementById('mcList'); const hd = L.querySelector('.mc2-sv'); const rows = [...L.querySelectorAll('.mc2-row')];
    const nx = hd && hd.nextElementSibling; let lastOfGrp = null; for (let e = hd.nextElementSibling; e && !e.classList.contains('mc2-sv'); e = e.nextElementSibling) lastOfGrp = e;
    return { vis: !!L.getClientRects().length, n: hd && hd.querySelector('.mc2-n').textContent, more: !!(hd && hd.querySelector('[data-gmore]')), add: !hd.querySelector('.mc2-add,[data-add]') && lastOfGrp && lastOfGrp.classList.contains('mc2-addrow') ? lastOfGrp.textContent : null,
      addH: lastOfGrp && Math.round(lastOfGrp.getBoundingClientRect().height), hdH: Math.round(hd.getBoundingClientRect().height), sum: hd.querySelector('.mc-sv-sum').textContent,
      top: rows[0] && rows[0].querySelector('.mc2-top .mc-nm').textContent, bot: rows[0] && rows[0].querySelector('.mc2-bot').textContent, yen: rows[0] && (rows[0].querySelector('.mc2-yen') || {}).textContent,
      tag: rows[1] && (rows[1].querySelector('.mc2-tag') || {}).textContent, hmin: Math.min(...rows.map(r => r.getBoundingClientRect().height)) };
  });
    ok('スマホ：見出しは 1 段（名前・行数・売・［⋯］）・［＋ 明細を追加］はグループのいちばん下（44px）', mc.vis && /^\d+行$/.test(mc.n) && mc.more && mc.add === '＋ 明細を追加' && mc.addH >= 44 && mc.hdH <= 60, mc);
  ok('スマホ：見出しの金額は「売 ¥…」（JPY 換算・外貨があれば ※）・通貨別の内訳は出さない', /^売 ¥[\d,]+※$/.test(mc.sum) && !/USD/.test(mc.sum), mc.sum);
  ok('スマホ：1 行＝2 段（上段 項目名＋札・下段 数量 × 単位 ・ 売の小計）・44px 以上', mc.top && /×/.test(mc.bot) && /・/.test(mc.bot) && mc.tag === '要調査' && mc.hmin >= 44, mc);
  ok('スマホ：外貨の行は小計の下に ≈ 円', /^≈ ¥[\d,]+$/.test(mc.yen || ''), mc);
  ok('スマホ：各カードの右に［✓］（48px）・押すと入力完了／もう一度で外れる', await p.evaluate(async () => {
    const L = document.getElementById('mcList'); const b = L.querySelector('.mc2-line > .mc2-done'); if (!b) return false;
    const w = b.getBoundingClientRect().width; const id = b.dataset.done; b.click(); await new Promise(r => setTimeout(r, 400));
    const on = document.getElementById(id).dataset.done === '1' && !!document.querySelector('#mcList .mc2-done[data-done="' + id + '"].is-on') && !document.getElementById('mcSheet')?.classList.contains('open');
    document.querySelector('#mcList .mc2-done[data-done="' + id + '"]').click(); await new Promise(r => setTimeout(r, 400));
    return w >= 44 && on && document.getElementById(id).dataset.done !== '1'; }));
  ok('スマホ：見出しの［⋯］で見出しのメニュー（複製・注記・見積書から外す）', await p.evaluate(async () => { document.querySelector('#mcList [data-gmore]').click(); await new Promise(r => setTimeout(r, 200)); const m = document.getElementById('gbMenu'); const t = m && !m.hidden ? m.textContent : ''; document.body.click(); return /複製/.test(t) && /見積書から外す/.test(t); }));
  ok('スマホ：編集シートは 数量・単位 → 仕入 → 乗せ幅 → 売 → 備考 → カテゴリ の順', await p.evaluate(async () => {
    document.querySelector('#mcList .mc2-row').click(); await new Promise(r => setTimeout(r, 300));
    const y = id => document.getElementById(id).getBoundingClientRect().top;
    const r = y('mcs-pq') < y('mcs-pp') && y('mcs-pp') < y('mcs-mk') && y('mcs-mk') < y('mcs-bp') && y('mcs-bp') < y('mcs-nt') && y('mcs-nt') < y('mcs-cat');
    document.getElementById('mcsDone').click(); return r; }));
  await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(500);
  // 旧い画面に戻すと、元の場所へ戻る
  await p.evaluate(() => window.editorV2Toggle()); await p.waitForTimeout(400);
  ok('旧い画面に戻すと、欄は元の場所（サブコンはカテゴリ欄・課税は課税の列）', await p.evaluate(() => { const tr = document.querySelector('#tableBody tr:not([data-virtual]):not([data-type])'); return !tr.classList.contains('ca-row') && !!tr.querySelector('td.catsv-cell [data-field="sv"]') && !!tr.querySelector('td.tax-cell [data-field="tx"]') && !!tr.querySelector('td.ccy-cell select[data-field="pc"]') && !tr.querySelector('.ca-name'); }));
  ok('JS エラーなし', errs.length === 0, errs);
  await b.close(); srv.close();
  console.log(fails ? `\n${fails} 件 FAIL` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
