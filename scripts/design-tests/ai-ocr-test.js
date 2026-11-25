// 📷 画像を AI で読む（js/quote/ai-ocr.js）：選択画面の入口・準備中の表示・切り抜き／黒塗り・送る前の確認・結果を確認画面へ流す
// Edge Function「ai-ocr」は偽物（page.route）。実際の AI・Supabase には接続しない。
//   node scripts/design-tests/ai-ocr-test.js     （THEME=1 で Industry・W=390 でスマホ幅）
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
  const W = Number(process.env.W) || 1400;
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, locale: 'ja-JP' });
  await ctx.addInitScript((theme) => { try { localStorage.setItem('fwd.uiMode', 'detail'); localStorage.setItem('forwarderTheme_v1', JSON.stringify(theme ? { site: true, doc: true } : { site: false, doc: false })); } catch (e) {} }, !!process.env.THEME);
  const state = { mode: 'disabled', reqs: [] };
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  await ctx.route('**/functions/v1/ai-ocr', async (r) => {
    const body = JSON.parse(r.request().postData() || '{}');
    state.reqs.push(body);
    const send = (status, j) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(j) });
    if (body.action === 'status') return send(200, { ok: true, ready: state.mode === 'ready', reason: state.mode === 'ready' ? '' : 'disabled', model: 'claude-opus-5-5' });
    if (state.mode === 'readFail') return send(503, { ok: false, error: 'disabled', message: 'AI 読み取りはまだ使えない設定です' });
    return send(200, { ok: true, rows: [
      { name: 'THC', qty: '1', unit: 'CNTR', ccy: 'JPY', price: '34900', amount: '34900', note: '' },
      { name: 'OCEAN FREIGHT', qty: '2', unit: "20'GP", ccy: 'USD', price: '1200', amount: '2400', note: '' },
    ], remarks: ['書類代は別途'], unreadable: ['よめない行'] });
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  p.setDefaultTimeout(10000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(900);
  await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(900);
  const login = (on) => p.evaluate((on) => { window.cloudGetClient = () => ({ auth: { getSession: async () => ({ data: { session: on ? { access_token: 'tok' } : null } }) } }); }, on);

  // 未ログイン
  await login(false);
  await p.evaluate(() => { window.openImportChooser(); }); await p.waitForTimeout(200);
  ok('取り込みの選択画面に「📷 画像を AI で読む」', await p.evaluate(() => !!document.querySelector('#icAiOcr') && /AI で読む/.test(document.querySelector('#icAiOcr').textContent)));
  await p.evaluate(() => window.icChoose('aiocr')); await p.waitForTimeout(400);
  ok('押すと画像の画面が開く（選択画面は閉じる）', await p.evaluate(() => document.getElementById('aoModal').classList.contains('open') && !document.getElementById('importChooser').classList.contains('open')));
  ok('未ログインは「ログインすると使えます」', await p.evaluate(() => /ログインすると/.test(document.getElementById('aoBanner').textContent) && !document.getElementById('aoBanner').hidden));
  ok('未ログインのときはサーバーへ問い合わせない', state.reqs.length === 0, state.reqs);
  await p.evaluate(() => window.aiOcrClose());

  // ログイン中・準備中（使う設定がまだ）
  await login(true);
  await p.evaluate(() => { window.aiOcrOpen(''); }); await p.waitForTimeout(400);
  ok('準備中の案内が出る（切り抜き・黒塗りまでは試せる）', await p.evaluate(() => /準備中/.test(document.getElementById('aoBanner').textContent) && /試せます/.test(document.getElementById('aoBanner').textContent)));
  await p.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 400, 300); x.fillStyle = '#c00'; x.fillRect(0, 0, 400, 300);
    window.aiOcrDebug.setCanvas(c);
  }); await p.waitForTimeout(150);
  ok('画像を入れると加工の画面になる', await p.evaluate(() => !document.getElementById('aoEdit').hidden && document.getElementById('aoPick').hidden));
  const cropped = await p.evaluate(() => { window.aiOcrDebug.applyRect('crop', 50, 40, 200, 100); return window.aiOcrDebug.size(); });
  ok('✂️ 表だけ切り抜く：囲んだ部分だけが残る', JSON.stringify(cropped) === '[200,100]', cropped);
  const blk = await p.evaluate(() => { window.aiOcrDebug.applyRect('black', 0, 0, 60, 40); return [window.aiOcrDebug.pixel(10, 10), window.aiOcrDebug.pixel(150, 80)]; });
  ok('⬛ 黒く塗る：囲んだ所だけ黒くなる', blk[0].slice(0, 3).join() === '0,0,0' && blk[1][0] > 150, blk);
  ok('小さすぎる囲みは無視する', await p.evaluate(() => window.aiOcrDebug.applyRect('black', 0, 0, 3, 3) === false));
  await p.evaluate(() => document.querySelector('#aoModal [data-ao="undo"]').click());
  ok('↩ 戻すで黒塗りを取り消せる', await p.evaluate(() => window.aiOcrDebug.pixel(10, 10)[0] > 150));
  await p.evaluate(() => document.querySelectorAll('#aoModal .ao-ck').forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }));
  ok('準備中は、確認にチェックしても送れない', await p.evaluate(() => document.getElementById('aoSend').disabled));
  await p.evaluate(() => window.aiOcrClose());

  // 使える状態
  state.mode = 'ready';
  await p.evaluate(async () => { await window.aiOcrStatus(true); window.aiOcrOpen(''); }); await p.waitForTimeout(400);
  ok('使えるときは準備中の案内を出さない', await p.evaluate(() => document.getElementById('aoBanner').hidden));
  await p.evaluate(() => { const c = document.createElement('canvas'); c.width = 3000; c.height = 1500; c.getContext('2d').fillRect(0, 0, 10, 10); window.aiOcrDebug.setCanvas(c); });
  ok('送れるのは 3 つの確認にチェックを入れてから', await p.evaluate(() => document.getElementById('aoSend').disabled));
  await p.evaluate(() => document.querySelectorAll('#aoModal .ao-ck').forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }));
  ok('チェックを入れると送れる', await p.evaluate(() => !document.getElementById('aoSend').disabled));
  await p.evaluate(() => window.aiOcrDebug.applyRect('black', 0, 0, 100, 100));
  ok('画像を変えたら、確認のチェックはやり直し', await p.evaluate(() => document.getElementById('aoSend').disabled && [...document.querySelectorAll('#aoModal .ao-ck')].every(c => !c.checked)));
  await p.evaluate(() => document.querySelectorAll('#aoModal .ao-ck').forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }));
  state.mode = 'readFail';
  await p.evaluate(() => document.getElementById('aoSend').click()); await p.waitForTimeout(600);
  ok('読み取りが断られたら、画面は開いたまま', await p.evaluate(() => document.getElementById('aoModal').classList.contains('open')));
  state.mode = 'ready';
  await p.evaluate(async () => { await window.aiOcrStatus(true); });
  await p.evaluate(() => { window.aiOcrDebug.setCanvas((() => { const c = document.createElement('canvas'); c.width = 3000; c.height = 1500; return c; })()); document.querySelectorAll('#aoModal .ao-ck').forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }); });
  state.reqs = [];
  await p.evaluate(() => document.getElementById('aoSend').click()); await p.waitForTimeout(900);
  const sent = state.reqs.find(x => x.action === 'read');
  ok('送るのは JPEG に作り直した画像（形式・base64）', sent && sent.mediaType === 'image/jpeg' && /^\/9j\//.test(sent.image), sent && { t: sent.mediaType, head: String(sent.image).slice(0, 8) });
  const rv = await p.evaluate(() => ({
    open: document.getElementById('emailImportModal').classList.contains('open'),
    text: document.getElementById('eiText').value,
    rows: [...document.querySelectorAll('#eiReviewWrap .ei-table tbody tr')].map(tr => ({ n: tr.querySelector('.ei-name')?.value, c: tr.querySelector('.ei-ccy')?.value, p: tr.querySelector('.ei-price')?.value })),
    ao: document.getElementById('aoModal').classList.contains('open'),
  }));
  ok('結果はいつもの確認画面に流れる（画像の画面は閉じる）', rv.open && !rv.ao, rv);
  ok('明細の表として読める（品名・通貨・単価）', rv.rows.some(r => r.n === 'THC' && r.c === 'JPY' && Number(r.p) === 34900) && rv.rows.some(r => /OCEAN FREIGHT/.test(r.n) && r.c === 'USD' && Number(r.p) === 1200), rv.rows);
  ok('リマークは【リマーク】として渡す', /【リマーク】\n書類代は別途/.test(rv.text), rv.text);
  ok('読みにくい行は文に入れない', !/よめない行/.test(rv.text));
  ok('画面のエラーが出ていない', errs.length === 0, errs);

  // 長辺を 2000px にそろえる（読み込み時）
  const fitted = await p.evaluate(async () => {
    window.aiOcrOpen('');
    const c = document.createElement('canvas'); c.width = 4000; c.height = 1000;
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const f = new File([blob], 'scan.png', { type: 'image/png' });
    const inp = document.getElementById('aoFile'); const dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 600));
    return window.aiOcrDebug.size();
  });
  ok('画像ファイルは長辺 2000px に縮めて読み込む', JSON.stringify(fitted) === '[2000,500]', fitted);
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok('Esc で閉じる', await p.evaluate(() => !document.getElementById('aoModal').classList.contains('open')));

  await b.close(); srv.close();
  const fail = out.filter(l => l.startsWith('FAIL')).length;
  console.log(out.join('\n')); console.log(`\n${out.length - fail} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})();
