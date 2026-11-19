// 📎 案件のファイル（js/quote/case-files.js・Design 38 案X）の確認。 node scripts/design-tests/case-files-test.js （EDITOR=v2 で新画面）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0])); if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.statusCode = 404; return r.end(); } r.end(fs.readFileSync(f)); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html`;
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  let fails = 0; const ok = (n, c, d) => { if (!c) fails++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d))); };
  const W = +(process.env.W || 1400), mobile = W <= 600, th = process.env.THEME, v2 = process.env.EDITOR === 'v2', out = process.env.OUT;

  async function open(mode) {   // mode: 'ok' | 'nologin' | 'nosql'
    const ctx = await b.newContext({ viewport: { width: W, height: 900 }, locale: 'ja-JP', hasTouch: mobile, isMobile: mobile, acceptDownloads: true });
    await ctx.addInitScript(({ th, mode }) => {
      try { localStorage.setItem('fwd.uiMode', 'detail'); localStorage.setItem('fbFabHintDone_v1', '1'); localStorage.setItem('quoteRemarkSheetSeen_v1', '1');
        localStorage.setItem('forwarderTheme_v1', JSON.stringify(th === 'classic' ? { site: false, doc: false } : { site: true, doc: true })); } catch (e) {}
      const db = { quote_presets: [{ id: '1', name: '案件1', status: '下書き中', customer: 'X社', person: '山田', editors: [], created_by: 'me@x.com', owner_email: 'me@x.com', updated_at: '2026-11-10T00:00:00Z', ref: 'R-1', tags: [], data: { rows: [], fields: { 'qf-status': '下書き中', 'qf-customer': 'X社' } } }],
        allowed_emails: [{ email: 'me@x.com', role: 'admin', member_no: 1 }], user_profiles: [{ email: 'me@x.com', display_name: '自分' }, { email: 'sub@x.com', display_name: '鈴木' }],
        quote_temp_files: [], master_votes: [], master_details: [], quote_preset_links: [], quote_comments: [], synonym_groups: [], alias_rules: [], organizations: [], teams: [], org_members: [], team_members: [] };
      window.__db = db; window.__removed = []; window.__log = [];
      let seq = 0;
      const qb = t => { const st = { op: 'select', f: [], payload: null, sel: false, single: false };
        const run = () => {
          if (t === 'quote_temp_files' && mode === 'nosql') return { data: null, error: { code: '42P01', message: 'relation "public.quote_temp_files" does not exist' } };
          const tbl = db[t] || (db[t] = []);
          const match = r => st.f.every(f => f(r));
          if (st.op === 'insert') { const o = Object.assign({ id: 'f' + (++seq), created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 3 * 3600e3).toISOString(), uploaded_by: 'me@x.com', file_size: (window.__sizes || {})[st.payload.storage_path] || 0 }, st.payload); tbl.push(o); window.__log.push('insert'); return { data: st.single ? Object.assign({}, o) : [Object.assign({}, o)], error: null }; }
          if (st.op === 'update') { const rows = tbl.filter(match); rows.forEach(r => Object.assign(r, st.payload)); window.__log.push('update'); return { data: rows.map(r => Object.assign({}, r)), error: null }; }
          if (st.op === 'delete') { const keep = tbl.filter(r => !match(r)); const n = tbl.length - keep.length; db[t] = keep; window.__log.push('delete'); return { data: null, error: null, count: n }; }
          let data = tbl.filter(match).map(r => Object.assign({}, r)); return { data, error: null };
        };
        const api = { select() { st.sel = true; return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, is() { return api; }, ilike() { return api; }, gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; }, or() { return api; },
          eq(k, v) { st.f.push(r => r[k] === v); return api; }, in(k, vs) { st.f.push(r => vs.includes(r[k])); return api; }, upsert() { return api; },
          insert(p) { st.op = 'insert'; st.payload = p; return api; }, update(p) { st.op = 'update'; st.payload = p; return api; }, delete() { st.op = 'delete'; return api; },
          single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
          then(res, rej) { return Promise.resolve(run()).then(res, rej); } }; return api; };
      const store = {};
      const storage = { from: bucket => ({
        upload: (p, file) => { store[p] = file; (window.__sizes || (window.__sizes = {}))[p] = file.size; return Promise.resolve({ data: { path: p }, error: null }); },
        remove: ps => { window.__removed.push(...ps); ps.forEach(p => delete store[p]); return Promise.resolve({ data: [], error: null }); },
        createSignedUrl: (p, s, opt) => Promise.resolve({ data: { signedUrl: location.origin + '/__signed/' + encodeURIComponent(p) + (opt && opt.download ? '?download=' + encodeURIComponent(opt.download) : '') }, error: null }),
        createSignedUrls: (ps) => Promise.resolve({ data: ps.map(p => ({ path: p, signedUrl: location.origin + '/__signed/' + encodeURIComponent(p) })), error: null }) }) };
      const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() {} };
      const user = { email: 'me@x.com', user_metadata: { full_name: 'Me' } };
      window.supabase = { createClient: () => ({ from: qb, storage, rpc: n => Promise.resolve({ data: n === 'get_my_role' ? 'admin' : null, error: null }), channel: () => ch, removeChannel() {},
        auth: { getSession: () => Promise.resolve({ data: { session: mode === 'nologin' ? null : { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signInWithOAuth() { return Promise.resolve({}); }, signOut() { return Promise.resolve({}); } } }) };
    }, { th, mode });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    await ctx.route(/\/__signed\//, r => r.fulfill({ status: 200, contentType: 'application/pdf', headers: /download=/.test(r.request().url()) ? { 'content-disposition': 'attachment; filename="x.pdf"' } : {}, body: '%PDF-1.4' }));
    const p = await ctx.newPage(); p.setDefaultTimeout(8000); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(BASE + (v2 ? '?editor=v2' : '?editor=v1') + (th ? '&theme=' + th : ''), { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
    await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
    return { ctx, p, errs };
  }
  const vis = (p, s) => p.evaluate(s => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.width > 0 && r.height > 0 && c.visibility !== 'hidden' && c.display !== 'none'; }, s);
  const shot = async (p, n) => { if (out) await p.screenshot({ path: path.join(out, 'tf-' + (th || 'industry') + (mobile ? '-sp' : '') + (v2 ? '-v2' : '') + '-' + n + '.png') }); };
  const pdf = (name, size) => ({ name, mimeType: 'application/pdf', buffer: Buffer.alloc(size || 2048, 65) });

  let { ctx, p, errs } = await open('ok');
  await p.evaluate(() => { try { window.cloudLoadPreset('1'); } catch (e) {} }); await p.waitForTimeout(2500);
  await p.evaluate(() => { const b = document.getElementById('qadMode'); b && b.click(); }); await p.waitForTimeout(600);
  // 3 種類を用意：送付用（残り 2 時間）・社内ファイル（2 日前に添付＝残り 12 日）・URL
  await p.evaluate(() => {
    const now = Date.now();
    window.__db.quote_temp_files.push({ id: 't1', preset_id: '1', storage_path: '1/a_send.pdf', file_name: '送付スケジュール.pdf', file_size: 2048, uploaded_by: 'me@x.com', created_at: new Date(now - 3600e3).toISOString(), expires_at: new Date(now + 2 * 3600e3).toISOString() });
    (window.__db.quote_attachments || (window.__db.quote_attachments = [])).push({ id: 'a1', preset_id: '1', storage_path: '1/b_doc.pdf', file_name: '根拠資料.pdf', file_size: 4096, mime_type: 'application/pdf', uploaded_by: 'me@x.com', created_at: new Date(now - 2 * 86400e3).toISOString() });
    const ta = document.getElementById('qf-refurl'); ta.value = 'https://example.com/rate'; if (window.renderRefUrlLinks) window.renderRefUrlLinks();
    window.tfRefresh(true);
  });
  await p.waitForTimeout(800);
  await p.evaluate(() => window.cfOpen('send')); await p.waitForTimeout(900);
  ok('一覧の画面が開く', await vis(p, '#cfOverlay .cf-box'));
  ok('入口：参照資料の場所に［📎 案件のファイル（件数）］がある', await p.evaluate(() => { const b = document.getElementById('cfRefBtn'); return !!b && /案件のファイル（3）/.test(b.textContent); }));
  const rows = await p.evaluate(() => [...document.querySelectorAll('#cfBody .cf-row')].map(r => ({ k: r.dataset.k, name: r.querySelector('.cf-name').textContent, lab: r.querySelector('.cf-lab') ? r.querySelector('.cf-lab').textContent : '', left: r.querySelector('.cf-left').textContent, cls: r.querySelector('.cf-left').className })));
  ok('3 件が 1 つの一覧に出る（送付用・社内・URL）', rows.length === 3, rows);
  ok('並び順：残り時間が短い順（送付用 → 社内ファイル → URL は最後）', rows[0] && rows[0].k === 'send' && rows[1].k === 'doc' && rows[2].k === 'url', rows);
  ok('ラベル：📤 送付用／🔒 社内', /送付用/.test(rows[0].lab) && /社内/.test(rows[1].lab) && /社内/.test(rows[2].lab), rows);
  ok('残り時間の札：1 日未満は橙（2 時間）・1 日以上は灰（12 日）・URL は期限なし', /残り 1時間|残り 2時間/.test(rows[0].left) && /is-orange/.test(rows[0].cls) && /残り 1\d日/.test(rows[1].left) && !/is-orange|is-red/.test(rows[1].cls) && /期限なし/.test(rows[2].left), rows);
  ok('件数の札が「3 件」', /3 件/.test(await p.textContent('#cfCount')));
  // 追加の画面
  await p.click('#cfAddBtn'); await p.waitForTimeout(300);
  ok('追加の画面が開く（ドロップ領域・期間の 2 択・URL）', await vis(p, '#cfDrop') && await vis(p, '.cf-seg') && await vis(p, '#cfUrl'));
  ok('⑤（送付用）から開くと「送付用（3時間）」が初期の選択', await p.evaluate(() => document.querySelector('.cf-seg [data-p="send"]').classList.contains('is-on')));
  ok('追加するボタンは、ファイルかURLを入れるまで押せない', await p.evaluate(() => document.getElementById('cfGo').disabled));
  const nT0 = await p.evaluate(() => window.__db.quote_temp_files.length), nA0 = await p.evaluate(() => window.__db.quote_attachments.length);
  await p.setInputFiles('#cfFile', [pdf('新しい送付.pdf')]); await p.waitForTimeout(200);
  await p.click('#cfGo'); await p.waitForTimeout(1200);
  ok('送付用で追加すると、一時ファイルの表へ入る（社内の表は変わらない）', await p.evaluate(() => window.__db.quote_temp_files.length) === nT0 + 1 && await p.evaluate(() => window.__db.quote_attachments.length) === nA0);
  ok('追加後は追加の画面が閉じ、一覧が 4 件になる', !(await vis(p, '#cfAddOverlay')) && (await p.evaluate(() => document.querySelectorAll('#cfBody .cf-row').length)) === 4);
  await p.click('#cfAddBtn'); await p.waitForTimeout(250);
  await p.click('.cf-seg [data-p="internal"]'); await p.setInputFiles('#cfFile', [pdf('新しい社内.pdf')]); await p.waitForTimeout(200);
  ok('「社内の資料（14日）」を選ぶと説明が変わる', /14日後/.test(await p.textContent('#cfPerD')));
  await p.click('#cfGo'); await p.waitForTimeout(1500);
  ok('社内の資料で追加すると、添付の表へ入る', await p.evaluate(() => window.__db.quote_attachments.length) === nA0 + 1);
  // URL だけのときは期間の選択を出さない
  await p.click('#cfAddBtn'); await p.waitForTimeout(250);
  await p.fill('#cfUrl', 'https://example.com/second'); await p.waitForTimeout(150);
  ok('URL だけのとき、期間の選択は出ない（社内の資料に固定）', !(await vis(p, '#cfPer')));
  await p.click('#cfGo'); await p.waitForTimeout(800);
  ok('URL は参照URLに足される', /example\.com\/second/.test(await p.evaluate(() => document.getElementById('qf-refurl').value)));
  // 削除
  const n1 = await p.evaluate(() => document.querySelectorAll('#cfBody .cf-row').length);
  await p.click('#cfBody .cf-row[data-k="url"] .cf-more'); await p.waitForTimeout(150);
  ok('⋯ を押すとメニューに「URL を外す」', /URL を外す/.test(await p.textContent('.cf-menu')));
  await p.click('.cf-menu button'); await p.waitForTimeout(700);
  ok('URL を外すと 1 件減る', (await p.evaluate(() => document.querySelectorAll('#cfBody .cf-row').length)) === n1 - 1);
  await p.click('#cfBody .cf-row[data-k="doc"] .cf-more'); await p.waitForTimeout(150); await p.click('.cf-menu button'); await p.waitForTimeout(400);
  ok('社内ファイルの削除は確認画面（uiConfirm）を出す', await vis(p, '.confirm-dialog'));
  await p.evaluate(() => { const bs = Array.from(document.querySelectorAll('.confirm-dialog button')); bs[bs.length - 1].click(); }); await p.waitForTimeout(900);
  ok('社内ファイルを削除すると添付の表から消える', await p.evaluate(() => window.__db.quote_attachments.length) < nA0 + 1);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok('Esc で閉じる', !(await vis(p, '#cfOverlay .cf-box')));
  ok('エラーなし', errs.length === 0, errs);
  await ctx.close();

  // ===== 未ログイン =====
  ({ ctx, p, errs } = await open('nologin'));
  await p.evaluate(() => window.cfOpen('internal')); await p.waitForTimeout(700);
  ok('未ログインは「ログインすると使えます」・追加は押せない', /ログイン/.test(await p.textContent('#cfBody')) && await p.evaluate(() => document.getElementById('cfAddBtn').disabled));
  await ctx.close();

  await b.close(); srv.close();
  console.log(fails ? `\n${fails} 件失敗` : '\nすべて成功');
  process.exit(fails ? 1 : 0);
})();
