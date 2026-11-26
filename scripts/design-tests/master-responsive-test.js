// マスター管理の幅ごとの崩れ（コントラスト・ボタンの折り返し）の確認。偽の Supabase は master-responsive-init.js。
//   node scripts/design-tests/master-responsive-test.js            （Industry）
//   THEME=classic node scripts/design-tests/master-responsive-test.js
//   THEME=quiet   node scripts/design-tests/master-responsive-test.js
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
  const THEME = process.env.THEME || 'industry';
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?theme=${THEME}`;
  const init = fs.readFileSync(path.join(__dirname, 'master-responsive-init.js'), 'utf8');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let pass = 0, fail = 0; const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log('FAIL', n, JSON.stringify(d)); } };
  const open = async w => {
    const ctx = await b.newContext({ viewport: { width: w, height: 900 }, locale: 'ja-JP' });
    await ctx.addInitScript(init);
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(900);
    await p.evaluate(async () => { switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); await new Promise(r => setTimeout(r, 800)); if (window.statsLoadMasterCache) await window.statsLoadMasterCache(); window.statsSetPane('master'); await new Promise(r => setTimeout(r, 600)); window.statsMasterSetFilter('customer'); await new Promise(r => setTimeout(r, 800)); });
    return { ctx, p };
  };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const ratio = (a, b2) => { const x = lum(a), y = lum(b2); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  // 1) 件数バッジ（チップの中）のコントラスト：選択中・未選択
  {
    const { ctx, p } = await open(1100);
    const r = await p.evaluate(() => {
      const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
      const out = [];
      for (const sel of ['.master-filter-chip.is-active .master-filter-count', '.master-filter-chip:not(.is-active) .master-filter-count']) {
        const e = document.querySelector('#statsPane-master ' + sel); if (!e) { out.push(null); continue; }
        const cs = getComputedStyle(e), chip = e.closest('.master-filter-chip'), cc = getComputedStyle(chip);
        out.push({ fg: rgb(cs.color), badge: rgb(cs.backgroundColor), chip: rgb(cc.backgroundColor) });
      }
      return out;
    });
    const comp = (top, bot) => { const a = top[3] === undefined ? 1 : top[3]; return [0, 1, 2].map(i => top[i] * a + bot[i] * (1 - a)); };
    r.forEach((x, i) => { if (!x) { ok('件数バッジがある ' + i, false, x); return; } const bg = comp(x.badge, comp(x.chip, [255, 255, 255])); ok('件数バッジのコントラスト 4.5 以上 ' + (i ? '未選択' : '選択中'), ratio(x.fg, bg) >= 4.5, ratio(x.fg, bg)); });
    // 「＋ 別名」ボタン
    const k = await p.evaluate(() => { const e = document.querySelector('.stats-master-abbrev-add'); if (!e) return null; const rgb = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number); let bg = null; for (let n = e; n && !bg; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; const m = rgb(c); if (c.indexOf('rgba') < 0 || /, 1\)/.test(c)) bg = m; } return { fg: rgb(getComputedStyle(e).color), bg: bg || [255, 255, 255] }; });
    ok('「＋ 別名」のコントラスト 4.5 以上', k && ratio(k.fg, k.bg) >= 4.5, k && ratio(k.fg, k.bg));
    await ctx.close();
  }
  // 2) 詳細（スマホ幅）：保存ボタンが縦に潰れない
  for (const w of [360, 600]) {
    const { ctx, p } = await open(w);
    await p.evaluate(async () => { window.statsToggleMasterDetail('customer', 'お客様1商事株式会社'); await new Promise(r => setTimeout(r, 800)); });
    const r = await p.evaluate(() => { const b = document.querySelector('#mdDetailModal .master-detail-save'); if (!b) return null; const q = b.getBoundingClientRect(); return { w: q.width, h: q.height }; });
    ok('[' + w + '] 保存ボタンが 1 行（高さ 60px 以下・幅 70px 以上）', r && r.h <= 60 && r.w >= 70, r);
    await ctx.close();
  }
  // 名前の整理（お客様）：スマホ幅で表が横に伸びて「操作」が画面の外へ出ていた → カードに並べ替える
  for (const w of [360, 390, 600]) {
    const { ctx, p } = await open(w);
    await p.evaluate(async () => {
      const rows = []; for (let i = 1; i <= 12; i++) rows.push({ id: i, name: 'c' + i, status: '受注', customer: ['東京商事株式会社', '東京商事(株)', 'ＡＢＣ物流'][i % 3], data: { rows: [], fields: {} }, updated_at: new Date().toISOString(), created_by: 's@example.com' });
      window.cloudGetAllRows = () => rows;
      if (window.statsRefresh) await window.statsRefresh();
      if (window.mmShow) window.mmShow('fix'); else if (window.masterSetPane) window.masterSetPane('fix');
      if (window.fixSetKind) window.fixSetKind('customer');
      await new Promise(r => setTimeout(r, 800));
    });
    const r = await p.evaluate(() => {
      const pane = document.getElementById('statsPane-customer'); if (!pane) return null;
      const bad = [...pane.querySelectorAll('button')].filter(x => { const q = x.getBoundingClientRect(); return q.width > 0 && q.right > innerWidth + 1; }).length;
      return { over: document.documentElement.scrollWidth - innerWidth, bad };
    });
    ok('[' + w + '] 名前の整理（お客様）：横にはみ出さず、ボタンが画面内', r && r.over <= 1 && r.bad === 0, r);
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log(`${THEME}: PASS ${pass} / FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
