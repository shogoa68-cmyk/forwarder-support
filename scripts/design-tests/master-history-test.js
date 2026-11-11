// 🕘 マスターの変更履歴（読み取り専用の画面・js/master-history.js）を、偽の Supabase で確かめる。
//   node scripts/design-tests/master-history-test.js            （THEME=1 で Industry・QUIET=1 で Quiet）
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
  const ok = (n, c, d) => { const l = (c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)); out.push(l); console.log(l); };
  const ME = 'alice@example.com';

  // 履歴の偽データ（新しいほど id が大きい）
  const hist = [];
  let hid = 0;
  const add = (o) => hist.push(Object.assign({ id: ++hid, changed_at: new Date(Date.UTC(2026, 10, 1, 0, hid)).toISOString(), changed_by: ME, row_id: 'r' + hid, old_data: null, new_data: null }, o));
  add({ source_table: 'master_votes', action: 'BASELINE', changed_by: 'system:baseline', row_id: null, field: null, value: null, new_data: { baseline_rows: 2 } });
  add({ source_table: 'master_votes', action: 'BASELINE', changed_by: 'system:baseline', field: 'customer', value: 'ABC商事', new_data: { field: 'customer', value: 'ABC商事' } });
  // 一覧の 2 ページ目まで使う件数（品名の登録 60 件）
  for (let i = 0; i < 60; i++) add({ source_table: 'master_votes', action: 'INSERT', field: 'nm', value: '品目' + String(i).padStart(2, '0'), new_data: { field: 'nm', value: '品目' + String(i).padStart(2, '0'), voter_email: ME } });
  add({ source_table: 'synonym_groups', action: 'UPDATE', field: 'customer', value: 'ABC商事', old_data: { canonical: 'ABC商事', aliases: ['ABC'] }, new_data: { canonical: 'ABC商事', aliases: ['ABC', 'エービーシー商事'] } });
  add({ source_table: 'master_details', action: 'UPDATE', field: 'customer', value: 'ABC商事', old_data: { details: { dealType: 'ship', country: 'JP' } }, new_data: { details: { dealType: 'agent', country: 'VN', website: 'https://example.com' } } });
  add({ source_table: 'master_attachments', action: 'INSERT', field: 'customer', value: 'ABC商事', new_data: { file_name: '名刺.pdf', uploaded_by: ME } });
  add({ source_table: 'master_requests', action: 'UPDATE', field: 'port', value: 'HOCHIMINH', old_data: { status: 'pending' }, new_data: { status: 'approved', decided_by: 'carol@example.com', requested_by: 'bob@example.com' } });
  add({ source_table: 'master_votes', action: 'DELETE', field: 'nm', value: '誤登録の品名', changed_by: 'carol@example.com', old_data: { field: 'nm', value: '誤登録の品名' } });
  add({ source_table: 'master_votes', action: 'INSERT', field: 'nm', value: '<img src=x onerror="window.__xss=1">', new_data: {} });
  add({ source_table: 'master_votes', action: 'INSERT', field: 'port', value: 'THC_100%', changed_by: 'bob@example.com', new_data: {} });
  const NON_BASE = hist.filter(h => h.action !== 'BASELINE').length;

  async function open(opts = {}) {
    const ctx = await b.newContext({ viewport: { width: +(process.env.W || 1400), height: +(process.env.H || 900) }, locale: 'ja-JP' });
    if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
    if (process.env.QUIET) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ quiet: true })); } catch (e) {} });
    await ctx.addInitScript(({ hist, ME, opts }) => {
      try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
      const db = {
        master_votes: [{ field: 'nm', value: 'THC', voter_email: ME }, { field: 'customer', value: 'ABC商事', voter_email: ME }, { field: 'port', value: 'HOCHIMINH', voter_email: ME }],
        synonym_groups: [{ id: 'g1', field: 'customer', canonical: 'ABC商事', aliases: ['ABC'] }],
        master_details: [{ field: 'nm', value: 'THC', details: {} }],
        alias_rules: [], master_history: hist,
      };
      window.__db = db; window.__writes = 0; window.__queries = [];
      const rx = c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const like = (pat) => { const s = String(pat); let re = '', i = 0; while (i < s.length) { const c = s[i]; if (c === '\\' && i + 1 < s.length) { re += rx(s[i + 1]); i += 2; continue; } re += c === '%' ? '.*' : c === '_' ? '.' : rx(c); i++; } return new RegExp('^' + re + '$', 'i'); };
      const qb = t => {
        const st = { op: 'select', filters: [], order: null, lim: null, one: false };
        const api = {
          select() { return api; }, not() { return api; }, or() { return api; }, is() { return api; }, gte() { return api; }, lte() { return api; }, range() { return api; },
          order(c, o) { st.order = [c, !(o && o.ascending === false)]; return api; }, limit(n) { st.lim = n; return api; },
          eq(k, v) { st.filters.push(r => r[k] === v); return api; }, neq(k, v) { st.filters.push(r => r[k] !== v); return api; },
          lt(k, v) { st.filters.push(r => r[k] < v); return api; },
          in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
          ilike(k, p) { const re = like(p); st.filters.push(r => re.test(r[k] == null ? '' : String(r[k]))); return api; },
          match(o) { st.filters.push(r => Object.keys(o).every(k => r[k] === o[k])); return api; },
          upsert() { st.op = 'write'; return api; }, insert() { st.op = 'write'; return api; }, update() { st.op = 'write'; return api; }, delete() { st.op = 'write'; return api; },
          single() { st.one = true; return api; }, maybeSingle() { st.one = true; return api; },
          then(res, rej) {
            if (st.op === 'write') { window.__writes++; return Promise.resolve({ data: null, error: null }).then(res, rej); }
            if (t === 'master_history') {
              if (opts.nosql) return Promise.resolve({ data: null, error: { message: 'relation "public.master_history" does not exist' } }).then(res, rej);
              window.__queries.push(1);
            }
            let data = (db[t] || []).filter(r => st.filters.every(f => f(r)));
            if (st.order) data = data.slice().sort((a, z) => (a[st.order[0]] > z[st.order[0]] ? 1 : -1) * (st.order[1] ? 1 : -1));
            if (st.lim != null) data = data.slice(0, st.lim);
            if (st.one) data = data[0] || null;
            return Promise.resolve({ data, error: null }).then(res, rej);
          },
        };
        return api;
      };
      const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, presenceState() { return {}; }, unsubscribe() { return Promise.resolve(); } };
      const user = { email: ME, user_metadata: { full_name: 'A' } };
      const client = {
        from: qb, rpc: name => Promise.resolve({ data: name === 'get_my_role' ? 'member' : null, error: null }), channel: () => ch, removeChannel() {}, storage: { from: () => ({}) },
        auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signOut: () => Promise.resolve({}), signInWithOAuth: () => Promise.resolve({}) },
      };
      window.supabase = { createClient: () => client };
    }, { hist, ME, opts });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    const p = await ctx.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    p.on('dialog', d => d.accept());
    p.setDefaultTimeout(10000);
    await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1200);
    await p.evaluate(async () => { if (window.statsLoadMasterCache) await window.statsLoadMasterCache(); switchCategory('master', document.querySelector('[onclick*="switchCategory(\'master"]')); });
    await p.waitForTimeout(1200);
    return { ctx, p, errs };
  }
  const items = p => p.evaluate(() => document.querySelectorAll('#mhList .mh-item').length);
  const listText = p => p.evaluate(() => (document.getElementById('mhList') || {}).textContent || '');

  // ===== ふつうの動き =====
  {
    const { ctx, p, errs } = await open();
    const L = '[履歴] ';
    ok(L + 'マスター管理の絞り込みの行に「🕘 履歴」が出る', await p.evaluate(() => document.querySelectorAll('#statsPane-master .master-filter-chips .mh-open-btn').length) === 1, null);
    // 描き直しても 1 つだけ（種別を切り替えて、画面が作り直される）
    await p.evaluate(() => { const c = document.querySelector('#statsPane-master .master-filter-chip:not(.is-active)'); c && c.click(); }); await p.waitForTimeout(500);
    ok(L + '画面を描き直しても、ボタンは 1 つだけ', await p.evaluate(() => document.querySelectorAll('#statsPane-master .mh-open-btn').length) === 1, null);

    const w0 = await p.evaluate(() => window.__writes);   // 履歴を開く前に、ページ自体が行った書き込み（ログイン時の処理など）の回数
    await p.click('#statsPane-master .mh-open-btn'); await p.waitForTimeout(700);
    ok(L + '履歴の画面が開く', await p.evaluate(() => !!document.getElementById('mhModal')), null);
    ok(L + '1 ページ目は 50 件（出発点は除く）', (await items(p)) === 50, await items(p));
    ok(L + '「さらに古い履歴があります」と「もっと見る」が出る', (await p.evaluate(() => document.getElementById('mhFoot').textContent)).includes('さらに古い') && await p.evaluate(() => !!document.querySelector('#mhFoot .mh-more')), null);
    ok(L + '新しい順（いちばん新しい操作が先頭）', (await p.evaluate(() => document.querySelector('#mhList .mh-name').textContent)) === 'THC_100%', null);
    await p.click('#mhFoot .mh-more'); await p.waitForTimeout(500);
    ok(L + '「もっと見る」で残りが読み込まれ（重複なし）、出発点は含まれない', (await items(p)) === NON_BASE, [await items(p), NON_BASE]);
    ok(L + '最後まで読んだら「もっと見る」は消える', await p.evaluate(() => !document.querySelector('#mhFoot .mh-more')), null);

    // 中身の説明
    await p.fill('#mhQ', 'ABC商事'); await p.waitForTimeout(800);
    const t = await listText(p);
    ok(L + '別名の追加が「＋ 別名」で分かる', t.includes('別名を変更') && t.includes('＋ 別名：エービーシー商事'), t.slice(0, 300));
    ok(L + '詳細の変更が前後で分かる（取引形態・国）', t.includes('荷主') && t.includes('海外代理店') && t.includes('ベトナム'), t.slice(0, 600));
    ok(L + '添付の追加が分かる', t.includes('📎 名刺.pdf'), t);
    ok(L + '名前の絞り込みで、その名前の履歴だけになる', (await items(p)) === 3, await items(p));

    // 種別・操作・人・出発点
    await p.fill('#mhQ', ''); await p.waitForTimeout(700);
    await p.selectOption('#mhField', 'port'); await p.waitForTimeout(500);
    ok(L + '種別（港）で絞り込める', (await items(p)) === 2 && (await listText(p)).includes('承認'), await items(p));
    ok(L + '承認の履歴に、判断した人・申請した人が出る', (await listText(p)).includes('carol') && (await listText(p)).includes('bob'), await listText(p));
    await p.selectOption('#mhField', 'all'); await p.selectOption('#mhAction', 'DELETE'); await p.waitForTimeout(500);
    ok(L + '操作（削除）で絞り込める', (await items(p)) === 1 && (await listText(p)).includes('マスターから解除'), await listText(p));
    await p.selectOption('#mhAction', 'all'); await p.fill('#mhWho', 'carol'); await p.waitForTimeout(800);
    ok(L + '変更した人で絞り込める（carol は削除の 1 件）', (await items(p)) === 1, await items(p));
    await p.fill('#mhWho', ''); await p.waitForTimeout(600);
    await p.check('#mhBase'); await p.waitForTimeout(600);
    for (let k = 0; k < 4 && await p.evaluate(() => !!document.querySelector('#mhFoot .mh-more')); k++) { await p.click('#mhFoot .mh-more'); await p.waitForTimeout(400); }   // 出発点は最も古いので、最後まで読む
    ok(L + '「出発点も表示」で出発点（既存データ）も見える', (await p.evaluate(() => document.querySelectorAll('#mhList .mh-act-base').length)) === 2, null);
    ok(L + '出発点の目印の行は「出発点を記録（2 件）」と分かる', (await listText(p)).includes('出発点を記録（2 件）'), null);
    await p.uncheck('#mhBase'); await p.waitForTimeout(500);

    // % や _ を含む名前でも、その文字どおりに探せる
    await p.fill('#mhQ', 'THC_100%'); await p.waitForTimeout(800);
    ok(L + '「%」「_」を含む名前も、そのまま探せる（ワイルドカードにならない）', (await items(p)) === 1, await items(p));
    await p.fill('#mhQ', ''); await p.waitForTimeout(500);

    // 名前を押すと、その名前の経緯だけに
    await p.evaluate(() => { const n = [...document.querySelectorAll('#mhList .mh-name')].find(x => x.textContent === '品目55'); n.click(); }); await p.waitForTimeout(700);
    ok(L + '名前を押すと、その名前だけに絞り込む（欄にも入る）', (await items(p)) === 1 && (await p.inputValue('#mhQ')) === '品目55' && (await p.inputValue('#mhField')) === 'nm', await items(p));

    // 安全：書き込みなし・HTML は文字として出す
    await p.fill('#mhQ', 'img'); await p.waitForTimeout(800);
    ok(L + '名前に HTML があっても、文字として表示する（スクリプトは動かない）', (await p.evaluate(() => window.__xss === undefined && !document.querySelector('#mhList img'))) && (await listText(p)).includes('<img'), null);
    ok(L + '履歴の画面を操作しても、DB への書き込みは増えない（0 回）', (await p.evaluate(() => window.__writes)) === w0, [w0, await p.evaluate(() => window.__writes)]);
    ok(L + '元の記録（技術情報）は閉じたまま。開くと中身が読める', await p.evaluate(() => { const d = document.querySelector('#mhList .mh-raw'); return !!d && !d.open && /master_votes/.test(d.textContent); }), null);

    // 閉じ方
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(L + 'Esc で閉じる', await p.evaluate(() => !document.getElementById('mhModal')), null);
    await p.click('#statsPane-master .mh-open-btn'); await p.waitForTimeout(500);
    await p.mouse.click(4, 4); await p.waitForTimeout(200);
    ok(L + '外側を押すと閉じる', await p.evaluate(() => !document.getElementById('mhModal')), null);
    await p.click('#statsPane-master .mh-open-btn'); await p.waitForTimeout(500);
    await p.click('#mhModal [data-act="close"]'); await p.waitForTimeout(200);
    ok(L + '✕ で閉じる', await p.evaluate(() => !document.getElementById('mhModal')), null);

    // 詳細ポップアップの入口
    await p.evaluate(() => window.statsToggleMasterDetail('customer', 'ABC商事')); await p.waitForTimeout(500);
    ok(L + 'マスターの詳細に「🕘 この名前の履歴」が出る', await p.evaluate(() => !!document.querySelector('#mdDetailModal .mh-detail-btn')), null);
    await p.click('#mdDetailModal .mh-detail-btn'); await p.waitForTimeout(800);
    ok(L + 'その名前（お客様・ABC商事）の履歴が開く', (await p.inputValue('#mhQ')) === 'ABC商事' && (await p.inputValue('#mhField')) === 'customer' && (await items(p)) === 3, [await p.inputValue('#mhQ'), await items(p)]);
    ok(L + '詳細ポップアップより手前に出る', await p.evaluate(() => { const r = document.getElementById('mhModal').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + 60); return !!e && !!e.closest('#mhModal'); }), null);
    await p.keyboard.press('Escape'); await p.waitForTimeout(200);
    ok(L + 'Esc で履歴だけ閉じる（詳細ポップアップは残る）', await p.evaluate(() => !document.getElementById('mhModal') && !!document.getElementById('mdDetailModal')), null);
    // 二重に包まれない
    await p.evaluate(() => { window.statsCloseMasterDetail(); window.statsToggleMasterDetail('nm', 'THC'); window.statsCloseMasterDetail(); window.statsToggleMasterDetail('nm', 'THC'); }); await p.waitForTimeout(300);
    ok(L + '詳細を開き直しても、ボタンは 1 つだけ', await p.evaluate(() => document.querySelectorAll('#mdDetailModal .mh-detail-btn').length) === 1, null);

    ok(L + '画面のエラーなし', errs.length === 0, errs);
    if (process.env.OUT) {
      await p.evaluate(() => window.mhOpen({})); await p.waitForTimeout(700);
      await p.screenshot({ path: path.join(process.env.OUT, 'master-history' + (process.env.THEME ? '-industry' : process.env.QUIET ? '-quiet' : '') + '.png') });
    }
    await ctx.close();
  }

  // ===== SQL をまだ実行していない環境 =====
  {
    const { ctx, p, errs } = await open({ nosql: true });
    const L = '[SQL 未実行] ';
    await p.click('#statsPane-master .mh-open-btn'); await p.waitForTimeout(700);
    const t = await listText(p);
    ok(L + '案内が出る（master-history.sql を実行する）', t.includes('master-history.sql') && t.includes('まだ有効になっていません'), t);
    ok(L + '他の機能（マスター管理）は動いたまま・エラーなし', errs.length === 0 && await p.evaluate(() => !!document.querySelector('#statsPane-master .master-filter-chips')), errs);
    await ctx.close();
  }

  await b.close(); srv.close();
  const fails = out.filter(l => l.startsWith('FAIL')).length;
  console.log(`\n${out.length - fails}/${out.length} PASS`);
  process.exit(fails ? 1 : 0);
})();
