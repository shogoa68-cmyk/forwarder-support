// 出発地側・到着地側のデフォルトサブコン：その側の国（国欄→POL/POD の国→港名の推測）を得意エリアとするサブコンだけが候補に出る。
// 偽の Supabase（メモリ上の表）を使う。実サーバーには接続しない。
//   node scripts/design-tests/zone-subcon-test.js           （THEME=1 で Industry）
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
  const sv = (name, areas, extra) => ({ vote: { field: 'sv', value: name, voter_email: ME }, det: { field: 'sv', value: name, details: Object.assign({ areas }, extra || {}) } });
  const svs = [
    sv('ヤマト国内運輸', ['JP'], { furigana: 'やまとこくないうんゆ' }), sv('関東通関', ['JP-KAN']), sv('九州倉庫', ['JP-KYU']),
    sv('PHILA CUSTOMS', ['US'], { enName: 'Philadelphia Customs' }), sv('北米物流', ['NAM']),
    sv('VN LOGISTICS', ['VN']), sv('アジア全域', ['SEA', 'EAS']), sv('エリア未設定社', []),
  ];
  const seed = {
    master_votes: [...svs.map(x => x.vote), { field: 'port', value: 'YOKOHAMA', voter_email: ME }, { field: 'port', value: 'PHILADELPHIA', voter_email: ME }],
    synonym_groups: [],
    master_details: [...svs.map(x => x.det), { field: 'port', value: 'YOKOHAMA', details: { country: 'JP' } }, { field: 'port', value: 'PHILADELPHIA', details: { country: 'US' } }],
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

  const setVal = async (p, id, v, ev) => {
    await p.evaluate(([id, v, ev]) => { const el = document.getElementById(id); el.value = v; (ev || ['input', 'change']).forEach(t => el.dispatchEvent(new Event(t, { bubbles: true }))); }, [id, v, ev]);
    await p.waitForTimeout(300);
  };
  const opts = (p, id) => p.evaluate(id => { const el = document.getElementById(id); return { attr: el.getAttribute('list'), opts: el.list ? [...el.list.options].map(o => o.value).sort() : null }; }, id);
  const noteOf = (p, id) => p.evaluate(id => { const n = document.getElementById(id); return { hidden: n.hidden, text: n.textContent }; }, id);
  const prep = async p => { await p.evaluate(async () => { if (window.mdLoadCloud) await window.mdLoadCloud(); if (window.statsLoadMasterCache) await window.statsLoadMasterCache(); window.arRefreshDatalist(); }); await p.waitForTimeout(400); };

  const { ctx, p, errs } = await open(true, { legacy: {}, role: 'member' });
  await prep(p);
  let a = await opts(p, 'z1DefaultSc');
  ok('国が分からないあいだは、従来どおり全サブコンが候補（svSuggestions）', a.attr === 'svSuggestions' && a.opts.includes('PHILA CUSTOMS') && a.opts.includes('エリア未設定社'), a);
  ok('国が分からないあいだは、説明を出さない', (await noteOf(p, 'z1ScNote')).hidden === true);

  // POL = YOKOHAMA → 日本
  await setVal(p, 'z2Pol', 'YOKOHAMA', ['input', 'change']);
  a = await opts(p, 'z1DefaultSc');
  ok('POL を YOKOHAMA にすると、出発地側の候補が「日本を得意エリアとするサブコン」に絞られる（日本全国・関東・九州・東アジア）', a.attr === 'z1ScList' && JSON.stringify(a.opts) === JSON.stringify(['ヤマト国内運輸', '関東通関', '九州倉庫', 'アジア全域'].sort()), a);
  ok('海外のサブコンと、得意エリア未設定のサブコンは出ない', !a.opts.includes('PHILA CUSTOMS') && !a.opts.includes('VN LOGISTICS') && !a.opts.includes('エリア未設定社'), a);
  const n1 = await noteOf(p, 'z1ScNote');
  ok('説明に「日本（POL）を得意エリアとする登録済みサブコン 4 件」と出る', !n1.hidden && /日本/.test(n1.text) && /POL/.test(n1.text) && /4 件/.test(n1.text), n1);
  const d3 = await opts(p, 'z3DefaultSc');
  ok('到着地側は、POD が決まるまで全サブコンのまま', d3.attr === 'svSuggestions', d3);

  // POD = PHILADELPHIA → 米国（北米のサブコンも該当）
  await setVal(p, 'z2Pod', 'PHILADELPHIA', ['input', 'change']);
  const b2 = await opts(p, 'z3DefaultSc');
  ok('POD を PHILADELPHIA にすると、到着地側の候補が米国を得意エリアとするサブコン（米国・北米）に絞られる', b2.attr === 'z3ScList' && JSON.stringify(b2.opts) === JSON.stringify(['PHILA CUSTOMS', '北米物流'].sort()), b2);
  ok('出発地側の候補はそのまま（日本）', JSON.stringify((await opts(p, 'z1DefaultSc')).opts) === JSON.stringify(['ヤマト国内運輸', '関東通関', '九州倉庫', 'アジア全域'].sort()));
  const bl = await p.evaluate(() => { const o = [...document.getElementById('z3ScList').options].find(x => x.value === 'PHILA CUSTOMS'); return o ? o.label : null; });
  ok('候補に英語名が付く（英字でも探せる）', /Philadelphia Customs/.test(bl || ''), bl);

  // 幹線輸送の国欄が優先（港名より）
  await setVal(p, 'z2PodCountry', 'ベトナム', ['input', 'change']);
  const c2 = await opts(p, 'z3DefaultSc');
  ok('幹線輸送の POD の「国」を選ぶと、港名からの推測より優先（ベトナム＝ベトナム・東南アジア）', JSON.stringify(c2.opts) === JSON.stringify(['VN LOGISTICS', 'アジア全域'].sort()) && /POD の国/.test((await noteOf(p, 'z3ScNote')).text), c2);
  // 到着地側の国欄がいちばん優先
  await setVal(p, 'z3Country', '日本', ['input', 'change']);
  const d2 = await opts(p, 'z3DefaultSc');
  ok('到着地側の「国」欄に日本を入れると、それが最優先（日本のサブコン）', JSON.stringify(d2.opts) === JSON.stringify(['ヤマト国内運輸', '関東通関', '九州倉庫', 'アジア全域'].sort()) && /到着地側の国/.test((await noteOf(p, 'z3ScNote')).text), d2);
  await setVal(p, 'z3Country', '', ['input', 'change']);
  await setVal(p, 'z2PodCountry', '', ['input', 'change']);
  ok('国欄を空にすると、港名からの推測（米国）に戻る', JSON.stringify((await opts(p, 'z3DefaultSc')).opts) === JSON.stringify(['PHILA CUSTOMS', '北米物流'].sort()));

  // 「＋」で足した欄にも同じ候補
  await p.evaluate(() => { if (document.getElementById('zone1Card').classList.contains('zone-off')) window.toggleZone(1); });
  await p.evaluate(() => window.addDefaultScEntry(1)); await p.waitForTimeout(300);
  const add = await p.evaluate(() => { const ins = document.querySelectorAll('#z1DefaultScArea .sc-input'); const last = ins[ins.length - 1]; return { n: ins.length, list: last.getAttribute('list') }; });
  ok('「＋」で足したサブコン欄にも、同じ絞り込みの候補が付く', add.n === 2 && add.list === 'z1ScList', add);

  // 日本のサブコンが「該当なし」のとき
  await setVal(p, 'z2Pod', 'ROTTERDAM', ['input', 'change']);
  const e2 = await opts(p, 'z3DefaultSc');
  ok('該当するサブコンが無い国（オランダ）は、候補が空で、説明に設定のお願いが出る', e2.attr === 'z3ScList' && e2.opts.length === 0 && /得意エリア/.test((await noteOf(p, 'z3ScNote')).text) && /まだありません/.test((await noteOf(p, 'z3ScNote')).text), { e2, n: await noteOf(p, 'z3ScNote') });

  // 保存して開き直しても国の欄は保存される
  const saved = await p.evaluate(() => gatherAllData().fields);
  ok('国の欄は見積の項目として保存される', 'z1Country' in saved && 'z3Country' in saved);

  ok('JS エラーなし', errs.length === 0, errs);
  await ctx.close(); await b.close(); srv.close();
  const fails = out.filter(l => l.startsWith('FAIL')).length;
  console.log('\nFAIL=' + fails);
  process.exit(fails ? 1 : 0);
})();
