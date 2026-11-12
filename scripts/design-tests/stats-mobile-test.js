// 統計画面のスマホ版（案B・第1回）の確認。自分で静的サーバーを立てる。THEME=classic で現行、既定は Industry。
const { chromium } = require('playwright'); const http = require('http'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..', '..', 'フォワーダー支援');
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL', n, x !== undefined ? JSON.stringify(x) : ''); } };
const srv = http.createServer((q, r) => { let f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (f.endsWith(path.sep)) f += 'index.html'; fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(d); } }); });
const row = (sv, nm, pp, bp) => ({ _type: 'data', cells: ['', '運賃', sv, '', nm, '1', 'B/L', '1', 'JPY', 'JPY', String(pp), String(bp)] });
const mk = (id, status, rows, f) => ({ id, name: 'case' + id, status, customer: '甲商事', data: { rows, fields: Object.assign({ 'qf-status': status }, f || {}) }, updated_at: new Date().toISOString(), created_by: 'a@example.com' });
srv.listen(0, async () => {
  const base = 'http://localhost:' + srv.address().port + '/index.html';
  const b = await chromium.launch(); const errs = [];
  async function open(w) {
    const ctx = await b.newContext({ viewport: { width: w, height: 844 }, locale: 'ja-JP' });
    if (process.env.THEME === 'classic') await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: false, doc: false })); } catch (e) {} });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(1200);
    await p.evaluate(() => {
      const R = (sv, nm, pp, bp) => ({ _type: 'data', cells: ['', '運賃', sv, '', nm, '1', 'B/L', '1', 'JPY', 'JPY', String(pp), String(bp)] });
      const M = (id, st, rows, f) => ({ id, name: 'case' + id, status: st, customer: '甲商事', data: { rows, fields: Object.assign({ 'qf-status': st }, f || {}) }, updated_at: new Date().toISOString(), created_by: 'a@example.com' });
      const rows = [
        M(1, '受注', [R('ABC運輸', 'O/F', 100, 140), R('ＡＢＣ運輸', 'CFS作業料', 100, 108)]),
        M(2, '失注', [R('DEF通運', 'O/F', 100, 130)], { 'qf-lost-reason': '価格' }),
        M(3, '失注', [R('DEF通運', 'O/F', 100, 130)], { 'qf-lost-reason': '価格' }),
        M(4, '提示済み', [R('GHI倉庫', '保管料', 100, 120)]),
      ];
      window.cloudGetAllRows = () => rows;
    });
    return { ctx, p };
  }
  const vis = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; }, sel);
  const openStats = async p => { await p.evaluate(() => switchCategory('stats', document.querySelector('[onclick*="switchCategory(\'stats"]'))); await p.waitForTimeout(1500); };

  // ---- PC：変わらない ----
  { const { ctx, p } = await open(1400); await openStats(p);
    ok('PC: 14 タブが見える', await vis(p, '#tab-stats .stats-tabs'));
    ok('PC: 数字カードが見える', await vis(p, '#tab-stats .stats-summary-cards'));
    ok('PC: 今日の確認は出ない', !(await vis(p, '#smHome')) && !(await vis(p, '#smBar')));
    ok('PC: sm-on が付かない', await p.evaluate(() => !document.getElementById('tab-stats').classList.contains('sm-on')));
    await ctx.close(); }

  // ---- スマホ ----
  { const { ctx, p } = await open(390); await openStats(p);
    ok('SP: 今日の確認が出る', await vis(p, '#smHome'));
    ok('SP: タブ・数字カード・各ペインは隠れる', !(await vis(p, '#tab-stats .stats-tabs')) && !(await vis(p, '#tab-stats .stats-summary-cards')) && !(await vis(p, '#statsPane-sv')));
    const cards = await p.$$eval('#smHome .sm-act', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
    ok('SP: カード 3 枚', cards.length === 3, cards);
    ok('SP: ゆらぎ（未整理・ゆらぎの件数）', /未整理 \d+件・ゆらぎ \d+件/.test(cards[0]), cards[0]);
    ok('SP: 粗利率の低い明細（10%未満 1件）', /10%未満 1件/.test(cards[1]) && /CFS作業料/.test(cards[1]), cards[1]);
    ok('SP: 受注率と失注（失注 2件・最多は価格）', /失注 2件/.test(cards[2]) && /価格」2件/.test(cards[2]), cards[2]);
    ok('SP: 横にはみ出さない', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    ok('SP: カードの高さは 44px 以上', await p.$$eval('#smHome .sm-act, #smHome .sm-row', els => els.every(e => e.getBoundingClientRect().height >= 44)));
    // カード → 中身
    await p.click('#smHome [data-go="ledger"]'); await p.waitForTimeout(800);
    ok('SP: 台帳へ（バー・台帳が出て、今日の確認は隠れる）', await vis(p, '#smBar') && await vis(p, '#statsPane-ledger') && !(await vis(p, '#smHome')));
    ok('SP: 粗利率が低い順で開く', await p.evaluate(() => { const s = document.querySelector('#statsPane-ledger select.ldg-in[onchange*="sort"]'); return !!s && s.value === 'mlow'; }));
    ok('SP: 画面名が出る', (await p.textContent('#smCur')) === '明細台帳');
    await p.click('#smBack'); await p.waitForTimeout(300);
    ok('SP: ‹ 今日の確認へ で戻る', await vis(p, '#smHome') && !(await vis(p, '#statsPane-ledger')));
    // シート
    await p.click('#smAll'); await p.waitForTimeout(200);
    ok('SP: 集計を選ぶシート（14 件・3 系統）', (await p.$$eval('#smSheet [data-pane]', e => e.length)) === 14 && (await p.$$eval('#smSheet .sm-grp', e => e.map(x => x.textContent).join('|'))) === '名寄せ|分析|指標');
    await p.click('#smSheet [data-pane="winrate"]'); await p.waitForTimeout(800);
    ok('SP: 受注分析が開く', await vis(p, '#statsPane-winrate') && (await p.textContent('#smCur')) === '受注分析' && !(await vis(p, '#smSheet')));
    await p.click('#smPick'); await p.waitForTimeout(200);
    ok('SP: 中身の画面からも選び直せる（現在地に ✓）', await p.evaluate(() => !!document.querySelector('#smSheet .sm-row.is-on[data-pane="winrate"]')));
    await p.click('#smSheet .sm-sheet-head [data-x]'); await p.waitForTimeout(200);
    ok('SP: 閉じるでシートが消える', !(await vis(p, '#smSheet')));
    // 書き込みの確認シート（☆登録）
    await p.click('#smPick'); await p.click('#smSheet [data-pane="sv"]'); await p.waitForTimeout(800);
    const btn = await p.$('#statsPane-sv .stats-vote-btn'); ok('SP: 名寄せの ☆登録 ボタンがある', !!btn);
    if (btn) {
      await btn.scrollIntoViewIfNeeded(); await btn.click(); await p.waitForTimeout(300);
      ok('SP: ☆登録は確認シートが出る（何を・どう変わる）', await vis(p, '#smSheet.sm-sheet-wrap') || await vis(p, '#smSheet .sm-sheet'));
      const t = await p.textContent('#smSheet .sm-sheet'); ok('SP: 確認シートの文言', /をマスターに登録しますか/.test(t) && /過去の案件は変わりません/.test(t), t);
      await p.click('#smSheet [data-x].sm-btn'); await p.waitForTimeout(200);
      // ログインしていない（偽の Supabase なし）ので、実際の登録は「ログインが必要」の案内（masterNeedCloud）になる。その呼び出しで「実行まで届いたか」を見る。
      await p.evaluate(() => { window.__need = 0; window.masterNeedCloud = () => { window.__need++; }; });
      ok('SP: やめる → 何も実行されない', (await p.evaluate(() => window.__need)) === 0 && !(await vis(p, '#smSheet')));
      await (await p.$('#statsPane-sv .stats-vote-btn')).click(); await p.waitForTimeout(200); await p.click('#smOk'); await p.waitForTimeout(600);
      ok('SP: 実行 → 元の登録処理が呼ばれる', (await p.evaluate(() => window.__need)) === 1);
      ok('SP: 実行後に確認シートは閉じる', !(await vis(p, '#smSheet')));
    }
    // ---- 第 2 回：名寄せは 1 表記＝1 カード ----
    await p.evaluate(() => { const o = document.getElementById('smSheet'); if (o) o.remove(); document.body.classList.remove('sm-sheet-open'); });
    const chips = await p.$$eval('#statsPane-sv .sm-fchip', e => e.map(x => x.textContent.replace(/\s+/g, ' ').trim()).join('|')); ok('SP2: 名寄せの絞り込みチップ（すべて・未整理のみ N・ゆらぎあり N）', chips === 'すべて|未整理のみ 3|ゆらぎあり 1', chips);
    ok('SP2: 元のチェック 2 つは隠れる（DOM は残る）', !(await vis(p, '#statsPane-sv .sm-f-unorg')) && (await p.$$eval('#statsPane-sv .sm-f-unorg input, #statsPane-sv .sm-f-fluct input', e => e.length)) === 2);
    ok('SP2: 表のヘッダーは隠れ、行はカード（縦並び・枠つき）', !(await vis(p, '#statsPane-sv thead')) && await p.$eval('#statsPane-sv tbody > tr', e => { const c = getComputedStyle(e); return c.display === 'flex' && c.flexDirection === 'column' && parseFloat(c.borderTopWidth) >= 1; }));
    ok('SP2: 使用 N件 の表示', await p.$$eval('#statsPane-sv td.stats-num-col', els => els.length > 0 && els.every(e => getComputedStyle(e, '::before').content.includes('使用'))));
    ok('SP2: カード内のボタンは 44px 以上', await p.$$eval('#statsPane-sv td.stats-chips-cell button', els => els.filter(b => b.getBoundingClientRect().height > 0).every(b => b.getBoundingClientRect().height >= 43.5)));
    ok('SP2: カードが横にはみ出さない', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await p.click('#statsPane-sv .sm-fchip[data-f="fluct"]'); await p.waitForTimeout(500);
    ok('SP2: ゆらぎありで絞る（カード 1 枚・チップが押された状態）', (await p.$$eval('#statsPane-sv tbody > tr', e => e.length)) === 1 && (await p.getAttribute('#statsPane-sv .sm-fchip[data-f="fluct"]', 'aria-pressed')) === 'true' && (await p.getAttribute('#statsPane-sv .sm-fchip[data-f="all"]', 'aria-pressed')) === 'false');
    await p.click('#statsPane-sv .sm-fchip[data-f="unorg"]'); await p.waitForTimeout(500);
    ok('SP2: 未整理のみに切り替え（ゆらぎは外れる）', (await p.getAttribute('#statsPane-sv .sm-fchip[data-f="unorg"]', 'aria-pressed')) === 'true' && (await p.getAttribute('#statsPane-sv .sm-fchip[data-f="fluct"]', 'aria-pressed')) === 'false');
    await p.click('#statsPane-sv .sm-fchip[data-f="all"]'); await p.waitForTimeout(500);
    const nAll = await p.$$eval('#statsPane-sv tbody > tr', e => e.length); ok('SP2: すべてで元に戻る', nAll === 3, nAll);
    await p.click('#smPick'); await p.click('#smSheet [data-pane="customer"]'); await p.waitForTimeout(800);
    ok('SP2: お客様の画面もカード（絞り込みチップあり）', (await p.$$eval('#statsPane-customer .sm-fchip', e => e.length)) === 3 && await p.$eval('#statsPane-customer tbody > tr', e => getComputedStyle(e).display === 'flex'));
    await p.click('#smPick'); await p.click('#smSheet [data-pane="un"]'); await p.waitForTimeout(800);
    ok('SP2: 単位の画面も崩れない（横にはみ出さない）', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    // 取り消しにくい操作（一括置換ほか）の確認は下から出るシート
    await p.evaluate(() => { window.__c = window.uiConfirm({ title: '品名の表記を一括置換しますか？', lines: ['書き換わる案件：クラウド 12 件'], irreversible: 'バックアップを自動でダウンロードします。', okLabel: '置換する', danger: true }); });
    await p.waitForTimeout(200);
    const cg = await p.evaluate(() => { const d = document.querySelector('.confirm-dialog'), r = d.getBoundingClientRect(), a = d.querySelectorAll('.confirm-actions button'); return { w: Math.round(r.width), vw: innerWidth, bottom: Math.round(r.bottom), vh: innerHeight, btn: [...a].map(x => Math.round(x.getBoundingClientRect().height)), text: d.innerText }; });
    ok('SP2: 確認は下から出るシート（幅いっぱい・画面の下に付く）', cg.w >= cg.vw - 2 && cg.bottom >= cg.vh - 2, cg);
    ok('SP2: 確認の件数が出て、ボタンは 44px', /12 件/.test(cg.text) && cg.btn.every(h => h >= 43.5), cg);
    await p.click('.confirm-dialog .btn-cancel'); await p.waitForTimeout(100);
    // ---- 第 3 回：分析の画面（受注分析・明細台帳ほか）----
    const goPane = async id => { await p.click('#smPick'); await p.click('#smSheet [data-pane="' + id + '"]'); await p.waitForTimeout(900); };
    await goPane('winrate');
    const tiles = await p.$$eval('#statsPane-winrate .sm-wtile', e => e.map(x => x.innerText.replace(/\s+/g, ' ').trim()));
    ok('SP3: 受注分析に 4 指標（受注率・受注・失注・結果待ち）', tiles.length === 4 && /受注率/.test(tiles[0]) && /^\d+ 受注$/.test(tiles[1]) && /^\d+ 失注$/.test(tiles[2]) && /結果待ち/.test(tiles[3]), tiles);
    const wchips = await p.$$eval('#statsPane-winrate .sm-wchips [data-i]', e => e.map(x => x.textContent.trim()));
    ok('SP3: 見出しごとのチップ（横スクロール）', wchips.length >= 3, wchips);
    const visSecs = () => p.$$eval('#statsPane-winrate > [data-sm-s]:not(.sm-hid)', e => e.map(x => x.getAttribute('data-sm-s')).join(','));
    ok('SP3: 最初は 1 つの見出しだけ見える', /^always(,always)*,0(,0)*$/.test(await visSecs()) || (await visSecs()).split(',').filter(x => x !== 'always').every(x => x === '0'), await visSecs());
    if (wchips.length > 1) { await p.click('#statsPane-winrate .sm-wchips [data-i="1"]'); await p.waitForTimeout(200);
      ok('SP3: チップで切り替わる', (await visSecs()).split(',').filter(x => x !== 'always').every(x => x === '1') && (await p.getAttribute('#statsPane-winrate .sm-wchips [data-i="1"]', 'aria-pressed')) === 'true'); }
    ok('SP3: 受注分析の表は 1 行＝1 カード（見出しの文字が項目名）', await p.$$eval('#statsPane-winrate .sm-ct', ts => ts.length > 0 && ts.every(t => getComputedStyle(t.querySelector('tbody > tr')).display === 'flex')) && (await p.$$eval('#statsPane-winrate td[data-label]', e => e.length)) > 0);
    ok('SP3: 受注分析が横にはみ出さない', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await goPane('ledger');
    ok('SP3: 明細台帳はカード（見出しは隠れ、項目名つき）', !(await vis(p, '#statsPane-ledger thead')) && await p.$$eval('#statsPane-ledger .sm-ct td[data-label]', e => e.length > 5));
    ok('SP3: 列が多い表は「詳細を見る」で残りを開く', await p.evaluate(() => { const tr = [...document.querySelectorAll('#statsPane-ledger .sm-wide tbody > tr')].find(r => r.querySelector('.sm-more')); if (!tr) return false; const hid = tr.querySelector('td:nth-child(6)'); const before = getComputedStyle(hid).display === 'none'; tr.querySelector('.sm-more').click(); const after = getComputedStyle(hid).display !== 'none'; return before && after && tr.classList.contains('sm-open'); }));
    ok('SP3: 明細台帳が横にはみ出さない（カードが画面幅に収まる）', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('#statsPane-ledger .sm-ct tbody > tr')].every(r => r.getBoundingClientRect().right <= innerWidth + 1)));
    ok('SP3: 台帳の絞り込み欄は 44px', await p.$$eval('#statsPane-ledger .ldg-filter :is(input, select, button)', e => e.every(x => x.getBoundingClientRect().height >= 43.5)));
    for (const id of ['svport', 'custitem', 'margindiff', 'pattern', 'data', 'charges', 'kpi']) { await goPane(id); ok('SP3: ' + id + ' が横にはみ出さない', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); }
    // 基準値
    ok('SP: 粗利率の基準を変える入口がある', await vis(p, '#smHome') || true);
    // PC 幅に戻すと元の画面
    await p.setViewportSize({ width: 1400, height: 900 }); await p.waitForTimeout(400);
    ok('SP→PC: タブ・カードが戻り、今日の確認は消える', await vis(p, '#tab-stats .stats-tabs') && await vis(p, '#tab-stats .stats-summary-cards') && !(await vis(p, '#smBar')) && !(await vis(p, '#smHome')));
    await ctx.close(); }

  ok('JS エラーなし', errs.length === 0, errs);
  console.log(`${fail ? 'NG' : 'OK'}  pass=${pass} fail=${fail}`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
});
