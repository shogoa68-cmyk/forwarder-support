// 画面共通部品（ヘッダー・上段ナビ・チーム管理・出力前ガイド・更新バー）の幅ごとの崩れの回帰テスト（debug4-shell）。
//   node scripts/design-tests/shell-width-test.js   （THEMES=industry,classic,quiet を絞れる）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('/opt/node-tools/node_modules/playwright-core'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fail = 0; const ok = (n, c, d) => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const themes = (process.env.THEMES || 'industry,classic,quiet').split(',');
  // コントラスト比（文字色と、不透明になるまで親をたどった背景色）
  const contrastFn = `(sel) => { const el = document.querySelector(sel); if (!el) return null;
    const p = s => { const m = s.match(/rgba?\\(([^)]+)\\)/); const a = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return { r: a[0], g: a[1], b: a[2], a: a.length > 3 ? a[3] : 1 }; };
    const L = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
    let bg = { r: 255, g: 255, b: 255 }; const layers = [];
    for (let e = el; e; e = e.parentElement) { const c = p(getComputedStyle(e).backgroundColor); if (c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
    for (let i = layers.length - 1; i >= 0; i--) { const c = layers[i]; bg = { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a) }; }
    const fg = p(getComputedStyle(el).color); const a = L(fg), z = L(bg); return (Math.max(a, z) + .05) / (Math.min(a, z) + .05); }`;
  for (const th of themes) {
    const open = async (w, tab) => {
      const ctx = await b.newContext({ viewport: { width: w, height: 900 }, locale: 'ja-JP' });
      await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
      const p = await ctx.newPage(); p.setDefaultTimeout(15000);
      await p.goto(base + '?theme=' + th, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(900);
      await p.evaluate(t => { const x = document.querySelector(`[onclick*="switchCategory('${t}'"]`); if (x) x.click(); else window.switchCategory(t); }, tab);
      await p.waitForTimeout(600);
      return { ctx, p };
    };
    // 1) ☰ メニュー：どの幅でもパネルが画面の中に収まり、ヘッダーは ☰ とログインのためだけの行を空けない
    for (const w of [360, 600, 700, 900, 1100, 1440]) {
      const { ctx, p } = await open(w, 'docs');
      await p.click('#hdrMenuBtn'); await p.waitForTimeout(200);
      const r = await p.evaluate(() => { const e = document.getElementById('hdrMenuPanel').getBoundingClientRect(); const h = document.querySelector('.header').getBoundingClientRect(); const m = document.getElementById('hdrMenuBtn').getBoundingClientRect(); const t = document.querySelector('.header h1').getBoundingClientRect(); return { l: e.left, rt: e.right, vw: innerWidth, hh: h.height, mTop: m.top, tBottom: t.bottom }; });
      ok(`[${th} ${w}] ☰ パネルが画面内`, r.l >= 0 && r.rt <= r.vw + 1, r);
      if (w > 600) ok(`[${th} ${w}] ☰ はタイトルの行に並ぶ（別の行を空けない）`, r.mTop < r.tBottom + 30, r);
      await ctx.close();
    }
    // 2) 「その他」の中のタブを選んだ状態で、681〜800px でも上段ナビがページを横に伸ばさない
    for (const w of [681, 700, 720, 760, 800]) {
      const { ctx, p } = await open(w, 'docs');
      const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, vw: document.documentElement.clientWidth }));
      ok(`[${th} ${w}] 横スクロールが出ない`, r.sw <= r.vw, r);
      await ctx.close();
    }
    // 3) チーム管理（360px）：検索欄とロール絞り込みがモーダルの右端で切れない
    for (const w of [360, 600]) {
      const { ctx, p } = await open(w, 'docs');
      await p.evaluate(() => { try { openUserMgr(); } catch (e) {} }); await p.waitForTimeout(600);
      const r = await p.evaluate(() => { const m = document.getElementById('umModal').getBoundingClientRect(); const f = document.getElementById('umRoleFilter').getBoundingClientRect(); const s = document.getElementById('umSearch').getBoundingClientRect(); return { mr: m.right, fr: f.right, sr: s.right }; });
      ok(`[${th} ${w}] チーム管理の絞り込みが枠内`, r.fr <= r.mr && r.sr <= r.mr, r);
      await ctx.close();
    }
    // 4) 出力前の確認ガイド「次の箇所へ」：文字が読める（4.5:1 以上）
    {
      const { ctx, p } = await open(1100, 'quote');
      await p.evaluate(() => { window.qpShowEditor && qpShowEditor(); for (let i = 0; i < 2; i++) addRow(); openPreview(); }); await p.waitForTimeout(900);
      const c = await p.evaluate(`(${contrastFn})('#pvWarnGuideNextBtn')`);
      ok(`[${th}] 確認ガイドの「次の箇所へ」のコントラスト（${c && c.toFixed(1)}）`, c !== null && c >= 4.5, c);
      const c2 = await p.evaluate(`(${contrastFn})('.pv-wg-close')`);
      ok(`[${th}] 確認ガイドの ✕ のコントラスト（${c2 && c2.toFixed(1)}）`, c2 !== null && c2 >= 4.5, c2);
      await ctx.close();
    }
    // 5) 更新バーの「更新する」
    {
      const { ctx, p } = await open(1100, 'docs');
      await p.evaluate(() => { const u = document.createElement('div'); u.id = 'updBar'; u.className = 'upd-bar'; u.innerHTML = '<div class="upd-btns"><button class="upd-go">更新する</button></div>'; document.body.appendChild(u); });
      const c = await p.evaluate(`(${contrastFn})('.upd-go')`);
      ok(`[${th}] 更新バーの「更新する」のコントラスト（${c && c.toFixed(1)}）`, c >= 4.5, c);
      await ctx.close();
    }
  }
  await b.close(); srv.close();
  console.log(fail ? `\nFAIL=${fail}` : '\n全部 PASS');
  process.exit(fail ? 1 : 0);
})();
