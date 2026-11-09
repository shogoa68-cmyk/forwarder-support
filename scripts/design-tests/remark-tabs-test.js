// 全体リマークのタブ化（Design 回答 2026-11・案1）の試験。  node scripts/design-tests/remark-tabs-test.js （OUT=<dir>, MODE=simple, THEME=1）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const out = []; const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
  await ctx.addInitScript((mode) => { try { localStorage.setItem('fwd.uiMode', mode); } catch (e) {} }, process.env.MODE || 'detail');
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(700);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
  await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(600);
  await p.evaluate(() => { const s = document.getElementById('section-remark'); s.classList.remove('collapsed'); s.scrollIntoView(); }); await p.waitForTimeout(300);
  const vis = s => p.evaluate(x => { const e = document.querySelector(x); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, s);
  const tabs = await p.$$eval('#remarkTabs .rm-tab', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  ok('タブ：定型文／区切り線／チーム共有／個人（品物別・人気は区分を選ぶ／該当があるときだけ…）', tabs[0].startsWith('定型文') && tabs.some(t => t.startsWith('区切り線')) && tabs.some(t => t.startsWith('個人')), tabs);
  ok('既定は「定型文」タブ：定型文が見え、区切り線は見えない', await vis('#presetBtns .preset-btn:not(.preset-btn-divider):not(.preset-btn-add)') && !(await vis('#presetBtns .preset-btn-divider')));
  ok('定型文の件数がタブに出る', /定型文 \d+/.test(tabs[0]) && parseInt(tabs[0].replace(/\D/g, ''), 10) >= 10, tabs[0]);
  await p.click('#remarkTabs .rm-tab[data-rt="line"]'); ok('区切り線タブ：区切り線だけ見える', await vis('#presetBtns .preset-btn-divider') && !(await vis('#presetBtns .preset-btn:not(.preset-btn-divider):not(.preset-btn-add)')));
  await p.click('#remarkTabs .rm-tab[data-rt="personal"]'); ok('個人タブ：「＋ 個人に追加」が見える', await vis('#presetBtns .preset-btn-add'));
  await p.click('#remarkTabs .rm-tab[data-rt="preset"]');
  await p.click('#presetBtns .preset-btn:not(.preset-btn-divider):not(.preset-btn-add)'); await p.waitForTimeout(150);
  ok('定型文を押すと文章欄に入る', (await p.evaluate(() => document.getElementById('remarkTextarea').value)).length > 5);
  ok('押した定型文は点灯', await p.evaluate(() => !!document.querySelector('#presetBtns .preset-btn.active')));
  await p.click('#remarkTabs .rm-tab[data-rt="line"]'); await p.click('#remarkTabs .rm-tab[data-rt="preset"]');
  ok('タブを切り替えても点灯が残る', await p.evaluate(() => !!document.querySelector('#presetBtns .preset-btn.active')));
  // 品物別
  await p.selectOption('#remarkCargoSel', { index: 1 }); await p.waitForTimeout(400);
  ok('品物別の区分を選ぶと「品物別」タブが出て、そこが開く', await vis('#remarkTabs .rm-tab[data-rt="cargo"].is-on'));
  await p.selectOption('#remarkCargoSel', { index: 0 }); await p.waitForTimeout(400);
  ok('区分を外すと「品物別」タブは消え、定型文に戻る', !(await vis('#remarkTabs .rm-tab[data-rt="cargo"]')) && await vis('#remarkTabs .rm-tab[data-rt="preset"].is-on'));
  await p.click('.btn-remark-clear'); await p.waitForTimeout(150);
  ok('クリアで点灯が消える', !(await p.evaluate(() => !!document.querySelector('#presetBtns .preset-btn.active'))));
  ok('JS エラーなし', errs.length === 0, errs);
  if (process.env.OUT) { await p.evaluate(() => document.getElementById('section-remark').scrollIntoView()); await p.screenshot({ path: path.join(process.env.OUT, 'remark-tabs.png') }); }
  console.log(out.join('\n')); console.log(out.some(l => l.startsWith('FAIL')) ? 'NG' : 'OK');
  await b.close(); srv.close(); process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
