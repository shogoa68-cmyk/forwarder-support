// 見張り番（不具合の再現を記録する・js/bug-recorder.js）の確認
//   Ctrl+Shift+L で開始／終了・手順の記録・伏せ字（数字・自由入力）・品名などの文字は残す・
//   🚩目印・エラーと通知の記録・再読み込みしても続く・報告フォームへの下書き・❓カードの入口
//   node scripts/design-tests/bug-recorder-test.js          （THEME=1 で Industry）
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
  let fails = 0;
  const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };

  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
  await ctx.addInitScript(theme => {
    try { localStorage.setItem('fwd.uiMode', 'detail'); localStorage.setItem('fbFabHintDone_v1', '1'); } catch (e) {}
    if (theme) try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {}
  }, !!process.env.THEME);
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage();
  await p.goto(URL, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#fbQuickFab', { state: 'attached' });
  const vis = sel => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.display !== 'none'; }, sel);

  // ① 開始：ショートカット
  ok('最初は記録中ではない', !(await p.evaluate(() => window.bugRecActive())));
  await p.keyboard.press('Control+Shift+L');
  ok('Ctrl+Shift+L で記録が始まる（バーが出る）', (await p.evaluate(() => window.bugRecActive())) && (await vis('#fbBrecBar')));
  const barBox = await p.evaluate(() => { const r = document.getElementById('fbBrecBar').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, w: innerWidth }; });
  ok('バーは画面内に収まる', barBox.l >= 0 && barBox.r <= barBox.w && barBox.t >= 0, barBox);

  // ② 操作：タブ移動・入力（見積タブの行追加→品名・単価・お客様名）
  await p.click('.cat-btn[aria-controls="tab-quote-make"]');
  await p.waitForSelector('#tab-quote-make.active', { timeout: 5000 });
  await p.evaluate(() => { if (typeof window.qpNewQuote === 'function') window.qpNewQuote(); });
  await p.waitForTimeout(400);
  // 実際の入力と同じ操作（本物のキー入力・フォーカス移動）で入れる
  await p.fill('#qf-customer', '山田商事株式会社'); await p.keyboard.press('Tab');
  await p.fill('#qf-person', '佐藤太郎'); await p.keyboard.press('Tab');
  await p.fill('#tableBody tr[id^="row-"] [data-field="nm"]', 'THC'); await p.keyboard.press('Tab');
  await p.fill('#tableBody tr[id^="row-"] [data-field="pp"]', '12345.5'); await p.keyboard.press('Tab');
  await p.evaluate(() => {
    console.error('テスト用のエラー ABC');
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('⚠️ テスト用の警告', 'warn');
  });
  await p.click('#fbBrecMark');
  const live = await p.evaluate(() => JSON.parse(sessionStorage.getItem('fwd.bugRec_v1')));
  const txt = live.steps.map(s => s.text).join('\n');
  ok('タブの移動（ボタンを押した）が記録される', /「💼 見積を作る.*」を押す/.test(txt), txt);
  ok('アプリが自動で動かした入力（日付の初期値など）は混ざらない', !/日付・時刻/.test(txt), txt);
  ok('欄の id が添えられる（再現・修正しやすい）', /#qf-customer/.test(txt) && /#qf-person/.test(txt), txt);
  ok('お客様名の文字は伏せる（文字数だけ）', !/山田商事|佐藤太郎/.test(JSON.stringify(live)) && /文字 \d+ 字/.test(txt), txt);
  ok('金額は 9 に伏せる', !/12345/.test(JSON.stringify(live)) && /数値 99999\.9/.test(txt), txt);
  ok('品名の文字は残す', /品名.*に入力 → THC/.test(txt), txt);
  ok('エラーが記録される', /エラーが出た：.*ABC/.test(txt) && live.errors.some(e => /ABC/.test(e)), txt);
  ok('警告の通知が記録される', /通知（warn）：.*テスト用の警告/.test(txt), txt);
  ok('🚩目印と画面の状態が残る', live.steps.some(s => s.snap && /画面=/.test(s.snap)), live.steps.slice(-2));
  ok('記録中は「バーのボタン」を操作として記録しない', !/止めて報告|ここが不具合/.test(txt), txt);

  // ③ 再読み込みしても続く
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#fbBrecBar', { timeout: 5000 });
  ok('再読み込みしても記録が続く', await p.evaluate(() => window.bugRecActive()));
  const after = await p.evaluate(() => JSON.parse(sessionStorage.getItem('fwd.bugRec_v1')));
  ok('再読み込みの印が入り、前の手順も残る', after.steps.length > live.steps.length && after.steps.some(s => /再読み込み/.test(s.text)), after.steps.length);

  // ④ 終了：もう一度ショートカット → 報告フォームに下書き
  await p.keyboard.press('Control+Shift+L');
  await p.waitForSelector('#fbBrecMode', { timeout: 3000 });
  ok('止めると「処理の方法」を選ぶ画面が出る（報告フォームはまだ開かない）', (await vis('#fbBrecMode')) && !(await vis('#fbOverlay.open')));
  ok('選択肢はリアルタイム処理とバッチ処理の 2 つ', await p.evaluate(() => [...document.querySelectorAll('#fbBrecMode [data-mode]')].map(b => b.dataset.mode).join(',') === 'realtime,batch'));
  const modeH = await p.evaluate(() => Math.min(...[...document.querySelectorAll('#fbBrecMode [data-mode]')].map(b => b.getBoundingClientRect().height)));
  ok('選択のボタンは押しやすい高さ（44px 以上）', modeH >= 44, modeH);
  await p.click('#fbBrecMode [data-mode="realtime"]');
  await p.waitForSelector('#fbOverlay.open', { timeout: 3000 });
  ok('選ぶと選択画面が消えて報告フォームが開く', !(await vis('#fbBrecMode')));
  ok('もう一度押すと記録が止まり、バーが消える', !(await p.evaluate(() => window.bugRecActive())) && !(await vis('#fbBrecBar')));
  ok('記録の保存データが消える', (await p.evaluate(() => sessionStorage.getItem('fwd.bugRec_v1'))) === null);
  const form = await p.evaluate(() => ({
    body: document.getElementById('fbBody').value,
    cat: (document.querySelector('#fbForm input[name="fbCategory"]:checked') || {}).value,
    title: document.getElementById('fbTitle').value,
    ctx: window.__fbRecCtx,
  }));
  ok('報告は「バグ報告」で開く', form.cat === 'バグ報告', form.cat);
  ok('下書きに 起きたこと／本当は／再現手順／画面の状態／エラー が入る',
    ['【起きたこと】', '【本当はこうなるはず】', '【再現手順（自動記録）】', '【記録の開始時の画面の状態】', '【不具合に気づいた時点の画面の状態】', '【記録の終了時の画面の状態】', '【記録中に出たエラー】'].every(k => form.body.includes(k)), form.body.slice(0, 400));
  ok('下書きに個人情報（お客様名・金額）が入らない', !/山田商事|佐藤太郎|12345/.test(form.body), form.body);
  ok('手順に番号と経過時間が付く', /^1\. \[\d+:\d\d・/m.test(form.body), form.body.slice(0, 600));
  ok('題名に「（再現記録）」が入る', /再現記録/.test(form.title), form.title);
  ok('context に添える要約が用意される', form.ctx && form.ctx.steps > 3 && form.ctx.marks === 1 && form.ctx.errors >= 1, form.ctx);
  ok('本文の先頭に【処理の方法】リアルタイム', /^【処理の方法】⚡ リアルタイム/.test(form.body), form.body.slice(0, 60));
  ok('題名にリアルタイムの印（⚡）', /^⚡/.test(form.title), form.title);
  const ctxBuilt = await p.evaluate(async () => (await window.fbBuildExtra()).context.recording);
  ok('送信時の context.recording に入る（処理の方法も）', ctxBuilt && ctxBuilt.steps === form.ctx.steps && ctxBuilt.mode === 'realtime', ctxBuilt);
  ok('報告フォームに「処理の方法」の切替が出る', (await vis('#fbBrecModeSw')) && await p.evaluate(() => document.querySelector('#fbBrecModeSw [data-mode="realtime"]').getAttribute('aria-pressed') === 'true'));
  await p.click('#fbBrecModeSw [data-mode="batch"]');
  const sw2 = await p.evaluate(async () => ({ body: document.getElementById('fbBody').value, mode: (await window.fbBuildExtra()).context.recording.mode, on: document.querySelector('#fbBrecModeSw [data-mode="batch"]').getAttribute('aria-pressed') }));
  ok('フォームで選び直すと本文と context の両方が変わる', /^【処理の方法】🕐 バッチ/.test(sw2.body) && sw2.mode === 'batch' && sw2.on === 'true', sw2);
  await p.evaluate(() => document.getElementById('fbOverlay').classList.remove('open'));

  // ⑤ 再現記録でない報告には要約を付けない
  await p.evaluate(() => { window.fbOpenQuick(); document.getElementById('fbBody').value = 'ふつうの報告'; });
  const plain = await p.evaluate(async () => (await window.fbBuildExtra()).context.recording);
  ok('ふつうの報告には記録の要約を付けない', plain === undefined, plain);
  ok('ふつうの報告には「処理の方法」の切替を出さない', !(await vis('#fbBrecModeSw')));
  await p.evaluate(() => document.getElementById('fbOverlay').classList.remove('open'));

  // ⑥ 破棄・フォームを開いている間は始めない・❓カードの入口
  await p.evaluate(() => window.bugRecStart());
  ok('関数からも始められる', await p.evaluate(() => window.bugRecActive()));
  await p.click('#fbBrecCancel');
  ok('✕で記録を捨てられる（フォームは開かない）', !(await p.evaluate(() => window.bugRecActive())) && !(await vis('#fbOverlay.open')));
  await p.evaluate(() => window.fbOpenQuick());
  await p.keyboard.press('Control+Shift+L');
  ok('報告フォームを開いている間は始まらない', !(await p.evaluate(() => window.bugRecActive())));
  await p.evaluate(() => document.getElementById('fbOverlay').classList.remove('open'));
  await p.click('#fbQuickFab');
  ok('❓カードに「不具合の再現を記録する」がある', await vis('#fbHelpRec'));
  const rowH = await p.evaluate(() => Math.round(document.getElementById('fbHelpRec').getBoundingClientRect().height));
  ok('その行は押しやすい高さ（44px 以上）', rowH >= 44, rowH);
  await p.click('#fbHelpRec');
  ok('カードの項目で記録が始まる', await p.evaluate(() => window.bugRecActive()));
  await p.click('#fbBrecStop');
  await p.waitForSelector('#fbBrecMode', { timeout: 3000 });
  await p.keyboard.press('Escape');
  await p.waitForSelector('#fbOverlay.open', { timeout: 3000 });
  const esc = await p.evaluate(() => ({ body: document.getElementById('fbBody').value, mode: window.__fbRecCtx && window.__fbRecCtx.mode, title: document.getElementById('fbTitle').value }));
  ok('「止めて報告」ボタンでも選択画面→報告が開く', true);
  ok('選択画面で Esc を押すと記録は消えず、バッチ処理として開く', /^【処理の方法】🕐 バッチ/.test(esc.body) && esc.mode === 'batch' && !/^⚡/.test(esc.title), esc);

  await b.close(); srv.close();
  console.log(fails ? `\n${fails} 件失敗` : '\n全項目 OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
