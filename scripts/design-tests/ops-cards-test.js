// 📦 進行管理：作業カード（状態・担当・手順メモ・やりとり）と 📅 日程・締め切り（ops-progress.js）
//   node scripts/design-tests/ops-cards-test.js   （CLASSIC=1 で現行／W=390 でスマホ幅）
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
    await ctx.addInitScript(missing => {
      window.__missing = missing || [];
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
            if (window.__missing.includes(t)) return Promise.resolve({ data: null, error: { code: '42P01', message: 'relation "public.' + t + '" does not exist' } }).then(res, rej);
            const rows = (db[t] = db[t] || []);
            let data = null;
            if (st.op === 'insert') {
              const made = [].concat(st.payload).map(o => Object.assign({ id: 'id' + Math.random().toString(36).slice(2), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_by: 'me@x.com', updated_by: 'me@x.com', uploaded_by: 'me@x.com' }, JSON.parse(JSON.stringify(o))));
              made.forEach(r => rows.push(r)); data = st.single ? made[0] : made;
              window.__writes.push({ t, op: 'insert', payload: JSON.parse(JSON.stringify(st.payload)) });
            } else if (st.op === 'delete') { data = rows.filter(r => st.filters.every(f => f(r))).map(r => ({ id: r.id })); db[t] = rows.filter(r => !st.filters.every(f => f(r))); }
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
        storage: { from: bk => ({ upload: async (path, f) => { (window.__obj = window.__obj || []).push({ bk, path, size: f && f.size }); return { error: null }; }, remove: async ps => { window.__obj = (window.__obj || []).filter(o => !ps.includes(o.path)); return { error: null }; }, createSignedUrls: async () => ({ data: [], error: null }), createSignedUrl: async (path, sec, o) => { (window.__signed = window.__signed || []).push({ path, dl: !!(o && o.download) }); return { data: { signedUrl: 'http://127.0.0.1:1/' + path }, error: null }; } }) },
      };
      window.supabase = { createClient: () => client };
    }, opts.missing || []);
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

  const chip = (p, nm) => p.evaluate(nm => {
    const c = [...document.querySelectorAll('#qpdListWrap .cloud-card')].find(c => c.querySelector('.cloud-card-links') && c.querySelector('.cloud-card-links').dataset.lid === nm);
    const e = c && c.querySelector('.ops-chip'); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null;
  }, nm);
  const ops = (p, id) => p.evaluate(id => { const r = window.__db.quote_presets.find(x => x.id === id); const v = r && r.data.fields['qf-ops']; return v ? JSON.parse(v) : null; }, id);
  const steps = p => p.evaluate(() => [...document.querySelectorAll('#opmModal .opm-step')].map(li => ({ l: li.querySelector('.opm-step-l') ? li.querySelector('.opm-step-l').textContent : '', d: li.classList.contains('is-done'), next: li.classList.contains('is-next'), by: (li.querySelector('.opm-done-by') || {}).textContent || '' })));
  const click = (p, sel) => p.evaluate(sel => { const e = document.querySelector(sel); e && e.click(); return !!e; }, sel);

  const { ctx, p, errs } = await open();
  const setv = (sel, v) => p.evaluate(([sel, v]) => { const i = document.querySelector(sel); if (!i) return false; i.value = v; i.dispatchEvent(new Event('change', { bubbles: true })); return true; }, [sel, v]);
  const iso = n => p.evaluate(n => window.__iso(n), n);
  const dlRows = () => p.evaluate(() => [...document.querySelectorAll('#opmModal .opm-dl-row')].map(r => ({ l: r.querySelector('.opm-dl-l').textContent, cls: r.className, st: r.querySelector('.opm-dl-st').textContent, link: (r.querySelector('.opm-dl-link') || {}).textContent || '' })));
  const by = (rows, re) => rows.find(r => re.test(r.l)) || {};
  await p.evaluate(() => window.opsOpen('B1')); await p.waitForTimeout(400);
  // ---- 📅 日程・締め切り ----
  let dr = await dlRows();
  ok('輸出 FCL の締め切り 5 つ（CY オープン・CY カット・SI カット・VGM カット・ETD）', dr.map(r => r.l).join('|') === 'CY オープン|CY カット|SI カット|VGM カット|ETD（出港予定日）', dr.map(r => r.l));
  ok('CY カットは作業「バンニング・CY 搬入の手配」とつながる', /バンニング/.test(dr[1].link) && /SI/.test(dr[2].link) && /本船出港/.test(dr[4].link), dr.map(r => r.link));
  const tmr = await iso(1), yst = await iso(-1);
  await setv('#opmModal .opm-dl-d[data-i="1"]', tmr); await p.waitForTimeout(600);
  let o = await ops(p, 'B1');
  const cy = o.dl.find(d => d.k === 'cy_cut'), van = o.s.find(s => /バンニング/.test(s.l));
  ok('締め切りの日付は案件に保存（qf-ops の dl）', !!cy && cy.d === tmr, cy);
  ok('つないだ作業の期限にも同じ日付が入る', van.due === tmr && van.dk === cy.id, van);
  dr = await dlRows();
  ok('明日の締め切りは黄（48 時間以内）・「明日」', /is-soon/.test(by(dr, /^CY カット/).cls) && /明日/.test(by(dr, /^CY カット/).st), by(dr, /^CY カット/));
  ok('日付の入った締め切りは一番上へ自動で並ぶ', dr[0].l === 'CY カット', dr.map(r => r.l));
  await setv('#opmModal .opm-dl-d[data-i="2"]', yst); await p.waitForTimeout(600);
  dr = await dlRows();
  ok('昨日の SI カットは赤（過ぎた）・「1 日過ぎています」', /is-over/.test(by(dr, /^SI カット/).cls) && /1 日過ぎています/.test(by(dr, /^SI カット/).st), by(dr, /^SI カット/));
  ok('日付の早い順（昨日の SI カット → 明日の CY カット → 日付なし）', dr.map(r => r.l).slice(0, 3).join('|') === 'SI カット|CY カット|CY オープン', dr.map(r => r.l));
  await setv('#opmModal .opm-dl-d[data-i="4"]', await iso(-3)); await p.waitForTimeout(600);
  dr = await dlRows();
  ok('予定日（ETD）でも、つないだ作業が済んでいなければ過ぎたら赤', /is-over/.test(by(dr, /^ETD/).cls), by(dr, /^ETD/));
  const cmt = await p.evaluate(() => window.__db.quote_comments.map(c => c.body));
  ok('申し送りに「📅 業務：CY カット を …に」', cmt.some(t => /📅 業務：CY カット/.test(t)), cmt);
  // 締め切りとつないだ作業の期限は同期する（どちらを直しても、もう一方もそろう）
  o = await ops(p, 'B1');
  const shipI = o.s.findIndex(s => /本船出港/.test(s.l)), d2 = await iso(2), dm3 = await iso(-3);
  ok('締め切り（ETD）を入れると、つないだ作業（本船出港）の期限も同じ', o.s[shipI].due === dm3, o.s[shipI]);
  await setv('#opmModal .opm-step .opm-due[data-i="' + shipI + '"]', d2); await p.waitForTimeout(600);
  o = await ops(p, 'B1');
  ok('作業の期限を直すと、つないだ締め切り（ETD）の日付も同じになる', o.s[shipI].due === d2 && o.dl.find(d => d.k === 'etd').d === d2, { due: o.s[shipI].due, etd: o.dl.find(d => d.k === 'etd').d });
  ok('申し送りに「… の期限から」', (await p.evaluate(() => window.__db.quote_comments.map(c => c.body))).some(t => /ETD.*作業「本船出港」の期限から/.test(t)));
  const etdI = o.dl.findIndex(d => d.k === 'etd');
  await setv('#opmModal .opm-dl-d[data-i="' + etdI + '"]', dm3); await p.waitForTimeout(600);
  o = await ops(p, 'B1');
  ok('締め切りを直すと、手で入れた期限があっても同じ日付にそろう', o.s[shipI].due === dm3, o.s[shipI].due);
  // 以前の記録でずれているとき：札に「⚠ 期限と違う」・カードでどちらかにそろえる
  await p.evaluate(([i, v]) => { const r = window.__db.quote_presets.find(x => x.id === 'B1'); const st = JSON.parse(r.data.fields['qf-ops']); st.s[i].due = v; r.data.fields['qf-ops'] = JSON.stringify(st); r.updated_at = new Date().toISOString(); }, [shipI, d2]);
  await p.evaluate(() => { const c = document.querySelector('#opmModal .opm-close, #opmModal [data-opm="close"]'); c && c.click(); }); await p.waitForTimeout(200);
  await p.evaluate(() => window.cloudListPresets && window.cloudListPresets(true)); await p.waitForTimeout(800);
  await p.evaluate(() => window.opsOpen('B1')); await p.waitForTimeout(400);
  ok('ずれている作業の札に「⚠ 期限と違う」', await p.evaluate(i => /期限と違う/.test(document.querySelectorAll('#opmModal .opm-step')[i].textContent), shipI));
  await p.evaluate(i => { const b = document.querySelectorAll('#opmModal .opm-step')[i].querySelector('.opm-step-l'); b && b.click(); }, shipI); await p.waitForTimeout(300);
  ok('作業カードに日付の違いと「そろえる」ボタン 2 つ', await p.evaluate(() => document.querySelectorAll('#opmModal .opc-dlsync [data-opm="dlsync"]').length === 2));
  await click(p, '#opmModal .opc-dlsync [data-v="dl"]'); await p.waitForTimeout(600);
  o = await ops(p, 'B1');
  ok('「締め切りの日付にそろえる」で作業の期限が締め切りと同じに', o.s[shipI].due === dm3 && o.dl.find(d => d.k === 'etd').d === dm3, o.s[shipI].due);
  ok('そろえると違いの案内は消える', await p.evaluate(() => !document.querySelector('#opmModal .opc-dlsync')));
  await p.evaluate(i => { const b = document.querySelectorAll('#opmModal .opm-step')[i].querySelector('.opm-step-l'); b && b.click(); }, shipI); await p.waitForTimeout(200);
  // 作業を済ませると締め切りは「済み」
  const vi = o.s.indexOf(o.s.find(s => /バンニング/.test(s.l)));
  await p.evaluate(i => document.querySelector('#opmModal .opm-chk[data-i="' + i + '"]').click(), vi); await p.waitForTimeout(600);
  dr = await dlRows();
  ok('つないだ作業が済むと、締め切りは「✅ 済み」', /is-met/.test(by(dr, /^CY カット/).cls) && /済み/.test(by(dr, /^CY カット/).st), by(dr, /^CY カット/));
  ok('済みの締め切りは一番下へ', dr[dr.length - 1].l === 'CY カット', dr.map(r => r.l));
  await p.evaluate(i => document.querySelector('#opmModal .opm-chk[data-i="' + i + '"]').click(), vi); await p.waitForTimeout(600);
  // 自由な名前の締め切りを足す
  await setv('#opmDlType', 'free'); await p.evaluate(() => { document.getElementById('opmDlFree').value = '通関書類の提出'; document.querySelector('#opmModal [data-opm="dladd"]').click(); }); await p.waitForTimeout(600);
  dr = await dlRows();
  ok('自由な名前の締め切りを追加できる（つないだ作業なし＝「済み」のチェック）', dr.length === 6 && dr[5].l === '通関書類の提出' && await p.evaluate(() => !!document.querySelector('#opmModal .opm-dl-row:last-child .opm-dl-ok')), dr[5]);
  // ドラッグで並べ替え（日付のないものだけ・日付のあるものは 📅＝自動）
  ok('日付のない締め切りに ⠿・日付のあるものに 📅', await p.evaluate(() => { const rows = [...document.querySelectorAll('#opmModal .opm-dl-row')]; return rows.every(r => { const d = r.querySelector('.opm-dl-d').value, g = r.querySelector('.opm-grip'); return d ? g.classList.contains('is-auto') : g.dataset.kind === 'dl'; }); }));
  const dragDl = async (fromL, toL) => {
    const rows = await p.$$('#opmModal .opm-dl-row'); let f, t;
    for (const r of rows) { const l = await r.$eval('.opm-dl-l', e => e.textContent); if (l === fromL) f = r; if (l === toL) t = r; }
    const g = await f.$('.opm-grip'); await g.scrollIntoViewIfNeeded();
    const gb = await g.boundingBox(); await p.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2); await p.mouse.down();
    await t.scrollIntoViewIfNeeded(); const tb = await t.boundingBox();
    await p.mouse.move(gb.x + 4, tb.y + 3, { steps: 8 });
    const mk = await p.evaluate(() => !!document.querySelector('#opmModal .opm-dl-row.drop-before'));
    await p.mouse.up(); await p.waitForTimeout(700); return mk;
  };
  const mkd = await dragDl('通関書類の提出', 'CY オープン');
  dr = await dlRows();
  o = await ops(p, 'B1');
  ok('締め切りをドラッグで並べ替え（日付のないものの中で・保存される）', mkd && dr.map(r => r.l).indexOf('通関書類の提出') === dr.map(r => r.l).indexOf('CY オープン') - 1 && o.dl.map(d => d.l || d.k).indexOf('通関書類の提出') < o.dl.map(d => d.k).indexOf('cy_open'), dr.map(r => r.l));
  // 期限を入れた作業は、締め切りの一覧にも出る（締め切りとつないでいない作業）
  const s0 = o.s.findIndex(x => !x.dk && !x.d);
  await setv('#opmModal .opm-step .opm-due[data-i="' + s0 + '"]', await iso(2)); await p.waitForTimeout(600);
  dr = await dlRows();
  const vrow = dr.find(r => r.l.startsWith(o.s[s0].l));
  ok('期限を入れた作業が「作業の期限」として締め切りの一覧に出る（日付順の位置）', !!vrow && /作業の期限/.test(vrow.l) && /is-step/.test(vrow.cls) && /あと 2 日/.test(vrow.st), dr.map(r => r.l));
  if (process.env.OUT) await p.locator('#opmModal .opm-dl').screenshot({ path: process.env.OUT });
  await setv('#opmModal .opm-dl-row.is-step .opm-dl-sd', await iso(4)); await p.waitForTimeout(600);
  o = await ops(p, 'B1');
  ok('一覧の日付を直すと作業の期限が変わる（締め切りは増えない）', o.s[s0].due === await iso(4) && o.dl.length === 6, { due: o.s[s0].due, n: o.dl.length });
  await setv('#opmModal .opm-step .opm-due[data-i="' + s0 + '"]', ''); await p.waitForTimeout(600);
  ok('作業の期限を消すと一覧からも消える', !(await dlRows()).some(r => /作業の期限/.test(r.l)));
  ok('並べ替えても日付のある締め切りは日付順のまま上', dr.slice(0, 2).map(r => r.l).join('|') === 'ETD（出港予定日）|SI カット', dr.map(r => r.l));
  // ---- 🗂 作業カード ----
  const SI = o.s.findIndex(s => /SI（船積指示）/.test(s.l));
  await p.evaluate(i => document.querySelectorAll('#opmModal .opm-step-l')[i].click(), SI); await p.waitForTimeout(500);
  ok('作業名を押すと作業カードが開く（状態・担当・締め切り・手順・やりとり）', await p.evaluate(() => { const c = document.querySelector('#opmModal .opm-card'); return !!c && !!c.querySelector('.opc-seg') && !!c.querySelector('.opc-who') && !!c.querySelector('.opc-dk') && /手順/.test(c.textContent) && /やりとり/.test(c.textContent); }));
  await click(p, '#opmModal .opm-card [data-opm="wstate"][data-v="wait"]'); await p.waitForTimeout(600);
  await setv('#opmModal .opc-wn', 'お客様（INV の確認）'); await p.waitForTimeout(600);
  o = await ops(p, 'B1');
  ok('状態「返事待ち」と待っている相手を保存', o.s[SI].w === 'wait' && o.s[SI].wn === 'お客様（INV の確認）', o.s[SI]);
  ok('作業の行に「⏳ 返事待ち：お客様…」の札', await p.evaluate(i => /返事待ち：お客様/.test(document.querySelectorAll('#opmModal .opm-step')[i].textContent), SI));
  const whoOpts = await p.evaluate(() => [...document.querySelectorAll('#opmModal .opc-who option')].map(o => o.textContent));
  ok('担当はチームのメンバーから選べる', whoOpts.includes('鈴木') && whoOpts.includes('田中'), whoOpts);
  await setv('#opmModal .opc-who', 'suzuki@x.com'); await p.waitForTimeout(600);
  o = await ops(p, 'B1');
  ok('担当を保存・申し送りに「👤 … の担当を 鈴木 に」', o.s[SI].who === 'suzuki@x.com' && (await p.evaluate(() => window.__db.quote_comments.map(c => c.body))).some(t => /担当を 鈴木 に/.test(t)), o.s[SI]);
  await click(p, '#opmModal .opm-card [data-opm="whome"]'); await p.waitForTimeout(600);
  o = await ops(p, 'B1');
  ok('「自分にする」で自分が担当', o.s[SI].who === 'me@x.com', o.s[SI].who);
  // 手順メモ
  await click(p, '#opmModal .opm-card [data-opm="gedit"]'); await p.waitForTimeout(200);
  await p.evaluate(() => { document.querySelector('#opmModal .opc-g-in').value = '1. 船会社の SI 画面で入力 https://example.com/si\n2. 荷主に確認'; document.querySelector('#opmModal [data-opm="gsave"]').click(); }); await p.waitForTimeout(600);
  const gd = await p.evaluate(() => window.__db.ops_guides || []);
  ok('手順メモはチーム共有の表に、作業名（往路・復路を除く）の key で保存', gd.length === 1 && gd[0].key === 'si(船積指示)の提出' && /SI 画面/.test(gd[0].body), gd);
  ok('手順メモの URL はリンクになる', await p.evaluate(() => !!document.querySelector('#opmModal .opc-guide a[href="https://example.com/si"][target="_blank"]')));
  // 手順メモの範囲：お客様ごと・サブコンごと
  ok('手順メモは「共通／お客様：X社／サブコン」の 3 つの枠', await p.evaluate(() => { const t = [...document.querySelectorAll('#opmModal .opc-gs .opc-gs-h b')].map(e => e.textContent); return t.length === 3 && t[0] === '共通' && t[1] === 'お客様：X社' && /^サブコン/.test(t[2]); }));
  ok('相手（サブコン）が空のあいだは、サブコンの手順は書けない（案内だけ）', await p.evaluate(() => !document.querySelector('#opmModal .opc-gs-s [data-opm="gedit"]') && /相手（サブコン）/.test(document.querySelector('#opmModal .opc-gs-s').textContent)));
  await click(p, '#opmModal .opc-gs-c [data-opm="gedit"]'); await p.waitForTimeout(200);
  await p.evaluate(() => { document.querySelector('#opmModal .opc-gs-c .opc-g-in').value = 'X社は INV に HS コード必須'; document.querySelector('#opmModal .opc-gs-c [data-opm="gsave"]').click(); }); await p.waitForTimeout(600);
  let gd2 = await p.evaluate(() => window.__db.ops_guides || []);
  ok('お客様の手順は「作業名|c:お客様」の key で保存（共通の手順は変わらない）', gd2.some(g => g.key === 'si(船積指示)の提出|c:x社' && /HS コード/.test(g.body)) && gd2.some(g => g.key === 'si(船積指示)の提出' && /SI 画面/.test(g.body)), gd2.map(g => g.key));
  await setv('#opmModal .opc-sv', '山田運送'); await p.waitForTimeout(600);
  o = await ops(p, 'B1');
  ok('相手（サブコン）は作業に保存', o.s[SI].sv === '山田運送', o.s[SI]);
  await click(p, '#opmModal .opc-gs-s [data-opm="gedit"]'); await p.waitForTimeout(200);
  await p.evaluate(() => { document.querySelector('#opmModal .opc-gs-s .opc-g-in').value = '山田運送は専用フォームで依頼'; document.querySelector('#opmModal .opc-gs-s [data-opm="gsave"]').click(); }); await p.waitForTimeout(600);
  gd2 = await p.evaluate(() => window.__db.ops_guides || []);
  ok('サブコンの手順は「作業名|s:サブコン」の key で保存', gd2.some(g => g.key === 'si(船積指示)の提出|s:山田運送' && /専用フォーム/.test(g.body)), gd2.map(g => g.key));
  ok('3 つの枠それぞれに手順が出る', await p.evaluate(() => ['all', 'c', 's'].every(k => document.querySelector('#opmModal .opc-gs-' + k + ' .opc-guide'))));
  // やりとり
  await p.evaluate(() => { document.querySelector('#opmModal .opc-n-in').value = 'INV の確認を依頼しました'; document.querySelector('#opmModal [data-opm="nadd"]').click(); }); await p.waitForTimeout(600);
  const nt = await p.evaluate(() => window.__db.ops_notes || []);
  ok('やりとりは ops_notes に案件と作業の id で残る', nt.length === 1 && nt[0].target === 'q:B1' && nt[0].body === 'INV の確認を依頼しました', nt);
  ok('作業の行に「💬 1」「📖」の札', await p.evaluate(i => { const t = document.querySelectorAll('#opmModal .opm-step')[i].textContent; return /💬 1/.test(t) && /📖/.test(t); }, SI));
  // 添付ファイル
  await p.locator('#opmModal .opc-f-in').setInputFiles([{ name: 'BLドラフト.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') }]); await p.waitForTimeout(800);
  const fr = await p.evaluate(() => ({ rows: window.__db.ops_files || [], obj: window.__obj || [], list: [...document.querySelectorAll('#opmModal .opc-files-list li')].map(e => e.textContent) }));
  ok('ファイルを選ぶと、保存領域に置いてから ops_files に案件と作業の id で行を作る', fr.obj.length === 1 && fr.obj[0].bk === 'ops-files' && fr.rows.length === 1 && fr.rows[0].target === 'q:B1' && fr.rows[0].file_name === 'BLドラフト.pdf' && fr.rows[0].storage_path === fr.obj[0].path, fr);
  ok('保存場所は「年月/時刻_乱数_英数字の名前」（日本語名は表示名にだけ）', /^\d{6}\/\d+_[a-z0-9]+_[A-Za-z0-9._-]+$/.test(fr.obj[0].path), fr.obj[0].path);
  ok('カードの一覧に名前・大きさ・置いた人、行に「📎 1」の札', /BLドラフト\.pdf/.test(fr.list[0] || '') && /自分/.test(fr.list[0] || '') && await p.evaluate(i => /📎 1/.test(document.querySelectorAll('#opmModal .opm-step')[i].textContent), SI), fr.list);
  await p.evaluate(() => { const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl = this.download; return; } return orig.call(this); }; });
  await click(p, '#opmModal [data-opm="fdl"]'); await p.waitForTimeout(500);
  ok('⬇ で署名つきの URL（ダウンロード）を作り、元の名前で保存する', await p.evaluate(() => (window.__signed || []).some(x => x.dl) && window.__dl === 'BLドラフト.pdf'));
  await p.locator('#opmModal .opc-f-in').setInputFiles([{ name: 'big.zip', mimeType: 'application/zip', buffer: Buffer.alloc(11 * 1024 * 1024) }]); await p.waitForTimeout(500);
  ok('10MB を超えるファイルは付けない', (await p.evaluate(() => (window.__db.ops_files || []).length)) === 1);
  await click(p, '#opmModal [data-opm="fdel"]'); await p.waitForTimeout(300);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.confirm-overlay button')].find(b => /消す/.test(b.textContent)); b && b.click(); }); await p.waitForTimeout(600);
  ok('自分のファイルは消せる（保存領域と行の両方）', await p.evaluate(() => (window.__db.ops_files || []).length === 0 && (window.__obj || []).length === 0));
  // ほかの案件の同じ名前の作業にも手順が出る
  await click(p, '#opmModal [data-opm="close"]'); await p.waitForTimeout(200);
  await p.evaluate(() => { const r = window.__db.quote_presets.find(x => x.id === 'B3'); r.status = '受注'; r.updated_at = new Date().toISOString(); r.data.fields['qf-status'] = '受注'; Object.assign(r.data.fields, { 'cond-direction': 'export', 'cond-mode': '海上（LCL）' }); });
  await p.evaluate(() => window.cloudListPresets && window.cloudListPresets(true)); await p.waitForTimeout(800);
  await p.evaluate(() => window.opsOpen('B3')); await p.waitForTimeout(500);
  const lclDl = (await dlRows()).map(r => r.l).join('|');
  ok('輸出 LCL の締め切り（CFS カット・倉庫の搬入締め切り・SI カット・ETD）', lclDl === 'CFS カット|倉庫の搬入締め切り|SI カット|ETD（出港予定日）', lclDl);
  ok('ほかの案件の同じ名前の作業にも 📖（手順メモは共有）', await p.evaluate(() => [...document.querySelectorAll('#opmModal .opm-step')].some(li => /SI（船積指示）/.test(li.textContent) && /📖/.test(li.textContent))));
  ok('ほかの案件には、ほかの案件のやりとりは出ない', await p.evaluate(() => ![...document.querySelectorAll('#opmModal .opm-step')].some(li => /💬/.test(li.textContent))));
  await click(p, '#opmModal [data-opm="close"]'); await p.waitForTimeout(200);
  // 記録は書いた本人が消せる
  await p.evaluate(() => window.opsOpen('B1')); await p.waitForTimeout(500);
  await p.evaluate(i => document.querySelectorAll('#opmModal .opm-step-l')[i].click(), SI); await p.waitForTimeout(500);
  await click(p, '#opmModal .opc-n-del'); await p.waitForTimeout(300);
  await p.evaluate(() => { const b = [...document.querySelectorAll('.confirm-overlay button')].find(b => /消す/.test(b.textContent)); b && b.click(); }); await p.waitForTimeout(500);
  ok('自分の記録は消せる', (await p.evaluate(() => (window.__db.ops_notes || []).length)) === 0);
  await click(p, '#opmModal [data-opm="close"]'); await p.waitForTimeout(200);
  // ---- 一覧・帯 ----
  await p.evaluate(() => window.cloudRefreshDashList && window.cloudRefreshDashList()); await p.waitForTimeout(500);
  await p.evaluate(() => window.dtRefresh && window.dtRefresh()); await p.waitForTimeout(300);
  const band = await p.evaluate(() => { const e = document.getElementById('opsBand'); return e ? e.textContent.replace(/\s+/g, ' ') : ''; });
  ok('ダッシュボードの帯に「📅 締め切り 48時間以内 3」', /締め切り 48時間以内 3/.test(band), band);
  await p.evaluate(() => window.opsGoTab('dl')); await p.waitForTimeout(600);
  const dl = await p.evaluate(() => ({ h: [...document.querySelectorAll('#opsRoot .opt-dl-h')].map(e => e.textContent.replace(/\s+/g, ' ')), rows: [...document.querySelectorAll('#opsRoot .opt-dl-row')].map(e => e.textContent.replace(/\s+/g, ' ')) }));
  ok('進行管理の「📅 締め切り」：過ぎた 2・今日・明日 1', dl.h[0] === '⚠ 過ぎた締め切り 2' && dl.h[1] === '今日・明日 1', dl.h);
  ok('締め切りの行に種類・案件・つないだ作業と担当', dl.rows.some(t => /SI カット/.test(t) && /輸出FCL案件/.test(t) && /作業：SI（船積指示）の提出（👤 自分）/.test(t) && /⏳/.test(t)), dl.rows);
  await click(p, '#opsRoot .opt-dl-row [data-opt="dlopen"]'); await p.waitForTimeout(500);
  ok('［☑ 開く］でその案件のチェックリスト', await p.evaluate(() => !document.getElementById('opmModal').hidden && /輸出FCL案件/.test(document.getElementById('opmSub').textContent)));
  await click(p, '#opmModal [data-opm="close"]'); await p.waitForTimeout(200);
  await p.evaluate(() => { document.querySelector('#opsRoot [data-opt="f"][data-f="mine"]').click(); }); await p.waitForTimeout(400);
  const mine = await p.evaluate(() => [...document.querySelectorAll('#opsRoot .opt-row')].map(e => e.textContent.replace(/\s+/g, ' ')));
  ok('「👤 自分の担当」で自分が担当の作業がある進行だけ', mine.length === 1 && /輸出FCL案件/.test(mine[0]), mine);
  ok('一覧の行にいちばん早い締め切りの札（過ぎた ETD）', /📅 ETD（出港予定日）/.test(mine[0] || ''), mine[0]);
  // ---- 🛰 COLINS の日付を締め切りの候補に ----
  const d3 = await iso(3), d5 = await iso(5);
  await p.evaluate(([a, b]) => {
    const t = new Date(); t.setDate(t.getDate() + 2);
    const utc = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0') + 'T20:00:00Z';   // 日本では 3 日後の朝 5 時
    window.__db.cp_watch_targets = [{ preset_id: 'B1', direction: 'export', source: 'case', trace: true, state: 'active', snapshot: [
      { k: 'v:ONE HARMONY|012E:cyCut', scope: '本船 ONE HARMONY 012E', label: 'CYカット', val: utc, cat: 'date' },
      { k: 'v:ONE HARMONY|012E:pol:etd', scope: '本船 ONE HARMONY 012E', label: 'TOKYO 出港 予定(ETD)', val: b.replace(/-/g, ''), cat: 'date' },
    ] }];
  }, [d3, d5]);
  await p.evaluate(() => window.opsAutoSync()); await p.waitForTimeout(800);
  await p.evaluate(() => window.opsGoTab('dl')); await p.waitForTimeout(600);
  const cands = await p.evaluate(() => ({ h: (document.querySelector('#opsRoot .opt-dl-h.is-cand') || {}).textContent || '', rows: [...document.querySelectorAll('#opsRoot .opt-dl-row.is-cand')].map(e => e.textContent.replace(/\s+/g, ' ')), tile: (document.querySelector('#opsRoot .opt-tile[data-f="dl"]') || {}).textContent || '' }));
  ok('進行管理の締め切りに「🛰 COLINS に新しい日付があります 2」', /COLINS に新しい日付があります 2/.test(cands.h) && /🛰 2/.test(cands.tile), cands);
  ok('候補は日本の日付に直す（UTC 20 時＝翌日）・CY カットと ETD', cands.rows.some(t => t.startsWith(+d3.slice(5,7) + '/' + +d3.slice(8)) && /CY カット/.test(t)) && cands.rows.some(t => /ETD/.test(t)), cands.rows);
  await p.evaluate(() => window.opsOpen('B1')); await p.waitForTimeout(500);
  const cd = await p.evaluate(() => [...document.querySelectorAll('#opmModal .opm-dl-cand')].map(e => e.textContent.replace(/\s+/g, ' ')));
  ok('チェックリストの締め切りに「🛰 COLINS の日付が違います」と出どころ', cd.some(t => /COLINS の日付が違います/.test(t) && /CYカット（本船 ONE HARMONY 012E）/.test(t)), cd);
  ok('勝手には書き換えない', (await ops(p, 'B1')).dl.find(d => d.k === 'cy_cut').d === tmr);
  const candBtn = (lab, act) => p.evaluate(([lab, act]) => { const r = [...document.querySelectorAll('#opmModal .opm-dl-row')].find(r => r.querySelector('.opm-dl-l').textContent.startsWith(lab)); const b = r && r.querySelector('[data-opm="' + act + '"]'); b && b.click(); return !!b; }, [lab, act]);
  await candBtn('CY カット', 'dlapply'); await p.waitForTimeout(700);
  o = await ops(p, 'B1');
  const cy2 = o.dl.find(d => d.k === 'cy_cut'), van2 = o.s.find(s => /バンニング/.test(s.l));
  ok('［反映する］で COLINS の日付が入り、つないだ作業の期限も追う', cy2.d === d3 && van2.due === d3, { cy2, due: van2.due });
  ok('申し送りに「COLINS の日付を反映・前は …」', (await p.evaluate(() => window.__db.quote_comments.map(c => c.body))).some(t => /COLINS の日付を反映・前は/.test(t)));
  ok('反映後は「COLINS と同じ日付」', await p.evaluate(() => [...document.querySelectorAll('#opmModal .opm-dl-cand.is-same')].some(e => /CYカット/.test(e.textContent))));
  await candBtn('ETD', 'dlignore'); await p.waitForTimeout(700);
  o = await ops(p, 'B1');
  const etd2 = o.dl.find(d => d.k === 'etd');
  ok('［このままにする］で日付は変えず、同じ候補は出さない', etd2.d !== d5 && etd2.cx === d5 && !(await p.evaluate(() => document.querySelector('#opmModal [data-opm="dlapply"]'))), etd2);
  await click(p, '#opmModal [data-opm="close"]'); await p.waitForTimeout(200);
  ok('ページのエラーなし', errs.length === 0, errs);
  await ctx.close();
  // ---- 表が無いとき ----
  {
    const r = await open({ missing: ['ops_guides', 'ops_notes', 'ops_files'] });
    await r.p.evaluate(() => window.opsOpen('B1')); await r.p.waitForTimeout(400);
    await r.p.evaluate(() => document.querySelectorAll('#opmModal .opm-step-l')[3].click()); await r.p.waitForTimeout(600);
    const t = await r.p.evaluate(() => (document.querySelector('#opmModal .opm-card') || {}).textContent || '');
    ok('（表なし）手順・やりとり・添付は「SQL を実行」の案内・状態と担当は使える', (t.match(/ops-cards\.sql/g) || []).length === 2 && /ops-files\.sql/.test(t) && !!(await r.p.evaluate(() => document.querySelector('#opmModal .opc-seg'))), t.slice(0, 200));
    ok('（表なし）ページのエラーなし', r.errs.length === 0, r.errs);
    await r.ctx.close();
  }
  await b.close(); srv.close();
  console.log(fails ? fails + ' 件 FAIL' : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})();
