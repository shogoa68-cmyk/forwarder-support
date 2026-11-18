// 見積入力の既定は新画面（選んだ人の選択は優先）。  node scripts/design-tests/editor-default-test.js
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  async function cls({ webdriver, store, query = '' }) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.addInitScript(({ webdriver, store }) => { if (!webdriver) Object.defineProperty(navigator, 'webdriver', { get: () => false }); try { localStorage.setItem('fbFabHintDone_v1', '1'); if (store != null) localStorage.setItem('fwd.editorV2', store); } catch (e) {} }, { webdriver, store });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    const p = await ctx.newPage(); await p.goto(BASE + query); await p.waitForTimeout(400);
    const on = await p.evaluate(() => document.documentElement.classList.contains('editor-v2')); await ctx.close(); return on;
  }
  ok('選択を保存していない人（ふつうのブラウザ）は新画面', (await cls({ webdriver: false, store: null })) === true);
  ok('旧画面を選んだ人（保存値 0）は旧画面のまま', (await cls({ webdriver: false, store: '0' })) === false);
  ok('新画面を選んだ人（保存値 1）は新画面', (await cls({ webdriver: false, store: '1' })) === true);
  ok('?editor=v1 で旧画面へ戻せる', (await cls({ webdriver: false, store: null, query: '?editor=v1' })) === false);
  ok('?editor=v2 で新画面', (await cls({ webdriver: false, store: '0', query: '?editor=v2' })) === true);
  ok('自動テスト（webdriver）は従来どおり旧画面が既定', (await cls({ webdriver: true, store: null })) === false);
  await b.close(); srv.close(); console.log(fails ? `\nFAIL=${fails}` : '\nALL PASS'); process.exit(fails ? 1 : 0);
})();
