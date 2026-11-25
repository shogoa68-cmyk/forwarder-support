// 🔍 類似見積パネル（Design 44）の確認用（元は new-quote-chooser-test.js の疑似 Supabase）
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
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
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


  const W2 = +(process.env.W || 1400);
  // 案件 A を開く（お客様・POL・POD・モード・貿易条件が入る）→ 右の「類似」を開く
  await p.evaluate(() => window.cloudLoadPreset && window.cloudLoadPreset('A')); await p.waitForTimeout(1500);
  await p.evaluate(() => { const b = document.querySelector('.qrc-rail-btn[data-mod="similar"]'); if (b) b.click(); else { const m = document.querySelector('#qrcMore2'); m && m.click(); const b2 = document.querySelector('.qrc-rail-btn[data-mod="similar"]'); b2 && b2.click(); } });
  // 新画面：右レールは引き出し（body.e2-drawer）で見せる。レールのボタンを押したあと引き出しを開く
  await p.evaluate(() => { if (document.documentElement.classList.contains('editor-v2')) { document.body.classList.add('e2-drawer'); document.body.dataset.e2drawer = 'similar'; } });
  await p.waitForTimeout(1200);
  const vis = sel => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, sel);

  ok('入口カードが出る（以前の自動候補は出ない）', await vis('#sqPanel .sq-intro') && !(await q('#sqPanel .sq-card')), null);
  ok('近道：いまの条件の札と［この見積の条件で探す］', await vis('#sqPanel .sq-quick-btn') && /サンプル商事/.test(await txt('#sqPanel .sq-cond')) && /TOKYO/.test(await txt('#sqPanel .sq-cond')), await txt('#sqPanel .sq-short'));
  ok('2 つの箱が 8px の帯で区切られる', await vis('#sqPanel .sq-divider') && (await p.evaluate(() => document.querySelector('#sqPanel .sq-divider').getBoundingClientRect().height)) === 8, null);
  ok('関連付けた案件の見出しに「手で結んだ案件」', /手で結んだ案件/.test(await txt('#sqPanel .sq-links-title')), null);
  ok('関連付けが無いとき点線の案内', /まだありません/.test(await txt('#sqPanel .sq-links-empty')), null);

  // --- 検索画面へ ---
  await p.click('#sqPanel .sq-intro'); await p.waitForTimeout(300);
  ok('［‹ 戻る］と各欄のラベル', await vis('#sqPanel .sq-back-btn') && (await p.evaluate(() => [...document.querySelectorAll('#sqPanel .sq-f-lbl')].map(x => x.textContent.trim()).join('|'))).startsWith('お客様・見積名|積み港 POL|揚げ港 POD|輸送モード'), null);
  ok('いまの条件が最初から入る', (await p.inputValue('#sqSearchText')) === '株式会社サンプル商事' && (await p.inputValue('#sqSearchPol')) === 'TOKYO', null);
  ok('状態・見積もり番号は［さらに条件 ▾］の奥（閉じている）', !(await vis('#sqPanel .sq-more-cond')) && await vis('#sqPanel .sq-more-toggle'), null);
  await p.click('#sqPanel .sq-more-toggle'); await p.waitForTimeout(150);
  ok('▾ を押すと状態・見積もり番号が開く', await vis('#sqPanel .sq-more-cond') && await vis('#sqSearchRef'), null);
  ok('探す前の案内（🗂）', /条件を確かめて/.test(await txt('#sqResults')) && !(await q('#sqPanel .sq-card')), await txt('#sqResults'));
  const chipH = await p.evaluate(() => document.querySelector('#sqPanel .sq-mode-chip').getBoundingClientRect().height);
  ok('チップは高さ 32px 以上', chipH >= 32, chipH);
  ok('［探す］は幅いっぱい（flex:1）・36px 以上', await p.evaluate(() => { const b = document.querySelector('#sqPanel .sq-search-bar .sq-go-btn'); const r = b.getBoundingClientRect(); return r.height >= 36 && r.width > 150; }), null);

  // --- 探す ---
  await p.click('#sqPanel .sq-search-bar .sq-go-btn'); await p.waitForTimeout(600);
  const n = await p.evaluate(() => document.querySelectorAll('#sqPanel .sq-card').length);
  ok('結果が出る（件数表示＋カード）', n >= 1 && /件が見つかりました/.test(await txt('#sqResults .sq-count')), await txt('#sqResults .sq-count'));
  ok('カードに「N/M 一致」と一致の札', await p.evaluate(() => { const c = document.querySelector('#sqPanel .sq-card'); return /\d\/\d 一致/.test(c.querySelector('.sq-lv').textContent) && c.querySelectorAll('.sq-m').length >= 3; }), null);
  ok('一致する札は緑の面・取り消し線なし／不一致は取り消し線', await p.evaluate(() => { const c = [...document.querySelectorAll('#sqPanel .sq-card')][0]; const h = c.querySelector('.sq-m.is-hit'); const m = c.querySelector('.sq-m:not(.is-hit)'); return !!h && getComputedStyle(h).textDecorationLine === 'none' && (!m || getComputedStyle(m).textDecorationLine === 'line-through'); }), null);
  ok('一致が先・不一致が後に並ぶ', await p.evaluate(() => [...document.querySelectorAll('#sqPanel .sq-card')].every(c => { const a = [...c.querySelectorAll('.sq-m')].map(x => x.classList.contains('is-hit')); const i = a.indexOf(false); return i < 0 || a.slice(i).every(v => !v); })), null);
  ok('カードは tabindex=0・Enter でプレビューが開く', await p.evaluate(() => document.querySelector('#sqPanel .sq-card').tabIndex === 0), null);
  const calls = await p.evaluate(() => { window.__pv = []; window.sqOpenPreview = id => window.__pv.push(id); const c = document.querySelector('#sqPanel .sq-card'); c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); c.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); return window.__pv.length; });
  ok('Enter・Space でプレビュー（sqOpenPreview）', calls === 2, calls);

  if (process.env.OUT) { const el = await p.$('#sqPanel'); el && await el.screenshot({ path: process.env.OUT + '/sq-results.png' }); }
  // --- もっと見る ---
  if (n >= 5) { await p.click('#sqPanel .sq-more-btn'); await p.waitForTimeout(200); ok('もっと見る', true, null); }

  // --- 該当なし ---
  await p.evaluate(() => { window.__db.quote_presets.length = 0; });
  await p.click('#sqPanel .sq-search-bar .sq-go-btn'); await p.waitForTimeout(500);
  ok('該当なしの表示（🔎＋再検索ボタン）', /該当する案件はありません/.test(await txt('#sqResults')) && await vis('#sqPanel .sq-retry-btn'), await txt('#sqResults'));
  await p.click('#sqPanel .sq-retry-btn'); await p.waitForTimeout(500);
  ok('［条件をクリアしてもう一度］で欄が空になる', (await p.inputValue('#sqSearchText')) === '', null);

  // --- 戻る → 近道 ---
  await p.click('#sqPanel .sq-back-btn'); await p.waitForTimeout(200);
  ok('［‹ 戻る］で入口に戻る', await vis('#sqPanel .sq-intro') && !(await q('#sqSearchText')), null);
  await p.evaluate(() => { window.__db.quote_presets.push({ id: 'Z', name: '案件Z', status: '提示済み', customer: '株式会社サンプル商事', transport_mode: '海上（FCL）', incoterms: 'FOB（本船渡し）', pol: 'TOKYO', pod: 'SHANGHAI', updated_at: '2026-11-11T00:00:00Z', ref: 'R-Z', data: { fields: {}, rows: [] } }); });
  await p.click('#sqPanel .sq-quick-btn'); await p.waitForTimeout(700);
  ok('近道で検索画面→すぐ結果まで出る', await vis('#sqSearchText') && (await p.evaluate(() => document.querySelectorAll('#sqPanel .sq-card').length)) === 1, await txt('#sqResults'));
  ok('5/5 一致（お客様・POL・POD・モード・貿易条件）', /5\/5 一致/.test(await txt('#sqPanel .sq-lv')), await txt('#sqPanel .sq-lv'));
  // 探す側の条件が空の条件は札を出さず、分母を減らす
  await p.fill('#sqSearchText', ''); await p.fill('#sqSearchPol', ''); await p.waitForTimeout(100);
  await p.click('#sqPanel .sq-search-bar .sq-go-btn'); await p.waitForTimeout(600);
  ok('条件が空だと札・分母を減らす（POD・モード・貿易条件の 3 つ）', /3\/3 一致/.test(await txt('#sqPanel .sq-lv')) && (await p.evaluate(() => document.querySelectorAll('#sqPanel .sq-card .sq-m').length)) === 3, await txt('#sqPanel .sq-lv'));

  // --- スマホ ---
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(400);
  await p.evaluate(() => window.sqBackToIntro && window.sqBackToIntro()); await p.evaluate(() => window.sqStartSearch());
  await p.waitForTimeout(300);
  ok('スマホ：下に固定の［探す］が出る・欄の中の［探す］は隠れる', await vis('#sqPanel .sq-actions--phone') && !(await vis('#sqPanel .sq-search-bar .sq-actions')), null);
  ok('スマホ：チップ・欄・ボタンは 44px 以上', await p.evaluate(() => ['.sq-mode-chip', '.sq-search-input', '.sq-go-btn'].every(s => { const e = document.querySelector('#sqPanel ' + s + (s === '.sq-go-btn' ? '' : '')); return e && e.getBoundingClientRect().height >= 43.5 || !e || e.getBoundingClientRect().height === 0; })), null);

  ok('ページエラーなし', errs.length === 0, errs.slice(0, 3));
  console.log(fails ? `\n${fails} 件失敗` : '\nすべて通過');
  await b.close(); srv.close(); process.exit(fails ? 1 : 0);
})();
