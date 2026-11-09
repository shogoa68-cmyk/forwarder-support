// 幹線輸送の POL／経由地／POD：国を選ぶと、その国に設定済みの港だけが候補に出る。未登録の港は、その国の港として登録（承認制は申請）できる。
// 偽の Supabase（メモリ上の表）を使う。実サーバーには接続しない。
//   node scripts/design-tests/port-country-test.js           （THEME=1 で Industry）
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

  // クラウド（偽）の初期データ
  const ME = 's@example.com';
  const seed = {
    master_votes: [
      { field: 'port', value: 'HO CHI MINH', voter_email: ME }, { field: 'port', value: 'HAIPHONG', voter_email: ME },
      { field: 'port', value: 'YOKOHAMA', voter_email: ME }, { field: 'port', value: 'OSAKA', voter_email: ME },
      { field: 'port', value: 'NOCOUNTRY PORT', voter_email: ME },
    ],
    synonym_groups: [],
    master_details: [
      { field: 'port', value: 'HO CHI MINH', details: { country: 'VN', furigana: 'ほーちみん', enName: 'Ho Chi Minh' } },
      { field: 'port', value: 'HAIPHONG', details: { country: 'VN' } },
      { field: 'port', value: 'YOKOHAMA', details: { country: 'JP' } },
      { field: 'port', value: 'OSAKA', details: { country: 'JP' } },
    ],
    alias_rules: [],
  };
  // このブラウザにだけ残っている古いデータ（移行の対象）
  const legacy = {
    masterCandidates_v1: [{ field: 'nm', value: 'ローカル品名', votes: 1 }, { field: 'nm', value: 'THC', votes: 1 }],
    synonymGroups_v1: [{ id: 'l1', field: 'sv', canonical: 'ローカル運送', aliases: ['ﾛｰｶﾙ運送'] }],
    masterDetails_v1: [{ field: 'nm', value: 'ローカル品名', details: { defaultUnit: 'B/L' } }],
    aliasRules_v1: [{ id: 'l2', field: 'port', from_value: 'YKH', to_value: 'Yokohama' }],
    abbrevPairs_v1: [{ id: 'l3', field: 'carrier', abbrev: 'NTL', full: 'NAIGAI TRANS LINES' }],
    statsExclusions_v1: [{ field: 'nm', value: 'ローカル除外', created_at: '2026-01-01T00:00:00Z' }],
  };

  // opts.approval：申請テーブル（master_requests）を用意する＝承認制、opts.role：get_my_role() の結果
  async function open(loggedIn, opts = {}) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
    if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
    await ctx.addInitScript(({ seed, legacy, loggedIn, ME, opts }) => {
      try {
        localStorage.setItem('fwd.uiMode', 'detail');
        Object.entries(legacy).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v)));
        if (opts.backup) localStorage.setItem('masterLocalBackup_v1', JSON.stringify(opts.backup));
      } catch (e) {}
      if (!loggedIn) return;
      const db = JSON.parse(JSON.stringify(seed));
      if (opts.approval) db.master_requests = [];
      if (opts.excl) db.stats_exclusions = [];
      window.__db = db;
      const qb = t => {
        const st = { op: 'select', filters: [], payload: null, opts: null, one: false, range: null };
        const api = {
          select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, or() { return api; },
          is() { return api; }, ilike() { return api; }, gte() { return api; }, lte() { return api; },
          range(a, z) { st.range = [a, z]; return api; },
          eq(k, v) { st.filters.push(r => r[k] === v); return api; },
          in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
          match(o) { st.filters.push(r => Object.keys(o).every(k => r[k] === o[k])); return api; },
          upsert(o, opts) { st.op = 'upsert'; st.payload = o; st.opts = opts; return api; },
          insert(o) { st.op = 'insert'; st.payload = o; return api; },
          update(o) { st.op = 'update'; st.payload = o; return api; },
          delete() { st.op = 'delete'; return api; },
          single() { st.one = true; return api; }, maybeSingle() { st.one = true; return api; },
          then(res, rej) {
            // 申請テーブルは承認制の試験のときだけ存在する（無いときは未作成のエラー＝従来の動き）
            if ((t === 'master_requests' || t === 'stats_exclusions') && !db[t]) return Promise.resolve({ data: null, error: { message: 'relation "' + t + '" does not exist' } }).then(res, rej);
            const rows = (db[t] = db[t] || []);
            // 1 行でも不正（制約違反）なら、まとめて書いた分も全体が失敗する（Postgres と同じ）
            if (opts.badKey && (st.op === 'upsert' || st.op === 'insert') && [].concat(st.payload).some(o => [o.canonical, o.value, o.from_value].includes(opts.badKey))) return Promise.resolve({ data: null, error: { message: 'violates check constraint' } }).then(res, rej);
            if (opts.failDetailWrites && t === 'master_details' && st.op !== 'select') return Promise.resolve({ data: null, error: { message: 'new row violates row-level security policy' } }).then(res, rej);
            let data = null;
            if (st.op === 'upsert' || st.op === 'insert') {
              [].concat(st.payload).forEach(o => {
                const keys = ((st.opts && st.opts.onConflict) || '').split(',').filter(Boolean);
                const i = keys.length ? rows.findIndex(r => keys.every(k => r[k] === o[k])) : -1;
                if (i >= 0) Object.assign(rows[i], o); else rows.push(Object.assign({ id: 'id' + Math.random().toString(36).slice(2) }, o));
              });
            } else if (st.op === 'delete') {
              db[t] = rows.filter(r => !st.filters.every(f => f(r)));
            } else if (st.op === 'update') {
              rows.filter(r => st.filters.every(f => f(r))).forEach(r => Object.assign(r, st.payload));
            } else {
              data = rows.filter(r => st.filters.every(f => f(r)));
              if (st.range) data = data.slice(st.range[0], st.range[1] + 1);
              if (st.one) data = data[0] || null;
            }
            return Promise.resolve({ data, error: null }).then(res, rej);
          },
        };
        return api;
      };
      const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, presenceState() { return {}; }, unsubscribe() { return Promise.resolve(); }, send() { return Promise.resolve(); } };
      const user = { email: ME, user_metadata: { full_name: 'S' } };
      const client = {
        from: qb, rpc: name => Promise.resolve({ data: name === 'get_my_role' ? (opts.role || 'member') : null, error: null }), channel: () => ch, removeChannel() {}, storage: { from: () => ({}) },
        auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signOut: () => Promise.resolve({}), signInWithOAuth: () => Promise.resolve({}) },
      };
      window.supabase = { createClient: () => client };
    }, { seed, legacy: (opts.legacy !== undefined ? opts.legacy : legacy), loggedIn, ME, opts });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    const p = await ctx.newPage();
    const errs = [], dlg = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', d => { dlg.push(d.message()); d.accept(); });
    p.setDefaultTimeout(10000);
    await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
    await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1000);
    await p.evaluate(() => window.qpShowEditor && window.qpShowEditor()); await p.waitForTimeout(1200);
    await p.evaluate(async () => { if (window.statsLoadMasterCache) await window.statsLoadMasterCache(); if (window.arRefreshDatalist) window.arRefreshDatalist(); });
    return { ctx, p, errs, dlg };
  }
  const setCountry = async (p, id, v) => {
    await p.evaluate(([id, v]) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
    await p.waitForTimeout(250);
  };
  const setPort = async (p, id, v) => {
    await p.evaluate(id => { const el = document.getElementById(id); el.scrollIntoView({ block: 'center' }); }, id);
    await p.waitForTimeout(300);   // 先に動かしておく（吹き出しは、あとからスクロールが起きると閉じるため）
    await p.evaluate(([id, v]) => { const el = document.getElementById(id); el.focus(); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
    await p.waitForTimeout(400);
  };
  const listOf = (p, id) => p.evaluate(id => { const el = document.getElementById(id); return { attr: el.getAttribute('list'), opts: el.list ? [...el.list.options].map(o => o.value) : null }; }, id);
  const bubble = p => p.evaluate(() => { const b = document.querySelector('.syn-suggest'); return b ? { text: b.textContent, apply: (b.querySelector('.syn-suggest-apply') || {}).textContent } : null; });
  const prep = async p => { await p.evaluate(async () => { if (window.mdLoadCloud) await window.mdLoadCloud(); if (window.statsLoadMasterCache) await window.statsLoadMasterCache(); window.arRefreshDatalist(); }); await p.waitForTimeout(300); };

  // ===== 承認制のメンバー =====
  {
    const { ctx, p, errs, dlg } = await open(true, { legacy: {}, approval: true, role: 'member' });
    await prep(p);
    let l = await listOf(p, 'z2Pol');
    ok('国を選ぶ前は、全港が候補（従来どおり）', l.attr === 'portSuggestions' && l.opts.includes('YOKOHAMA') && l.opts.includes('HAIPHONG') && l.opts.includes('NOCOUNTRY PORT'), l);
    await setCountry(p, 'z2PolCountry', 'ベトナム');
    l = await listOf(p, 'z2Pol');
    ok('国（ベトナム）を選ぶと、その国に設定済みの港だけが候補に出る（国が未設定の港・他の国の港は出ない）', l.attr === 'z2PolList' && JSON.stringify(l.opts) === JSON.stringify(['HAIPHONG', 'HO CHI MINH']), l);
    const note = await p.evaluate(() => { const n = document.getElementById('z2PortCountryNote'); return { hidden: n.hidden, text: n.textContent }; });
    ok('欄の下に「POL：ベトナムの登録済み港 2 件から選べます」と出る', !note.hidden && /POL：ベトナムの登録済み港 2 件/.test(note.text), note);
    const lp = await listOf(p, 'z2Pod');
    ok('国の選択は欄ごと（POD はまだ全港）', lp.attr === 'portSuggestions', lp);
    await setCountry(p, 'z2PodCountry', 'jp');
    const lp2 = await p.evaluate(() => ({ v: document.getElementById('z2PodCountry').value, opts: [...document.getElementById('z2Pod').list.options].map(o => o.value) }));
    ok('国コード（jp）で入れても「日本」になり、日本の港だけが候補になる', lp2.v === '日本' && JSON.stringify(lp2.opts) === JSON.stringify(['OSAKA', 'YOKOHAMA']), lp2);
    await setCountry(p, 'z2PodCountry', '');
    // 登録済みの港は、国が違っても「未登録」の印や登録の確認を出さない
    await setPort(p, 'z2Pol', 'YOKOHAMA');
    ok('マスターにある港（別の国の港でも）には、登録の確認も「未登録」の印も出ない', !(await bubble(p)) && !(await p.evaluate(() => document.getElementById('z2Pol').classList.contains('name-unregistered'))), await bubble(p));
    await setPort(p, 'z2Pol', 'HAIPHONG');
    ok('その国の登録済みの港にも、確認は出ない', !(await bubble(p)), await bubble(p));
    // 未登録の港 → 申請
    await setPort(p, 'z2Pol', 'DA NANG');
    if (process.env.SHOT) { await p.evaluate(() => document.getElementById('z2Pol').scrollIntoView({ block: 'center' })); await p.waitForTimeout(500); await p.screenshot({ path: process.env.SHOT, clip: { x: 0, y: 150, width: 900, height: 600 } }); }
    const bb = await bubble(p);
    ok('国を選んだうえで未登録の港を入れると、「ベトナムの港として登録を申請」の確認が出る', bb && /未登録/.test(bb.text) && /ベトナムの港として登録を申請/.test(bb.apply), bb);
    await p.click('.syn-suggest-apply'); await p.waitForTimeout(1200);
    const reqs = await p.evaluate(() => window.__db.master_requests.map(r => ({ f: r.field, v: r.value, c: r.country, s: r.status })));
    ok('申請に国（VN）が付く（マスターにはまだ入らない）', reqs.length === 1 && reqs[0].f === 'port' && reqs[0].v === 'DA NANG' && reqs[0].c === 'VN' && reqs[0].s === 'pending', reqs);
    ok('申請したあと、同じ港の確認はもう「申請中」扱いで二重に申請されない', await (async () => { await setPort(p, 'z2Pol', 'DA NANG'); if (await bubble(p)) await p.click('.syn-suggest-apply'); await p.waitForTimeout(800); return (await p.evaluate(() => window.__db.master_requests.length)) === 1; })(), null);
    // 国を選んでいなければ、確認は出ない
    await setCountry(p, 'z2PolCountry', '');
    await setPort(p, 'z2Pol', 'KAOHSIUNG');
    ok('国を選んでいないときは、未登録の港でも確認は出ない（従来どおり）', !(await bubble(p)), await bubble(p));
    ok('国を空に戻すと、全港が候補に戻る', (await listOf(p, 'z2Pol')).attr === 'portSuggestions', await listOf(p, 'z2Pol'));
    // 保存される項目に含まれる
    ok('国の入力欄は見積の保存項目に含まれる（開き直しても国の選択が戻る）', await p.evaluate(() => { document.getElementById('z2PolCountry').value = 'ベトナム'; const d = gatherAllData(); return Object.prototype.hasOwnProperty.call(d.fields, 'z2PolCountry') && d.fields.z2PolCountry === 'ベトナム'; }), null);
    ok('JS エラーなし（メンバー）', errs.length === 0, errs);
    await ctx.close();
  }
  // ===== 管理者：直接登録して国を付ける／メンバーの国つき申請を承認すると国が付く =====
  {
    const { ctx, p, errs } = await open(true, { legacy: {}, approval: true, role: 'admin' });
    await prep(p);
    await p.waitForTimeout(1500);   // 管理者の権限の読み込みが終わるのを待つ
    await setCountry(p, 'z2PolCountry', 'ベトナム');
    await setPort(p, 'z2Pol', 'DA NANG');
    const bb = await bubble(p);
    ok('管理者の確認は「マスター登録」', bb && /ベトナムの港としてマスター登録/.test(bb.apply), bb);
    await p.click('.syn-suggest-apply'); await p.waitForTimeout(1500);
    const st = await p.evaluate(() => ({ votes: window.__db.master_votes.filter(v => v.field === 'port' && v.value === 'DA NANG').length, det: (window.__db.master_details.find(d => d.field === 'port' && d.value === 'DA NANG') || {}).details }));
    ok('管理者が登録すると、マスターに入り、国（VN）が付く', st.votes === 1 && st.det && st.det.country === 'VN', st);
    const l = await listOf(p, 'z2Pol');
    ok('登録した港が、すぐこの国の候補に出る', l.opts.includes('DA NANG'), l);
    // メンバーが出した国つきの申請を、管理者が承認する
    await p.evaluate(() => { window.__db.master_requests.push({ id: 'rq1', field: 'port', value: 'HAI PHONG 2', country: 'VN', requested_by: 'm@example.com', status: 'pending' }); });
    await p.evaluate(async () => { await window.statsLoadMasterCache(); });
    await p.evaluate(async () => { await window.statsApproveRequest('rq1'); }); await p.waitForTimeout(1500);
    const ap = await p.evaluate(() => ({ r: window.__db.master_requests.find(r => r.id === 'rq1').status, det: (window.__db.master_details.find(d => d.field === 'port' && d.value === 'HAI PHONG 2') || {}).details, vote: window.__db.master_votes.some(v => v.value === 'HAI PHONG 2') }));
    ok('国つきの申請を承認すると、マスターに入り、国が付く', ap.r === 'approved' && ap.vote && ap.det && ap.det.country === 'VN', ap);
    ok('JS エラーなし（管理者）', errs.length === 0, errs);
    await ctx.close();
  }
  await b.close(); srv.close();
  console.log(out.join('\n'));
})();
