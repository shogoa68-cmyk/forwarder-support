// パレタイズ計算：段の敷き詰めを複数のやり方で試し（互い違いの配置を含む）、少ないパレット数を採用／最大重量を超えないよう分ける。
//   node scripts/design-tests/pallet-test.js
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

  // 1) 1 段（高さ＝箱 1 つ分）に敷ける数：従来のギロチンだけ vs 新しいやり方
  const one = await p.evaluate(() => {
    const cases = [[458, 268, 1200, 800], [440, 376, 1200, 1000], [419, 298, 1200, 800], [476, 369, 1219, 1016], [638, 135, 1100, 1100], [428, 220, 1100, 1100]];
    return cases.map(([l, w, pw, pd]) => {
      const cargo = [{ bl: l, bw: w, bh: 200, qty: 100, weight: 5 }];
      const o = window._packPalletsLayered(cargo, pw, pd, 200, undefined, { legacy: true });
      const n = window._packPalletsLayered(cargo, pw, pd, 200);
      return { l, w, pw, pd, old: o.bins[0].placed.length, now: n.bins[0].placed.length };
    });
  });
  ok('1 段に敷ける数：従来より少なくなる例は無い', one.every(x => x.now >= x.old), one);
  ok('458×268 を 1200×800 に敷くと、1 段 4 個 → 6 個になる', one[0].old === 4 && one[0].now === 6, one[0]);
  ok('440×376（1200×1000）・419×298（1200×800）・476×369（1219×1016）も 4 → 6 個', [1, 2, 3].every(i => one[i].old === 4 && one[i].now === 6), one);
  ok('638×135（1100×1100）・428×220（1100×1100）も増える', one[4].now > one[4].old && one[5].now > one[5].old, one);

  // 2) 乱数の貨物：パレット数が従来より増えず、配置は妥当（パレット内・高さ内・重なりなし・重量内）
  const rg = await p.evaluate(() => {
    let seed = 2024; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const ri = (a, b) => Math.floor(a + rnd() * (b - a + 1));
    const pallets = [[1100, 1100], [1200, 1000], [1200, 800], [1219, 1016]];
    let binsOld = 0, binsNew = 0, worse = 0, better = 0, bad = 0, wbad = 0;
    for (let t = 0; t < 80; t++) {
      const cargo = []; for (let i = 0, k = ri(1, 3); i < k; i++) cargo.push({ bl: ri(180, 650), bw: ri(120, 450), bh: ri(100, 450), qty: ri(10, 120), weight: ri(2, 25), rowNoStack: rnd() < 0.1 });
      const [pw, pd] = pallets[t % 4], maxH = ri(1000, 1800), maxWeight = t % 3 === 0 ? ri(300, 900) : 0;
      const o = window._packPalletsLayered(cargo, pw, pd, maxH, undefined, { legacy: true, maxWeight });
      const n = window._packPalletsLayered(cargo, pw, pd, maxH, undefined, { maxWeight });
      const L = r => Object.values(r.leftoverByOrig).reduce((a, c) => a + c, 0);
      binsOld += o.bins.length; binsNew += n.bins.length;
      if (L(n) > L(o) || (L(n) === L(o) && n.bins.length > o.bins.length)) worse++; else if (n.bins.length < o.bins.length || L(n) < L(o)) better++;
      for (const bin of n.bins) {
        let w = 0;
        for (const q of bin.placed) { w += cargo[q.typeIndex].weight; if (q.x < -1e-6 || q.y < -1e-6 || q.x + q.w > pw + 1e-6 || q.y + q.d > pd + 1e-6 || q.z + q.h > maxH + 1e-6) bad++; }
        if (maxWeight > 0 && w > maxWeight + 1e-6) wbad++;
        for (let i = 0; i < bin.placed.length; i++) for (let j = i + 1; j < bin.placed.length; j++) {
          const a = bin.placed[i], c = bin.placed[j];
          if (a.x < c.x + c.w - 1e-6 && a.x + a.w > c.x + 1e-6 && a.y < c.y + c.d - 1e-6 && a.y + a.d > c.y + 1e-6 && a.z < c.z + c.h - 1e-6 && a.z + a.h > c.z + 1e-6) bad++;
        }
      }
    }
    return { binsOld, binsNew, worse, better, bad, wbad };
  });
  ok('乱数 80 件：従来より悪くなる例は 0（良くなる例あり・合計パレット数が減る）', rg.worse === 0 && rg.better > 0 && rg.binsNew < rg.binsOld, rg);
  ok('乱数 80 件：パレットからのはみ出し・高さ超過・箱の重なりは 0', rg.bad === 0, rg);
  ok('乱数 80 件：最大重量を指定した件では、どのパレットも重量内', rg.wbad === 0, rg);

  // 3) 最大重量：超えないようにパレットを分ける
  const wt = await p.evaluate(() => {
    const cargo = [{ bl: 300, bw: 200, bh: 200, qty: 30, weight: 20 }];
    const free = window._packPalletsLayered(cargo, 1200, 1000, 1000);
    const lim = window._packPalletsLayered(cargo, 1200, 1000, 1000, undefined, { maxWeight: 100 });
    const heavy = window._packPalletsLayered([{ bl: 300, bw: 200, bh: 200, qty: 3, weight: 150 }], 1200, 1000, 1000, undefined, { maxWeight: 100 });
    return {
      freeBins: free.bins.length, limBins: lim.bins.length, limWeights: lim.bins.map(x => x.binWeight), limPlaced: lim.bins.reduce((s, x) => s + x.placed.length, 0),
      heavyBins: heavy.bins.length, heavyLeft: heavy.leftoverByOrig[0] || 0,
    };
  });
  ok('最大重量なし：30 個（20kg）は 1 パレットに入る', wt.freeBins === 1, wt);
  ok('最大重量 100kg：どのパレットも 100kg 以内に分かれ、30 個すべて配置される', wt.limBins >= 6 && wt.limWeights.every(w => w <= 100) && wt.limPlaced === 30, wt);
  ok('1 個が最大重量を超える箱は配置されず積み残しになる', wt.heavyBins === 0 && wt.heavyLeft === 3, wt);

  // 4) 画面：計算タブのパレタイズ
  const fill = async (size, maxH, maxW, rows) => {
    await p.evaluate(({ size, maxH, maxW, rows }) => {
      document.getElementById('pal-size').value = size;
      document.getElementById('pal-max-height').value = maxH;
      document.getElementById('pal-max-weight').value = maxW;
      const wrap = document.getElementById('pal-rows-wrap');
      while (wrap.querySelectorAll('.calc-multi-row').length < rows.length) window.addCalcRow('pal');
      wrap.querySelectorAll('.calc-multi-row').forEach((el, i) => {
        const r = rows[i]; [['l', r[0]], ['w', r[1]], ['h', r[2]], ['weight', r[3]], ['total', r[4]]].forEach(([k, v]) => { el.querySelector('[data-key="' + k + '"]').value = v; });
      });
      document.getElementById('pal-unit').value = 'mm';
      window.clearCalcResult && window.clearCalcResult('pal-result');
      window.calcPalletize();
    }, { size, maxH, maxW, rows });
    await p.waitForTimeout(1200);
    return p.evaluate(() => document.getElementById('pal-result').textContent.replace(/\s+/g, ' '));
  };
  const hasSize = await p.evaluate(() => !!document.querySelector('#pal-size option[value="1200x800"]'));
  let txt = await fill('1200x800', 200, '', [[458, 268, 200, 5, 12]]);
  ok('画面：458×268 を 12 個（高さ上限は 1 段）→ 1 パレット 6 個で 2 パレット（従来は 1 パレット 4 個で 3 パレット）', hasSize && /合計必要パレット数\s*2 パレット/.test(txt), txt.slice(0, 400));
  ok('画面：注意書きに「複数のやり方を試して」「互い違い」の説明が出る', /複数のやり方を試して/.test(txt) && /互い違い/.test(txt), txt.slice(-300));
  txt = await fill('1200x1000', 1000, 100, [[300, 200, 200, 20, 30]]);
  ok('画面：最大重量 100kg を指定すると、重量内に分かれ、注意書きに重量の説明が出る', /1パレットの重量が 100kg 以内/.test(txt) && !/重量超過/.test(txt), txt.slice(-400));
  const nPal = (txt.match(/合計必要パレット数\s*(\d+)/) || [])[1];
  ok('画面：30 個×20kg を 100kg 以内に分けると 6 パレット以上', Number(nPal) >= 6, nPal);
  txt = await fill('1200x1000', 1000, 100, [[300, 200, 200, 150, 3]]);
  const toast = await p.evaluate(() => [...document.querySelectorAll('#toast-container *')].map(e => e.textContent).join(' '));
  ok('画面：1 個が最大重量を超えるとき、重量が原因だと分かる注意が出る（結果は出さない）', txt === '' && /1個の重量がパレットの最大積載重量を超えている/.test(toast), { txt, toast });

  ok('JS エラーなし', errs.length === 0, errs);
  await ctx.close(); await b.close(); srv.close();
  const fails = out.filter(l => l.startsWith('FAIL')).length;
  console.log('\nFAIL=' + fails);
  process.exit(fails ? 1 : 0);
})();
