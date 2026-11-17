// 🙋 フォロー担当（アプリ内でフォローを宣言／引き継ぎ／外す・未フォロー・人ごとの持ち件数）
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

  async function open() {
    const ctx = await b.newContext({ viewport: { width: W, height: 1000 }, locale: 'ja-JP' });
    if (process.env.CLASSIC) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: false, doc: false })); } catch (e) {} });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
      const iso = d => { const t = new Date(); t.setDate(t.getDate() + d); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); };
      const mk = (id, ct, status, follower, extra) => Object.assign({
        id, name: '案件' + id, status, customer: 'X社', created_by: 'tanaka@x.com', owner_email: 'tanaka@x.com',
        updated_at: '2026-11-' + ct + 'T00:00:00Z', ref: 'R-' + id,
        data: { fields: Object.assign({ 'qf-ref': 'R-' + id, 'qf-status': status }, follower ? { 'qf-follower': follower } : {}), rows: [] },
      }, extra || {});
      const fresh = new Date().toISOString();
      const db = {
        quote_presets: [
          mk('A1', '10', '下書き中', 'me@x.com'),                       // 自分・期限は明日
          mk('A2', '11', '提出済み', 'tanaka@x.com'),
          mk('A3', '12', '下書き中', ''),                               // 未フォロー
          mk('A4', '13', '受注', 'tanaka@x.com'),                       // 終わった案件（数えない）
          mk('A6', '14', '下書き中', 'suzuki@x.com', { locked_by: 'tanaka@x.com', locked_at: fresh }),   // 他の人が編集中
          mk('A7', '15', '失注', ''),                                   // 終わった未フォロー（数えない・ボタンも出さない）
        ],
        allowed_emails: [{ email: 'me@x.com', role: 'admin', member_no: 1 }, { email: 'tanaka@x.com', role: 'member', member_no: 2 }, { email: 'suzuki@x.com', role: 'member', member_no: 3 }],
        user_profiles: [{ email: 'me@x.com', display_name: '自分' }, { email: 'tanaka@x.com', display_name: '田中' }, { email: 'suzuki@x.com', display_name: '鈴木' }],
        quote_comments: [], quote_preset_links: [], master_votes: [], synonym_groups: [], master_details: [], alias_rules: [], organizations: [], teams: [], org_members: [], team_members: [],
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

  // ===== カードの表示 =====
  {
    const { ctx, p, errs } = await open();
    const cs = await cards(p);
    const a1 = byName(cs, 'A1'), a2 = byName(cs, 'A2'), a3 = byName(cs, 'A3'), a4 = byName(cs, 'A4'), a6 = byName(cs, 'A6'), a7 = byName(cs, 'A7');
    ok('自分がフォロー中のカード：「担当 自分・あなた フォロー中」・自分の印・ボタンなし', a1 && /担当.*自分・あなた.*フォロー中/.test(a1.follow) && a1.mine && !a1.btn, a1);
    ok('他の人がフォロー中のカード：名前とフォロー中・「🔁 引き継ぐ」ボタン', a2 && /田中.*フォロー中/.test(a2.follow) && a2.btn === '🔁 引き継ぐ', a2);
    ok('誰もフォローしていない進行中のカード：「未フォロー」（点線の注意色）・「🙋 フォローする」ボタン', a3 && a3.none && /未フォロー/.test(a3.follow) && a3.btn === '🙋 フォローする', a3);
    ok('受注の案件は担当を表示するがボタンは出さない（割り振りの対象外）', a4 && /田中/.test(a4.follow) && !a4.btn, a4);
    ok('他の人が編集中の案件には引き継ぎボタンを出さない（変更できないため）', a6 && /鈴木/.test(a6.follow) && !a6.btn, a6);
    ok('失注で担当なしの案件には「未フォロー」も出さない', a7 && a7.follow === '', a7);
    ok('エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 帯の件数（進行中だけ・期限が近い件数）=====
  {
    const { ctx, p, errs } = await open();
    if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT, fullPage: false });
    const st = await strip(p);
    const get = k => st.find(x => x.k === k);
    ok('帯：自分 1 件（期限間近 1）・田中 1 件（受注は数えない）・鈴木 1 件・未フォロー 1 件', get('me@x.com') && /自分（あなた）1.*期限間近 1/.test(get('me@x.com').t) && /田中1$/.test(get('tanaka@x.com').t) && /鈴木1$/.test(get('suzuki@x.com').t) && /未フォロー1$/.test(get('__none').t), st);
    ok('帯の先頭は自分（持ち件数の順位づけはしない）', st[0] && st[0].k === 'me@x.com', st.map(x => x.k));
    // 押すと絞り込み
    await p.click('#dtFollow [data-dt-fl="tanaka@x.com"]'); await p.waitForTimeout(500);
    let cs = await cards(p);
    ok('「田中」を押すと田中の進行中だけ（A2）・受注 A4 は出ない', cs.length === 1 && /A2/.test(cs[0].name), cs.map(x => x.name));
    ok('絞り込み中は帯のボタンが押された状態', (await strip(p)).find(x => x.k === 'tanaka@x.com').on === true, 0);
    await p.click('#dtFollow [data-dt-fl="__none"]'); await p.waitForTimeout(500);
    cs = await cards(p);
    ok('「未フォロー」を押すと未フォローの進行中だけ（A3・失注 A7 は出ない）', cs.length === 1 && /A3/.test(cs[0].name), cs.map(x => x.name));
    await p.click('#dtFollow [data-dt-fl="__none"]'); await p.waitForTimeout(400);
    ok('もう一度押すと解除されて全件に戻る', (await cards(p)).length === 6, 0);
    await p.click('#dtFollow [data-dt-fl="suzuki@x.com"]'); await p.waitForTimeout(400);
    await p.evaluate(() => window.qpdResetAllFilters()); await p.waitForTimeout(400);
    ok('「すべて解除」で担当の絞り込みも外れる', (await cards(p)).length === 6 && (await strip(p)).every(x => !x.on), 0);
    ok('エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 宣言・引き継ぎ・割り当て・外す =====
  {
    const { ctx, p, errs } = await open();
    // 宣言（誰もフォローしていない A3 → 確認なしですぐ自分に）
    await p.evaluate(() => window.cloudFollowMe('A3')); await p.waitForTimeout(700);
    ok('「フォローする」：その場で自分が担当になる（確認画面なし）', (await fieldOf(p, 'A3', 'qf-follower')) === 'me@x.com' && !(await p.$('.confirm-dialog')), await fieldOf(p, 'A3', 'qf-follower'));
    let cs = await cards(p);
    ok('カードが「自分・あなた フォロー中」に変わる', /自分・あなた.*フォロー中/.test(byName(cs, 'A3').follow), byName(cs, 'A3'));
    const log1 = JSON.parse(await fieldOf(p, 'A3', 'qf-follow-log'));
    ok('引き継ぎの履歴に 1 件（誰から・誰へ・誰が）', log1.length === 1 && log1[0].from === '' && log1[0].to === 'me@x.com' && log1[0].by === 'me@x.com', log1);
    const com1 = await p.evaluate(() => window.__db.quote_comments.filter(c => c.preset_id === 'A3').map(c => c.body));
    ok('申し送りに「🙋 自分 さんがフォローします」が自動で残る', com1.length === 1 && /🙋 自分 さんがフォローします/.test(com1[0]), com1);

    // 引き継ぎ（A2：田中 → 自分・ひと言つき）
    p.evaluate(() => window.cloudFollowMe('A2'));
    await dlg(p, { note: '返答待ちです', ok: '引き継ぐ' });
    ok('「引き継ぐ」：確認画面でひと言を添えて、担当が田中 → 自分に', (await fieldOf(p, 'A2', 'qf-follower')) === 'me@x.com', await fieldOf(p, 'A2', 'qf-follower'));
    const com2 = await p.evaluate(() => window.__db.quote_comments.filter(c => c.preset_id === 'A2').map(c => c.body));
    ok('申し送りに「🔁 田中 → 自分 に引き継ぎ／返答待ちです」', com2.length === 1 && /🔁 田中 → 自分 に引き継ぎ\/返答待ちです|🔁 田中 → 自分 に引き継ぎ／返答待ちです/.test(com2[0]), com2);

    // 割り当て（A1：自分 → 鈴木）
    p.evaluate(() => window.cloudFollowAssign('A1'));
    await dlg(p, { pick: 'suzuki@x.com', ok: '担当にする' });
    ok('「担当を渡す」：メンバーを選んで割り当てる（自分 → 鈴木）', (await fieldOf(p, 'A1', 'qf-follower')) === 'suzuki@x.com', await fieldOf(p, 'A1', 'qf-follower'));
    const com3 = await p.evaluate(() => window.__db.quote_comments.filter(c => c.preset_id === 'A1').map(c => c.body));
    ok('申し送りに「自分 → 鈴木」', com3.length === 1 && /自分 → 鈴木/.test(com3[0]), com3);

    // 外す（A1）
    p.evaluate(() => window.cloudFollowRelease('A1'));
    await dlg(p, { ok: '外す' });
    ok('「フォローを外す」：担当が空（未フォロー）に戻る', (await fieldOf(p, 'A1', 'qf-follower')) === '', await fieldOf(p, 'A1', 'qf-follower'));
    cs = await cards(p);
    ok('外したカードは「未フォロー」に戻る', byName(cs, 'A1').none === true, byName(cs, 'A1'));
    const log4 = JSON.parse(await fieldOf(p, 'A1', 'qf-follow-log'));
    ok('履歴は新しい順に積まれる（外す → 割り当て）', log4.length === 2 && log4[0].to === '' && log4[1].to === 'suzuki@x.com', log4);

    // やめる（キャンセル）
    const wBefore = await p.evaluate(() => window.__writes.length);
    await p.evaluate(() => window.cloudFollowMe('A2')); // すでに自分
    await p.waitForTimeout(300);
    ok('すでに自分がフォロー中なら何も書かない', (await p.evaluate(() => window.__writes.length)) === wBefore, 0);
    await p.evaluate(() => window.cloudFollowMe('A6')); await p.waitForTimeout(600);   // ロック中
    ok('他の人が編集中の案件は変更できない（担当は鈴木のまま・確認画面も出ない）', (await fieldOf(p, 'A6', 'qf-follower')) === 'suzuki@x.com' && !(await p.$('.confirm-dialog')), await fieldOf(p, 'A6', 'qf-follower'));
    p.evaluate(() => window.cloudFollowAssign('A4'));
    await p.waitForSelector('.confirm-dialog');
    await p.evaluate(() => { const b = [...document.querySelectorAll('.confirm-dialog button')].find(x => x.textContent.trim() === 'やめる'); b && b.click(); }); await p.waitForTimeout(300);
    ok('「やめる」を押すと何も変わらない', (await fieldOf(p, 'A4', 'qf-follower')) === 'tanaka@x.com', 0);
    ok('エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 「⋯」メニュー =====
  {
    const { ctx, p } = await open();
    const items = id => p.evaluate(id => {
      const c = [...document.querySelectorAll('#qpdListWrap .cloud-card')].find(x => (x.querySelector('.cloud-card-name') || {}).textContent.includes(id));
      return c ? [...c.querySelectorAll('.cloud-menu-item')].map(x => x.textContent.replace(/\s+/g, ' ').trim()).filter(t => /フォロー|担当/.test(t) && !/料金フォロー/.test(t)) : null;
    }, id);
    ok('未フォローの案件のメニュー：フォローする・担当を渡す', JSON.stringify(await items('A3')) === JSON.stringify(['🙋 フォローする', '👥 担当を渡す…']), await items('A3'));
    ok('他の人の案件のメニュー：担当を引き継ぐ・担当を渡す・フォローを外す', JSON.stringify(await items('A2')) === JSON.stringify(['🔁 担当を引き継ぐ', '👥 担当を渡す…', '🙌 フォローを外す']), await items('A2'));
    ok('自分の案件のメニュー：担当を渡す・フォローを外す（引き継ぎは出ない）', JSON.stringify(await items('A1')) === JSON.stringify(['👥 担当を渡す…', '🙌 フォローを外す']), await items('A1'));
    ok('終わった案件（受注）にはフォロー関係のメニューが出ない', JSON.stringify(await items('A4')) === '[]', await items('A4'));
    await ctx.close();
  }

  // ===== 新しい案件の既定／コピー =====
  {
    const { ctx, p, errs } = await open();
    // コピーして新規作成（A2 → コピーした人がフォロー担当・履歴は引き継がない）
    await p.evaluate(() => { const r = window.__db.quote_presets.find(x => x.id === 'A2'); r.data.fields['qf-follow-log'] = JSON.stringify([{ from: '', to: 'tanaka@x.com', at: '2026-11-01T00:00:00Z', by: 'tanaka@x.com', note: '' }]); });
    await p.evaluate(() => window.cloudListPresets && window.cloudListPresets(true)); await p.waitForTimeout(800);
    await p.evaluate(() => window.cloudDuplicatePreset('A2')); await p.waitForTimeout(1500);
    const dup = await p.evaluate(() => { const r = window.__db.quote_presets.find(x => /のコピー/.test(x.name)); return r ? { f: r.data.fields['qf-follower'], l: r.data.fields['qf-follow-log'] } : null; });
    ok('コピーして新規作成：フォロー担当はコピーした人・引き継ぎ履歴は引き継がない', dup && dup.f === 'me@x.com' && !dup.l, dup);

    // 新規作成（保存すると作った人が担当）
    await p.evaluate(() => window.qpNewQuote()); await p.waitForTimeout(800);
    const info0 = await p.evaluate(() => { const e = document.getElementById('qfFollowInfo'); return e ? { hidden: e.hidden, t: e.textContent.replace(/\s+/g, ' ').trim() } : null; });
    ok('新規作成の画面：「担当 保存すると、あなたがフォロー担当になります」', info0 && !info0.hidden && /保存すると、あなたがフォロー担当になります/.test(info0.t), info0);
    await p.evaluate(() => { const e = document.getElementById('qf-customer'); e.value = '新規客'; e.dispatchEvent(new Event('input', { bubbles: true })); });
    await p.evaluate(() => window.cloudSaveCurrent()); await p.waitForTimeout(1500);
    const mine = await p.evaluate(() => { const r = window.__db.quote_presets.find(x => x.customer === '新規客'); return r && r.data.fields['qf-follower']; });
    ok('通常の保存で作った案件は、作った人（自分）がフォロー担当', mine === 'me@x.com', mine);
    ok('エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 自由入力の保管は「未フォロー」のまま（割り振り待ち）=====
  {
    const { ctx, p, errs } = await open();
    const r = await p.evaluate(async () => {
      const ok = await window.cloudStoreRawQuote({ customer: '保管客', memo: '件名', rawText: '海上運賃 USD 1,200/20GP' });
      const row = window.__db.quote_presets.find(x => x.customer === '保管客');
      return { ok, f: row ? (row.data.fields['qf-follower'] || '') : null };
    });
    await p.waitForTimeout(500);
    ok('自由入力の保管で作った案件は未フォロー（誰かが宣言するまで）', r.ok && r.f === '', r);
    ok('エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 編集画面の「担当」表示 =====
  {
    const { ctx, p, errs } = await open();
    await p.evaluate(() => window.cloudLoadPreset('A2')); await p.waitForTimeout(1500);
    const ed = await p.evaluate(() => { const e = document.getElementById('qfFollowInfo'); return e ? { hidden: e.hidden, t: e.textContent.replace(/\s+/g, ' ').trim(), btn: !!e.querySelector('button') } : null; });
    ok('案件を開いた直後（閲覧モード）：「担当 田中 フォロー中」・操作できないのでボタンは出さない', ed && !ed.hidden && /田中.*フォロー中/.test(ed.t) && !ed.btn, ed);
    await p.evaluate(() => { const b = document.querySelector('[onclick*="cloudStartEdit"], #btnCloudEdit, .qm-banner-view button'); b && b.click(); }); await p.waitForTimeout(800);
    ok('エラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  await b.close(); srv.close();
  console.log(fails ? '\nFAIL ' + fails + ' 件' : '\n全項目 OK');
  process.exit(fails ? 1 : 0);
})();
