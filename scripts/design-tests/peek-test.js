// 見積の編集中に、ほかの画面をサイドピーク／ポップアップで開く（js/peek.js）の試験。偽の Supabase。
//   node scripts/design-tests/peek-test.js   （THEME=1＝Industry・EDITOR=v2＝新画面・OUT=<dir> で画面を撮る）
const { chromium } = (() => { try { return require('playwright-core'); } catch (e) { return require('playwright'); } })();
const http = require('http'), fs = require('fs'), path = require('path');
process.env.W = process.env.W || '1440'; process.env.H = process.env.H || '900';
(async () => {
  const root = path.resolve(__dirname, '..', '..');
  const srv = http.createServer((q, r) => {
    const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': f.endsWith('.css') ? 'text/css' : f.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const URL = `http://127.0.0.1:${srv.address().port}/${encodeURIComponent('フォワーダー支援')}/index.html` + (process.env.EDITOR === 'v2' ? '?editor=v2' : '');
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const out = [];
  const ok = (n, c, d) => out.push((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : ' → ' + JSON.stringify(d)));
  const ME = 's@example.com';
  const seed = { master_votes: [], synonym_groups: [], master_details: [], alias_rules: [], bookmarks: [] };
  const legacy = {};
  const OUT = process.env.OUT;

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

  const L = '[ピーク] ';
  const { ctx, p, errs } = await open(true, { legacy: {} });
  await p.evaluate(() => { try { localStorage.removeItem('fwd.peekMode'); localStorage.removeItem('fwd.peekW'); } catch (e) {} });
  // 上段ナビのボタンを「人が押す」形で押す（閉じたメニューの中なら先にメニューを開く）
  const clickNav = async id => {
    await p.evaluate(id => { const bt = document.querySelector('.cat-btn[aria-controls="' + id + '"]'); const pn = bt.closest('.cat-more-panel'); if (pn && pn.hidden) { pn.closest('.cat-more').querySelector('.cat-more-btn').click(); } }, id);
    await p.waitForTimeout(150);
    await p.click('.cat-btn[aria-controls="' + id + '"]'); await p.waitForTimeout(500);
  };
  const st = () => p.evaluate(() => ({ s: window.peekState(), quote: document.getElementById('tab-quote-make').classList.contains('active'), inPeek: (id => { const e = document.getElementById(id); return !!e && !!e.closest('#pkBody'); }), side: document.getElementById('pkWrap') && document.getElementById('pkWrap').classList.contains('pk-side') }));
  ok(L + '見積の編集画面が出ている', await p.evaluate(() => document.getElementById('tab-quote-make').classList.contains('active') && !document.getElementById('tab-quote-make').classList.contains('qp-dash')));
  await clickNav('tab-stats');
  let s = await p.evaluate(() => ({ st: window.peekState(), quote: document.getElementById('tab-quote-make').classList.contains('active'), inPeek: !!document.querySelector('#pkBody > #tab-stats.active'), side: document.getElementById('pkWrap').classList.contains('pk-side'), menuOpen: !!document.querySelector('.cat-more-panel:not([hidden])') }));
  ok(L + '実績を見るを押すと、サイドピークで開く（既定）', s.st.open && s.st.id === 'tab-stats' && s.side, s);
  ok(L + '見積の画面はそのまま（切り替わらない）', s.quote, s);
  ok(L + '実績の画面が窓の中に出る', s.inPeek, s);
  ok(L + '開いていたメニューは閉じる', !s.menuOpen, s);
  ok(L + '見積の画面が左に見えている（窓は右の一部だけ）', await p.evaluate(() => { const r = document.querySelector('#pkWrap .pk-panel').getBoundingClientRect(); return r.left > 300 && Math.round(r.right) >= innerWidth - 1; }));
  ok(L + 'サイドピークは見積の操作を止めない（暗幕なし）', await p.evaluate(() => getComputedStyle(document.querySelector('#pkWrap .pk-scrim')).display === 'none'));
  if (OUT) await p.screenshot({ path: path.join(OUT, 'peek-side.png') });
  s = await p.evaluate(() => { const hit = el => { if (!el || !el.getClientRects().length) return 'none'; const r = el.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && (t === el || el.contains(t)) ? true : (t ? (t.id || t.className) : 'null'); };
    const save = [...document.querySelectorAll('#qadMode, #e2EditBtn, #quoteActionDock button')].find(e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
    return { save: hit(save), tot: hit(document.querySelector('#e2Total [data-e2drawer], #e2Total button')) }; });
  ok(L + 'サイドピークは見積の保存ボタン・下の合計バーを隠さない', s.save === true && (s.tot === true || s.tot === 'none'), s);
  // ポップアップへ切り替え
  await p.click('#pkWrap [data-pk="center"]'); await p.waitForTimeout(250);
  s = await p.evaluate(() => ({ center: document.getElementById('pkWrap').classList.contains('pk-center'), scrim: getComputedStyle(document.querySelector('#pkWrap .pk-scrim')).display, saved: localStorage.getItem('fwd.peekMode') }));
  ok(L + '［ポップアップ］で中央の窓に切り替わり、選んだ開き方を覚える', s.center && s.scrim !== 'none' && s.saved === 'center', s);
  if (OUT) await p.screenshot({ path: path.join(OUT, 'peek-center.png') });
  // 暗幕を押すと閉じ、画面は元の場所へ戻る
  await p.mouse.click(20, 400); await p.waitForTimeout(250);
  s = await p.evaluate(() => { const e = document.getElementById('tab-stats'); return { open: window.peekState().open, back: !e.closest('#pkWrap') && e.parentElement && e.parentElement.id !== 'pkBody', active: e.classList.contains('active'), quote: document.getElementById('tab-quote-make').classList.contains('active') }; });
  ok(L + 'ポップアップは外側を押すと閉じ、実績の画面は元の場所へ戻る（非表示）', !s.open && s.back && !s.active && s.quote, s);
  // 次に開くときは覚えた開き方（ポップアップ）
  await clickNav('tab-bookmark');
  s = await p.evaluate(() => ({ st: window.peekState(), center: document.getElementById('pkWrap').classList.contains('pk-center'), title: document.getElementById('pkTitle').textContent, inPeek: !!document.querySelector('#pkBody > #tab-bookmark.active') }));
  ok(L + 'リンク集も窓で開き、前に選んだ開き方（ポップアップ）になる', s.st.id === 'tab-bookmark' && s.center && s.inPeek && /リンク集/.test(s.title), s);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok(L + 'Esc で閉じる', await p.evaluate(() => !window.peekState().open));
  // サイドピークに戻して、窓の中から別の画面を開いても入れ替わる
  await p.evaluate(() => window.peekSetMode('side'));
  await clickNav('tab-stats'); await clickNav('tab-bookmark');
  s = await p.evaluate(() => ({ st: window.peekState(), statsBack: !document.getElementById('tab-stats').closest('#pkWrap'), inPeek: !!document.querySelector('#pkBody > #tab-bookmark') }));
  ok(L + '窓を開いたまま別のボタンを押すと、中身が入れ替わる（前の画面は元へ戻る）', s.st.id === 'tab-bookmark' && s.statsBack && s.inPeek, s);
  await clickNav('tab-bookmark');
  ok(L + '同じボタンをもう一度押すと閉じる', await p.evaluate(() => !window.peekState().open && !document.getElementById('tab-bookmark').closest('#pkWrap')));
  // ✕ と「全体で開く」
  await clickNav('tab-stats');
  await p.click('#pkWrap [data-pk="close"].pk-x'); await p.waitForTimeout(200);
  ok(L + '✕ で閉じる', await p.evaluate(() => !window.peekState().open));
  await clickNav('tab-stats');
  await p.click('#pkWrap [data-pk="full"]'); await p.waitForTimeout(600);
  s = await p.evaluate(() => ({ open: window.peekState().open, stats: document.getElementById('tab-stats').classList.contains('active'), quote: document.getElementById('tab-quote-make').classList.contains('active'), inPeek: !!document.getElementById('tab-stats').closest('#pkWrap') }));
  ok(L + '［全体で開く］で、いつもの画面切り替えになる', !s.open && s.stats && !s.quote && !s.inPeek, s);
  // 見積の編集中でないときは従来どおり（画面ごと切り替え）
  await p.evaluate(() => switchCategory('bookmark', document.querySelector('.cat-btn[aria-controls="tab-bookmark"]'))); await p.waitForTimeout(300);
  await clickNav('tab-stats');
  s = await p.evaluate(() => ({ open: window.peekState().open, stats: document.getElementById('tab-stats').classList.contains('active') }));
  ok(L + '見積以外の画面から押したときは、いつもどおり画面が切り替わる', !s.open && s.stats, s);
  // 見積の画面へ戻り、窓を開いたまま switchTab（ほかの入口）で切り替えると窓は閉じて元へ戻る
  await p.evaluate(() => { switchCategory('quote', document.querySelector('.cat-btn[aria-controls="tab-quote-make"]')); window.qpShowEditor && window.qpShowEditor(); }); await p.waitForTimeout(700);
  await clickNav('tab-stats');
  await p.evaluate(() => switchTab('master')); await p.waitForTimeout(400);
  s = await p.evaluate(() => ({ open: window.peekState().open, back: !document.getElementById('tab-stats').closest('#pkWrap'), master: document.getElementById('tab-master').classList.contains('active') }));
  ok(L + '窓を開いたままほかの画面へ切り替えると、窓は閉じて中身は元へ戻る', !s.open && s.back && s.master, s);
  // 幅の変更
  await p.evaluate(() => { switchCategory('quote', document.querySelector('.cat-btn[aria-controls="tab-quote-make"]')); window.qpShowEditor && window.qpShowEditor(); }); await p.waitForTimeout(700);
  await clickNav('tab-stats');
  const r0 = await p.evaluate(() => document.querySelector('#pkWrap .pk-panel').getBoundingClientRect().width);
  const rz = await p.evaluate(() => { const r = document.querySelector('#pkWrap .pk-resize').getBoundingClientRect(); return { x: r.left + 3, y: r.top + 200 }; });
  await p.mouse.move(rz.x, rz.y); await p.mouse.down(); await p.mouse.move(rz.x - 150, rz.y, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(150);
  s = await p.evaluate(() => ({ w: document.querySelector('#pkWrap .pk-panel').getBoundingClientRect().width, saved: +localStorage.getItem('fwd.peekW') }));
  ok(L + 'サイドピークの左端をドラッグで幅を変えられ、幅を覚える', s.w > r0 + 100 && s.saved > r0 + 100, { r0, s });
  await p.evaluate(() => window.peekClose());
  // 狭い画面では従来どおり
  await p.setViewportSize({ width: 900, height: 800 }); await p.waitForTimeout(300);
  await clickNav('tab-stats');
  s = await p.evaluate(() => ({ open: window.peekState().open, stats: document.getElementById('tab-stats').classList.contains('active') }));
  ok(L + '狭い画面（〜999px）では窓を使わず、いつもどおり切り替わる', !s.open && s.stats, s);
  ok(L + 'JS エラーなし', errs.length === 0, errs);
  await ctx.close(); await b.close(); srv.close();
  console.log(out.join('\n'));
  const fail = out.filter(x => x.startsWith('FAIL')).length;
  console.log(fail ? 'FAIL=' + fail : '全項目 PASS');
  process.exit(fail ? 1 : 0);
})();
