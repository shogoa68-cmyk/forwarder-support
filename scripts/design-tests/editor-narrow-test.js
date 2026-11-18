/* 見積入力画面の狭い幅での崩れの回帰テスト（3テーマ・旧画面）
 *  ①操作バーの「⋯」のポップアップが画面の左へ切れない（360/600px）
 *  ②「ゾーン構成から見積もり行を生成」の見出しが 1 文字幅に潰れない（360px）
 * 使い方: node scripts/design-tests/editor-narrow-test.js */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = process.cwd();
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
(async () => {
  const s = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } const t = { '.css': 'text/css', '.js': 'text/javascript' }; r.writeHead(200, { 'Content-Type': t[path.extname(f)] || 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  for (const th of ['industry', 'classic', 'quiet']) for (const w of [360, 600]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 } });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    await p.goto(`http://127.0.0.1:${s.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?theme=${th}&editor=v1`, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
    await p.evaluate(() => { document.querySelector('[onclick*="switchCategory(\'quote\'"]').click(); }); await p.waitForTimeout(700);
    await p.evaluate(() => { qpShowEditor(); addRow(); }); await p.waitForTimeout(500);
    const r = await p.evaluate(() => {
      const d = document.querySelector('#cmdbarMore'); d.open = true;
      const x = d.querySelector('.cmdbar-more-pop').getBoundingClientRect();
      const t = document.querySelector('.zone-preset-section-title').getBoundingClientRect();
      return { l: x.left, r: x.right, vw: innerWidth, tw: t.width };
    });
    ok(r.l >= 0 && r.r <= r.vw + 1, `${th} ${w}px ⋯ポップアップが画面内 (${Math.round(r.l)}〜${Math.round(r.r)})`);
    if (w === 360) ok(r.tw > 120, `${th} ${w}px ゾーン生成の見出し幅 ${Math.round(r.tw)}px`);
    await ctx.close();
  }
  await b.close(); s.close(); console.log(fail ? 'FAIL=' + fail : 'ALL OK'); process.exit(fail ? 1 : 0);
})();
