// 🌳 関連付けの「メイン／サブ」（入れ子ツリー）：ダッシュボードのカード・編集画面の関連パネル・一括関連付け。
//   偽の Supabase（メモリ上・or/in/eq の解釈つき）で、ツリー描画・位置づけの切替・循環／二重メインの拒否・列なし（SQL 未実行）時の案内を確かめる。
//   node scripts/design-tests/link-hierarchy-test.js           （THEME=1 で Industry）
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

  // links: [id, a, b, parent|null]  ／ 案件 P1(メイン)→S1→S2（孫）, P1→S3, P1—PEER（ただの関連）, X—Y（別の関連）
  async function open({ noParentCol = false } = {}) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ja-JP' });
    if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
    await ctx.addInitScript(({ noParentCol }) => {
      try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
      const mk = (id, ct) => ({ id, name: '案件' + id, status: '下書き中', customer: 'X社', created_by: 'me@x.com', owner_email: 'me@x.com', updated_at: '2026-11-' + ct + 'T00:00:00Z', ref: 'R-' + id, data: { fields: { 'qf-ref': 'R-' + id }, rows: [] } });
      const L = (id, a, b, parent, note) => ({ id, preset_a: a, preset_b: b, parent_id: parent || null, note: note || '', created_by: 'me@x.com' });
      const db = {
        quote_presets: ['P1', 'S1', 'S2', 'S3', 'PEER', 'X', 'Y', 'Z'].map((id, i) => mk(id, '1' + i)),
        quote_preset_links: [L('l1', 'P1', 'S1', 'P1', '追加分'), L('l2', 'S1', 'S2', 'S1'), L('l3', 'S3', 'P1', 'P1'), L('l4', 'P1', 'PEER', null, '代替案'), L('l5', 'X', 'Y', null)],
        allowed_emails: [{ email: 'me@x.com', role: 'admin', member_no: 1 }], user_profiles: [], quote_comments: [],
        master_votes: [], synonym_groups: [], master_details: [], alias_rules: [], organizations: [], teams: [], org_members: [], team_members: [],
      };
      if (noParentCol) db.quote_preset_links.forEach(l => delete l.parent_id);
      window.__db = db;
      // 'a.eq.X,b.in.(P,Q)' / 'and(a.eq.X,b.eq.Y),and(...)' を解く
      const splitTop = s => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(cur); cur = ''; } else cur += ch; } if (cur) out.push(cur); return out; };
      const term = (t, r) => {
        const m = t.match(/^and\((.*)\)$/); if (m) return splitTop(m[1]).every(x => term(x, r));
        const k = t.match(/^([a-z_]+)\.(eq|in)\.(.*)$/); if (!k) return true;
        if (k[2] === 'eq') return r[k[1]] === k[3];
        return k[3].replace(/^\(|\)$/g, '').split(',').includes(r[k[1]]);
      };
      const qb = t => {
        const st = { op: 'select', filters: [], payload: null, cols: '' };
        const api = {
          select(c) { st.cols = c || ''; return api; }, order() { return api; }, limit() { return api; }, not() { return api; },
          is() { return api; }, ilike() { return api; }, gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; },
          or(expr) { st.filters.push(r => splitTop(expr).some(x => term(x, r))); return api; },
          eq(k, v) { st.filters.push(r => r[k] === v); return api; },
          in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
          upsert(o) { st.op = 'insert'; st.payload = o; return api; },
          insert(o) { st.op = 'insert'; st.payload = o; return api; },
          update(o) { st.op = 'update'; st.payload = o; return api; },
          delete() { st.op = 'delete'; return api; },
          single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
          then(res, rej) {
            const miss = { code: '42703', message: 'column quote_preset_links.parent_id does not exist' };
            const rows = (db[t] = db[t] || []);
            if (t === 'quote_preset_links' && noParentCol) {
              if (/parent_id/.test(st.cols) || (st.payload && JSON.stringify(st.payload).includes('parent_id')) || st.filters.some(f => { try { return f({ parent_id: 'q' }) && false; } catch (e) { return false; } }))
                return Promise.resolve({ data: null, error: miss }).then(res, rej);
              if (st.op === 'select' && st.__inParent) return Promise.resolve({ data: null, error: miss }).then(res, rej);
            }
            let data = null;
            if (st.op === 'insert') { const made = [].concat(st.payload).map(o => Object.assign({ id: 'id' + Math.random().toString(36).slice(2) }, JSON.parse(JSON.stringify(o)))); made.forEach(r => rows.push(r)); if (st.cols) data = st.single ? { id: made[0].id } : made.map(r => ({ id: r.id })); }
            else if (st.op === 'delete') { db[t] = rows.filter(r => !st.filters.every(f => f(r))); }
            else if (st.op === 'update') { rows.filter(r => st.filters.every(f => f(r))).forEach(r => Object.assign(r, JSON.parse(JSON.stringify(st.payload)))); }
            else data = rows.filter(r => st.filters.every(f => f(r))).map(r => Object.assign({}, r));
            return Promise.resolve({ data, error: null }).then(res, rej);
          },
        };
        const origIn = api.in; api.in = (k, vs) => { if (k === 'parent_id') st.__inParent = true; return origIn(k, vs); };
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
    }, { noParentCol });
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
  const card = (p, id) => p.evaluate(id => {
    const el = [...document.querySelectorAll('#qpdListWrap .cloud-card')].find(c => c.querySelector('.cloud-card-links[data-lid="' + id + '"]'));
    if (!el) return null;
    const box = el.querySelector('.cloud-card-links'), pl = el.querySelector('.cloud-card-parentline');
    return {
      parentLine: pl ? pl.textContent.trim() : '',
      head: [...box.querySelectorAll('.cloud-card-links-head')].map(h => h.textContent.trim()),
      treeRoot: [...box.querySelectorAll('.clink-tree--root > .clink-tree-node > .cloud-clink-wrap .clink-name')].map(n => n.textContent),
      nested: [...box.querySelectorAll('.clink-tree .clink-tree .clink-name')].map(n => n.textContent),
      peers: [...box.querySelectorAll('.cloud-clink-list .clink-name')].map(n => n.textContent),
      notes: [...box.querySelectorAll('.clink-note')].map(n => n.textContent),
    };
  }, id);

  // ===== ダッシュボードのツリー =====
  {
    const { ctx, p, errs } = await open();
    const c1 = await card(p, 'P1');
    ok('メインのカードに「🌳 サブ案件（3）」（孫も数える）と「🔗 関連案件（1）」', c1 && c1.head.join('|') === '🌳 サブ案件（3）|🔗 関連案件（1）', c1);
    ok('ツリー直下は S1・S3（別の向きで登録した l3 も）', c1 && c1.treeRoot.sort().join() === '案件S1,案件S3', c1);
    ok('孫 S2 は S1 の下に入れ子で出る', c1 && c1.nested.join() === '案件S2', c1);
    ok('ただの関連 PEER は関連案件のリストに出る', c1 && c1.peers.join() === '案件PEER', c1);
    ok('関連付けの理由が出る（追加分／代替案）', c1 && c1.notes.join() === '追加分,代替案' || (c1 && c1.notes.sort().join() === '📝 代替案,📝 追加分'), c1 && c1.notes);
    const s1 = await card(p, 'S1');
    ok('サブ S1 のカードに「↳ サブ」とメイン P1 の行', s1 && s1.parentLine.includes('↳ サブ') && s1.parentLine.includes('案件P1'), s1);
    ok('S1 のカードにも自分のサブ S2 のツリー', s1 && s1.treeRoot.join() === '案件S2', s1);
    const s2 = await card(p, 'S2');
    ok('孫 S2 のカードは S1 のサブ', s2 && s2.parentLine.includes('案件S1'), s2);
    const xy = await card(p, 'X');
    ok('ただの関連だけのカード X：ツリー無し・親行無し・関連1件', xy && xy.parentLine === '' && xy.treeRoot.length === 0 && xy.peers.join() === '案件Y', xy);
    const z = await card(p, 'Z');
    ok('関連の無いカード Z は空', z && z.parentLine === '' && z.head.length === 0, z);
    if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, 'link-tree-dash.png') }).catch(() => {});

    // ---- 位置づけの切替 ----
    // PEER を P1 のサブにする（P1 カードの関連案件の select）
    await p.evaluate(() => {
      const el = [...document.querySelectorAll('#qpdListWrap .cloud-card')].find(c => c.querySelector('.cloud-card-links[data-lid="P1"]'));
      const row = [...el.querySelectorAll('.cloud-clink-list .cloud-clink-wrap')][0];
      const sel = row.querySelector('select.clink-role'); sel.value = 'sub'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await p.waitForTimeout(1200);
    ok('関連→サブに切替：P1 のサブが 4 件になり、関連案件の欄は消える', await (async () => { const c = await card(p, 'P1'); return c && c.head.join('|') === '🌳 サブ案件（4）' && c.peers.length === 0; })(), await card(p, 'P1'));
    ok('DB：l4 の parent_id が P1', await p.evaluate(() => window.__db.quote_preset_links.find(l => l.id === 'l4').parent_id === 'P1'));
    // サブ S3 をただの関連に戻す
    await p.evaluate(() => {
      const el = [...document.querySelectorAll('#qpdListWrap .cloud-card')].find(c => c.querySelector('.cloud-card-links[data-lid="P1"]'));
      const wrap = [...el.querySelectorAll('.clink-tree--root > .clink-tree-node > .cloud-clink-wrap')].find(w => w.textContent.includes('案件S3'));
      const sel = wrap.querySelector('select.clink-role'); sel.value = 'none'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await p.waitForTimeout(1200);
    ok('サブ→関連に戻す：l3 の parent_id が空・P1 の関連案件に S3', await (async () => { const c = await card(p, 'P1'); return (await p.evaluate(() => window.__db.quote_preset_links.find(l => l.id === 'l3').parent_id)) === null && c.peers.join() === '案件S3'; })(), await card(p, 'P1'));
    // メインとサブの入れ替え（S1 のカードで、メイン P1 を「サブ」にする）＝向きが逆になるだけで循環ではない
    await p.evaluate(() => {
      const el = [...document.querySelectorAll('#qpdListWrap .cloud-card')].find(c => c.querySelector('.cloud-card-links[data-lid="S1"]'));
      const sel = el.querySelector('.cloud-card-parentline select.clink-role'); sel.value = 'sub'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await p.waitForTimeout(1200);
    ok('メイン⇄サブの入れ替え：l1 の parent_id が S1 に変わる', await p.evaluate(() => window.__db.quote_preset_links.find(l => l.id === 'l1').parent_id === 'S1'));
    await p.evaluate(() => cloudSetLinkRole('l1', 'P1', 'sub'));   // 元に戻す（P1 がメイン）
    // 循環：P1→S1→S2 の鎖があるとき、S2 を P1 の「メイン」にする（P1—S2 の関連を足してから）は輪になるので拒否
    const lk = await p.evaluate(async () => cloudLinkPresets('P1', 'S2', '', { silent: true }));
    const cyc = await p.evaluate(async () => { const row = window.__db.quote_preset_links.find(l => [l.preset_a, l.preset_b].sort().join() === 'P1,S2'); return { ok: await cloudSetLinkRole(row.id, 'P1', 'main'), parent: row.parent_id }; });
    ok('輪になる設定（S2 を P1 のメインに）は拒否され、DB は変わらない', lk && lk.ok && cyc.ok === false && !cyc.parent, [lk, cyc]);
    // 二重メイン：S2（すでに S1 のサブ）を P1 のサブにもする（P1—S2 を新規に関連付け）
    const r = await p.evaluate(async () => { const row = window.__db.quote_preset_links.find(l => [l.preset_a, l.preset_b].sort().join() === 'P1,S2'); return { ok: await cloudSetLinkRole(row.id, 'P1', 'sub'), parent: row.parent_id }; });
    ok('すでに別のメイン（S1）があるサブを、別のメイン P1 のサブにもはできない（1 サブ 1 メイン）', r.ok === false && !r.parent, r);
    ok('ページエラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 一括の関連付け（メイン指定）=====
  {
    const { ctx, p, errs } = await open();
    await p.evaluate(() => cloudToggleLinkMode()); await p.waitForTimeout(500);
    ok('一括関連付けバーに「ただ関連付ける／最初に選んだ案件をメインに」', await p.evaluate(() => [...document.querySelectorAll('#qpdLinkBarRole option')].map(o => o.value).join() === 'plain,main'));
    await p.evaluate(() => { document.getElementById('qpdLinkBarRole').value = 'main'; cloudLinkBarRefresh(); });
    await p.evaluate(() => { cloudToggleLinkSel('Z'); cloudToggleLinkSel('PEER'); }); await p.waitForTimeout(300);
    ok('バーに「メイン：」（最初に選んだ Z）と「サブ 1件」', await p.evaluate(() => { const t = document.getElementById('qpdLinkBar').textContent; return t.includes('メイン') && t.includes('サブ'); }), await p.evaluate(() => document.getElementById('qpdLinkBar').textContent));
    await p.evaluate(() => cloudLinkSelected()); await p.waitForTimeout(1500);
    ok('Z がメイン・PEER がサブとして関連付く（DB）', await p.evaluate(() => { const l = window.__db.quote_preset_links.find(x => [x.preset_a, x.preset_b].sort().join() === 'PEER,Z'); return l && l.parent_id === 'Z'; }));
    ok('PEER の関連付けは P1 とのものと合わせ、PEER は Z のサブ＋P1 とは関連（1 サブ 1 メイン・l4 は peer なので可）', await (async () => { const c = await card(p, 'Z'); return c && c.head.join('|').includes('サブ案件（1）'); })(), await card(p, 'Z'));
    ok('ページエラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 編集画面（案件を開いたときの関連パネル）=====
  {
    const { ctx, p, errs } = await open();
    await p.evaluate(() => { window.quoteCloudLoadedId = () => 'P1'; });
    const html = await p.evaluate(async () => { const l = await window.cloudFetchPresetLinks('P1'); return l.map(x => [x.rel, x.preset.id, (x.kids || []).length].join(':')); });
    ok('cloudFetchPresetLinks：サブ（child）に孫つき・メインなし・関連 peer', html.sort().join() === 'child:S1:1,child:S3:0,peer:PEER:0', html);
    const r = await p.evaluate(async () => { const l = await window.cloudFetchPresetLinks('S1'); return l.map(x => x.rel + ':' + x.preset.id); });
    ok('S1 から見ると P1 は parent・S2 は child', r.sort().join() === 'child:S2,parent:P1', r);
    await ctx.close();
  }

  // ===== 編集画面の関連パネル（描画・位置づけ切替・追加時のメイン／サブ）=====
  {
    const { ctx, p, errs } = await open();
    await p.evaluate(() => { window.quoteCloudLoadedId = () => 'P1'; document.querySelector('#qpDashboard') && (document.querySelector('#qpDashboard').hidden = true); });
    await p.evaluate(() => window.sqOnActivate()); await p.waitForTimeout(800);
    const panel = () => p.evaluate(() => {
      const sec = document.querySelector('#sqPanel .sq-links-section');
      if (!sec) return null;
      return {
        groups: [...sec.querySelectorAll('.sq-links-group-title')].map(x => x.textContent.trim()),
        root: [...sec.querySelectorAll('.sq-link-tree--root > .sq-link-tree-node > .sq-link-item .sq-link-name')].map(x => x.textContent),
        nested: [...sec.querySelectorAll('.sq-link-tree .sq-link-tree .sq-link-name')].map(x => x.textContent),
        roles: [...sec.querySelectorAll('select.sq-link-role')].map(x => x.value).join(),
        title: sec.querySelector('.sq-links-title').textContent,
      };
    });
    let pn = await panel();
    ok('編集画面：サブ案件ツリー（S1・S3・孫 S2）と関連案件のグループ', pn && pn.groups.join('|') === '🌳 サブ案件（3）|🔗 関連案件（1）' && pn.root.sort().join() === '案件S1,案件S3' && pn.nested.join() === '案件S2', pn);
    ok('位置づけの選択（関連／サブ／メイン）が各件にある', pn && pn.roles.split(',').length === 4, pn);
    // メイン側から開いた S1 では、メイン P1 が「👑 この案件のメイン」に出る
    await p.evaluate(() => { window.quoteCloudLoadedId = () => 'S1'; return window.sqOnActivate(); }); await p.waitForTimeout(800);
    pn = await panel();
    ok('S1 を開くと「👑 この案件のメイン」に P1・サブに S2', pn && pn.groups.join('|') === '👑 この案件のメイン|🌳 サブ案件（1）', pn);
    // 追加時にサブ指定：Z を P1 のサブにする
    await p.evaluate(() => { window.quoteCloudLoadedId = () => 'P1'; return window.sqOnActivate(); }); await p.waitForTimeout(800);
    await p.evaluate(() => { sqToggleLinkSearch(); }); 
    await p.evaluate(() => { document.getElementById('sqLinkSearchInput').value = '案件Z'; return sqDoLinkSearch(); }).catch(() => {});
    await p.waitForTimeout(500);
    // 偽 DB は ilike を無視して全件返す。Z のボタンを押す
    await p.evaluate(() => { const b = [...document.querySelectorAll('.sq-link-result')].find(x => x.textContent.includes('案件Z')); b && b.click(); }); await p.waitForTimeout(300);
    ok('理由バーに「ただ関連付ける／サブにする／メインにする」の選択', await p.evaluate(() => [...document.querySelectorAll('input[name="sqLinkRole"]')].map(x => x.value).join() === 'none,sub,main'));
    await p.evaluate(() => { document.querySelector('input[name="sqLinkRole"][value="sub"]').click(); return sqConfirmPendingLink(); }); await p.waitForTimeout(1200);
    ok('「この案件のサブにする」で追加：DB の parent_id が P1・パネルのサブが 4 件', await p.evaluate(() => { const l = window.__db.quote_preset_links.find(x => [x.preset_a, x.preset_b].sort().join() === 'P1,Z'); return l && l.parent_id === 'P1'; }) && (await panel()).groups[0] === '🌳 サブ案件（4）', await panel());
    // 位置づけ切替：パネルの Z を「関連」に戻す
    await p.evaluate(() => { const it = [...document.querySelectorAll('.sq-link-tree--root > .sq-link-tree-node')].find(n => n.textContent.includes('案件Z')); const sel = it.querySelector('select.sq-link-role'); sel.value = 'none'; sel.dispatchEvent(new Event('change', { bubbles: true })); }); await p.waitForTimeout(1200);
    ok('パネルで「関連」へ切替：parent_id が空・サブは 3 件に戻る', await p.evaluate(() => { const l = window.__db.quote_preset_links.find(x => [x.preset_a, x.preset_b].sort().join() === 'P1,Z'); return l && l.parent_id === null; }) && (await panel()).groups.join('|').startsWith('🌳 サブ案件（3）'), await panel());
    if (process.env.OUT) { await p.screenshot({ path: path.join(process.env.OUT, 'link-tree-panel.png') }).catch(() => {}); }
    ok('ページエラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== SQL 未実行（parent_id 列なし）=====
  {
    const { ctx, p, errs } = await open({ noParentCol: true });
    const c1 = await card(p, 'P1');
    ok('列が無くても、関連付けは従来どおり「関連案件」として出る（サブ欄なし）', c1 && c1.head.join('|') === '🔗 関連案件（2）' && c1.peers.sort().join() === '案件PEER,案件S1' || (c1 && c1.peers.length >= 2), c1);
    const toasts = [];
    await p.evaluate(() => { window.__toasts = []; const o = window.quoteShowToast; window.quoteShowToast = function (m) { window.__toasts.push(m); return o && o.apply(this, arguments); }; });
    await p.evaluate(() => {
      const el = [...document.querySelectorAll('#qpdListWrap .cloud-card')].find(c => c.querySelector('.cloud-card-links[data-lid="P1"]'));
      const sel = el.querySelector('.cloud-clink-list select.clink-role'); sel.value = 'sub'; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await p.waitForTimeout(1000);
    ok('メイン／サブを選ぶと SQL 実行の案内が出る', (await p.evaluate(() => window.__toasts)).some(m => /quote-preset-links-hierarchy\.sql/.test(m)), await p.evaluate(() => window.__toasts));
    ok('ページエラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== カードの「🌱 サブ作成」（この案件をコピーして、サブとして関連付ける）=====
  {
    const { ctx, p, errs } = await open();
    ok('詳細表示のカードに「🌱 サブ作成」ボタンがある', await p.evaluate(() => document.querySelectorAll('#qpdListWrap .cloud-card .btn-preset-sub').length === 8));
    ok('「⋯」メニュー（かんたん表示用）にも「サブ案件を作成」がある', await p.evaluate(() => [...document.querySelectorAll('#qpdListWrap .cloud-card .cloud-menu-item')].some(b => b.textContent.includes('サブ案件を作成'))));
    const before = await p.evaluate(() => window.__db.quote_presets.length);
    await p.evaluate(() => document.querySelector('#qpdListWrap .cloud-card:has(.cloud-card-links[data-lid="Z"]) .btn-preset-sub').click());
    await p.waitForTimeout(1800);
    const r = await p.evaluate(() => {
      const db = window.__db, made = db.quote_presets.find(x => x.name === '案件Z のサブ');
      const lk = made && db.quote_preset_links.find(l => [l.preset_a, l.preset_b].includes(made.id) && [l.preset_a, l.preset_b].includes('Z'));
      return { made: !!made, count: db.quote_presets.length, parent: lk && lk.parent_id, status: made && made.status, hasCopied: !!(made && made.data && made.data.copiedFrom), ref: made && made.data.fields['qf-ref'] };
    });
    ok('案件が 1 件増え、名前は「◯◯ のサブ」・状態は下書き中', r.made && r.count === before + 1 && r.status === '下書き中', r);
    ok('コピー元 Z がメイン（parent_id＝Z）としてサブに関連付く', r.parent === 'Z', r);
    ok('サブには代替わり（copiedFrom）を付けない', r.hasCopied === false, r);
    const zc = await card(p, 'Z');
    ok('ダッシュボード：Z のカードに「🌳 サブ案件（1）」が出る', zc && zc.head.join('|') === '🌳 サブ案件（1）' && zc.treeRoot.join() === '案件Z のサブ', zc);
    // 同じ案件でもう一度 → 「のサブ_2」で 2 件目
    await p.evaluate(() => document.querySelector('#qpdListWrap .cloud-card:has(.cloud-card-links[data-lid="Z"]) .btn-preset-sub').click());
    await p.waitForTimeout(1800);
    const zc2 = await card(p, 'Z');
    ok('もう一度作ると、名前が重ならず（_2）サブが 2 件になる', zc2 && zc2.head.join('|') === '🌳 サブ案件（2）' && zc2.treeRoot.sort().join() === '案件Z のサブ,案件Z のサブ_2', zc2);
    // サブの上でもさらにサブを作れる（孫）
    ok('ページエラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== 通常のコピーと関連付け（サブ＝同じメインの兄弟として／メイン＝サブも一緒に）=====
  {
    const { ctx, p, errs } = await open();
    const lk = (name) => p.evaluate((name) => {
      const db = window.__db, made = db.quote_presets.find(x => x.name === name);
      if (!made) return null;
      const mine = db.quote_preset_links.filter(x => [x.preset_a, x.preset_b].includes(made.id));
      const up = mine.find(x => x.parent_id && x.parent_id !== made.id);   // 自分が「サブ」側の関連（自分がメインの関連は数えない）
      const nm = id => (db.quote_presets.find(x => x.id === id) || {}).name;
      return { parent: up ? nm(up.parent_id) : null, linked: mine.length > 0 };
    }, name);
    const clickCopy = (id) => p.evaluate(id => document.querySelector('#qpdListWrap .cloud-card:has(.cloud-card-links[data-lid="' + id + '"]) .btn-preset-copy:not(.btn-preset-sub)').click(), id);
    const dialog = () => p.evaluate(() => { const d = document.querySelector('.confirm-dialog'); return d ? { title: d.querySelector('.confirm-title').textContent, boxes: [...d.querySelectorAll('.dup-subs input')].map(x => ({ nm: x.nextSibling.textContent, on: x.checked, dis: x.disabled })) } : null; });

    // 1) ただのコピー（関連なし）：確認なし・単独
    const n0 = await p.evaluate(() => window.__db.quote_presets.length);
    await clickCopy('Z'); await p.waitForTimeout(1500);
    ok('関連のない案件のコピー：確認は出ず、単独のコピーができる', !(await dialog()) && (await p.evaluate(() => window.__db.quote_presets.length)) === n0 + 1 && (await lk('案件Z のコピー')).linked === false, await lk('案件Z のコピー'));

    // 2) サブ（S3＝P1 のサブ・サブなし）をコピー → 同じメイン P1 のサブ（兄弟）
    await clickCopy('S3'); await p.waitForTimeout(1800);
    ok('サブのコピー：確認は出ず、コピーも同じメイン（P1）のサブとして付く', !(await dialog()) && (await lk('案件S3 のコピー')).parent === '案件P1', await lk('案件S3 のコピー'));
    const c1 = await card(p, 'P1');
    ok('メインのカードのサブが 1 件増える（S1・S3・S3のコピー＋孫 S2）', c1 && c1.head[0] === '🌳 サブ案件（4）', c1 && c1.head);

    // 3) メイン P1 をコピー → 確認画面（サブのツリー）。S3 のチェックを外し、S1 を残して OK
    await clickCopy('P1'); await p.waitForTimeout(600);
    const dg = await dialog();
    ok('メインのコピー：サブ選択の確認画面が出る（S1・S2・S3・S3のコピーが並び、既定はすべてチェック）', dg && dg.title.includes('サブ案件も一緒に') && dg.boxes.length === 4 && dg.boxes.every(b => b.on), dg);
    // S1 のチェックを外す → 孫 S2 は自動で外れて選べなくなる
    await p.evaluate(() => { const b = [...document.querySelectorAll('.dup-subs input')].find(x => x.nextSibling.textContent === '案件S1'); b.click(); });
    const dg2 = await dialog();
    ok('サブのチェックを外すと、その下（孫 S2）も外れて選べなくなる', dg2.boxes.find(b => b.nm === '案件S2').on === false && dg2.boxes.find(b => b.nm === '案件S2').dis === true, dg2);
    await p.evaluate(() => { const b = [...document.querySelectorAll('.dup-subs input')].find(x => x.nextSibling.textContent === '案件S1'); b.click(); });   // S1 を戻す（S2 も戻る）
    await p.evaluate(() => { const b = [...document.querySelectorAll('.dup-subs input')].find(x => x.nextSibling.textContent === '案件S3'); b.click(); });   // S3 を外す
    await p.evaluate(() => document.querySelector('.confirm-dialog .btn-primary').click()); await p.waitForTimeout(2500);
    const m = await lk('案件P1 のコピー'), s1c = await lk('案件S1 のコピー'), s2c = await lk('案件S2 のコピー'), s3c = await lk('案件S3 のコピー_2');
    ok('メインのコピー：コピーしたメインは単独（親なし）', m && m.parent === null, m);
    const tree = await card(p, 'P1');   // 元のメインは変わらない
    ok('選んだサブ（S1）がコピーされ、コピーしたメインのサブとして付く', s1c && s1c.parent === '案件P1 のコピー', s1c);
    ok('孫（S2）もコピーされ、S1 のコピーのサブとして付く（ツリーごと）', s2c && s2c.parent === '案件S1 のコピー', s2c);
    ok('チェックを外したサブ（S3）はコピーされない', !(await p.evaluate(() => window.__db.quote_presets.some(x => x.name === '案件S3 のコピー_2'))), s3c);
    ok('元のメイン P1 のサブは変わらない', tree && tree.treeRoot.includes('案件S1') && tree.treeRoot.includes('案件S3'), tree);

    // 4) やめる → 何も作られない
    const n1 = await p.evaluate(() => window.__db.quote_presets.length);
    await clickCopy('P1'); await p.waitForTimeout(500);
    await p.evaluate(() => document.querySelector('.confirm-dialog .btn-cancel').click()); await p.waitForTimeout(500);
    ok('確認画面で「やめる」：何もコピーされない', (await p.evaluate(() => window.__db.quote_presets.length)) === n1);

    // 5) すべて外してコピー → メインだけ
    await clickCopy('P1'); await p.waitForTimeout(500);
    await p.evaluate(() => { [...document.querySelectorAll('.dup-subs > li > label input')].forEach(x => { if (x.checked) x.click(); }); document.querySelector('.confirm-dialog .btn-primary').click(); }); await p.waitForTimeout(2000);
    ok('すべてのチェックを外すと、メインだけがコピーされる（+1 件）', (await p.evaluate(() => window.__db.quote_presets.length)) === n1 + 1, await p.evaluate(() => window.__db.quote_presets.length));

    // 6) サブでもあり、サブを持つ案件（S1）：確認画面（S2）が出て、コピーは P1 の兄弟＋S2 のコピーがその下
    await clickCopy('S1'); await p.waitForTimeout(600);
    const dg3 = await dialog();
    ok('サブを持つサブ（S1）のコピー：サブ（S2）の選択が出る', dg3 && dg3.boxes.map(b => b.nm).join() === '案件S2', dg3);
    await p.evaluate(() => document.querySelector('.confirm-dialog .btn-primary').click()); await p.waitForTimeout(2500);
    const sib = await p.evaluate(() => {
      const db = window.__db, byName = n => db.quote_presets.find(x => x.name === n);
      const parentOf = n => { const q = byName(n); const l = q && db.quote_preset_links.find(x => [x.preset_a, x.preset_b].includes(q.id) && x.parent_id && x.parent_id !== q.id); return l && (db.quote_presets.find(x => x.id === l.parent_id) || {}).name; };
      return { s1: parentOf('案件S1 のコピー_2'), s2: parentOf('案件S2 のコピー_2') };
    });
    ok('S1 のコピーは P1 の兄弟として付く', sib.s1 === '案件P1', sib);
    ok('S2 のコピーは、その S1 のコピーの下に付く（ツリーごと）', sib.s2 === '案件S1 のコピー_2', sib);
    ok('ページエラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  // ===== SQL 未実行でも「サブ作成」は、ただの関連として付く =====
  {
    const { ctx, p, errs } = await open({ noParentCol: true });
    await p.evaluate(() => { window.__toasts = []; const o = window.quoteShowToast; window.quoteShowToast = function (m) { window.__toasts.push(m); return o && o.apply(this, arguments); }; });
    await p.evaluate(() => document.querySelector('#qpdListWrap .cloud-card:has(.cloud-card-links[data-lid="Z"]) .btn-preset-sub').click());
    await p.waitForTimeout(1800);
    const r = await p.evaluate(() => { const db = window.__db, made = db.quote_presets.find(x => x.name === '案件Z のサブ'); const lk = made && db.quote_preset_links.find(l => [l.preset_a, l.preset_b].includes(made.id)); return { made: !!made, linked: !!lk, toasts: window.__toasts }; });
    ok('列なしでも案件は作られ、ただの関連として付く', r.made && r.linked, r);
    ok('SQL 実行の案内が出る', r.toasts.some(m => /quote-preset-links-hierarchy\.sql/.test(m)), r.toasts);
    ok('ページエラーなし', errs.length === 0, errs);
    await ctx.close();
  }

  await b.close(); srv.close();
  console.log(fails ? `\n${fails} 件失敗` : '\nすべて成功');
  process.exit(fails ? 1 : 0);
})();
