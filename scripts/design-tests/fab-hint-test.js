// 🐞 常駐ボタンの「気づいてもらう合図」（吹き出し＋波紋）：初回表示・押すと終了・✕・回数上限・自動で消える・
//   ボタンとの位置関係・スマホ幅・動きを減らす設定・入力中は出さない。
//   node scripts/design-tests/fab-hint-test.js           （THEME=1 で Industry）
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

  async function open({ w = 1400, h = 900, mobile = false, reduce = false, store = {} } = {}) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'ja-JP', isMobile: mobile, hasTouch: mobile, reducedMotion: reduce ? 'reduce' : 'no-preference' });
    await ctx.addInitScript(({ theme, store }) => {
      try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
      if (theme) try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {}
      for (const k in store) try { localStorage.setItem(k, store[k]); } catch (e) {}
    }, { theme: !!process.env.THEME, store });
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#fbQuickFab', { state: 'attached' });
    return { ctx, p };
  }
  const hintInfo = p => p.evaluate(() => {
    const h = document.getElementById('fbFabHint'), f = document.getElementById('fbQuickFab');
    if (!h) return { shown: false, pulse: f.classList.contains('fb-hint-pulse') };
    const a = h.getBoundingClientRect(), r = f.getBoundingClientRect();
    return { shown: true, pulse: f.classList.contains('fb-hint-pulse'), left: a.left >= 0, top: a.top >= 0, right: a.right, fabLeft: r.left,
      gapOk: r.left - a.right > 0 && r.left - a.right < 30, vOverlap: a.bottom > r.top && a.top < r.bottom, text: h.textContent,
      overflowX: document.documentElement.scrollWidth > innerWidth, btnH: Math.round(h.querySelector('.fbh-main').getBoundingClientRect().height),
      anim: getComputedStyle(f, '::before').animationName };
  });
  const store = p => p.evaluate(() => ({ done: localStorage.getItem('fbFabHintDone_v1'), n: localStorage.getItem('fbFabHintN_v1') }));

  // 1) 初回：4 秒後に出る（呼び出し前は出ていない）
  {
    const { ctx, p } = await open();
    ok('開いてすぐは出ていない', !(await hintInfo(p)).shown);
    await p.waitForSelector('#fbFabHint', { timeout: 8000 });
    const i = await hintInfo(p);
    ok('4 秒ほどで吹き出しが出る', i.shown);
    ok('文言（不具合・ご意見）', /不具合・ご意見/.test(i.text) && /写真・録画/.test(i.text), i.text);
    ok('ボタンに波紋の動き', i.pulse && i.anim === 'fbFabRing', i);
    ok('🐞 のすぐ左・同じ高さに出る', i.gapOk && i.vOverlap && i.left && i.top, i);
    ok('横にはみ出さない', !i.overflowX, i);
    ok('タップしやすい高さ（44px 以上）', i.btnH >= 44, i);
    ok('表示回数を 1 と記録', (await store(p)).n === '1', await store(p));
    // 吹き出しを押す → 報告フォームが開き、以後は出さない
    await p.click('#fbFabHint .fbh-main');
    await p.waitForSelector('#fbOverlay.open', { timeout: 3000 });
    const j = await hintInfo(p);
    ok('押すと吹き出しと波紋が消える', !j.shown && !j.pulse, j);
    ok('「気づいた」として記録', (await store(p)).done === '1', await store(p));
    await ctx.close();
  }

  // 2) ✕ で閉じる → 以後は出ない（再読み込みしても）
  {
    const { ctx, p } = await open();
    await p.waitForSelector('#fbFabHint', { timeout: 8000 });
    await p.click('#fbFabHint .fbh-x');
    ok('✕ で消える', !(await hintInfo(p)).shown);
    ok('フォームは開かない', await p.evaluate(() => !document.getElementById('fbOverlay').classList.contains('open')));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5200);
    ok('再読み込みしても出ない', !(await hintInfo(p)).shown);
    await ctx.close();
  }

  // 3) 🐞 を直接押した → 気づいたとして以後は出ない
  {
    const { ctx, p } = await open();
    await p.waitForSelector('#fbFabHint', { timeout: 8000 });
    await p.click('#fbQuickFab');
    await p.waitForSelector('#fbOverlay.open', { timeout: 3000 });
    const i = await hintInfo(p);
    ok('🐞 を押すと合図が終わる', !i.shown && !i.pulse && (await store(p)).done === '1', i);
    await ctx.close();
  }

  // 4) Esc でしまう（記録は残さない＝次回また出る）／回数の上限 3
  {
    const { ctx, p } = await open();
    await p.waitForSelector('#fbFabHint', { timeout: 8000 });
    await p.keyboard.press('Escape');
    const i = await hintInfo(p), s = await store(p);
    ok('Esc でしまえる（気づいた扱いにはしない）', !i.shown && s.done === null && s.n === '1', { i, s });
    await ctx.close();
    const c2 = await open({ store: { fbFabHintN_v1: '3' } });
    await c2.p.waitForTimeout(5200);
    ok('3 回出ていたら、もう出ない', !(await hintInfo(c2.p)).shown);
    await c2.ctx.close();
    const c3 = await open({ store: { fbFabHintDone_v1: '1' } });
    await c3.p.waitForTimeout(5200);
    ok('気づいた人には出ない', !(await hintInfo(c3.p)).shown);
    await c3.ctx.close();
  }

  // 5) 入力中は出さない（フォーカスが外れたら出る）
  {
    const { ctx, p } = await open();
    await p.evaluate(() => { const t = document.createElement('input'); t.id = 'tmpIn'; document.body.appendChild(t); t.focus(); });
    await p.waitForTimeout(5200);
    ok('入力欄にフォーカス中は出ない', !(await hintInfo(p)).shown);
    await p.evaluate(() => document.getElementById('tmpIn').blur());
    await p.waitForSelector('#fbFabHint', { timeout: 11000 });
    ok('フォーカスが外れれば出る', (await hintInfo(p)).shown);
    await ctx.close();
  }

  // 6) 手動で出す・自動で消える（14 秒）
  {
    const { ctx, p } = await open({ store: { fbFabHintDone_v1: '1' } });
    await p.evaluate(() => window.fbHintShow(true));
    ok('fbHintShow(true) で条件を無視して出せる', (await hintInfo(p)).shown);
    await p.waitForTimeout(14500);
    const i = await hintInfo(p);
    ok('14 秒で自動的にしまう', !i.shown && !i.pulse, i);
    ok('自動でしまっても「気づいた」とは記録しない（done は元のまま）', (await store(p)).done === '1');
    await ctx.close();
  }

  // 7) スマホ幅
  {
    const { ctx, p } = await open({ w: 390, h: 800, mobile: true });
    await p.waitForSelector('#fbFabHint', { timeout: 8000 });
    const i = await hintInfo(p);
    ok('スマホ幅：🐞 の左に出て、画面内・はみ出さない', i.shown && i.gapOk && i.left && !i.overflowX, i);
    await p.screenshot({ path: path.join(process.env.OUT || '/tmp', `fab-hint-mobile${process.env.THEME ? '-industry' : ''}.png`) });
    await ctx.close();
  }

  // 8) 動きを減らす設定：吹き出しは出るが、波紋・揺れは止まる
  {
    const { ctx, p } = await open({ reduce: true });
    await p.waitForSelector('#fbFabHint', { timeout: 8000 });
    const m = await p.evaluate(() => ({ ring: getComputedStyle(document.getElementById('fbQuickFab'), '::before').animationName, fab: getComputedStyle(document.getElementById('fbQuickFab')).animationName, hint: getComputedStyle(document.getElementById('fbFabHint')).animationName }));
    ok('視差効果を減らす設定では動かない（吹き出しは出る）', m.ring === 'none' && m.fab === 'none' && m.hint === 'none', m);
    await ctx.close();
  }

  // 9) PC：見た目の確認用に撮る
  {
    const { ctx, p } = await open();
    await p.waitForSelector('#fbFabHint', { timeout: 8000 });
    await p.screenshot({ path: path.join(process.env.OUT || '/tmp', `fab-hint-pc${process.env.THEME ? '-industry' : ''}.png`), clip: { x: 900, y: 650, width: 500, height: 250 } });
    await ctx.close();
  }

  await b.close(); srv.close();
  console.log(fails ? `\n${fails} 件失敗` : '\n全項目 PASS');
  process.exit(fails ? 1 : 0);
})();
