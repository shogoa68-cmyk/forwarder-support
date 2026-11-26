// スマホ：見積タブの「過去の事例」のモーダルで、カードの全文シートを閉じて元の画面に戻れるかの試験（2026-11）。
// 偽の Supabase。W=390（既定）・THEME=1 で Industry。
//   node scripts/design-tests/cases-sheet-mobile-test.js
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
process.env.W = process.env.W || '390'; process.env.H = process.env.H || '844';
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
  const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  const ME = 's@example.com';
  const seed = { master_votes: [{ field: 'customer', value: 'カルテ商事', voter_email: ME }], synonym_groups: [], master_details: [{ field: 'customer', value: 'カルテ商事', details: { dealType: '荷主（直接）' } }], alias_rules: [],
    customer_cases: [
      { id: 'c1', customer: 'カルテ商事', occurred_on: '2026-03-10', kind: 'cost', title: '請求書の宛先違い', situation: '旧住所宛てに発行', action: '再発行', improvement: '住所を確認', status: 'open', created_by: ME, created_at: '2026-03-10T00:00:00Z' },
      { id: 'c2', customer: 'カルテ商事', occurred_on: '2026-02-01', kind: 'doc', title: '原本が間に合わず1便遅れ', situation: '原本の郵送が遅れた', action: '電子B/L', improvement: '3営業日前', status: 'open', created_by: ME, created_at: '2026-02-01T00:00:00Z' },
    ] };
  const legacy = {};

  async function open(loggedIn, opts = {}) {
    const ctx = await b.newContext({ viewport: { width: +(process.env.W || 1400), height: +(process.env.H || 900) }, locale: 'ja-JP' });
    if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
    if (process.env.QUIET) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ quiet: true })); } catch (e) {} });
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
            if (st.op === 'select') { window.__sel = window.__sel || {}; window.__sel[t] = (window.__sel[t] || 0) + 1; }
            // 申請テーブルは承認制の試験のときだけ存在する（無いときは未作成のエラー＝従来の動き）
            if ((t === 'master_requests' || t === 'stats_exclusions') && !db[t]) return Promise.resolve({ data: null, error: { message: 'relation "' + t + '" does not exist' } }).then(res, rej);
            const rows = (db[t] = db[t] || []);
            // 1 行でも不正（制約違反）なら、まとめて書いた分も全体が失敗する（Postgres と同じ）
            if (opts.badKey && (st.op === 'upsert' || st.op === 'insert') && [].concat(st.payload).some(o => [o.canonical, o.value, o.from_value].includes(opts.badKey) || (o.aliases || []).includes(opts.badKey))) return Promise.resolve({ data: null, error: { message: 'violates check constraint' } }).then(res, rej);
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
    // 詳細ポップアップはタブ形式：隠れているタブの中の入力欄を操作するときは、先にそのタブを開く
    for (const m of ['fill', 'click', 'selectOption']) {
      const orig = p[m].bind(p);
      p[m] = async (sel, ...r) => {
        if (typeof sel === 'string' && sel.includes('#md')) {
          await p.evaluate(s => { const e = document.querySelector(s); const pn = e && e.closest('.mt-panel'); if (pn && pn.hidden) { const t = document.querySelector('#mdDetailModal .mt-tab[data-mt="' + pn.dataset.mt + '"]'); t && t.click(); } }, sel).catch(() => {});
        }
        return orig(sel, ...r);
      };
    }
    return { ctx, p, errs, dlg };
  }

  const L = '[事例シート・スマホ] ';
  const { ctx, p, errs } = await open(true, { legacy: {} });
  await p.evaluate(async () => { document.getElementById('qf-ref').value = 'R-009'; document.getElementById('qf-customer').value = 'カルテ商事'; await crRefreshBanner(); });
  await p.waitForTimeout(300);
  await p.evaluate(() => document.querySelector('#crBanner .cc-chip').click()); await p.waitForTimeout(400);
  ok(L + '過去の事例のモーダルが開く', await p.evaluate(() => document.querySelectorAll('#ccModalBody .cc-item').length === 2));
  const topAt = sel => p.evaluate(s => { const e = document.querySelector(s); if (!e) return 'none'; const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === e || e.contains(t)) ? true : (t ? t.className || t.tagName : 'null'); }, sel);
  const tapAt = async sel => { const r = await p.evaluate(s => { const b = document.querySelector(s).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, sel); await p.mouse.click(r.x, r.y); await p.waitForTimeout(300); };
  await tapAt('#ccModalBody .cc-item .cc-title');
  ok(L + 'カードを押すと全文のシートが開く', await p.evaluate(() => !!document.querySelector('#ccModalBody .cc-item.cc-sheet-open')));
  const t1 = await topAt('#ccModalBody .cc-sheet-open .cc-sheet-close');
  ok(L + 'シートに［✕ 閉じる］があり、押せる位置にある', t1 === true, t1);
  await tapAt('#ccModalBody .cc-sheet-open .cc-sheet-close');
  ok(L + '［✕ 閉じる］でシートが閉じる', await p.evaluate(() => !document.querySelector('#ccModalBody .cc-sheet-open') && !document.querySelector('.cc-has-sheet')));
  await tapAt('#ccModalBody .cc-item .cc-title');
  await p.mouse.click(20, 30); await p.waitForTimeout(300);
  ok(L + '暗い背景を押してもシートが閉じる', await p.evaluate(() => !document.querySelector('#ccModalBody .cc-sheet-open')));
  ok(L + 'モーダルはまだ開いている（背景のタップでモーダルまで閉じない）', await p.evaluate(() => !!document.getElementById('ccModal')));
  await tapAt('#ccModalBody .cc-item .cc-title');
  await tapAt('#ccModalBody .cc-sheet-open [data-cc="resolve"]');
  ok(L + 'シートの中のボタン（解決済みにする）は押せる', await p.evaluate(() => window.__db.customer_cases.some(c => c.status === 'resolved')));
  if (await p.evaluate(() => !!document.querySelector('#ccModalBody .cc-sheet-open'))) await tapAt('#ccModalBody .cc-sheet-open .cc-sheet-close');
  const t2 = await topAt('#ccModal .md-modal-close');
  ok(L + 'モーダルの ✕ が押せる位置にある', t2 === true, t2);
  await tapAt('#ccModal .md-modal-close');
  ok(L + '✕ でモーダルが閉じて元の画面に戻る', await p.evaluate(() => !document.getElementById('ccModal') && !document.body.classList.contains('md-modal-open')));
  ok(L + 'JS エラーなし', errs.length === 0, errs);
  await ctx.close();
  await b.close(); srv.close();
  console.log(out.join('\n'));
  const fail = out.filter(x => x.startsWith('FAIL')).length;
  console.log(fail ? 'FAIL=' + fail : '全項目 PASS');
  process.exit(fail ? 1 : 0);
})();
