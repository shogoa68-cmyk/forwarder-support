// 未登録のお客様：ダッシュボードのカードに「マスター登録」のショートカット（登録済みは詳細リンク）
//   偽の Supabase（メモリ上・編集ロックは RLS のように 0 行で拒否）で、宣言・引き継ぎ・割り当て・外す・ロック中の拒否・申し送りの自動記録・
//   絞り込み・帯の件数・新規作成時の既定（作った人）・コピー時のリセットを確かめる。
//   node scripts/design-tests/follow-test.js           （THEME=1 で Industry／CLASSIC=1 で現行／W=390 でスマホ幅）
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
      try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
      const iso = d => { const t = new Date(); t.setDate(t.getDate() + d); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
      const mk = (id, ct, status, follower, extra) => Object.assign({
        id, name: '案件' + id, status, customer: 'X社', created_by: 'tanaka@x.com', owner_email: 'tanaka@x.com',
        updated_at: '2026-11-' + ct + 'T00:00:00Z', ref: 'R-' + id,
        data: { fields: Object.assign({ 'qf-ref': 'R-' + id, 'qf-status': status, 'qf-customer': (extra && extra.customer) || '' }, follower ? { 'qf-follower': follower } : {}), rows: [] },
      }, extra || {});
      const fresh = new Date().toISOString();
      const db = {
        quote_presets: [
          mk('A1', '10', '下書き中', 'me@x.com', { customer: '登録済み社' }),                       // 自分・期限は明日
          mk('A2', '11', '提出済み', 'tanaka@x.com', { customer: '未登録社' }),
          mk('A3', '12', '下書き中', '', { customer: '未登録社' }),                               // 未フォロー
          mk('A4', '13', '受注', 'tanaka@x.com'),                       // 終わった案件（数えない）
          mk('A6', '14', '下書き中', 'suzuki@x.com', { locked_by: 'tanaka@x.com', locked_at: fresh }),   // 他の人が編集中
          mk('A7', '15', '失注', ''),                                   // 終わった未フォロー（数えない・ボタンも出さない）
        ],
        allowed_emails: [{ email: 'me@x.com', role: 'admin', member_no: 1 }, { email: 'tanaka@x.com', role: 'member', member_no: 2 }, { email: 'suzuki@x.com', role: 'member', member_no: 3 }],
        user_profiles: [{ email: 'me@x.com', display_name: '自分' }, { email: 'tanaka@x.com', display_name: '田中' }, { email: 'suzuki@x.com', display_name: '鈴木' }],
        quote_comments: [], quote_preset_links: [], master_votes: [{ field: 'customer', value: '登録済み社', voter_email: 'me@x.com' }, { field: 'customer', value: '申請済み社', voter_email: 'tanaka@x.com' }], synonym_groups: [], master_details: [{ field: 'customer', value: '登録済み社', details: { dealType: '荷主（直接）' } }], alias_rules: [], organizations: [], teams: [], org_members: [], team_members: [],
      };
      db.quote_presets[0].data.fields['qf-due'] = iso(1);
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
    if (opts.off) await ctx.addInitScript(() => { try { localStorage.removeItem('fwd.follow'); } catch (e) {} });   // 表示を止めている既定の状態
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
  const cards = p => p.evaluate(() => [...document.querySelectorAll('#qpdListWrap .cloud-card')].map(c => {
    const f = c.querySelector('.cc3-follow');
    return { id: c.querySelector('.cloud-card-links') ? c.querySelector('.cloud-card-links').dataset.lid : '', name: (c.querySelector('.cloud-card-name') || {}).textContent, follow: f ? f.textContent.replace(/\s+/g, ' ').trim() : '', btn: f && f.querySelector('.cc3-fl-btn') ? f.querySelector('.cc3-fl-btn').textContent.trim() : '', none: !!(f && f.classList.contains('is-none')), mine: !!(f && f.classList.contains('is-me')) };
  }));
  const byName = (list, n) => list.find(x => (x.name || '').includes(n));
  const strip = p => p.evaluate(() => [...document.querySelectorAll('#dtFollow .dt-fl')].map(b => ({ k: b.dataset.dtFl, t: b.textContent.replace(/\s+/g, ' ').trim(), on: b.classList.contains('is-on') })));
  const dlg = async (p, { pick, note, ok: okLabel }) => {   // 確認画面（uiConfirm）を操作する
    await p.waitForSelector('.confirm-dialog');
    if (pick) await p.selectOption('.confirm-dialog .fl-dlg-sel', pick);
    if (note) await p.fill('.confirm-dialog .fl-dlg-note', note);
    await p.evaluate(l => { const b = [...document.querySelectorAll('.confirm-dialog button')].find(x => x.textContent.trim() === l); b && b.click(); }, okLabel);
    await p.waitForTimeout(500);
  };
  const fieldOf = (p, id, k) => p.evaluate(([id, k]) => { const r = window.__db.quote_presets.find(x => x.id === id); return r && r.data.fields[k]; }, [id, k]);

  // ===== カード =====
  const info = p => p.evaluate(() => [...document.querySelectorAll('#qpdListWrap .cloud-card')].map(c => ({
    name: (c.querySelector('.cloud-card-name') || {}).textContent || '',
    cust: (c.querySelector('.cc3-cust') || {}).textContent || '',
    link: !!c.querySelector('.cc3-cust.is-link'),
    reg: c.querySelector('.cust-reg-btn') ? c.querySelector('.cust-reg-btn').textContent.trim() : '',
  })));
  {
    const { ctx, p, errs } = await open();
    const cs = await info(p);
    const by = n => cs.find(x => x.name.includes(n));
    ok('登録済みのお客様は詳細リンク（登録ボタンなし）', by('A1') && by('A1').link && by('A1').reg === '', by('A1'));
    ok('未登録のお客様は文字のまま＋「＋ マスター登録」', by('A2') && !by('A2').link && by('A2').reg === '＋ マスター登録', by('A2'));
    ok('お客様名が空の案件には出ない', cs.filter(x => x.cust.includes('未入力')).every(x => x.reg === ''), cs);
    if (process.env.SHOT) { const el = await p.evaluateHandle(() => [...document.querySelectorAll('#qpdListWrap .cloud-card')].find(c => /R-A2/.test(c.textContent))); await el.asElement().scrollIntoViewIfNeeded(); await el.asElement().screenshot({ path: process.env.SHOT }); }
    // 押すと、種別＝お客様・名前入りで登録モーダルが開く（画面は切り替わらない）
    await p.evaluate(() => document.querySelector('#qpdListWrap .cust-reg-btn').click());
    await p.waitForSelector('#masterNewModal');
    const m = await p.evaluate(() => ({ f: document.getElementById('masterNewField').value, v: document.getElementById('masterNewValue').value, tab: !!document.querySelector('#tab-quote-make.active') }));
    ok('登録モーダルが「お客様」・名前入りで開く', m.f === 'customer' && m.v === '未登録社', m);
    ok('ダッシュボードのまま（マスター管理へ切り替わらない）', m.tab === true, m);
    // 登録する → モーダルが閉じ、カードが詳細リンクになる（登録ボタンが消える）
    await p.evaluate(() => window.statsMasterAddCanonical()); await p.waitForTimeout(1200);
    const after = await info(p);
    const a2 = after.find(x => x.name.includes('A2')), a3 = after.find(x => x.name.includes('A3'));
    ok('登録するとモーダルが閉じる', !(await p.$('#masterNewModal')), 0);
    ok('同じお客様の案件はすべて登録ボタンが消える', a2 && a3 && a2.reg === '' && a3.reg === '', [a2, a3]);
    const voted = await p.evaluate(() => window.__db.master_votes.some(v => v.field === 'customer' && v.value === '未登録社'));
    ok('マスター（投票）に登録された', voted, 0);
    // 何も登録せず閉じても一覧は壊れない
    ok('エラーなし', errs.length === 0, errs);
    await ctx.close();
  }
  // ===== 申請済み（承認待ち）の表示は statsMasterState が 'pending' のとき =====
  {
    const { ctx, p, errs } = await open();
    await p.evaluate(() => { window.statsMasterState = (f, v) => v === '未登録社' ? 'pending' : 'master'; window.cloudRefreshDashList(); });
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => ({ pend: [...document.querySelectorAll('#qpdListWrap .cust-reg-pend')].length, btn: document.querySelectorAll('#qpdListWrap .cust-reg-btn').length }));
    ok('申請済みは「📨 申請中」の印だけ（押せるボタンは出ない）', r.pend >= 1 && r.btn === 0, r);
    ok('エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  await b.close(); srv.close();
  console.log(fails ? '\nFAIL ' + fails + ' 件' : '\n全項目 OK');
  process.exit(fails ? 1 : 0);
})();
