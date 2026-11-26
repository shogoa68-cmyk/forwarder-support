// 放置・編集権の解放：①スクロール／マウス移動も「操作」と数える ②解放と同時に未保存の入力を下書き（この端末）に控える
//   ③案件を開いたとき帯で「復元して編集／破棄」④保存で下書きが消える ⑤他の人の下書き・他の案件の下書きは出さない
//   偽の Supabase（メモリ上）・時計は「30 秒のハートビート＝0.2 秒」「Date.now を進める」で早回し。
//   node scripts/design-tests/idle-draft-test.js           （THEME=1 で Industry）
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
  const ME = 'me@x.com';

  // 1 つのブラウザ文脈（localStorage を共有）で、ページを開き直しながら確かめる
  async function newCtx() {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
    if (process.env.THEME) await ctx.addInitScript(() => { try { localStorage.setItem('forwarderTheme_v1', JSON.stringify({ site: true, doc: true })); } catch (e) {} });
    await ctx.addInitScript(({ ME }) => {
      try { localStorage.setItem('fwd.uiMode', 'detail'); } catch (e) {}
      // 時計：Date.now を進められるように／30 秒のハートビートは 0.2 秒に
      window.__off = 0; const rn = Date.now.bind(Date); Date.now = () => rn() + window.__off;
      const si = window.setInterval.bind(window); window.setInterval = (f, ms, ...a) => si(f, ms === 30000 ? 200 : ms, ...a);
      // 偽の Supabase
      const db = window.__db = { quote_presets: [{ id: 'c1', name: '案件1', status: '下書き中', customer: '元の会社', created_by: ME, owner_email: ME, tags: [], updated_at: '2026-11-01T00:00:00Z',
        data: { fields: { 'qf-customer': '元の会社', 'qf-ref': 'R1' }, rows: [] } }] };
      window.__lockLost = false;
      const qb = t => {
        const st = { op: 'select', filters: [], payload: null, single: false };
        const api = {
          select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; }, or() { return api; }, is() { return api; }, ilike() { return api; },
          gte() { return api; }, lte() { return api; }, neq() { return api; }, contains() { return api; }, range() { return api; },
          eq(k, v) { st.filters.push(r => r[k] === v); return api; }, in(k, vs) { st.filters.push(r => vs.includes(r[k])); return api; },
          update(o) { st.op = 'update'; st.payload = o; return api; }, insert(o) { st.op = 'insert'; st.payload = o; return api; }, delete() { st.op = 'delete'; return api; }, upsert() { return api; },
          single() { st.single = true; return api; }, maybeSingle() { st.single = true; return api; },
          then(res, rej) {
            const rows = (db[t] = db[t] || []);
            let data = null;
            if (st.op === 'update') { data = rows.filter(r => st.filters.every(f => f(r))); data.forEach(r => Object.assign(r, JSON.parse(JSON.stringify(st.payload)))); }
            else if (st.op === 'delete') { db[t] = rows.filter(r => !st.filters.every(f => f(r))); data = []; }
            else if (st.op === 'insert') { data = []; }
            else { data = rows.filter(r => st.filters.every(f => f(r))); if (st.single) data = data[0] || null; }
            return Promise.resolve({ data, error: null }).then(res, rej);
          },
        };
        return api;
      };
      const ch = { on() { return ch; }, subscribe(cb) { cb && cb('SUBSCRIBED'); return ch; }, track() { return Promise.resolve(); }, untrack() { return Promise.resolve(); }, unsubscribe() {}, send() { return Promise.resolve(); }, presenceState() { return {}; } };
      const user = { email: ME, user_metadata: { full_name: 'Me' } };
      const client = {
        from: qb, channel: () => ch, removeChannel() {},
        rpc: (name) => Promise.resolve({ data: name === 'get_my_role' ? 'member' : name === 'quote_acquire_lock' ? 'OK' : name === 'quote_renew_lock' ? !window.__lockLost : null, error: null }),
        auth: { getSession: () => Promise.resolve({ data: { session: { user } } }), onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signInWithOAuth() { return Promise.resolve({}); }, signOut() { return Promise.resolve({}); } },
        storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), createSignedUrls: async () => ({ data: [], error: null }) }) },
      };
      window.supabase = { createClient: () => client };
    }, { ME });
    await ctx.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
    return ctx;
  }
  async function openPage(ctx) {
    const p = await ctx.newPage();
    p.__errs = []; p.on('pageerror', e => p.__errs.push(e.message));
    p.setDefaultTimeout(10000);
    await p.goto(URL, { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(800);
    await p.evaluate(() => { const t = document.querySelector('[onclick*="quote-make"]'); t && t.click(); }); await p.waitForTimeout(1500);
    return p;
  }
  const viewing = p => p.evaluate(() => document.getElementById('tab-quote-make').classList.contains('qmode-view'));
  const draftRaw = p => p.evaluate(() => { try { return JSON.parse(localStorage.getItem('quoteIdleDrafts_v1') || '{}'); } catch (e) { return {}; } });
  const advance = (p, ms) => p.evaluate(m => { window.__off += m; }, ms);
  async function openCaseAndEdit(p) {
    await p.evaluate(() => window.cloudLoadPreset('c1')); await p.waitForTimeout(500);
    await p.evaluate(() => window.quoteModeEdit()); await p.waitForTimeout(400);
  }

  const ctx = await newCtx();
  let p = await openPage(ctx);

  // ===== 1) 開いて編集 → 入力 → スクロール／マウス移動で放置扱いにならない =====
  await openCaseAndEdit(p);
  ok('編集中になる（閲覧モードではない）', !(await viewing(p)));
  await p.fill('#qf-customer', '書きかけの会社');
  await advance(p, 9 * 60e3);
  await p.mouse.move(200, 300); await p.mouse.move(260, 340);                     // 9 分たったところでマウスを動かす
  await advance(p, 6 * 60e3);                                                      // 最後の操作から 6 分（合計 15 分）
  await p.waitForTimeout(700);
  ok('マウス移動を操作と数える：最後の操作から 6 分では解放されない', !(await viewing(p)));
  await advance(p, 5 * 60e3);                                                      // 合計 20 分・操作から 11 分
  await p.evaluate(() => window.dispatchEvent(new Event('scroll')));              // ここでスクロール
  await p.waitForTimeout(700);
  ok('スクロールも操作と数える：11 分たっていても直前にスクロールしていれば解放されない', !(await viewing(p)));
  await advance(p, 6 * 60e3);                                                      // スクロールから 6 分
  await p.evaluate(() => document.dispatchEvent(new WheelEvent('wheel', { bubbles: true })));
  await p.waitForTimeout(700);
  ok('ホイールも操作と数える', !(await viewing(p)));
  ok('ここまで下書きは作られない', Object.keys(await draftRaw(p)).length === 0);

  // ===== 2) 10 分以上まったく操作が無い → 解放＋下書き =====
  await advance(p, 11 * 60e3);
  await p.waitForTimeout(800);
  ok('10 分以上操作が無いと閲覧モードに切り替わる', await viewing(p));
  const toast = await p.evaluate(() => [...document.querySelectorAll('#toast-container .toast')].map(t => t.textContent).join('|'));
  ok('トーストに「下書きとしてこの端末に控えました」', /10分間操作がなかった/.test(toast) && /下書きとしてこの端末に控えました/.test(toast), toast);
  let d = await draftRaw(p);
  ok('下書きが案件 c1 に 1 件（入力中の値を含む）', Object.keys(d).length === 1 && d.c1 && d.c1.data.fields['qf-customer'] === '書きかけの会社' && d.c1.by === ME && d.c1.reason === 'idle', Object.keys(d));
  ok('画面の入力は残っている', (await p.inputValue('#qf-customer')) === '書きかけの会社');
  ok('サーバの案件は書き換わっていない（勝手に保存しない）', await p.evaluate(() => window.__db.quote_presets[0].data.fields['qf-customer'] === '元の会社'));

  // ===== 3) 未保存が無ければ下書きは作らない =====
  await p.evaluate(() => { localStorage.removeItem('quoteIdleDrafts_v1'); });
  await p.evaluate(() => window.cloudLoadPreset('c1')); await p.waitForTimeout(400);
  await p.evaluate(() => window.quoteModeEdit()); await p.waitForTimeout(400);
  await advance(p, 11 * 60e3); await p.waitForTimeout(800);
  ok('入力していなければ（未保存なし）、解放しても下書きは作らない', (await viewing(p)) && Object.keys(await draftRaw(p)).length === 0);

  // ===== 4) 入力 → 編集権が外れた（管理者の強制解放など）→ 下書き =====
  await p.evaluate(() => window.quoteModeEdit()); await p.waitForTimeout(400);
  await p.fill('#qf-customer', '外された時の入力');
  await p.evaluate(() => { window.__lockLost = true; });
  await p.evaluate(() => { window.__off += 0; });
  await p.waitForTimeout(900);                                                     // 更新に失敗 → acquire は OK を返す（握り直せる）ので、まだ編集中
  ok('握り直せるうちは継続（別タブがクリアしただけの場合）', !(await viewing(p)));
  await p.evaluate(() => { window.__lockLost = false; });

  // ===== 5) ページを開き直す → 案件を開くと帯が出る → 破棄 =====
  await p.evaluate(() => { const o = JSON.parse(localStorage.getItem('quoteIdleDrafts_v1') || '{}'); o.c1 = { at: Date.now(), reason: 'idle', by: 'me@x.com', base: '2026-11-01T00:00:00Z', name: '案件1', data: { fields: { 'qf-customer': '下書きの会社', 'qf-ref': 'R1' }, rows: [] } }; localStorage.setItem('quoteIdleDrafts_v1', JSON.stringify(o)); });
  await p.close();
  p = await openPage(ctx);
  await p.evaluate(() => window.cloudLoadPreset('c1')); await p.waitForTimeout(600);
  const bar = await p.evaluate(() => { const b = document.getElementById('qmDraftBar'); return b ? { text: b.textContent, warn: !!b.querySelector('.qmd-warn'), vis: b.getBoundingClientRect().height > 0 } : null; });
  ok('開き直して案件を開くと、下書きの帯が出る', bar && bar.vis && /未保存の下書き/.test(bar.text) && /放置で解放/.test(bar.text), bar);
  ok('下書きのあとに更新されていなければ警告は出ない', bar && !bar.warn, bar);
  ok('案件の中身は保存済みの値のまま（自動では入れない）', (await p.inputValue('#qf-customer')) === '元の会社');
  await p.click('#qmDraftBar [data-act="discard"]'); await p.waitForSelector('.confirm-overlay');
  await p.click('.confirm-overlay .confirm-ok, .confirm-overlay button.danger, .confirm-overlay [data-ok]').catch(async () => {
    await p.evaluate(() => { const bs = [...document.querySelectorAll('.confirm-overlay button')]; bs.find(x => /破棄する/.test(x.textContent)).click(); });
  });
  await p.waitForTimeout(400);
  ok('破棄すると帯が消え、下書きも消える', !(await p.$('#qmDraftBar')) && !(await draftRaw(p)).c1);

  // ===== 6) 復元して編集 → 保存で下書きが消える =====
  await p.evaluate(() => { const o = {}; o.c1 = { at: Date.now() - 3600e3, reason: 'lost', by: 'me@x.com', base: '2026-10-01T00:00:00Z', name: '案件1', data: { fields: { 'qf-customer': '復元する会社', 'qf-ref': 'R1' }, rows: [] } }; localStorage.setItem('quoteIdleDrafts_v1', JSON.stringify(o)); });
  await p.evaluate(() => window.cloudLoadPreset('c1')); await p.waitForTimeout(600);
  const bar2 = await p.evaluate(() => { const b = document.getElementById('qmDraftBar'); return b ? { text: b.textContent, warn: !!b.querySelector('.qmd-warn') } : null; });
  ok('下書きのあとに案件が更新されている場合は警告つき（上書きになる旨）', bar2 && bar2.warn && /編集権が外れた/.test(bar2.text), bar2);
  if (process.env.OUT) await p.screenshot({ path: path.join(process.env.OUT, `idle-draft-bar${process.env.THEME ? '-industry' : ''}.png`), clip: { x: 0, y: 0, width: 1400, height: 420 } });
  await p.click('#qmDraftBar [data-act="restore"]'); await p.waitForTimeout(800);
  ok('「復元して編集」で編集中になり、下書きの内容が入る', !(await viewing(p)) && (await p.inputValue('#qf-customer')) === '復元する会社');
  ok('帯は消える・下書きは保存するまで残す', !(await p.$('#qmDraftBar')) && !!(await draftRaw(p)).c1);
  ok('未保存の入力として扱う（quoteIsDirty）', await p.evaluate(() => window.quoteIsDirty()));
  await p.evaluate(() => window.cloudSaveCurrent()); await p.waitForTimeout(900);
  ok('保存すると下書きが消える', !(await draftRaw(p)).c1);
  ok('保存された値がサーバへ', await p.evaluate(() => window.__db.quote_presets[0].data.fields['qf-customer'] === '復元する会社'));

  // 案件を開いて（編集中・変更なし）ダッシュボードに戻り、検索欄を触っても「未保存」にならない（更新時の警告が出ない）
  await p.evaluate(() => window.cloudLoadPreset('c1')); await p.waitForTimeout(600);
  await p.evaluate(() => window.quoteModeEdit()); await p.waitForTimeout(600);
  ok('（前提）編集中になっている', !(await viewing(p)));
  await p.evaluate(() => window.qpShowDashboard()); await p.waitForTimeout(300);
  await p.evaluate(() => { const i = document.getElementById('qpdSearch'); i.value = 'abc'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  await p.waitForTimeout(100);
  ok('ダッシュボードで検索しても未保存にならない', !(await p.evaluate(() => window.quoteIsDirty())));
  await p.evaluate(() => { const i = document.getElementById('qpdSearch'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); });

  // 未保存の確認で「💾 保存して進む」を押すと、保存して先へ進む（以前は保存はされるが元の画面に残り、
  // さらに「ダッシュボードに戻りますか？」の確認まで割り込んでいた）
  await p.evaluate(() => window.cloudLoadPreset('c1')); await p.waitForTimeout(600);
  await p.evaluate(() => window.quoteModeEdit()); await p.waitForTimeout(600);
  await p.evaluate(() => { const i = document.getElementById('qf-customer'); i.value = '保存して進む会社'; i.dispatchEvent(new Event('input', { bubbles: true })); });
  ok('（前提）未保存の変更がある', await p.evaluate(() => window.quoteIsDirty()));
  const dlgs = []; const onDlg = d => { dlgs.push(d.message()); d.dismiss().catch(() => {}); }; p.on('dialog', onDlg);
  await p.evaluate(() => { window.__leave = 'pending'; window.cloudConfirmLeaveUnsaved('別の案件を開く').then(r => { window.__leave = r; }); });
  await p.waitForTimeout(200);
  await p.click('#qpLeaveConfirm .qplc-save');
  await p.waitForTimeout(1500);
  ok('「保存して進む」で先へ進む（結果が true）', await p.evaluate(() => window.__leave === true), await p.evaluate(() => window.__leave));
  ok('入力した内容が保存されている', await p.evaluate(() => window.__db.quote_presets[0].data.fields['qf-customer'] === '保存して進む会社'));
  ok('「ダッシュボードに戻りますか？」の確認は出ない', !dlgs.some(m => /ダッシュボードに戻りますか/.test(m)), dlgs);
  await p.evaluate(() => { window.__leave = 'pending'; window.cloudConfirmLeaveUnsaved('x').then(r => { window.__leave = r; }); }); await p.waitForTimeout(150);
  ok('保存のあとは、確認を出さずに進める', await p.evaluate(() => window.__leave === true && !document.getElementById('qpLeaveConfirm').classList.contains('open')));
  p.off('dialog', onDlg);

  // ===== 7) 他の人の下書きは出さない =====
  await p.evaluate(() => { localStorage.setItem('quoteIdleDrafts_v1', JSON.stringify({ c1: { at: Date.now(), reason: 'idle', by: 'other@x.com', base: null, data: { fields: {}, rows: [] } } })); });
  await p.evaluate(() => window.cloudLoadPreset('c1')); await p.waitForTimeout(600);
  ok('他の人（共有 PC）の下書きは帯に出さない', !(await p.$('#qmDraftBar')));

  // ===== 8) 帯はダッシュボードでは出ない・別の案件を開くと消える =====
  await p.evaluate(() => { localStorage.setItem('quoteIdleDrafts_v1', JSON.stringify({ c1: { at: Date.now(), reason: 'idle', by: 'me@x.com', base: '2026-11-01T00:00:00Z', data: { fields: {}, rows: [] } } })); });
  await p.evaluate(() => window.cloudLoadPreset('c1')); await p.waitForTimeout(600);
  await p.evaluate(() => window.qpShowDashboard()); await p.waitForTimeout(300);
  ok('ダッシュボードでは帯を隠す', await p.evaluate(() => { const b = document.getElementById('qmDraftBar'); return !b || getComputedStyle(b).display === 'none'; }));

  ok('ページエラーなし', p.__errs.length === 0, p.__errs);
  await ctx.close(); await b.close(); srv.close();
  console.log(fails ? `\n${fails} 件失敗` : '\n全項目 PASS');
  process.exit(fails ? 1 : 0);
})();
