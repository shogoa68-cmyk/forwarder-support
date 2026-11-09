// バンニング計算：積み付けの並び替え（best-of）で積める数が増え、「N 本必要」が 3D の結果とそろう。
//   node scripts/design-tests/vanning-test.js
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
  const ok = (n, c, d) => { const line = (c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)); out.push(line); console.log(line); };
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.setDefaultTimeout(10000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
  await p.evaluate(() => { const t = document.querySelector('.cat-btn[aria-controls="tab-calc"]'); t && t.click(); }); await p.waitForTimeout(600);

  // 1) packContainer 単体：ユーザー提示の例（800角 24 カートン＋500角のカートン）
  const pk = await p.evaluate(() => {
    const rows = [{ bl: 86, bw: 86, bh: 42, qty: 24 }, { bl: 97, bw: 52, bh: 54, qty: 55 }];
    const std = window.Vanning3D.packContainer(rows, { l: 589, w: 235, h: 239 });
    const cosco = window.Vanning3D.packContainer(rows, { l: 589, w: 234, h: 228 });
    const old = window.Vanning3D.packContainer(rows, { l: 589, w: 235, h: 239 }, { singleStrategy: true });
    const more = window.Vanning3D.packContainer([rows[0], { bl: 97, bw: 52, bh: 54, qty: 90 }], { l: 589, w: 235, h: 239 });
    const cmore = window.Vanning3D.packContainer([rows[0], { bl: 97, bw: 52, bh: 54, qty: 90 }], { l: 589, w: 234, h: 228 });
    return { std: std.totalPlaced, cosco: cosco.totalPlaced, old: old.totalPlaced, moreB: more.placed.filter(x => x.typeIndex === 1).length, coscoB: cmore.placed.filter(x => x.typeIndex === 1).length };
  });
  ok('従来のやり方（先頭の並びだけ）では 79 個のうち入りきらない（比較用）', pk.old < 79, pk);
  ok('標準の 20ft Dry：800角 24 ＋ 500角 55 がすべて入る（79 個）', pk.std === 79, pk);
  ok('COSCO 内寸（5.89×2.34×2.28）でも 79 個すべて入る', pk.cosco === 79, pk);
  ok('800角 24 のあとに積める 500角は、COSCO 内寸で 55 個以上', pk.coscoB >= 55, pk);

  // 2) 乱数の貨物で、従来より少なくならず・重なり／はみ出しが無い
  const rg = await p.evaluate(() => {
    let seed = 777; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const ri = (a, b) => Math.floor(a + rnd() * (b - a + 1));
    const conts = [{ l: 589, w: 235, h: 239 }, { l: 1203, w: 235, h: 239 }, { l: 1203, w: 235, h: 269 }];
    let worse = 0, better = 0, bad = 0;
    for (let n = 0; n < 60; n++) {
      const rows = []; for (let i = 0, k = ri(1, 3); i < k; i++) rows.push({ bl: ri(30, 150), bw: ri(30, 110), bh: ri(20, 100), qty: ri(3, 60) });
      const c = conts[n % 3];
      const a = window.Vanning3D.packContainer(rows, c, { singleStrategy: true }), r = window.Vanning3D.packContainer(rows, c);
      if (r.totalPlaced < a.totalPlaced) worse++; else if (r.totalPlaced > a.totalPlaced) better++;
      for (const x of r.placed) if (x.x + x.w > c.l + 1e-6 || x.y + x.d > c.w + 1e-6 || x.z + x.h > c.h + 1e-6) bad++;
      for (let i = 0; i < r.placed.length; i++) for (let j = i + 1; j < r.placed.length; j++) {
        const p1 = r.placed[i], q = r.placed[j];
        if (p1.x < q.x + q.w - 1e-6 && p1.x + p1.w > q.x + 1e-6 && p1.y < q.y + q.d - 1e-6 && p1.y + p1.d > q.y + 1e-6 && p1.z < q.z + q.h - 1e-6 && p1.z + p1.h > q.z + 1e-6) bad++;
      }
    }
    return { worse, better, bad };
  });
  ok('乱数 60 件：従来より少なくなる例は 0（多くなる例あり）', rg.worse === 0 && rg.better > 0, rg);
  ok('乱数 60 件：箱の重なり・コンテナからのはみ出しは 0', rg.bad === 0, rg);

  // 3) 画面（複数品種）：入った場合
  const fill = async rows => {
    await p.evaluate(rows => {
      const wrap = document.getElementById('van-rows-wrap');
      while (wrap.querySelectorAll('.calc-multi-row').length < rows.length) window.addCalcRow('van');
      wrap.querySelectorAll('.calc-multi-row').forEach((el, i) => {
        const r = rows[i]; [['l', r[0]], ['w', r[1]], ['h', r[2]], ['weight', r[3]], ['qty', r[4]]].forEach(([k, v]) => { el.querySelector('[data-key="' + k + '"]').value = v; });
      });
      document.getElementById('van-unit').value = 'cm';
      window.clearCalcResult && window.clearCalcResult('van-result');
      window.calcVanning();
    }, rows);
    await p.waitForTimeout(1200);
  };
  await fill([[86, 86, 42, 50, 24], [97, 52, 54, 50, 55]]);
  let res = await p.evaluate(() => { const r = document.getElementById('van-result'); const rec = r.querySelector('.calc-item.hl'); return { rec: rec ? rec.textContent.replace(/\s+/g, ' ') : null, text: r.textContent.replace(/\s+/g, ' ') }; });
  ok('画面：20ft Dry が推奨で「1 本必要」', res.rec && /20ft Dry/.test(res.rec) && /1 本必要/.test(res.rec), res.rec);
  ok('画面：3D との食い違いの注意は出ない', !/3D 積み付けで検証すると/.test(res.text) && !/3D積み付け\s*\d+ 本/.test(res.text), res.text.slice(0, 400));

  // 4) 画面：CBM 上は 1 本でも 3D では収まらない例 → 本数を 3D にそろえ、収まるコンテナへ推奨を切り替える
  await p.evaluate(() => { document.getElementById('van-result').innerHTML = ''; });
  await p.evaluate(() => { const w = document.getElementById('van-rows-wrap'); while (w.querySelectorAll('.calc-multi-row').length > 1) w.querySelector('.calc-multi-row:last-child .btn-row-del').click(); });
  await fill([[103, 105, 103, 20, 12], [86, 83, 81, 20, 13]]);
  res = await p.evaluate(() => { const r = document.getElementById('van-result'); const cards = [...r.querySelectorAll('.calc-item')].map(c => c.textContent.replace(/\s+/g, ' ')); return { cards, rec: (r.querySelector('.calc-item.hl') || {}).textContent, text: r.textContent.replace(/\s+/g, ' ') }; });
  const c20 = (res.cards.find(t => /^20ft Dry/.test(t.trim())) || '');
  ok('画面：20ft Dry は 3D 検証の本数（2 本）を表示し、CBM 上の目安（1 本）も併記', /2 本必要/.test(c20) && /3D積み付け 2 本（CBM上の目安は 1 本）/.test(c20), c20);
  ok('画面：推奨は 3D で 1 本に収まるコンテナ（40ft）に切り替わる', res.rec && /40ft/.test(res.rec) && /1 本必要/.test(res.rec), res.rec);
  ok('画面：切り替えの理由の注意文が出る', /3D 積み付けで検証すると/.test(res.text), res.text.slice(0, 500));

  ok('JS エラーなし', errs.length === 0, errs);
  await ctx.close(); await b.close(); srv.close();
  const fails = out.filter(l => l.startsWith('FAIL')).length;
  console.log('\nFAIL=' + fails);
  process.exit(fails ? 1 : 0);
})();
