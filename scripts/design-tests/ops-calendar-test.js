// 📦 進行管理のカレンダー表示（月・週）
//   受注した案件のカードの札・ひな形（輸出 FCL／輸入 AIR）・チェック（日時と名前の記録・申し送り）・期限・追加／名前変更／並べ替え／削除・
//   上部の帯（進行中・期限切れ）・一覧・編集中の案件は見るだけ・コピーで引き継がない・編集画面の保存で消えない、を確かめる。
//   node scripts/design-tests/ops-progress-test.js   （CLASSIC=1 で現行／W=390 でスマホ幅）
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
  const W = parseInt(process.env.W || '1400', 10);

  async function open(opts) {
    opts = opts || {};
    const ctx = await b.newContext({ viewport: { width: W, height: 1000 }, locale: 'ja-JP' });
    if (process.env.CLASSIC) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: false, doc: false })); } catch (e) {} });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('fwd.uiMode', 'detail');  } catch (e) {}
      const iso = d => { const t = new Date(); t.setDate(t.getDate() + d); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
      const mk = (id, ct, status, follower, extra) => Object.assign({
        id, name: '案件' + id, status, customer: 'X社', created_by: 'tanaka@x.com', owner_email: 'tanaka@x.com',
        updated_at: '2026-11-' + ct + 'T00:00:00Z', ref: 'R-' + id,
        data: { fields: Object.assign({ 'qf-ref': 'R-' + id, 'qf-status': status }, follower ? { 'qf-follower': follower } : {}), rows: [] },
      }, extra || {});
      const fresh = new Date().toISOString();
      const db = {
        quote_presets: [
          mk('B1', '10', '受注', '', { name: '輸出FCL案件' }),
          mk('B2', '11', '受注', '', { name: '輸入AIR案件' }),
          mk('B3', '12', '下書き中', '', { name: '下書き案件' }),
          mk('B4', '13', '受注', '', { name: '編集中の受注', locked_by: 'tanaka@x.com', locked_at: fresh }),
        ],
        allowed_emails: [{ email: 'me@x.com', role: 'admin', member_no: 1 }, { email: 'tanaka@x.com', role: 'member', member_no: 2 }, { email: 'suzuki@x.com', role: 'member', member_no: 3 }],
        user_profiles: [{ email: 'me@x.com', display_name: '自分' }, { email: 'tanaka@x.com', display_name: '田中' }, { email: 'suzuki@x.com', display_name: '鈴木' }],
        quote_comments: [], quote_preset_links: [], master_votes: [], synonym_groups: [], master_details: [], alias_rules: [], organizations: [], teams: [], org_members: [], team_members: [],
      };
      Object.assign(db.quote_presets[0].data.fields, { 'cond-direction': 'export', 'cond-mode': '海上（FCL）' });
      Object.assign(db.quote_presets[1].data.fields, { 'cond-direction': 'import', 'cond-mode': '航空（AIR）' });
      db.quote_presets[0].data.fields['qf-ops'] = JSON.stringify({ v: 1, tpl: 'exp-fcl', s: [
        { id: 's1', l: 'ブッキング依頼', d: false, at: '', by: '', due: iso(2) },
        { id: 's2', l: '本船出港', d: false, at: '', by: '', due: '', dk: 'd2' },
        { id: 's3', l: 'SI（船積指示）の提出', d: true, at: new Date().toISOString(), by: 'me@x.com', due: '', dk: 'd3' },
      ], dl: [
        { id: 'd1', k: 'cy_cut', l: '', d: iso(1), note: '', g: 0 },
        { id: 'd2', k: 'etd', l: '', d: iso(-3), note: '', g: 0 },
        { id: 'd3', k: 'si_cut', l: '', d: iso(0), note: '', g: 0 },
        { id: 'd4', k: 'free', l: '日付なし', d: '', note: '', g: 0 },
      ] });
      db.calendar_holidays = [
        { id: 'h1', source_type: 'jp', name: '試験の祝日', event_date: iso(1) },
        { id: 'h2', source_type: 'partner', name: '夏季休業', company_name: '山田運送', event_date: iso(2), end_date: iso(3) },
        { id: 'h3', source_type: 'overseas', name: 'Test Day', country_code: 'CN', event_date: iso(0) },
      ];
      window.__iso = iso;
      window.__db = db; window.__writes = [];
      const isLocked = r => r.locked_by && r.locked_by !== 'me@x.com' && (Date.now() - new Date(r.locked_at).getTime()) < 90000;
      const qb = t => {
        const st = { op: 'select', filters: [], payload: null };
        const api = {
          select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, is() { return api; }, ilike() { return api; },
          gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; }, or() { return api; },
          eq(k, v) { st.filters.push(r => r[k] === v); return api; },
          in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
          upsert(o) { st.op = 'insert'; st.payload = o; return api; }, insert(o) { st.op = 'insert'; st.payload = o; return api; },
          update(o) { st.op = 'update'; st.payload = o; return api; }, delete() { st.op = 'delete'; return api; },
          single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
          then(res, rej) {
            const rows = (db[t] = db[t] || []);
            let data = null;
            if (st.op === 'insert') {
              const made = [].concat(st.payload).map(o => Object.assign({ id: 'id' + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, JSON.parse(JSON.stringify(o))));
              made.forEach(r => rows.push(r)); data = st.single ? made[0] : made;
              window.__writes.push({ t, op: 'insert', payload: JSON.parse(JSON.stringify(st.payload)) });
            } else if (st.op === 'delete') { db[t] = rows.filter(r => !st.filters.every(f => f(r))); }
            else if (st.op === 'update') {
              const hit = rows.filter(r => st.filters.every(f => f(r)) && !(t === 'quote_presets' && isLocked(r)));   // 編集ロック中は RLS で 0 行
              hit.forEach(r => Object.assign(r, JSON.parse(JSON.stringify(st.payload))));
              data = hit.map(r => ({ id: r.id }));
              window.__writes.push({ t, op: 'update', n: hit.length });
            } else {
              data = rows.filter(r => st.filters.every(f => f(r))).map(r => JSON.parse(JSON.stringify(r)));
              if (st.single) data = data[0] || null;
            }
            return Promise.resolve({ data, error: null }).then(res, rej);
          },
        };
        return api;
      };
      const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() { return Promise.resolve(); }, presenceState() { return {}; } };
      const user = { email: 'me@x.com', user_metadata: { full_name: '自分' } };
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
    await p.evaluate(() => window.qpShowDashboard && window.qpShowDashboard()); await p.waitForTimeout(1500);
    return { ctx, p, errs };
  }
  const { ctx, p, errs } = await open();
  const iso = n => p.evaluate(n => window.__iso(n), n);
  await p.evaluate(() => window.opsGoTab('active')); await p.waitForTimeout(800);
  ok('進行管理に［☰ 一覧｜📅 カレンダー］の切り替え', await p.evaluate(() => document.querySelectorAll('#opsRoot .opt-view [data-opt="view"]').length === 2));
  await p.evaluate(() => document.querySelector('#opsRoot [data-opt="view"][data-v="cal"]').click()); await p.waitForTimeout(400);
  const ev = () => p.evaluate(() => [...document.querySelectorAll('#opsRoot .opc-day')].map(d => ({ d: d.dataset.day, ev: [...d.querySelectorAll('.opc-ev')].map(e => ({ t: e.querySelector('.opc-ev-k').textContent, c: e.className })) })).filter(x => x.ev.length));
  let m = await ev();
  const t1 = await iso(1), t0 = await iso(0), tm3 = await iso(-3), t2 = await iso(2);
  const on = (d, re) => { const x = m.find(y => y.d === d); return x ? x.ev.find(e => re.test(e.t)) : null; };
  ok('月の表示（既定）・今日のマスに印', await p.evaluate(() => !!document.querySelector('#opsRoot .opc-cal.is-month .opc-day.is-today')));
  // 月をまたぐ日付は、その月のときだけ確かめる
  const sameMonth = d => d.slice(0, 7) === t0.slice(0, 7) || m.some(y => y.d === d);
  if (sameMonth(t1)) ok('明日の CY カットは黄（今日・明日）', !!on(t1, /CY カット/) && /is-soon/.test(on(t1, /CY カット/).c), m);
  if (sameMonth(tm3)) ok('過ぎた ETD は赤', !!on(tm3, /ETD/) && /is-over/.test(on(tm3, /ETD/).c), m);
  ok('済みの SI カットは灰色（グレーアウト）', !!on(t0, /SI カット/) && /is-gray/.test(on(t0, /SI カット/).c), m);
  if (sameMonth(t2)) ok('期限を入れた作業も並ぶ（作業の期限）', !!on(t2, /ブッキング依頼/) && /is-step/.test(on(t2, /ブッキング依頼/).c), m);
  ok('日付のない締め切りは出さない', !m.some(x => x.ev.some(e => /日付なし/.test(e.t))), m);
  ok('凡例と件数の要約', await p.evaluate(() => /まだ/.test(document.querySelector('#opsRoot .opc-cal-sum').textContent) && document.querySelectorAll('#opsRoot .opc-lg').length === 4));
  // 押すとチェックリスト
  await p.evaluate(d => document.querySelector('#opsRoot .opc-day[data-day="' + d + '"] .opc-ev').click(), t0); await p.waitForTimeout(500);
  ok('札を押すとチェックリストが開く', await p.evaluate(() => !document.getElementById('opmModal').hidden));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // 週
  await p.evaluate(() => document.querySelector('#opsRoot [data-opt="calmode"][data-v="week"]').click()); await p.waitForTimeout(400);
  ok('週の表示：7 日・今日を含む', await p.evaluate(t0 => document.querySelectorAll('#opsRoot .opc-cal.is-week .opc-day').length === 7 && !!document.querySelector('#opsRoot .opc-day[data-day="' + t0 + '"].is-today'), t0));
  ok('週の表示はお客様名まで出す', await p.evaluate(() => [...document.querySelectorAll('#opsRoot .is-week .opc-ev-s')].some(e => /X社/.test(e.textContent))));
  const title0 = await p.evaluate(() => document.getElementById('opcCalTitle').textContent);
  await p.evaluate(() => document.querySelector('#opsRoot [data-opt="calnav"][data-d="1"]').click()); await p.waitForTimeout(300);
  const title1 = await p.evaluate(() => document.getElementById('opcCalTitle').textContent);
  await p.evaluate(() => document.querySelector('#opsRoot [data-opt="caltoday"]').click()); await p.waitForTimeout(300);
  ok('［›］で次の週・［今日］で戻る', title0 !== title1 && await p.evaluate(() => document.getElementById('opcCalTitle').textContent) === title0, [title0, title1]);
  // 月の日付を押すとその週へ
  await p.evaluate(() => document.querySelector('#opsRoot [data-opt="calmode"][data-v="month"]').click()); await p.waitForTimeout(300);
  await p.evaluate(t0 => document.querySelector('#opsRoot .opc-day[data-day="' + t0 + '"] .opc-day-n').click(), t0); await p.waitForTimeout(300);
  ok('月の日付を押すと、その週の表示へ', await p.evaluate(() => !!document.querySelector('#opsRoot .opc-cal.is-week')));
  // 検索
  await p.evaluate(() => { const q = document.getElementById('optQ'); q.value = 'CY カット'; q.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(300);
  ok('検索で絞り込める', await p.evaluate(() => { const ks = [...document.querySelectorAll('#opsRoot .opc-ev-k')].map(e => e.textContent); return ks.length >= 1 && ks.every(k => /CY カット/.test(k)); }));
  await p.evaluate(() => { const q = document.getElementById('optQ'); q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(200);
  if (process.env.OUT) await p.locator('#opsRoot').screenshot({ path: process.env.OUT });
  // 祝日・休業日の重ね表示
  await p.evaluate(() => document.querySelector('#opsRoot [data-opt="calhol"]') && document.querySelector('#opsRoot [data-opt="calmode"][data-v="week"]').click()); await p.waitForTimeout(400);
  const hd1 = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('#opsRoot .opc-day')].map(d => [d.dataset.day, { cls: d.className, hol: [...d.querySelectorAll('.opc-hol')].map(h => h.className.replace('opc-hol ', '') + ':' + h.textContent) }])));
  // 今日の週と次の週の両方を読む（曜日によって、明日〜3 日後が次の週になるため）
  const hd = async () => {
    const A = await hd1();
    await p.evaluate(() => document.querySelector('#opsRoot [data-opt="calnav"][data-d="1"]').click()); await p.waitForTimeout(200);
    const B = await hd1();
    await p.evaluate(() => document.querySelector('#opsRoot [data-opt="caltoday"]').click()); await p.waitForTimeout(200);
    return Object.assign(B, A);
  };
  let H = await hd();
  ok('重ねて表示のチップ 3 つ（日本の祝日・協力会社・海外）・既定は日本と協力会社', await p.evaluate(() => { const c = [...document.querySelectorAll('#opsRoot .opc-holchip')]; return c.length === 3 && c.filter(b => b.classList.contains('is-on')).length === 2 && !document.querySelector('#opsRoot .opc-holchip.is-overseas.is-on'); }));
  ok('日本の祝日はマスに名前と赤み', H[t1] && /is-hol/.test(H[t1].cls) && H[t1].hol.some(x => /is-jp.*試験の祝日/.test(x)), H[t1]);
  ok('祝日に締め切り（CY カット）があると「⚠ 休日」', H[t1] && /is-warn/.test(H[t1].cls), H[t1]);
  ok('協力会社の休業日は期間の毎日に会社名つき', H[t2] && H[t2].hol.some(x => /is-partner.*山田運送/.test(x)) && H[await iso(3)] && H[await iso(3)].hol.some(x => /山田運送/.test(x)), [H[t2], H[await iso(3)]]);
  ok('海外の祝日は既定では出さない', !(H[t0].hol || []).some(x => /overseas/.test(x)), H[t0]);
  await p.evaluate(() => document.querySelector('#opsRoot .opc-holchip.is-overseas').click()); await p.waitForTimeout(300);
  H = await hd();
  ok('海外の祝日を ON にすると国コードつきで出る', H[t0].hol.some(x => /is-overseas.*CN/.test(x)), H[t0]);
  await p.evaluate(() => document.querySelector('#opsRoot .opc-holchip.is-jp').click()); await p.waitForTimeout(300);
  H = await hd();
  ok('日本の祝日を OFF にすると消える・設定は端末に保存', !H[t1].hol.some(x => /is-jp/.test(x)) && await p.evaluate(() => { const v = JSON.parse(localStorage.getItem('opsCalHol_v1')); return v.jp === false && v.overseas === true; }), H[t1]);
  await p.evaluate(() => document.querySelector('#opsRoot .opc-holchip.is-jp').click()); await p.waitForTimeout(300);
  if (process.env.OUT2) await p.locator('#opsRoot .opc-cal').screenshot({ path: process.env.OUT2 });
  // タイルを押すと一覧へ戻る
  await p.evaluate(() => document.querySelector('#opsRoot .opt-tile[data-f="active"]').click()); await p.waitForTimeout(300);
  ok('タイルを押すと一覧の表示へ', await p.evaluate(() => !document.querySelector('#opsRoot .opc-cal') && !!document.querySelector('#opsRoot .opt-list')));
  ok('ページのエラーなし', errs.length === 0, errs);
  await ctx.close();
  await b.close(); srv.close();
  console.log(fails ? 'FAIL=' + fails : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();

