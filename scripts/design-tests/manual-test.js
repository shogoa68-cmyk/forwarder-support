// 📘 マニュアルの画面と 🎓 AI トレーナー（練習のツアー・質問）の試験。AI（Edge Function）は偽物に差し替える。
//   node scripts/design-tests/manual-test.js          （既定は Industry）
//   THEME=classic node scripts/design-tests/manual-test.js   W=390 で スマホ幅
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
let pass = 0, fail = 0;
const ok = (n, c, x) => { if (c) pass++; else fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(x))); };
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' }); fs.createReadStream(f).pipe(r); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const theme = process.env.THEME === 'classic' ? '?theme=classic' : '';
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html${theme}`;
  const W = +process.env.W || 1400;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: W, height: 900 }, locale: 'ja-JP' });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const calls = [];
  let mode = 'ready';
  await ctx.route('**/functions/v1/ai-trainer', async (r) => {
    const body = JSON.parse(r.request().postData() || '{}'); calls.push(body);
    if (body.action === 'status') return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ready: mode === 'ready', reason: mode === 'ready' ? '' : 'disabled' }) });
    if (mode === 'err') return r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'network', message: 'AI に接続できませんでした' }) });
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, answer: '右上の「保存」を押します。\n\n1. 入力する\n2. 保存する', chapters: ['quote-start', 'nope'], lesson: 'first-quote' }) });
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message)); p.setDefaultTimeout(8000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(900);

  // ---- マニュアルの画面 ----
  ok('データが読み込まれている（章 10 以上・練習 1 以上）', await p.evaluate(() => (window.MANUAL.chapters.length >= 10) && window.MANUAL.chapters.some(c => c.lessons.length)), null);
  ok('「その他」のメニューに 📘 マニュアル', await p.evaluate(() => !!document.querySelector('#catMorePanel .cat-btn[aria-controls="tab-manual"]')), null);
  await p.evaluate(() => document.querySelector('.cat-btn[aria-controls="tab-manual"]').click());
  await p.waitForTimeout(300);
  ok('開くと最初の案内と章のカードが出る', await p.evaluate(() => document.getElementById('tab-manual').classList.contains('active') && !!document.querySelector('#manMain .man-welcome') && document.querySelectorAll('#manMain .man-card').length >= 10), null);
  await p.evaluate(() => document.querySelector('#manToc [data-man="quote-start"]').click());
  await p.waitForTimeout(200);
  const ch = await p.evaluate(() => ({ h: document.querySelector('#manMain h2')?.textContent, on: document.querySelector('#manToc .is-on')?.dataset.man, list: document.querySelectorAll('#manMain .man-body ol li').length, code: document.querySelectorAll('#manMain .man-body code').length, lesson: !!document.querySelector('#manMain .man-lesson [data-lesson="first-quote"]'), open: !!document.querySelector('#manMain [data-man-open="tab-quote-make"]') }));
  ok('章を開く：題名・目次の選択・番号つきの手順・ボタン名の印・練習・この画面を開く', /はじめての 1 件/.test(ch.h) && ch.on === 'quote-start' && ch.list >= 5 && ch.code >= 3 && ch.lesson && ch.open, ch);
  await p.evaluate(() => document.querySelector('#manMain .man-link[data-man="quote-rows"]').click());
  ok('本文のリンクで別の章へ', await p.evaluate(() => /費用の明細/.test(document.querySelector('#manMain h2').textContent)), null);
  await p.fill('#manSearch', '別名');
  await p.waitForTimeout(100);
  const hits = await p.evaluate(() => [...document.querySelectorAll('#manToc .man-toc-item')].map(b => b.dataset.man));
  ok('検索：「別名」でマスター管理の章が出る', hits.includes('master') && hits.length < 6, hits);
  await p.fill('#manSearch', 'ぜんぜん関係ないぞぞぞ');
  ok('検索：見つからないときは AI トレーナーへの案内', await p.evaluate(() => !!document.querySelector('#manToc .man-none [data-man-ask]')), null);
  await p.fill('#manSearch', '');
  ok('検索の関数：保存 → 見積の章が上位', await p.evaluate(() => window.manualSearch('保存できない', 3).some(c => c.id === 'quote-start')), null);
  ok('画面から章を引ける（進行管理）', await p.evaluate(() => window.manualForTab('tab-ops').id === 'ops'), null);

  // ---- ❓ カード ----
  const rows = await p.evaluate(() => { document.getElementById('fbQuickFab').click(); return [...document.querySelectorAll('#fbHelpCard .fbhc-item')].map(e => e.textContent.trim()); });
  ok('❓ のカードに マニュアル と AI トレーナー', rows.some(r => /マニュアルを読む/.test(r)) && rows.some(r => /AI トレーナー/.test(r)), rows);
  await p.evaluate(() => document.querySelector('.cat-btn[aria-controls="tab-ops"]').click());
  await p.waitForTimeout(300);
  await p.evaluate(() => { document.getElementById('fbQuickFab').click(); document.getElementById('fbHelpManual').click(); });
  await p.waitForTimeout(200);
  ok('進行管理の画面で「マニュアルを読む」→ 進行管理の章が開く', await p.evaluate(() => document.getElementById('tab-manual').classList.contains('active') && /進行管理/.test(document.querySelector('#manMain h2').textContent)), null);

  // ---- 練習（ツアー） ----
  await p.evaluate(() => window.trainerStartLesson('first-quote'));
  await p.waitForTimeout(500);
  const t1 = await p.evaluate(() => ({ on: !document.getElementById('trnTour').hidden, step: document.getElementById('trnBStep').textContent, quote: document.getElementById('tab-quote-make').classList.contains('active') }));
  ok('練習を始めると、見積の画面に移って 1 歩目の吹き出し', t1.on && /^1 \//.test(t1.step) && t1.quote, t1);
  await p.click('#trnBubble [data-tour="next"]');
  await p.waitForTimeout(900);
  const t2 = await p.evaluate(() => { const r = document.getElementById('trnRing').getBoundingClientRect(); const c = document.querySelector('.qpd-newcard'); const cr = c && c.getBoundingClientRect(); return { step: document.getElementById('trnBStep').textContent, ring: Math.round(r.width), card: !!c, near: c ? Math.abs(r.left - cr.left) < 12 && Math.abs(r.top - cr.top) < 12 : null, miss: !document.getElementById('trnBMiss').hidden }; });
  ok('2 歩目：新しい見積のカードを光る枠で囲む', /^2 \//.test(t2.step) && (t2.card ? t2.near && t2.ring > 20 : t2.miss === false || true), t2);
  // 押すと自動で次へ（click: の手順）
  // 未ログインの試験では「新しい見積」のカードが無い → 代わり（else:）の「ログインせず試す」を囲む
  const alt = await p.evaluate(() => { const a = document.querySelector('.qpd-local-link'); const r = document.getElementById('trnRing').getBoundingClientRect(); const ar = a && a.getBoundingClientRect(); return { a: !!a, near: a ? Math.abs(r.left + 6 - ar.left) < 4 && Math.abs(r.top + 6 - ar.top) < 4 : null, txt: document.getElementById('trnBText').textContent, miss: !document.getElementById('trnBMiss').hidden }; });
  ok('場所が無いときは代わりの場所（else:）を囲み、代わりの説明を出す', t2.card || (alt.a && alt.near && /ログインせず試す/.test(alt.txt) && !alt.miss), alt);
  await p.evaluate((c) => document.querySelector(c ? '.qpd-newcard' : '.qpd-local-link').click(), t2.card);
  await p.waitForTimeout(1000);
  ok('枠の場所を押すと自動で次の歩へ進む', await p.evaluate(() => /^3 \//.test(document.getElementById('trnBStep').textContent)), null);
  await p.waitForTimeout(1700);
  if (!t2.card) ok('次の歩の場所（新規の選択）も無ければ、else: - の説明だけ（「見つかりません」は出さない）', await p.evaluate(() => /入力画面が開きました/.test(document.getElementById('trnBText').textContent) && document.getElementById('trnBMiss').hidden), null);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
  ok('Esc で練習をやめる', await p.evaluate(() => document.getElementById('trnTour').hidden && !window.trainerActive()), null);
  // 見つからない場所は「見つかりません」と出して止まらない
  await p.evaluate(() => { window.MANUAL.chapters[0].lessons.push({ id: 'ghost', title: '試し', open: '', steps: [{ sel: '#nothing-here', text: 'ない場所', wait: false }, { sel: '', text: '最後', wait: false }] }); window.trainerStartLesson('ghost'); });
  await p.waitForTimeout(1900);
  ok('場所が見つからない歩は、説明だけ中央に出す（止まらない）', await p.evaluate(() => !document.getElementById('trnBMiss').hidden), null);
  await p.click('#trnBubble [data-tour="next"]'); await p.click('#trnBubble [data-tour="next"]');
  await p.waitForTimeout(200);
  ok('最後まで進むと終わって、練習済みを覚える', await p.evaluate(() => document.getElementById('trnTour').hidden && !!JSON.parse(localStorage.getItem('trnDone_v1') || '{}').ghost), null);

  // ---- 質問：未ログイン → マニュアルから探す ----
  await p.evaluate(() => { window.cloudGetClient = () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }); window.trainerOpen('ask'); });
  await p.waitForTimeout(200);
  ok('パネルを開くと、質問の例が出る', await p.evaluate(() => !document.getElementById('trnPanel').hidden && document.querySelectorAll('#trnLog .trn-sug').length >= 3), null);
  await p.evaluate(() => window.trainerAsk('PDF の出し方は？'));
  await p.waitForTimeout(300);
  const loc = await p.evaluate(() => ({ last: document.querySelector('#trnLog .trn-ai:last-child')?.textContent || '', refs: [...document.querySelectorAll('#trnLog .trn-ai:last-child [data-man]')].map(b => b.dataset.man), status: document.getElementById('trnStatus').hidden ? '' : document.getElementById('trnStatus').textContent }));
  ok('未ログインは AI を呼ばず、マニュアルの近い章を出す', /ログイン/.test(loc.last) && loc.refs.includes('quote-output') && calls.length === 0, loc);
  // ---- 質問：ログイン済み・AI あり ----
  await p.evaluate(() => { window.CLOUD_CONFIG = Object.assign({}, window.CLOUD_CONFIG, { url: window.CLOUD_CONFIG?.url || 'https://example.supabase.co', publishableKey: 'pk' }); window.cloudGetClient = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } }); });
  await p.evaluate(() => window.trainerAsk('見積を保存するには？'));
  await p.waitForTimeout(600);
  const ai = await p.evaluate(() => { const m = document.querySelector('#trnLog .trn-ai:last-child'); return { t: m?.textContent || '', refs: [...m.querySelectorAll('[data-man]')].map(b => b.dataset.man), lesson: !!m.querySelector('[data-lesson="first-quote"]'), paras: m.querySelectorAll('p').length }; });
  ok('AI の答え：段落・知っている章のボタンだけ・練習のボタン', /保存/.test(ai.t) && ai.refs.join() === 'quote-start' && ai.lesson && ai.paras >= 2, ai);
  const askCall = calls.find(c => c.action === 'ask');
  ok('送る中身：質問・画面の名前・マニュアルの抜き書き（案件の中身は送らない）', askCall && askCall.question === '見積を保存するには？' && askCall.screen && askCall.excerpts.length >= 1 && askCall.excerpts.every(e => e.id && e.text) && !('data' in askCall) && !JSON.stringify(askCall).includes('qf-customer'), askCall && Object.keys(askCall));
  ok('前のやりとりも渡す（直前の答え）', askCall && askCall.history.some(h => h.role === 'assistant'), askCall && askCall.history);
  mode = 'err';
  await p.evaluate(() => window.trainerAsk('受注したあとは？'));
  await p.waitForTimeout(600);
  ok('AI がエラーのときは、理由とマニュアルの近い章', await p.evaluate(() => { const m = document.querySelector('#trnLog .trn-ai:last-child'); return /接続できません/.test(m.textContent) && !!m.querySelector('[data-man="ops"]'); }), null);
  await p.evaluate(() => document.querySelector('#trnLog .trn-ai:last-child [data-man="ops"]').click());
  await p.waitForTimeout(200);
  ok('答えの章のボタンでマニュアルが開き、パネルは閉じる', await p.evaluate(() => document.getElementById('trnPanel').hidden && /進行管理/.test(document.querySelector('#manMain h2').textContent)), null);
  await p.evaluate(() => { window.trainerOpen('learn'); });
  ok('「練習する」のタブに練習の一覧', await p.evaluate(() => document.querySelectorAll('#trnLearn .trn-lesson').length >= 1), null);
  await p.keyboard.press('Escape');
  ok('Esc でパネルを閉じる', await p.evaluate(() => document.getElementById('trnPanel').hidden), null);
  if (W <= 600) {
    await p.evaluate(() => window.trainerOpen('ask'));
    const r = await p.evaluate(() => { const x = document.getElementById('trnPanel').getBoundingClientRect(); return { l: x.left, r: x.right, b: Math.round(x.bottom), w: innerWidth, h: innerHeight }; });
    ok('スマホ幅：パネルは下から出るシート（幅いっぱい）', r.l === 0 && Math.round(r.r) === r.w && r.b === r.h, r);
    ok('スマホ幅：横にはみ出さない', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), null);
  }
  // すべての練習を最後まで「次へ」で進めても止まらない・エラーが出ない
  const ids = await p.evaluate(() => window.MANUAL.chapters.flatMap(c => c.lessons.map(L => L.id)).filter(id => id !== 'ghost'));
  let allDone = true;
  for (const id of ids) {
    await p.evaluate((id) => window.trainerStartLesson(id), id);
    const n = await p.evaluate((id) => window.manualLesson(id).steps.length, id);
    for (let i = 0; i < n; i++) { await p.waitForTimeout(120); await p.evaluate(() => document.querySelector('#trnBubble [data-tour="next"]').click()); }
    await p.waitForTimeout(150);
    if (await p.evaluate(() => window.trainerActive())) { allDone = false; console.log('  止まった練習:', id); await p.evaluate(() => window.trainerStopLesson()); }
  }
  ok('練習 ' + ids.length + ' 件を最後まで進められる', allDone && ids.length >= 5, ids);
  ok('JS エラーなし', errs.length === 0, errs);
  console.log(`manual: PASS=${pass} FAIL=${fail}`);
  await b.close(); srv.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
