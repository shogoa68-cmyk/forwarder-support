// 右下の「❓ 困ったとき」（Design 34 案B）の確認：
//   ①吹き出し（初回 1 回だけ・「？」の真上・見積入力では出さない・重なるときは出さない・8 秒で消える）
//   ②カード（開閉・中身 4 つ・移した 3 つの id／onclick・バッジ）③画面ごとの位置（新画面・スマホ）
//   node scripts/design-tests/fab-hint-test.js           （THEME=1 で Industry・OUT=<dir> で画像）
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
  const OUT = process.env.OUT || '/tmp';

  async function open({ w = 1400, h = 900, mobile = false, reduce = false, store = {} } = {}) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, locale: 'ja-JP', isMobile: mobile, hasTouch: mobile, reducedMotion: reduce ? 'reduce' : 'no-preference' });
    await ctx.addInitScript(({ theme, store }) => {
      try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
      if (theme) try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {}
      for (const k in store) try { localStorage.setItem(k, store[k]); } catch (e) {}
    }, { theme: !!process.env.THEME, store });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    const p = await ctx.newPage();
    await p.goto(URL, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#fbQuickFab', { state: 'attached' });
    return { ctx, p };
  }
  const hintInfo = p => p.evaluate(() => {
    const h = document.getElementById('fbFabHint'), f = document.getElementById('fbQuickFab');
    if (!h) return { shown: false, pulse: f.classList.contains('fb-hint-pulse') };
    const a = h.getBoundingClientRect(), r = f.getBoundingClientRect();
    return { shown: true, pulse: f.classList.contains('fb-hint-pulse'), text: h.textContent,
      above: a.bottom <= r.top && r.top - a.bottom < 30, rightAligned: Math.abs(a.right - r.right) <= 6,
      inView: a.left >= 0 && a.top >= 0 && a.right <= innerWidth, w: Math.round(a.width),
      overflowX: document.documentElement.scrollWidth > innerWidth, btnH: Math.round(h.querySelector('.fbh-main').getBoundingClientRect().height),
      anim: getComputedStyle(h).animationName };
  });
  const store = p => p.evaluate(() => ({ done: localStorage.getItem('fbFabHintDone_v1'), n: localStorage.getItem('fbFabHintN_v1') }));
  const vis = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden'; }, sel);

  // ===== ① 吹き出し =====
  // 1) 初回：4 秒後に出る。押すとカードが開く（報告フォームは開かない）
  {
    const { ctx, p } = await open();
    ok('開いてすぐは出ていない', !(await hintInfo(p)).shown);
    await p.waitForSelector('#fbFabHint', { timeout: 8000 });
    const i = await hintInfo(p);
    ok('4 秒ほどで吹き出しが出る', i.shown);
    ok('文言「困ったときは「？」から」「1回だけ出ます」', /困ったときは「？」から/.test(i.text) && /1回だけ/.test(i.text), i.text);
    ok('波紋・揺れはやめた（ボタンに動きのクラスが付かない）', !i.pulse, i);
    ok('「？」の真上・右端をそろえて出る', i.above && i.rightAligned, i);
    ok('画面内・横にはみ出さない・幅 210px 以内', i.inView && !i.overflowX && i.w <= 210, i);
    ok('タップしやすい高さ（44px 以上）', i.btnH >= 44, i);
    ok('表示回数を 1 と記録（最大 1 回）', (await store(p)).n === '1', await store(p));
    await p.click('#fbFabHint .fbh-main');
    await p.waitForSelector('#fbHelpCard:not([hidden])', { timeout: 3000 });
    const j = await hintInfo(p);
    ok('吹き出しを押すと、吹き出しが消えてカードが開く', !j.shown && await vis(p, '#fbHelpCard'), j);
    ok('報告フォームはまだ開かない', await p.evaluate(() => !document.getElementById('fbOverlay').classList.contains('open')));
    ok('「気づいた」として記録', (await store(p)).done === '1', await store(p));
    await ctx.close();
  }

  // 2) ✕ で閉じる → 以後は出ない（再読み込みしても）
  {
    const { ctx, p } = await open();
    await p.waitForSelector('#fbFabHint', { timeout: 8000 });
    await p.click('#fbFabHint .fbh-x');
    ok('✕ で消える', !(await hintInfo(p)).shown);
    ok('カードは開かない', !(await vis(p, '#fbHelpCard')));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(5200);
    ok('再読み込みしても出ない', !(await hintInfo(p)).shown);
    await ctx.close();
  }

  // 3) 「？」を直接押した → 気づいたとして以後は出ない
  {
    const { ctx, p } = await open();
    await p.waitForSelector('#fbFabHint', { timeout: 8000 });
    await p.click('#fbQuickFab');
    await p.waitForSelector('#fbHelpCard:not([hidden])', { timeout: 3000 });
    const i = await hintInfo(p);
    ok('「？」を押すと吹き出しが終わり、カードが開く', !i.shown && (await store(p)).done === '1', i);
    await ctx.close();
  }

  // 4) Esc でしまう（記録は残さないが、すでに 1 回数えたので再読み込みでは出ない）／上限
  {
    const { ctx, p } = await open();
    await p.waitForSelector('#fbFabHint', { timeout: 8000 });
    await p.keyboard.press('Escape');
    const i = await hintInfo(p), s = await store(p);
    ok('Esc でしまえる（気づいた扱いにはしない）', !i.shown && s.done === null && s.n === '1', { i, s });
    await ctx.close();
    const c2 = await open({ store: { fbFabHintN_v1: '1' } });
    await c2.p.waitForTimeout(5200);
    ok('1 回出ていたら、もう出ない', !(await hintInfo(c2.p)).shown);
    await c2.ctx.close();
    const c2b = await open({ store: { fbFabHintN_v1: '3' } });
    await c2b.p.waitForTimeout(5200);
    ok('旧仕様で 3 回出ていた人にも出ない', !(await hintInfo(c2b.p)).shown);
    await c2b.ctx.close();
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

  // 6) 見積入力の画面では出さない（ダッシュボードに戻れば出る）
  {
    const { ctx, p } = await open();
    await p.evaluate(() => document.body.classList.remove('qp-dash-active'));     // 見積入力の画面にいる状態
    await p.waitForTimeout(5200);
    ok('見積入力の画面では出ない（回数も数えない）', !(await hintInfo(p)).shown && (await store(p)).n === null, await store(p));
    await p.evaluate(() => document.body.classList.add('qp-dash-active'));
    await p.waitForSelector('#fbFabHint', { timeout: 11000 });
    ok('ダッシュボードに戻れば出る', (await hintInfo(p)).shown);
    await ctx.close();
  }

  // 7) 手動で出す・約 8 秒で自動的に消える
  {
    const { ctx, p } = await open({ store: { fbFabHintDone_v1: '1' } });
    await p.evaluate(() => window.fbHintShow(true));
    ok('fbHintShow(true) で条件を無視して出せる', (await hintInfo(p)).shown);
    await p.waitForTimeout(8600);
    const i = await hintInfo(p);
    ok('約 8 秒で自動的にしまう', !i.shown, i);
    ok('自動でしまっても「気づいた」とは記録しない（done は元のまま）', (await store(p)).done === '1');
    await ctx.close();
  }

  // 8) スマホ幅：ボタンや本文に重なる位置なら出さない（回数も数えない）／出すときは画面内・右端から 16px 以内
  {
    const { ctx, p } = await open({ w: 390, h: 800, mobile: true });
    await p.waitForTimeout(5200);
    const auto = await hintInfo(p);
    // 押せる部品に重なる位置なら出さない／出したときは、押せる部品に重なっていない（画面の配置しだいでどちらにもなる）
    const covers = await p.evaluate(() => { const h = document.getElementById('fbFabHint'); if (!h || !h.getClientRects().length) return false; const r = h.getBoundingClientRect();
      return [...document.querySelectorAll('button, a[href], input, select, textarea')].some(e => { if (e.closest('#fbFabHint') || e.id === 'fbQuickFab' || !e.getClientRects().length) return false; const b = e.getBoundingClientRect(); return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top; }); });
    ok('スマホ幅：下に押せる部品が隠れる位置なら、自動では出さない（出すときは押せる部品に重ならない）', auto.shown ? !covers : (await store(p)).n === null, { auto, covers, s: await store(p) });
    await p.evaluate(() => window.fbHintShow(true));
    const i = await hintInfo(p);
    ok('スマホ幅（手動で出した場合）：「？」の真上・画面内・はみ出さない', i.shown && i.above && i.inView && !i.overflowX && i.w <= 210, i);
    await p.screenshot({ path: path.join(OUT, `fab-hint-mobile${process.env.THEME ? '-industry' : ''}.png`) });
    await ctx.close();
  }

  // 9) 動きを減らす設定：吹き出しの動きも止まる
  {
    const { ctx, p } = await open({ reduce: true });
    await p.waitForSelector('#fbFabHint', { timeout: 8000 });
    const i = await hintInfo(p);
    ok('視差効果を減らす設定では動かない（吹き出しは出る）', i.shown && i.anim === 'none', i);
    await ctx.close();
  }

  // ===== ② カード =====
  {
    const { ctx, p } = await open({ store: { fbFabHintDone_v1: '1' } });
    const fab = await p.evaluate(() => { const r = document.getElementById('fbQuickFab').getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), right: Math.round(innerWidth - r.right), text: document.getElementById('fbQuickFab').textContent }; });
    ok('常駐は「❓」1 つだけ（48px・右端 16px）', fab.w === 48 && fab.h === 48 && fab.right === 16 && fab.text === '❓' && (await p.$$('.fb-quick-fab')).length === 1, fab);
    ok('カードは閉じている・aria-expanded=false', !(await vis(p, '#fbHelpCard')) && (await p.getAttribute('#fbQuickFab', 'aria-expanded')) === 'false');
    await p.click('#fbQuickFab'); await p.waitForTimeout(150);
    const c = await p.evaluate(() => {
      const card = document.getElementById('fbHelpCard'), f = document.getElementById('fbQuickFab'), a = card.getBoundingClientRect(), r = f.getBoundingClientRect();
      const rows = [...card.querySelectorAll('.fbhc-item')];
      return { rows: rows.map(e => e.textContent.trim()), minH: Math.min(...rows.map(e => Math.round(e.getBoundingClientRect().height))), w: Math.round(a.width),
        above: a.bottom <= r.top, inView: a.left >= 0 && a.top >= 0 && a.right <= innerWidth, title: card.querySelector('.fbhc-title').textContent, exp: f.getAttribute('aria-expanded') };
    });
    ok('押すとカード「困ったとき」が「？」の上に開く（幅 250px・画面内）', c.title === '困ったとき' && c.exp === 'true' && c.above && c.inView && c.w === 250, c);
    ok('中身は 9 つ（📖 用語を調べる／🧭 この画面の使い方／📘 マニュアル／🎓 AI トレーナー／🐞／🔴 再現を記録／📋／💡／📣）・各 44px 以上', c.rows.length === 9 && /用語を調べる/.test(c.rows[0]) && /この画面の使い方/.test(c.rows[1]) && /マニュアル/.test(c.rows[2]) && /AI トレーナー/.test(c.rows[3]) && /不具合・ご意見を送る/.test(c.rows[4]) && /再現を記録/.test(c.rows[5]) && /報告の状況/.test(c.rows[6]) && /アイデア/.test(c.rows[7]) && /改修予定/.test(c.rows[8]) && c.minH >= 44, c);
    ok('移した 3 つは id・onclick・href がそのまま', await p.evaluate(() => { const g = id => document.getElementById(id); return /switchCategory\('bugreports'\); fbrSetMode\('bug'\)/.test(g('hdrBugReportsBtn').getAttribute('onclick')) && /fbrSetMode\('idea'\)/.test(g('hdrIdeasBtn').getAttribute('onclick')) && document.querySelector('#fbHelpCard a[href="roadmap.html"]'); }));
    ok('各行にアイコンが 1 つだけ（二重にならない）', await p.evaluate(() => [...document.querySelectorAll('#fbHelpCard a.hdr-roadmap')].every(a => getComputedStyle(a, '::before').content === 'none')));
    if (process.env.OUT) await p.screenshot({ path: path.join(OUT, `help-card-pc${process.env.THEME ? '-industry' : ''}.png`), clip: { x: 900, y: 450, width: 500, height: 450 } });
    await p.keyboard.press('Escape'); await p.waitForTimeout(100);
    ok('Esc で閉じる（焦点は「？」へ戻る）', !(await vis(p, '#fbHelpCard')) && await p.evaluate(() => document.activeElement.id === 'fbQuickFab'));
    await p.click('#fbQuickFab'); await p.waitForTimeout(100);
    await p.mouse.click(200, 300); await p.waitForTimeout(100);
    ok('外側を押すと閉じる', !(await vis(p, '#fbHelpCard')));
    await p.click('#fbQuickFab'); await p.waitForTimeout(100); await p.click('#fbQuickFab'); await p.waitForTimeout(100);
    ok('「？」をもう一度押すと閉じる', !(await vis(p, '#fbHelpCard')));
    await p.click('#fbQuickFab'); await p.waitForTimeout(100);
    await p.click('#fbHelpSend'); await p.waitForSelector('#fbOverlay.open', { timeout: 3000 });
    ok('「不具合・ご意見を送る」で従来の報告フォームが開き、カードは閉じる', !(await vis(p, '#fbHelpCard')));
    await p.evaluate(() => document.getElementById('fbOverlay').classList.remove('open'));
    // 確認待ちの数字（バッジ）
    await p.evaluate(() => { const f = document.getElementById('fbQuickFab'); f.classList.add('has-badge'); f.dataset.n = '2'; });
    const bd = await p.evaluate(() => { const s = getComputedStyle(document.getElementById('fbQuickFab'), '::after'); return { c: s.content, minW: parseFloat(s.minWidth), fs: parseFloat(s.fontSize), fw: s.fontWeight }; });
    ok('確認待ちがあると「？」の右上に赤い数字（最小 18px・11px 太字）', bd.c === '"2"' && bd.minW >= 18 && bd.fs === 11 && Number(bd.fw) >= 700, bd);
    // 「報告の状況」の行を押す → カードが閉じて報告ページへ
    await p.click('#fbQuickFab'); await p.waitForTimeout(100);
    await p.click('#hdrIdeasBtn'); await p.waitForTimeout(400);
    ok('「アイデア」の行を押すとカードが閉じ、アイデアの画面へ移る', !(await vis(p, '#fbHelpCard')) && await p.evaluate(() => !!document.querySelector('#tab-bugreports.active, #tab-bugreports[style*="block"]') || document.getElementById('tab-bugreports') && getComputedStyle(document.getElementById('tab-bugreports')).display !== 'none'));
    await ctx.close();
  }

  // ===== ③ 画面ごとの位置 =====
  {
    const { ctx, p } = await open({ store: { fbFabHintDone_v1: '1' } });
    const bottom = () => p.evaluate(() => Math.round(innerHeight - document.getElementById('fbQuickFab').getBoundingClientRect().bottom));
    const base = await bottom();
    ok('旧画面・ダッシュボード（PC）：下から 72px', base === 72, base);
    await p.evaluate(() => document.documentElement.classList.add('editor-v2'));
    ok('新画面（PC）：下の合計バーの上＝下から 62px', (await bottom()) === 62, await bottom());
    await ctx.close();
    const m = await open({ w: 390, h: 800, mobile: true, store: { fbFabHintDone_v1: '1' } });
    const mb = () => m.p.evaluate(() => Math.round(innerHeight - document.getElementById('fbQuickFab').getBoundingClientRect().bottom));
    ok('スマホ（旧画面）：下から 72px', (await mb()) === 72, await mb());
    await m.p.evaluate(() => document.documentElement.classList.add('editor-v2'));
    ok('スマホ（新画面）：下の固定ドック＋合計バーの上（下から 120px）', (await mb()) === 120, await mb());
    await m.ctx.close();
  }

  await b.close(); srv.close();
  console.log(fails ? `\n${fails} 件失敗` : '\n全項目 PASS');
  process.exit(fails ? 1 : 0);
})();
