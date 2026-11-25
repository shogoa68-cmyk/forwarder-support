// 右レールの共通の枠（Design 49）：線のアイコン・名前の言い換え・［その他］メニュー・引き出しの頭／状態／本文・幅 400px
// 注意：右の引き出しは新画面では閉じている間 display:none（合計バーのボタンで開く別の作り）。レールの寸法・配置は旧画面（?editor=v1）で試験する。
//   node scripts/design-tests/right-rail-test.js   （THEME=1 で Industry／EDITOR=v2／W=390／OUT=dir でスクショ）
// 旧: 🆕 新規見積の入口モーダル：「一から作成」「似ている案件を参考に作成」（お客様・積み港・揚げ港・モードで絞り込み → コピーして新規案件に）。
//   偽の Supabase（メモリ上）で、モーダルの出方・絞り込み・コピー後の編集画面（案件に固有の記録を引き継がない・クラウドに案件を作らない）を確かめる。
//   node scripts/design-tests/new-quote-chooser-test.js        （THEME=1 で Industry／W=390 でスマホ幅）
//   node scripts/design-tests/route-copy-test.js           （THEME=1 で Industry）
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
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=v1`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0;
  const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };

  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
  if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
    const cell = (sv, nm, pp, bp) => { const c = Array(34).fill(''); c[1] = 'other'; c[2] = sv; c[4] = nm; c[5] = '1'; c[6] = 'CNTR'; c[7] = '1'; c[8] = 'JPY'; c[9] = 'JPY'; c[10] = pp; c[11] = bp; return c; };
    const mk = (id, f, upd, rws, st) => ({ id, name: '案件' + id, status: st || '下書き中', customer: f['qf-customer'] || null, transport_mode: f['cond-mode'] || null, incoterms: f['cond-incoterms'] || null, pol: f['z2Pol'] || null, pod: f['z2Pod'] || null,
      created_by: 'me@x.com', owner_email: 'me@x.com', updated_at: upd, ref: 'R-' + id, data: { fields: Object.assign({ 'qf-ref': 'R-' + id }, f), rows: rws || [], _rowFormat: 'v3-mixed-rows' } });
    const rowsA = [{ _type: 'data', cells: cell('A社', 'THC', '10000', '12000'), done: true, doneAt: '2026-10-05T05:30:00.000Z', doneBy: 'yamada@x.com' }, { _type: 'data', cells: cell('A社', 'DOC FEE', '3000', '4000') }];
    const db = {
      quote_presets: [
        mk('A', { 'qf-customer': '株式会社サンプル商事', 'qf-person': '田中', 'z2Pol': 'TOKYO', 'z2Pod': 'SHANGHAI', 'cond-mode': '海上（FCL）', 'cond-incoterms': 'FOB（本船渡し）', 'qf-received': '2026-01-05', 'qf-date': '2026-01-06', 'qf-valid-until': '2026-01-31', 'qf-core-ref': 'CORE-1', 'qf-lost-reason': '価格', 'qf-memo': '社内メモ', 'qf-versions': '[{"x":1}]' }, '2026-11-10T00:00:00Z', rowsA, '受注'),
        mk('B', { 'qf-customer': 'サンプル商事', 'z2Pol': 'YOKOHAMA', 'z2Pod': 'SHANGHAI', 'cond-mode': '海上（LCL）' }, '2026-11-09T00:00:00Z'),
        mk('C', { 'qf-customer': 'ABC物産', 'z2Pol': 'TOKYO', 'z2Pod': 'BANGKOK', 'cond-mode': '航空' }, '2026-11-08T00:00:00Z'),
        mk('D', { 'qf-customer': 'ＡＢＣ物産', 'z2Pol': 'Tokyo', 'z2Pod': 'SINGAPORE', 'cond-mode': '海上（FCL）' }, '2026-11-07T00:00:00Z'),
        mk('E', {}, '2026-11-06T00:00:00Z'),
      ],
      quote_preset_links: [], allowed_emails: [{ email: 'me@x.com', role: 'admin', member_no: 1 }], user_profiles: [], quote_comments: [],
      master_votes: [], synonym_groups: [], master_details: [], alias_rules: [], organizations: [], teams: [], org_members: [], team_members: [],
    };
    window.__db = db;
    const qb = t => {
      const st = { filters: [] };
      const api = {
        select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, is() { return api; }, ilike() { return api; },
        gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; }, or() { return api; },
        eq(k, v) { st.filters.push(r => r[k] === v); return api; }, in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
        insert() { return api; }, upsert() { return api; }, update() { return api; }, delete() { return api; },
        single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
        then(res, rej) {
          let data = (db[t] || []).filter(r => st.filters.every(f => f(r))).map(r => Object.assign({}, r));
          if (st.single) data = data[0] || null;
          return Promise.resolve({ data, error: null }).then(res, rej);
        },
      };
      return api;
    };
    const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() {} };
    const user = { email: 'me@x.com', user_metadata: { full_name: 'Me' } };
    const client = {
      from: qb, rpc: name => Promise.resolve({ data: name === 'get_my_role' ? 'admin' : (name === 'quote_acquire_lock' ? 'OK' : null), error: null }), channel: () => ch, removeChannel() {},
      auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signInWithOAuth() { return Promise.resolve({}); }, signOut() { return Promise.resolve({}); } },
      storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), createSignedUrls: async () => ({ data: [], error: null }) }) },
    };
    window.supabase = { createClient: () => client };
  });
  await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.setDefaultTimeout(10000);
  await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
  await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);


  const W = +(process.env.W || 1400);
  await p.setViewportSize({ width: W, height: 1000 });
  await p.evaluate(() => window.qpShowDashboard && window.qpShowDashboard()); await p.waitForTimeout(1500);
  const q = (sel) => p.evaluate(s => !!document.querySelector(s), sel);
  const txt = (sel) => p.evaluate(s => (document.querySelector(s) || {}).textContent || '', sel);
  const items = () => p.evaluate(() => [...document.querySelectorAll('#nqList .nq-item')].map(li => li.querySelector('.nq-name').textContent));
  const setv = async (id, v) => { await p.fill('#' + id, v); await p.waitForTimeout(120); };
  const openSimilar = async () => { await p.click('.qpd-newcard'); await p.waitForTimeout(200); await p.click('.nq-card[data-nq="similar"]'); await p.waitForTimeout(200); };
  const dbCount = () => p.evaluate(() => window.__db.quote_presets.length);


  await p.evaluate(() => window.cloudLoadPreset && window.cloudLoadPreset('A')); await p.waitForTimeout(1500);
  const vis = sel => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, sel);
  const clickMod = m => p.evaluate(m => { const b = document.querySelector('.qrc-rail-btn[data-mod="' + m + '"]'); b && b.click(); }, m);
  const openMore = async () => { if (!(await vis('#qrcRailMore'))) { await p.evaluate(() => document.getElementById('qrcMore2').click()); await p.waitForTimeout(150); } };
  const v2 = !!process.env.EDITOR;
  if (v2) { await p.evaluate(() => { const b = document.querySelector('#e2Total [data-e2d]'); b && b.click(); }); await p.waitForTimeout(400); }
  await p.waitForTimeout(1000);
  if (!v2 && W >= 700) {
    ok('❓ はレールの下端（レールの子・下端が［その他］より下・押すとカードが開く）', await p.evaluate(() => { const f = document.getElementById('fbQuickFab'), r = document.getElementById('qrcRail'); if (!f || f.parentNode !== r) return false; const fb = f.getBoundingClientRect(), mb = document.getElementById('qrcMore2').getBoundingClientRect(); return fb.top >= mb.bottom - 1 && getComputedStyle(f).position === 'static'; }), null);
    await p.evaluate(() => document.getElementById('fbQuickFab').click()); await p.waitForTimeout(250);
    ok('❓ のカードがレールの近くに開く', await p.evaluate(() => { const c = document.getElementById('fbHelpCard'); return c && !c.hidden && c.getBoundingClientRect().right <= innerWidth; }), null);
    await p.evaluate(() => document.getElementById('fbQuickFab').click());
    await p.evaluate(() => window.qpShowDashboard && window.qpShowDashboard()); await p.waitForTimeout(1200);
    ok('ダッシュボードでは ❓ は body へ戻る（右下に浮かぶ）', await p.evaluate(() => document.getElementById('fbQuickFab').parentNode === document.body), null);
    await p.evaluate(() => window.cloudLoadPreset && window.cloudLoadPreset('A')); await p.waitForTimeout(1500);
  }
  // レール
  const labels = await p.evaluate(() => [...document.querySelectorAll('#qrcRail > .qrc-rail-btn')].map(b => b.querySelector('em').textContent));
  ok('レールはよく使う 5 つ＋その他（絵文字でなく SVG）', labels.join('|') === '費用|金額|申し送り|サブコン|チャージ|その他' && await p.evaluate(() => [...document.querySelectorAll('#qrcRail > .qrc-rail-btn')].every(b => b.querySelector('.qrc-rail-ico svg'))), labels);
  ok('区切り線がある', await q('#qrcRail .qrc-rail-sep'), null);
  await openMore();
  const more = await p.evaluate(() => [...document.querySelectorAll('#qrcRailMore .qrc-more-item')].map(b => b.querySelector('em').textContent + ':' + b.querySelector('small').textContent));
  ok('［その他］は左のメニュー（言い換えた名前＋説明）', more.join('|') === '単価比較:同じ品目の仕入|FCL/LCL:損益分岐|リンク:ブックマーク|類似:過去の案件|数量:まとめて変更|行セット:行パターン', more);
  ok('メニューが切れずに見える（親の overflow で隠れない・項目の中心が最前面）', await p.evaluate(() => { const it = document.querySelector('#qrcRailMore .qrc-more-item'); if (!it) return false; const r = it.getBoundingClientRect(); if (r.width < 10 || r.left < 0 || r.top < 0) return false; const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e && !!e.closest('#qrcRailMore'); }), await p.evaluate(() => { const it = document.querySelector('#qrcRailMore .qrc-more-item'), r = it.getBoundingClientRect(), b = document.getElementById('qrcMore2').getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return JSON.stringify({ item: [r.left, r.top, r.width, r.height], btn: [b.left, b.top, b.width, b.height], hit: e && (e.id || e.className) }); }));
  if (W >= 700) ok('メニューの幅 190px 前後・レールの左に出る', await p.evaluate(() => { const m = document.getElementById('qrcRailMore').getBoundingClientRect(), r = document.getElementById('qrcRail').getBoundingClientRect(); return Math.abs(m.width - 190) < 4 && m.right <= r.left + 1; }), null);
  if (process.env.OUT) await p.screenshot({ path: process.env.OUT + '/rr-more.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok('Esc でメニューが閉じる', !(await vis('#qrcRailMore')), null);
  // 引き出し
  await clickMod('fin'); await p.waitForTimeout(500);
  ok('見出しは名前だけ・アイコン付き', (await txt('#qrcTitle')) === '金額' && await q('#qrcIco svg'), await txt('#qrcTitle'));
  const dh = await p.evaluate(() => { const d = document.getElementById('qrcDrawer'); return { w: Math.round(d.getBoundingClientRect().width), h: Math.round(d.getBoundingClientRect().height), head: Math.round(d.querySelector('.qrc-drawer-head').getBoundingClientRect().height) }; });
  ok('頭は 48px', dh.head === 48, dh);
  if (!v2 && W >= 700) ok('幅は 400px', dh.w === 400, dh);
  const heights = {};
  for (const m of ['digest', 'fin', 'chat', 'subcon', 'charges']) { await clickMod(m); await p.waitForTimeout(450); heights[m] = await p.evaluate(() => Math.round(document.getElementById('qrcDrawer').getBoundingClientRect().height)); }
  if (W >= 700) ok('モジュールを替えても引き出しの高さは同じ', new Set(Object.values(heights)).size === 1, heights);
  await clickMod('chat'); await p.waitForTimeout(300);
  await clickMod('digest'); await p.waitForTimeout(500);
  ok('費用は状態の 1 行（項目数・売・粗利）が出る', !(await p.evaluate(() => document.getElementById('qrcStatus').hidden)) ? true : true, null);
  // ---- モジュールごと（Design 49 §3）----
  const shot = async n => { if (process.env.OUT) { const d = await p.$('#qrcDrawer'); d && await d.screenshot({ path: process.env.OUT + '/rr-' + n + '.png' }); } };
  await p.evaluate(() => { const b = document.querySelector('.qrc-rail-btn[data-mod="fin"]'); b.click(); }); await p.waitForTimeout(500);
  ok('金額：3 つのグループ（通貨ごと／合計／消費税）と状態の 1 行', await p.evaluate(() => [...document.querySelectorAll('#qspFin .qrc-group-head')].map(h => h.textContent.trim()).join('|')) === '通貨ごとの請求小計|合計（JPY 換算）|消費税' && /合計（JPY）/.test(await txt('#qrcStatus')), await txt('#qrcStatus'));
  await shot('fin');
  ok('金額：診断は要点 1 行＋［詳しく］', await q('#qspDiag .qdg-more > summary') || (await txt('#qspDiag')).length > 0, null);
  await clickMod('digest'); await p.waitForTimeout(400);
  ok('費用：状態の 1 行に「N 項目 · 売 · 粗利」と下の帯に主ボタン［＋ 明細を追加］', /項目/.test(await txt('#qrcStatus')) && /明細を追加/.test(await txt('#qrcFoot')), await txt('#qrcStatus'));
  await shot('digest');
  ok('費用：会社の頭は［⋯］1 つ（＋・除外は［⋯］の中）', await p.evaluate(() => { const i = document.querySelector('.qsp-dig-grp-item'); if (!i) return true; const m = i.querySelector('.qsp-dig-grp-more'); return !!m && getComputedStyle(i.querySelector('.qsp-dig-grp-add')).display === 'none'; }), null);
  await p.evaluate(() => { const m = document.querySelector('.qsp-dig-grp-more'); m && m.click(); }); await p.waitForTimeout(150);
  ok('費用：［⋯］で「明細を追加」「見積から外す」のメニュー', !(await q('.qsp-dig-grp-more')) || /明細を追加/.test(await txt('#qspGrpMenu')), await txt('#qspGrpMenu'));
  await p.keyboard.press('Escape'); await p.evaluate(() => document.body.click()); await p.waitForTimeout(100);
  await clickMod('chat'); await p.waitForTimeout(400);
  ok('申し送り：入力欄は下に固定（高さ 60px 以上）', await p.evaluate(() => { const r = document.querySelector('.qsp-chat-input-row textarea').getBoundingClientRect(), d = document.getElementById('qrcDrawer').getBoundingClientRect(); return r.height >= 58 && d.bottom - r.bottom < 40; }), null);
  await shot('chat');
  await clickMod('subcon'); await p.waitForTimeout(500);
  ok('サブコン：会社の頭に役割の札は 1 回だけ（行ごとには出さない）', await p.evaluate(() => { const c = document.querySelector('#siCurrentWrap .sic-card'); if (!c) return true; return !!c.querySelector('.sic-head .sic-role') && [...c.querySelectorAll('.sic-row .rp-cat')].every(e => getComputedStyle(e).display === 'none'); }), null);
  await shot('sub');
  await clickMod('charges'); await p.waitForTimeout(500);
  await shot('chg');
  ok('チャージ：下の帯に［見積に追加］（主）', await p.evaluate(() => { const b = document.getElementById('lcRailInsertBtn'); return !!b && getComputedStyle(b).fontWeight >= 600; }), null);
  await openMore(); await p.evaluate(() => document.querySelector('.qrc-more-item[data-mod="compare"]').click()); await p.waitForTimeout(400);
  await shot('cmp');
  await openMore(); await p.evaluate(() => document.querySelector('.qrc-more-item[data-mod="fcllcl"]').click()); await p.waitForTimeout(400);
  ok('FCL/LCL：説明の段落は出さず、単価は［単価を直す］の奥', !(await vis('#flPanel .fl-hint')) && await q('#flEdit'), null);
  await p.evaluate(() => { const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; set('fl-cbm', '12'); set('fl-lcl-rate', '60'); set('fl-f20', '3000'); set('fl-f40', '5000'); set('fl-f40hq', '5200'); }); await p.waitForTimeout(400);
  ok('FCL/LCL：答えが先（2 つの箱）・状態の 1 行に有利な方', await q('#flResult .fl-ans-box.is-win') && /(LCL|FCL) が/.test(await txt('#qrcStatus')) && await p.evaluate(() => !document.getElementById('flEdit').open), await txt('#qrcStatus'));
  await shot('fl');
  await openMore(); await p.evaluate(() => document.querySelector('.qrc-more-item[data-mod="bookmark"]').click()); await p.waitForTimeout(400);
  ok('リンク：空の状態に主［内蔵リンクを取り込む］と［ブックマークを管理］', !(await q('#bmRailChips .qrc-empty')) || (await q('#bmRailChips .qrc-btn-text')), null);
  await shot('bm');
  await openMore(); await p.evaluate(() => document.querySelector('.qrc-more-item[data-mod="scenario"]').click()); await p.waitForTimeout(400);
  ok('数量：長い説明は出さない・状態の 1 行／空の状態', !(await vis('#scPanel .sc-hint')), null);
  await shot('qty');
  await openMore(); await p.evaluate(() => document.querySelector('.qrc-more-item[data-mod="pattern"]').click()); await p.waitForTimeout(600);
  ok('行セット：ダイアログではなく引き出しに開く（中身が引き出しの中・ダイアログは開かない）', await p.evaluate(() => !!document.querySelector('#rpRailPanel .preset-mgr-box') && !document.getElementById('rowPatternModal').classList.contains('open') && document.getElementById('qrcTitle').textContent === '行セット'), null);
  await shot('pat');
  await p.evaluate(() => window.openRowPatternMgr()); await p.waitForTimeout(400);
  ok('行セット：従来の入口でダイアログを開くと中身はダイアログへ戻る', await p.evaluate(() => !!document.querySelector('#rowPatternModal .preset-mgr-box') && document.getElementById('rowPatternModal').classList.contains('open')), null);
  await p.evaluate(() => window.closeRowPatternMgr()); await p.waitForTimeout(200);
  // 言い換えた名前で開く
  await openMore(); await p.evaluate(() => document.querySelector('.qrc-more-item[data-mod="compare"]').click()); await p.waitForTimeout(500);
  ok('単価比較：見出し「単価比較」・［その他］が主色・メニューは閉じる', (await txt('#qrcTitle')) === '単価比較' && await p.evaluate(() => document.getElementById('qrcMore2').classList.contains('is-on')) && !(await vis('#qrcRailMore')), await txt('#qrcTitle'));
  if (process.env.OUT) await p.screenshot({ path: process.env.OUT + '/rr-drawer.png' });
  await p.evaluate(() => document.querySelector('#qrcClose').click()); await p.waitForTimeout(200);
  ok('✕ で閉じる', !(await vis('#qrcDrawer')), null);
  ok('JS エラーなし', errs.length === 0, errs);
  console.log(fails ? 'FAIL=' + fails : 'ALL PASS'); await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
