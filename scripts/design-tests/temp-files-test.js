// 一時ファイル置き場（画面下の引き出しの 2 つ目のタブ・js/quote/temp-files.js）の確認
//   node scripts/design-tests/temp-files-test.js   （THEME=classic で現行・W=390 でスマホ幅・EDITOR=v2 で新画面・OUT=<dir> で画像）
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

  // ===== ログイン済み・保存済みの案件 =====
  let { ctx, p, errs } = await open('ok');
  await p.evaluate(() => { try { window.cloudLoadPreset('1'); } catch (e) {} }); await p.waitForTimeout(2500);
  if (v2) { await p.evaluate(() => { const b = document.getElementById('qadMode'); b && b.click(); }); await p.waitForTimeout(600); }
  if (v2) {   // 新画面：取っ手は閉じている間は出さず、合計バーの［📁 一時ファイル］から開く
    ok('[新画面] 閉じている間は取っ手バーを出さない（下の固定物を減らす）', !(await vis(p, '#rmSheet')));
    ok('[新画面] 合計バーには［一時ファイル］を置かない（出力と近い⑤の「出力する」枠へ移した）', !(await p.evaluate(() => !!document.querySelector('#e2Total [data-e2f]'))));
    await p.evaluate(() => { const n = document.querySelector('#e2Steps [data-e2s="5"]'); n && n.click(); }); await p.waitForTimeout(400);
    ok('[新画面] ステップ⑤の「出力する」枠に［📁 一時ファイル］がある', await vis(p, '#e2Out [data-e2o="files"]'));
    await p.evaluate(() => document.querySelector('#e2Out [data-e2o="files"]').click()); await p.waitForTimeout(500);
  }
  ok('引き出しの取っ手に「📁 一時ファイル」のタブがある', await vis(p, '#rmSheet .rms-tab[data-pane="files"]'));
  ok(v2 ? '[新画面] リマークのタブは出ず、一時ファイルだけ' : '「📝 全体リマーク」のタブも残っている', v2 ? !(await vis(p, '#rmSheet .rms-tab[data-pane="remark"]')) : await vis(p, '#rmSheet .rms-tab[data-pane="remark"]'));
  if (v2) {
    const g = await p.evaluate(() => { const s = document.getElementById('rmSheet').getBoundingClientRect(), t = document.getElementById('e2Total').getBoundingClientRect(); return { sb: Math.round(s.bottom), tt: Math.round(t.top) }; });
    ok('[新画面] 取っ手は下の合計バーの上に置かれ、重ならない', g.sb <= g.tt + 1, g);
  }
  if (!v2) { await p.click('#rmSheet .rms-tab[data-pane="files"]'); } await p.waitForTimeout(500); if (process.env.DBG) { console.log(JSON.stringify(await p.evaluate(() => ({open: window.rmsIsOpen(), pane: window.rmsPane(), h: document.getElementById('rmsBody').getBoundingClientRect().height, tf: document.getElementById('tfPane').getBoundingClientRect().toJSON(), hid: document.getElementById('tfPane').hidden, disp: getComputedStyle(document.getElementById('tfPane')).display})))); await p.screenshot({path:'/tmp/claude-0/tf/dbg.png'}); }
  ok('タブを押すと引き出しが開き、一時ファイルの画面になる', await p.evaluate(() => window.rmsIsOpen() && window.rmsPane() === 'files') && await vis(p, '#tfPane .tf-toolbar'));
  ok('リマーク側は隠れ、一時ファイルの画面だけが出る', v2 ? await p.evaluate(() => document.getElementById('rmsBody').getBoundingClientRect().height > 50) : !(await vis(p, '#remarkTextarea')));
  ok('空のときは案内（ドラッグ＆ドロップ・3 時間）を出す', /3 時間/.test(await p.evaluate(() => document.getElementById('tfMain').textContent)) && /空/.test(await p.evaluate(() => document.getElementById('tfMain').textContent)));
  ok('エクスプローラー風：ツールバー・パンくず・ステータスバーがある', await vis(p, '#tfPane .tf-addr') && await vis(p, '#tfStatus') && (await p.$$('#tfPane .tf-toolbar [data-act]')).length >= 6);
  await shot(p, '1-empty');

  // アップロード
  await p.setInputFiles('#tfInput', [pdf('工程スケジュール.pdf', 3000), pdf('S&D 参考<資料>.pdf', 1500), { name: '写真.png', mimeType: 'image/png', buffer: Buffer.alloc(900, 1) }]); await p.waitForTimeout(900);
  const names = await p.evaluate(() => Array.from(document.querySelectorAll('#tfMain .tf-row .tf-nm')).map(e => e.textContent));
  ok('3 個アップロードすると一覧に出る（新しい順）', names.length === 3 && names.includes('工程スケジュール.pdf') && names.includes('S&D 参考<資料>.pdf'), names);
  ok('名前の HTML は文字として表示される（XSS にならない）', await p.evaluate(() => !document.querySelector('#tfMain .tf-nm b, #tfMain script') && Array.from(document.querySelectorAll('#tfMain .tf-nm')).some(e => e.textContent === 'S&D 参考<資料>.pdf')));
  ok('保存領域の場所は案件 ID／ASCII の名前', await p.evaluate(() => window.__db.quote_temp_files.every(f => /^1\/\d+_[a-z0-9]+_[A-Za-z0-9._-]+$/.test(f.storage_path))), await p.evaluate(() => window.__db.quote_temp_files.map(f => f.storage_path)));
  ok('行には 追加日時・種類・サイズ・残り時間・追加した人 が出る', await p.evaluate(() => { const r = document.querySelector('#tfMain .tf-row'); return /\d\d\/\d\d \d\d:\d\d/.test(r.textContent) && /KB/.test(r.textContent) && /あと 2時間5\d分|あと 3時間/.test(r.textContent) && /自分/.test(r.textContent); }));
  ok('取っ手のタブに件数 3・メタに最短の残り時間', (await p.textContent('#tfTabN')) === '3' && /3 件・最短/.test(await p.textContent('#tfMeta')));
  ok('ステータスバーに項目数と使用量', /3 個の項目/.test(await p.textContent('#tfStatus')) && /\/ 100 MB/.test(await p.textContent('#tfStatus')));
  await shot(p, '2-list');

  // 上限
  await p.setInputFiles('#tfInput', [pdf('big.zip', 26 * 1048576)]); await p.waitForTimeout(700);
  ok('25MB を超えるファイルは置けない（行は増えない）', (await p.$$('#tfMain .tf-row')).length === 3);

  // ドロップ
  await p.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(500)], 'ドロップ.xlsx', { type: 'application/vnd.ms-excel' })); const pane = document.getElementById('tfPane'); pane.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true })); window.__dropShown = !document.getElementById('tfDrop').hidden; pane.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); }); await p.waitForTimeout(800);
  ok('OS からドロップすると置ける（ドロップ中は案内を出し、終われば消える）', await p.evaluate(() => window.__dropShown && document.getElementById('tfDrop').hidden && Array.from(document.querySelectorAll('#tfMain .tf-nm')).some(e => e.textContent === 'ドロップ.xlsx')));

  // 選択
  const rows = async () => p.evaluate(() => Array.from(document.querySelectorAll('#tfMain .tf-row')).map(r => ({ id: r.dataset.id, nm: r.querySelector('.tf-nm').textContent, sel: r.classList.contains('is-sel') })));
  let r0 = await rows();
  await p.click('#tfMain .tf-row:nth-child(1)'); r0 = await rows();
  ok('クリックで 1 つ選択', r0.filter(r => r.sel).length === 1 && r0[0].sel);
  await p.keyboard.down('Control'); await p.click('#tfMain .tf-row:nth-child(3)'); await p.keyboard.up('Control'); r0 = await rows();
  ok('Ctrl+クリックで追加選択', r0.filter(r => r.sel).length === 2 && r0[2].sel);
  await p.click('#tfMain .tf-row:nth-child(1)'); await p.keyboard.down('Shift'); await p.click('#tfMain .tf-row:nth-child(4)'); await p.keyboard.up('Shift'); r0 = await rows();
  ok('Shift+クリックで範囲選択', r0.filter(r => r.sel).length === 4);
  await p.click('#tfMain .tf-row:nth-child(2)'); await p.keyboard.press('Control+a'); r0 = await rows();
  ok('Ctrl+A で全選択', r0.every(r => r.sel));
  ok('選択数がステータスバーに出る', /4 個を選択/.test(await p.textContent('#tfStatus')));
  await p.keyboard.press('Escape'); r0 = await rows();
  ok('Esc で選択解除（引き出しは開いたまま）', r0.every(r => !r.sel) && await p.evaluate(() => window.rmsIsOpen()));
  await p.click('#tfMain .tf-row:nth-child(1)'); await p.keyboard.press('ArrowDown'); r0 = await rows();
  ok('↓ キーで次の行へ', r0[1].sel && !r0[0].sel);

  // 並べ替え・検索
  await p.click('#tfMain .tf-col[data-sort="name"]'); let nm = (await rows()).map(r => r.nm);
  ok('列見出しで並べ替え（名前順）', JSON.stringify(nm) === JSON.stringify(nm.slice().sort((a, c) => a.localeCompare(c, 'ja'))), nm);
  await p.click('#tfMain .tf-col[data-sort="name"]'); const nm2 = (await rows()).map(r => r.nm);
  ok('もう一度押すと逆順', JSON.stringify(nm2) === JSON.stringify(nm.slice().reverse()));
  await p.fill('#tfSearch', '写真'); await p.waitForTimeout(150);
  ok('ファイル名で検索', JSON.stringify((await rows()).map(r => r.nm)) === '["写真.png"]');
  await p.fill('#tfSearch', ''); await p.waitForTimeout(150);

  // 表示切替
  await p.click('#tfPane [data-view="icons"]'); await p.waitForTimeout(200);
  ok('アイコン表示にできる', (await p.$$('#tfMain .tf-tile')).length === 4 && await p.evaluate(() => localStorage.getItem('quoteTempFilesView_v1') === 'icons'));
  await shot(p, '3-icons');
  await p.click('#tfPane [data-view="detail"]'); await p.waitForTimeout(200);

  // 名前の変更（F2）
  await p.click('#tfMain .tf-row:nth-child(1)'); const target = (await rows())[0];
  await p.keyboard.press('F2'); await p.waitForTimeout(150);
  ok('F2 で名前の入力欄（拡張子の前を選択）', await vis(p, '#tfMain .tf-rename') && await p.evaluate(() => { const e = document.querySelector('#tfMain .tf-rename'); return e.selectionStart === 0 && e.selectionEnd === e.value.lastIndexOf('.'); }));
  await p.keyboard.type('改名後'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  ok('Enter で名前が変わり、DB にも反映', (await rows()).some(r => /^改名後\./.test(r.nm)) && await p.evaluate(id => window.__db.quote_temp_files.find(f => f.id === id).file_name.startsWith('改名後.'), target.id));
  await p.click('#tfMain .tf-row:nth-child(1)'); await p.keyboard.press('F2'); await p.keyboard.type('x'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok('Esc で名前の変更を取り消す', !(await rows()).some(r => r.nm.startsWith('x')));

  // 右クリック
  await p.click('#tfMain .tf-row:nth-child(2)', { button: 'right' }); await p.waitForTimeout(150);
  ok('右クリックでメニュー（開く・ダウンロード・名前の変更・削除）', await vis(p, '.tf-ctx') && (await p.$$eval('.tf-ctx button', bs => bs.map(x => x.textContent))).length === 4);
  await shot(p, '4-context');
  await p.keyboard.press('Escape'); await p.waitForTimeout(100);
  ok('Esc でメニューが閉じる', !(await vis(p, '.tf-ctx')));

  // 開く／ダウンロード
  await p.click('#tfMain .tf-row:nth-child(1)');
  const [pg] = await Promise.all([ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null), p.click('#tfPane [data-act="open"]')]);
  ok('PDF／画像は新しいタブで開く（署名つきリンク）', !!pg && /\/__signed\//.test(pg.url()), pg && pg.url()); if (pg) await pg.close();
  await p.evaluate(() => { window.__dl = []; const oc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) { window.__dl.push([this.download, this.href]); return; } return oc.call(this); }; });   // ヘッドレスは日本語名の download を正しく報告しないため、リンクに設定した名前を直接見る
  await p.focus('#tfMain'); await p.keyboard.press('Control+a'); await p.click('#tfPane [data-act="download"]'); await p.waitForTimeout(2200);
  const dls = await p.evaluate(() => window.__dl);
  ok('ダウンロード（複数選択は 1 つずつ・保存名つきのリンク）', dls.length === 4 && dls.every(d => /download=/.test(d[1])) && dls.some(d => d[0] === '改名後.png'), dls);

  // 取り出し（ドラッグ）
  const dt = await p.evaluate(() => { const row = document.querySelector('#tfMain .tf-row'); const d = new DataTransfer(); row.dispatchEvent(new DragEvent('dragstart', { dataTransfer: d, bubbles: true })); return d.getData('DownloadURL'); });
  ok('一覧から外へドラッグして取り出せる（DownloadURL）', /^[^:]+:.+:http:\/\/127\.0\.0\.1.*__signed/.test(dt), dt);

  // 残り時間・期限切れ
  await p.evaluate(() => { const f = window.__db.quote_temp_files[0]; f.expires_at = new Date(Date.now() + 20 * 60000).toISOString(); window.tfRefresh(true); }); await p.waitForTimeout(700);
  ok('残り 30 分を切ると赤く表示', await p.evaluate(() => !!document.querySelector('#tfMain .tf-left.is-soon') && /あと 2\d分|あと 19分/.test(document.querySelector('#tfMain .tf-left.is-soon').textContent)));
  await shot(p, '5-soon');
  const before = (await rows()).length;
  await p.evaluate(() => { const f = window.__db.quote_temp_files[0]; f.expires_at = new Date(Date.now() + 1500).toISOString(); window.tfRefresh(true); }); await p.waitForTimeout(3300);
  ok('期限が来たファイルは自動で一覧から消える', (await rows()).length === before - 1, { before, now: (await rows()).length });

  // 削除
  await p.click('#tfMain .tf-row:nth-child(1)'); await p.keyboard.press('Delete'); await p.waitForTimeout(400);
  ok('Delete で確認画面（取り消しにくい操作は uiConfirm）', await vis(p, '.confirm-dialog'));
  await p.click('.confirm-dialog .confirm-ok, .confirm-dialog button.danger, .confirm-dialog .btn-danger').catch(async () => { await p.evaluate(() => { const bs = Array.from(document.querySelectorAll('.confirm-dialog button')); bs[bs.length - 1].click(); }); }); await p.waitForTimeout(600);
  ok('削除すると行・DB・保存領域のファイルが消える', (await rows()).length === before - 2 && await p.evaluate(() => window.__removed.length >= 1));
  await p.evaluate(() => { const n = document.querySelectorAll('#tfMain .tf-row').length; window.__n = n; });
  await p.keyboard.press('Control+a'); await p.click('#tfPane [data-act="delete"]'); await p.waitForTimeout(300);
  await p.evaluate(() => { const bs = Array.from(document.querySelectorAll('.confirm-dialog button')); bs.find(x => /やめる|キャンセル/.test(x.textContent)).click(); }); await p.waitForTimeout(300);
  ok('確認で「やめる」なら消えない', (await rows()).length === before - 2);

  // リマークとの行き来
  await p.click('#rmSheet .rms-tab[data-pane="remark"]').catch(() => {}); await p.waitForTimeout(400);
  if (!v2) {
    ok('「全体リマーク」のタブへ切り替えると、リマークの入力欄が出る（開いたまま）', await p.evaluate(() => window.rmsPane() === 'remark' && window.rmsIsOpen()) && await vis(p, '#remarkTextarea') && !(await vis(p, '#tfPane')));
    await p.evaluate(() => window.rmsClose()); await p.waitForTimeout(400);
    await p.evaluate(() => window.rmsOpen()); await p.waitForTimeout(400);
    ok('外部（左ナビ・リマークへの追記）から開くと、必ずリマーク側', await p.evaluate(() => window.rmsPane() === 'remark') && await vis(p, '#remarkTextarea'));
    await p.click('#rmSheet .rms-tab[data-pane="files"]'); await p.waitForTimeout(300);
    ok('一時ファイルのタブへ戻しても一覧が残っている', (await rows()).length === before - 2);
    await p.click('#rmSheet .rms-handle'); await p.waitForTimeout(400);
    ok('取っ手の（タブ以外の）クリックで閉じる', await p.evaluate(() => !window.rmsIsOpen()));
    ok('閉じていても件数のバッジは見える', await vis(p, '#tfTabN'));
  }

  // 案件が変わったら読み直す／保存前
  await p.evaluate(() => { window.cloudLoadedId = () => null; }); await p.waitForTimeout(1600);
  await p.evaluate(() => window.rmsShowFiles()); await p.waitForTimeout(400);
  ok('案件が未保存のときは「案件を保存すると使えます」', /案件を保存/.test(await p.textContent('#tfMain')) && await p.evaluate(() => document.querySelector('#tfPane [data-act="upload"]').disabled));
  ok('エラーなし', errs.length === 0, errs);
  await ctx.close();

  // ===== 未ログイン =====
  ({ ctx, p, errs } = await open('nologin'));
  await p.evaluate(() => window.rmsShowFiles && window.rmsShowFiles()); await p.waitForTimeout(600);
  ok('未ログインは「ログインすると使えます」', /ログインすると/.test(await p.textContent('#tfMain')) && await p.evaluate(() => document.querySelector('#tfPane [data-act="upload"]').disabled));
  await ctx.close();

  // ===== SQL 未実行 =====
  ({ ctx, p, errs } = await open('nosql'));
  await p.evaluate(() => { try { window.cloudLoadPreset('1'); } catch (e) {} }); await p.waitForTimeout(2500);
  await p.evaluate(() => window.rmsShowFiles()); await p.waitForTimeout(800);
  ok('SQL 未実行は「サーバー側の準備がまだ」と案内（画面は壊れない）', /サーバー側の準備/.test(await p.textContent('#tfMain')) && /quote-temp-files\.sql/.test(await p.textContent('#tfMain')));
  ok('エラーなし（未実行）', errs.length === 0, errs);
  await ctx.close();

  await b.close(); srv.close();
  console.log(fails ? `\n${fails} 件失敗` : '\nすべて成功');
  process.exit(fails ? 1 : 0);
})();
