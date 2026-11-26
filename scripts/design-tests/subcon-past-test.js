// 明細テーブルで入力中のサブコンの「過去の明細」を、右パネル「サブコン」ですぐ探す（2026-11）
//   サブコン見出しの［🕘 過去の明細］・入力中の行に合わせる（追従）・英語名／ふりがなでの会社名検索
//   node scripts/design-tests/subcon-past-test.js   （THEME=1 で Industry／EDITOR=v2 で新画面／OUT=dir でスクショ）
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
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html?editor=${process.env.EDITOR === 'v2' ? 'v2' : 'v1'}`;
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
    const rowsA = [{ _type: 'data', cells: cell('A社', 'THC', '10000', '12000') }, { _type: 'data', cells: cell('A社', 'DOC FEE', '3000', '4000') }];
    const rowsP1 = [{ _type: 'data', cells: cell('株式会社 シーブリッジ', '保険料', '5000', '6000') }, { _type: 'data', cells: cell('A社', 'CFS', '4500', '5500') }];
    const rowsP2 = [{ _type: 'data', cells: cell('A社', 'THC', '11000', '13000') }];
    const rowsCur = [{ _type: 'data', cells: cell('株式会社シーブリッジ', '', '', '') }, { _type: 'data', cells: cell('A社', 'LSS', '100', '200') }, { _type: 'data', cells: cell('新しい会社', 'DRS', '200', '300') }];
    const db = {
      quote_presets: [
        mk('A', { 'qf-customer': '株式会社サンプル商事', 'qf-person': '田中', 'z2Pol': 'TOKYO', 'z2Pod': 'SHANGHAI', 'cond-mode': '海上（FCL）', 'cond-incoterms': 'FOB（本船渡し）', 'qf-received': '2026-01-05', 'qf-date': '2026-01-06', 'qf-valid-until': '2026-01-31', 'qf-core-ref': 'CORE-1', 'qf-lost-reason': '価格', 'qf-memo': '社内メモ', 'qf-versions': '[{"x":1}]' }, '2026-11-10T00:00:00Z', rowsA, '受注'),
        mk('B', { 'qf-customer': 'サンプル商事', 'z2Pol': 'YOKOHAMA', 'z2Pod': 'SHANGHAI', 'cond-mode': '海上（LCL）' }, '2026-11-09T00:00:00Z'),
        mk('C', { 'qf-customer': 'ABC物産', 'z2Pol': 'TOKYO', 'z2Pod': 'BANGKOK', 'cond-mode': '航空' }, '2026-11-08T00:00:00Z'),
        mk('D', { 'qf-customer': 'ＡＢＣ物産', 'z2Pol': 'Tokyo', 'z2Pod': 'SINGAPORE', 'cond-mode': '海上（FCL）' }, '2026-11-07T00:00:00Z'),
        mk('E', {}, '2026-11-06T00:00:00Z'),
        mk('P1', { 'qf-customer': 'X社' }, '2026-10-01T00:00:00Z', rowsP1),
        mk('P2', { 'qf-customer': 'Y社' }, '2026-10-02T00:00:00Z', rowsP2),
        mk('CUR', { 'qf-customer': 'Z社' }, '2026-11-20T00:00:00Z', rowsCur),
      ],
      quote_preset_links: [], allowed_emails: [{ email: 'me@x.com', role: 'admin', member_no: 1 }], user_profiles: [], quote_comments: [],
      master_votes: [{ field: 'sv', value: '株式会社シーブリッジ', voter: 'me@x.com' }, { field: 'sv', value: 'A社', voter: 'me@x.com' }], synonym_groups: [], master_details: [{ field: 'sv', value: '株式会社シーブリッジ', details: { furigana: 'しーぶりっじ', enName: 'SEA BRIDGE Co., Ltd.' } }], alias_rules: [], organizations: [], teams: [], org_members: [], team_members: [],
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
  await p.evaluate(() => window.cloudLoadPreset && window.cloudLoadPreset('CUR')); await p.waitForTimeout(1800);
  await p.evaluate(() => window.qpDockAction && window.qpDockAction()); await p.waitForTimeout(1200);   // 編集を始める
  if (process.env.EDITOR === 'v2') { await p.evaluate(() => { const b = document.querySelector('[data-e2s="4"]'); b && b.click(); }); await p.waitForTimeout(600); }
  const ev = (f, a) => p.evaluate(f, a);
  const cards = () => ev(() => [...document.querySelectorAll('#siListWrap .rp-sc-card .rp-sc-name')].map(e => e.textContent));
  const chip = () => ev(() => (document.querySelector('#siFocusBar .si-focus-chip b') || {}).textContent || '');
  const hdrBtn = (name) => ev(n => { const h = [...document.querySelectorAll('#tableBody tr.subcon-group-header')].find(t => (t.textContent || '').includes(n)); const b = h && h.querySelector('.sv-hdr-past'); return b ? { hidden: b.hidden, ok: true } : null; }, name);

  ok('見出しに［🕘 過去の明細］がある（サブコンのある枠）', !!(await hdrBtn('シーブリッジ')), null);
  ok('サブコン未設定の枠には出さない', await ev(() => { const h = [...document.querySelectorAll('#tableBody tr.subcon-group-header')].find(t => /未設定/.test(t.textContent)); return !h || !h.querySelector('.sv-hdr-past') || h.querySelector('.sv-hdr-past').hidden; }), null);

  // 見出しのボタンから開く
  await ev(() => { const h = [...document.querySelectorAll('#tableBody tr.subcon-group-header')].find(t => (t.textContent || '').includes('シーブリッジ')); h.querySelector('.sv-hdr-past').click(); });
  await p.waitForTimeout(1200);
  ok('右パネルのサブコンが開き、過去案件のペインが出る', await ev(() => { const pn = document.getElementById('siPane-past'); return !!pn && pn.style.display !== 'none' && pn.getClientRects().length > 0; }), null);
  ok('🎯 シーブリッジで絞り込み（空白の違いは同じ会社）', (await chip()) === '株式会社シーブリッジ' && JSON.stringify(await cards()) === JSON.stringify(['株式会社 シーブリッジ']), [await chip(), await cards()]);
  ok('その会社の過去の明細（保険料）が出る', await ev(() => [...document.querySelectorAll('#siListWrap .rp-sc-itemname')].map(e => e.textContent).includes('保険料')), null);

  // 入力中の行に合わせる
  await ev(() => { const tr = [...document.querySelectorAll('#tableBody tr')].find(t => !t.dataset.virtual && (t.querySelector('[data-field="sv"]') || {}).value === 'A社'); tr.querySelector('[data-field="pq"]').focus(); });
  await p.waitForTimeout(400);
  ok('A社の行に焦点を移すと、自動で A社 に切り替わる', (await chip()) === 'A社' && JSON.stringify(await cards()) === JSON.stringify(['A社']), [await chip(), await cards()]);
  if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, 'subcon-follow.png') });
  ok('A社の過去の明細（THC・DOC FEE・CFS）', await ev(() => { const n = [...document.querySelectorAll('#siListWrap .rp-sc-itemname')].map(e => e.textContent); return ['THC', 'DOC FEE', 'CFS'].every(x => n.includes(x)); }), null);

  // 過去の明細が無い会社
  await ev(() => { const tr = [...document.querySelectorAll('#tableBody tr')].find(t => !t.dataset.virtual && (t.querySelector('[data-field="sv"]') || {}).value === '新しい会社'); tr.querySelector('[data-field="pq"]').focus(); });
  await p.waitForTimeout(400);
  ok('過去の明細が無い会社は「見つかりませんでした」と出す', (await chip()) === '新しい会社' && /過去の明細は見つかりませんでした/.test(await ev(() => document.getElementById('siListWrap').textContent)), await ev(() => document.getElementById('siListWrap').textContent.slice(0,200)));

  // ✕ で外す → 追従も止まる
  await ev(() => document.querySelector('#siFocusBar .si-focus-x').click()); await p.waitForTimeout(300);
  ok('✕ で絞り込みを外すと全サブコンが出て、追従も OFF', (await chip()) === '' && (await cards()).length >= 2 && await ev(() => !document.getElementById('siFollowChk').checked), [await chip(), await cards()]);
  await ev(() => { const tr = [...document.querySelectorAll('#tableBody tr')].find(t => !t.dataset.virtual && (t.querySelector('[data-field="sv"]') || {}).value === 'A社'); tr.querySelector('[data-field="nm"]').focus(); });
  await p.waitForTimeout(300);
  ok('追従 OFF の間は、行を移っても絞り込まない', (await chip()) === '', await chip());

  // 英語名・ふりがなで会社名を探す
  await ev(() => { const q = document.getElementById('siSubconSearch'); q.value = 'SEA'; window.subconSidePanelFilter(); }); await p.waitForTimeout(300);
  ok('「SEA」（英語名）でシーブリッジの明細が出る', JSON.stringify(await cards()) === JSON.stringify(['株式会社 シーブリッジ']), await cards());
  ok('「SEA」でサブコンのチップにも出る', await ev(() => /シーブリッジ/.test(document.getElementById('siSvChips').textContent)), null);
  await ev(() => { const q = document.getElementById('siSubconSearch'); q.value = 'しーぶ'; window.subconSidePanelFilter(); }); await p.waitForTimeout(300);
  ok('ふりがな（ひらがな）でも当たる', JSON.stringify(await cards()) === JSON.stringify(['株式会社 シーブリッジ']), await cards());
  await ev(() => { const q = document.getElementById('siSubconSearch'); q.value = 'シーブ'; window.subconSidePanelFilter(); }); await p.waitForTimeout(300);
  ok('カタカナでも当たる', JSON.stringify(await cards()) === JSON.stringify(['株式会社 シーブリッジ']), await cards());
  await ev(() => { const q = document.getElementById('siSubconSearch'); q.value = ''; window.subconSidePanelFilter(); });

  // 追従を ON に戻すと、最後に触った行（A社）に合わせる
  await ev(() => { const c = document.getElementById('siFollowChk'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(300);
  ok('「入力中のサブコンに合わせる」を ON にすると、最後に触った行の A社 に合わせる', (await chip()) === 'A社', await chip());
  ok('追従の設定は端末に覚える', await ev(() => localStorage.getItem('siFollow_v1') === '1'), null);

  // 新画面の［⋯］メニュー
  if (process.env.EDITOR === 'v2') {
    ok('新画面：見出しのボタンは隠す（［⋯］の中へ）', await ev(() => { const b = document.querySelector('#tableBody tr.subcon-group-header .sv-hdr-past'); return b && getComputedStyle(b).display === 'none'; }), null);
    await ev(() => { const h = [...document.querySelectorAll('#tableBody tr.subcon-group-header')].find(t => (t.textContent || '').includes('シーブリッジ')); const m = h && h.querySelector('.gb-more'); m && m.click(); }); await p.waitForTimeout(300);
    const has = await ev(() => [...document.querySelectorAll('#gbMenu button, #gbMenu [role="menuitem"]')].some(b => /過去の明細/.test(b.textContent)));
    ok('新画面：［⋯］に「このサブコンの過去の明細」', has, null);
    if (has) {
      await ev(() => [...document.querySelectorAll('#gbMenu button, #gbMenu [role="menuitem"]')].find(b => /過去の明細/.test(b.textContent)).click()); await p.waitForTimeout(500);
      ok('新画面：メニューからシーブリッジに切り替わる', (await chip()) === '株式会社シーブリッジ', await chip());
    }
  }
  ok('JS エラーなし', errs.length === 0, errs);
  if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, 'subcon-past.png') });
  await b.close(); srv.close();
  console.log(fails ? 'FAIL=' + fails : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
