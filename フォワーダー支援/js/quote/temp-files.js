// js/quote/temp-files.js
// =====================================================================
// 📁 一時ファイル置き場（案件ごと・置いてから 3 時間で自動削除）
//   見積を提示するときに添える参考資料（スケジュールなど）を、ごく短い間だけ置いておく場所。
//   画面は、全体リマークと同じ「画面下の引き出し」の 2 つ目のタブ（remark-sheet.js が #tfPane を用意する）。
//   見た目と操作は Windows のエクスプローラー風（ツールバー・一覧（詳細／アイコン）・並べ替え・複数選択・
//   右クリックメニュー・F2／Delete／Enter／Ctrl+A・OS からのドラッグ＆ドロップ・一覧から外へドラッグして取り出し）。
//   保存先：テーブル quote_temp_files＋非公開バケット quote-temp（docs/sql/quote-temp-files.sql を Supabase で実行する前提）。
//   期限（3 時間）・大きさ・作成者は DB のトリガーが決める。期限が来たファイルは一覧にも保存領域にも出なくなり、
//   実際の削除は 10 分ごとの掃除（pg_cron）。未実行・未ログイン・未保存のときは案内を出すだけで、ほかの機能に影響しない。
// =====================================================================
(function () {
  'use strict';

  const BUCKET = 'quote-temp';
  const TTL_MS = 3 * 3600 * 1000;
  const MAX_FILE = 25 * 1048576;       // 1 ファイル
  const MAX_TOTAL = 100 * 1048576;     // 1 案件の合計
  const MAX_COUNT = 50;                // 1 案件のファイル数
  const VIEW_KEY = 'quoteTempFilesView_v1';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let files = [];                 // 画面に出している行（期限内）
  let pending = [];               // アップロード中の仮の行
  let urls = {};                  // id → 取り出し（ドラッグ）用の署名つき URL
  let sel = new Set(), anchor = null, lastClickId = null;
  let view = 'detail';
  try { view = localStorage.getItem(VIEW_KEY) === 'icons' ? 'icons' : 'detail'; } catch (e) {}
  let sort = { key: 'time', dir: -1 };
  let query = '';
  let state = 'init';             // init | nologin | unsaved | nosql | error | ok
  let errMsg = '';
  let loadedFor = null, loadedUser = null, loadedAt = 0, loading = false, ready = false, renamingId = null;

  // ---- 外部（cloud.js）への入口 ---------------------------------------
  const client = () => (typeof window.cloudGetClient === 'function' ? window.cloudGetClient() : null);
  const user = () => (typeof window.cloudCurrentUser === 'function' ? window.cloudCurrentUser() : null);
  const caseId = () => (typeof window.cloudLoadedId === 'function' ? window.cloudLoadedId() : null);
  const nameFor = e => (typeof window.cloudNameFor === 'function' ? window.cloudNameFor(e) : (e || ''));
  const toast = (m, k, ms) => { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(m, k || 'info', ms || 2600); };

  // ---- 表示用の整形 ----------------------------------------------------
  function fmtSize(n) {
    n = +n || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB';
    return Math.max(1, Math.round(n / 1024)) + ' KB';
  }
  function fmtLeft(ms) {
    if (ms <= 0) return '期限切れ';
    const m = Math.ceil(ms / 60000);
    if (m < 1) return 'まもなく';
    if (m < 60) return 'あと ' + m + '分';
    const h = Math.floor(m / 60), r = m % 60;
    return 'あと ' + h + '時間' + (r ? r + '分' : '');
  }
  function fmtWhen(iso) {
    const d = new Date(iso); if (isNaN(d)) return '';
    const p = n => (n < 10 ? '0' : '') + n;
    return p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  const extOf = n => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(n || ''); return m ? m[1].toLowerCase() : ''; };
  const TYPES = {
    pdf: ['📕', 'PDF ファイル'], xls: ['📊', 'Excel ファイル'], xlsx: ['📊', 'Excel ファイル'], xlsm: ['📊', 'Excel ファイル'], csv: ['📊', 'CSV ファイル'],
    doc: ['📝', 'Word ファイル'], docx: ['📝', 'Word ファイル'], ppt: ['📽️', 'PowerPoint ファイル'], pptx: ['📽️', 'PowerPoint ファイル'],
    png: ['🖼️', '画像'], jpg: ['🖼️', '画像'], jpeg: ['🖼️', '画像'], gif: ['🖼️', '画像'], webp: ['🖼️', '画像'], bmp: ['🖼️', '画像'],
    zip: ['🗜️', '圧縮ファイル'], txt: ['📄', 'テキスト'], msg: ['✉️', 'メール'], eml: ['✉️', 'メール'], html: ['🌐', 'HTML ファイル']
  };
  const typeOf = f => { const e = extOf(f.file_name); return TYPES[e] || ['📎', e ? e.toUpperCase() + ' ファイル' : 'ファイル']; };
  const canPreview = f => /^(pdf|png|jpe?g|gif|webp|bmp|txt)$/.test(extOf(f.file_name));
  const leftMs = f => new Date(f.expires_at).getTime() - Date.now();

  // ---- 読み込み ---------------------------------------------------------
  function missingTable(err) {
    const m = (err && (err.message || '')) + ' ' + (err && err.code || '');
    return /42P01|PGRST205|schema cache|does not exist|quote_temp_files/i.test(m) && !/permission|row-level/i.test(m);
  }
  async function load(force) {
    if (loading) return;
    const c = client(), u = user(), id = caseId();
    loadedUser = u ? u.email : null;
    if (!c || !u) { state = 'nologin'; files = []; loadedFor = id || null; sel = new Set(); renderAll(); return; }
    if (!id) { state = 'unsaved'; files = []; loadedFor = null; sel = new Set(); renderAll(); return; }
    if (!force && loadedFor === id && Date.now() - loadedAt < 15000) return;
    loading = true;
    try {
      const res = await c.from('quote_temp_files').select('id,file_name,file_size,mime_type,storage_path,uploaded_by,created_at,expires_at')
        .eq('preset_id', id).order('created_at', { ascending: false });
      if (caseId() !== id) return;                       // 読み込み中に別の案件へ移った
      if (res.error) { state = missingTable(res.error) ? 'nosql' : 'error'; errMsg = res.error.message || ''; files = []; }
      else { state = 'ok'; files = (res.data || []).filter(f => leftMs(f) > 0); }
      loadedFor = id; loadedAt = Date.now();
      const keep = new Set(files.map(f => f.id)); sel = new Set([...sel].filter(x => keep.has(x)));
      renderAll();
      prefetchUrls();
    } catch (e) { state = 'error'; errMsg = String(e && e.message || e); renderAll(); }
    finally { loading = false; }
  }
  // 一覧の外へドラッグして取り出す用の URL を先に作っておく（ドラッグ開始の瞬間には非同期で作れないため）
  async function prefetchUrls() {
    const c = client(); if (!c || !files.length) return;
    try {
      const res = await c.storage.from(BUCKET).createSignedUrls(files.map(f => f.storage_path), 3600);
      if (res && !res.error && Array.isArray(res.data)) {
        const byPath = {}; res.data.forEach(d => { if (d && d.path && d.signedUrl) byPath[d.path] = d.signedUrl; });
        urls = {}; files.forEach(f => { if (byPath[f.storage_path]) urls[f.id] = byPath[f.storage_path]; });
      }
    } catch (e) { /* 取り出しのドラッグが使えないだけ */ }
  }

  // ---- 骨組み（1 回だけ作る）------------------------------------------
  function build() {
    const pane = $('tfPane'); if (!pane || pane.dataset.built) return !!pane;
    pane.dataset.built = '1';
    pane.innerHTML =
      '<div class="tf-toolbar" role="toolbar" aria-label="一時ファイルの操作">' +
        '<button type="button" class="tf-btn tf-btn-main" data-act="upload" title="ファイルを選んで置く"><span class="tf-bi">⬆</span><span class="tf-bt"> アップロード</span></button>' +
        '<input type="file" id="tfInput" multiple hidden>' +
        '<span class="tf-sep"></span>' +
        '<button type="button" class="tf-btn" data-act="open" title="開く（Enter）"><span class="tf-bi">📂</span><span class="tf-bt"> 開く</span></button>' +
        '<button type="button" class="tf-btn" data-act="download" title="ダウンロード"><span class="tf-bi">⬇</span><span class="tf-bt"> ダウンロード</span></button>' +
        '<button type="button" class="tf-btn" data-act="rename" title="名前の変更（F2）"><span class="tf-bi">✏</span><span class="tf-bt"> 名前の変更</span></button>' +
        '<button type="button" class="tf-btn tf-btn-danger" data-act="delete" title="削除（Delete）"><span class="tf-bi">🗑</span><span class="tf-bt"> 削除</span></button>' +
        '<span class="tf-sep"></span>' +
        '<button type="button" class="tf-btn" data-act="refresh" title="最新の状態にする"><span class="tf-bi">🔄</span><span class="tf-bt"> 更新</span></button>' +
        '<span class="tf-grow"></span>' +
        '<input type="search" id="tfSearch" class="tf-search" placeholder="ファイル名で検索" aria-label="ファイル名で検索">' +
        '<span class="tf-viewsw" role="group" aria-label="表示の切り替え">' +
          '<button type="button" class="tf-btn" data-view="detail" title="詳細"><span class="tf-bi">☰</span><span class="tf-bt"> 詳細</span></button>' +
          '<button type="button" class="tf-btn" data-view="icons" title="アイコン"><span class="tf-bi">▦</span><span class="tf-bt"> アイコン</span></button>' +
        '</span>' +
      '</div>' +
      '<div class="tf-addr"><span class="tf-crumb">📁 この案件の一時ファイル</span><span class="tf-addr-note">置いてから <b>3 時間</b>で自動的に消えます（延長できません）</span></div>' +
      '<div class="tf-main" id="tfMain" tabindex="0" role="listbox" aria-multiselectable="true" aria-label="一時ファイルの一覧"></div>' +
      '<div class="tf-status" id="tfStatus"></div>' +
      '<div class="tf-drop" id="tfDrop" hidden><div>⬇ ここにドロップして置く<small>25MB まで・置いてから 3 時間で消えます</small></div></div>';
    wire(pane);
    return true;
  }

  function wire(pane) {
    const input = $('tfInput');
    pane.querySelector('.tf-toolbar').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.view) { setView(b.dataset.view); return; }
      act(b.dataset.act);
    });
    input.addEventListener('change', () => { const fl = Array.from(input.files || []); input.value = ''; upload(fl); });
    $('tfSearch').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); renderMain(); renderStatus(); });
    $('tfSearch').addEventListener('keydown', e => e.stopPropagation());

    const main = $('tfMain');
    main.addEventListener('click', onMainClick);
    main.addEventListener('contextmenu', onContext);
    main.addEventListener('keydown', onKey);
    main.addEventListener('dragstart', onDragStart);
    // 一覧の見出し（並べ替え）
    main.addEventListener('click', e => {
      const h = e.target.closest('.tf-col[data-sort]'); if (!h) return;
      const k = h.dataset.sort;
      sort = { key: k, dir: sort.key === k ? -sort.dir : (k === 'time' || k === 'size' ? -1 : 1) };
      renderMain();
    });

    // OS からのドラッグ＆ドロップ（ファイルのときだけ反応。一覧からの取り出しのドラッグには反応しない）
    let depth = 0;
    const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0;
    pane.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; $('tfDrop').hidden = false; });
    pane.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    pane.addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) $('tfDrop').hidden = true; });
    pane.addEventListener('drop', e => {
      if (!hasFiles(e)) return; e.preventDefault(); depth = 0; $('tfDrop').hidden = true;
      upload(Array.from(e.dataTransfer.files || []));
    });
    // メニューを閉じる
    document.addEventListener('mousedown', e => { if (!e.target.closest || !e.target.closest('.tf-ctx')) closeCtx(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCtx(); });
    window.addEventListener('blur', closeCtx);
    pane.addEventListener('scroll', closeCtx, true);
  }

  function setView(v) {
    view = v === 'icons' ? 'icons' : 'detail';
    try { localStorage.setItem(VIEW_KEY, view); } catch (e) {}
    renderAll();
  }

  // ---- 描画 --------------------------------------------------------------
  function shown() {
    let list = files.filter(f => !query || (f.file_name || '').toLowerCase().indexOf(query) >= 0);
    const k = sort.key, d = sort.dir;
    const txt = k === 'name' || k === 'type' || k === 'who';
    const val = f => k === 'name' ? (f.file_name || '') : k === 'size' ? (+f.file_size || 0) : k === 'type' ? typeOf(f)[1] : k === 'who' ? nameFor(f.uploaded_by) : k === 'left' ? new Date(f.expires_at).getTime() : new Date(f.created_at).getTime();
    const nat = (x, y) => String(x).localeCompare(String(y), 'ja', { numeric: true, sensitivity: 'base' });   // エクスプローラーと同じ自然順（file2 < file10）
    list = list.slice().sort((a, b) => { const x = val(a), y = val(b); return (txt ? nat(x, y) : (x < y ? -1 : x > y ? 1 : 0)) * d || nat(a.file_name || '', b.file_name || ''); });
    return list;
  }
  function renderAll() { if (!ready) return; syncToolbar(); renderMain(); renderStatus(); renderBadges(); }
  function syncToolbar() {
    const pane = $('tfPane'); if (!pane) return;
    pane.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('is-on', b.dataset.view === view));
    const ok = state === 'ok', n = sel.size;
    const dis = (act, off) => { const b = pane.querySelector('[data-act="' + act + '"]'); if (b) b.disabled = !!off; };
    dis('upload', !ok); dis('refresh', state === 'nologin' || state === 'unsaved');
    dis('open', !ok || n !== 1); dis('download', !ok || n < 1); dis('rename', !ok || n !== 1); dis('delete', !ok || n < 1);
    const s = $('tfSearch'); if (s) s.disabled = !ok;
  }
  function msgBox(icon, title, text) {
    return '<div class="tf-empty"><div class="tf-empty-ico" aria-hidden="true">' + icon + '</div><div class="tf-empty-t">' + esc(title) + '</div>' + (text ? '<div class="tf-empty-s">' + text + '</div>' : '') + '</div>';
  }
  function rowHtml(f, i) {
    const t = typeOf(f), on = sel.has(f.id), left = leftMs(f);
    const soon = left < 30 * 60000 ? ' is-soon' : '';
    const nm = renamingId === f.id
      ? '<input class="tf-rename" value="' + esc(f.file_name) + '" maxlength="200" aria-label="新しい名前">'
      : '<span class="tf-nm" title="' + esc(f.file_name) + '">' + esc(f.file_name) + '</span>';
    if (view === 'icons') {
      return '<div class="tf-tile' + (on ? ' is-sel' : '') + '" role="option" aria-selected="' + on + '" data-id="' + f.id + '" draggable="true" title="' + esc(f.file_name) + '">' +
        '<span class="tf-ico tf-ico-l" aria-hidden="true">' + t[0] + '</span>' + nm +
        '<span class="tf-left' + soon + '" data-exp="' + esc(f.expires_at) + '">' + fmtLeft(left) + '</span></div>';
    }
    return '<div class="tf-row' + (on ? ' is-sel' : '') + '" role="option" aria-selected="' + on + '" data-id="' + f.id + '" draggable="true">' +
      '<span class="tf-c tf-c-name"><span class="tf-ico" aria-hidden="true">' + t[0] + '</span>' + nm + '</span>' +
      '<span class="tf-c tf-c-time">' + esc(fmtWhen(f.created_at)) + '</span>' +
      '<span class="tf-c tf-c-type">' + esc(t[1]) + '</span>' +
      '<span class="tf-c tf-c-size">' + fmtSize(f.file_size) + '</span>' +
      '<span class="tf-c tf-c-left"><span class="tf-left' + soon + '" data-exp="' + esc(f.expires_at) + '">' + fmtLeft(left) + '</span></span>' +
      '<span class="tf-c tf-c-who" title="' + esc(f.uploaded_by) + '">' + esc(nameFor(f.uploaded_by)) + '</span></div>';
  }
  function pendingHtml(p) {
    return '<div class="' + (view === 'icons' ? 'tf-tile' : 'tf-row') + ' is-pending" aria-busy="true">' +
      (view === 'icons'
        ? '<span class="tf-ico tf-ico-l">⏳</span><span class="tf-nm">' + esc(p.name) + '</span><span class="tf-left">アップロード中…</span>'
        : '<span class="tf-c tf-c-name"><span class="tf-ico">⏳</span><span class="tf-nm">' + esc(p.name) + '</span></span><span class="tf-c tf-c-time"></span><span class="tf-c tf-c-type"></span><span class="tf-c tf-c-size">' + fmtSize(p.size) + '</span><span class="tf-c tf-c-left">アップロード中…</span><span class="tf-c tf-c-who"></span>') +
      '</div>';
  }
  function renderMain() {
    const main = $('tfMain'); if (!main) return;
    main.classList.toggle('is-icons', view === 'icons');
    if (state === 'nologin') { main.innerHTML = msgBox('🔒', 'ログインすると使えます', '一時ファイルは案件ごとにチームで共有されます。'); return; }
    if (state === 'unsaved') { main.innerHTML = msgBox('💾', '案件を保存すると使えます', '一時ファイルは案件に紐づけて置きます。先に「保存」してください。'); return; }
    if (state === 'nosql') { main.innerHTML = msgBox('🛠️', 'サーバー側の準備がまだです', '管理者が <code>docs/sql/quote-temp-files.sql</code> を Supabase で実行すると使えるようになります。'); return; }
    if (state === 'error') { main.innerHTML = msgBox('⚠️', '読み込めませんでした', esc(errMsg) + '<br><button type="button" class="tf-btn" data-act="refresh" onclick="tfRefresh(true)">もう一度読み込む</button>'); return; }
    if (state !== 'ok') { main.innerHTML = msgBox('⏳', '読み込み中…', ''); return; }
    const list = shown();
    if (!list.length && !pending.length) {
      main.innerHTML = files.length
        ? msgBox('🔍', '一致するファイルがありません', '')
        : msgBox('📂', 'このフォルダーは空です', '見積に添える資料（スケジュールなど）をここへ<b>ドラッグ＆ドロップ</b>するか、「⬆ アップロード」を押してください。<br>置いたファイルは 3 時間で自動的に消えます。');
      return;
    }
    const head = view === 'icons' ? '' :
      '<div class="tf-head" role="presentation">' + [['name', '名前', 'tf-c-name'], ['time', '追加日時', 'tf-c-time'], ['type', '種類', 'tf-c-type'], ['size', 'サイズ', 'tf-c-size'], ['left', '残り時間', 'tf-c-left'], ['who', '追加した人', 'tf-c-who']]
        .map(c => '<span class="tf-col tf-c ' + c[2] + '" data-sort="' + c[0] + '">' + c[1] + (sort.key === c[0] ? '<i>' + (sort.dir > 0 ? '▲' : '▼') + '</i>' : '') + '</span>').join('') + '</div>';
    main.innerHTML = head + '<div class="tf-rows">' + pending.map(pendingHtml).join('') + list.map(rowHtml).join('') + '</div>';
    if (renamingId) startRenameUi();
  }
  function renderStatus() {
    const st = $('tfStatus'); if (!st) return;
    if (state !== 'ok') { st.innerHTML = ''; return; }
    const list = shown(), chosen = files.filter(f => sel.has(f.id));
    const total = files.reduce((s, f) => s + (+f.file_size || 0), 0);
    const pct = Math.min(100, Math.round(total / MAX_TOTAL * 100));
    st.innerHTML = '<span>' + list.length + ' 個の項目' + (query ? '（検索中）' : '') + '</span>' +
      (chosen.length ? '<span>' + chosen.length + ' 個を選択　' + fmtSize(chosen.reduce((s, f) => s + (+f.file_size || 0), 0)) + '</span>' : '') +
      '<span class="tf-grow"></span><span class="tf-meter" title="1 案件で 100MB・50 ファイルまで"><i style="width:' + pct + '%"' + (pct >= 90 ? ' class="is-full"' : '') + '></i></span><span>' + fmtSize(total) + ' / 100 MB</span>';
  }
  function renderBadges() {
    const n = $('tfTabN'), m = $('tfMeta');
    const live = state === 'ok' ? files.length : 0;
    if (n) { n.hidden = !live; n.textContent = live ? String(live) : ''; }
    if (m) {
      if (state === 'ok' && live) { const mn = Math.min.apply(null, files.map(leftMs)); m.innerHTML = '<i class="rms-dot"></i>' + live + ' 件・最短 ' + esc(fmtLeft(mn)); }
      else m.innerHTML = '<span class="rms-empty">' + (state === 'ok' ? 'なし' : '') + '</span>';
    }
  }
  // 1 秒ごとに「残り時間」の文字だけを更新する（一覧を作り直さない＝名前変更の入力中でも邪魔をしない）
  function tick() {
    const sheet = $('rmSheet'); if (!sheet || !sheet.getClientRects().length) return;
    // 開いている案件が変わったら読み直す（開いていないときも、タブの件数を正しく保つ）
    const id = caseId();
    const uid = user() ? user().email : null;
    if (ready && (id !== (loadedFor || null) || uid !== loadedUser || (state === 'ok' && Date.now() - loadedAt > 60000))) { load(true); return; }
    if (state !== 'ok' || !files.length) return;
    let gone = false;
    files.forEach(f => { if (leftMs(f) <= 0) gone = true; });
    if (gone) { files = files.filter(f => leftMs(f) > 0); sel = new Set([...sel].filter(x => files.some(f => f.id === x))); renderAll(); return; }
    document.querySelectorAll('#tfMain .tf-left[data-exp]').forEach(el => {
      const ms = new Date(el.dataset.exp).getTime() - Date.now();
      const t = fmtLeft(ms); if (el.textContent !== t) el.textContent = t;
      el.classList.toggle('is-soon', ms < 30 * 60000);
    });
    renderBadges();
  }

  // ---- 選択・クリック・キー ---------------------------------------------
  function orderIds() { return shown().map(f => f.id); }
  function select(ids, anch) { sel = new Set(ids); if (anch !== undefined) anchor = anch; syncSel(); }
  function syncSel() {
    document.querySelectorAll('#tfMain [data-id]').forEach(el => { const on = sel.has(el.dataset.id); el.classList.toggle('is-sel', on); el.setAttribute('aria-selected', on ? 'true' : 'false'); });
    syncToolbar(); renderStatus();
  }
  function onMainClick(e) {
    if (e.target.closest('.tf-rename')) return;
    const el = e.target.closest('[data-id]');
    if (!el) { if (!e.target.closest('.tf-col')) { select([], null); } return; }
    const id = el.dataset.id;
    if (e.detail >= 2 && lastClickId === id) { select([id], id); act('open'); return; }       // 2 回目のクリック＝ダブルクリック
    lastClickId = id;
    if (e.shiftKey && anchor) {
      const o = orderIds(), a = o.indexOf(anchor), b = o.indexOf(id);
      if (a >= 0 && b >= 0) { select(o.slice(Math.min(a, b), Math.max(a, b) + 1)); return; }
    }
    if (e.ctrlKey || e.metaKey) { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); select(s, id); return; }
    select([id], id);
    $('tfMain').focus({ preventScroll: true });
  }
  function onKey(e) {
    if (e.target.closest && e.target.closest('.tf-rename')) return;
    const o = orderIds(); const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (document.querySelector('.tf-ctx')) { if (e.key === 'Escape') { handled(); closeCtx(); } return; }
    if (e.key === 'a' && (e.ctrlKey || e.metaKey)) { handled(); select(o, o[0] || null); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (sel.size) { handled(); act('delete'); } return; }
    if (e.key === 'F2') { handled(); act('rename'); return; }
    if (e.key === 'Enter') { if (sel.size === 1) { handled(); act('open'); } return; }
    if (e.key === 'Escape') { if (sel.size) { handled(); select([], null); } return; }
    const vert = view === 'detail';
    const next = (e.key === 'ArrowDown' && vert) || e.key === 'ArrowRight' ? 1 : (e.key === 'ArrowUp' && vert) || e.key === 'ArrowLeft' ? -1 : 0;
    if (next || e.key === 'Home' || e.key === 'End') {
      handled(); if (!o.length) return;
      const cur = o.indexOf(anchor); let i = e.key === 'Home' ? 0 : e.key === 'End' ? o.length - 1 : (cur < 0 ? (next > 0 ? 0 : o.length - 1) : Math.max(0, Math.min(o.length - 1, cur + next)));
      if (e.shiftKey && cur >= 0) { const lo = Math.min(cur, i), hi = Math.max(cur, i); select(o.slice(lo, hi + 1), anchor); } else select([o[i]], o[i]);
      const el = document.querySelector('#tfMain [data-id="' + o[i] + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
    }
  }
  function onDragStart(e) {
    const el = e.target.closest && e.target.closest('[data-id]'); if (!el) return;
    const f = files.find(x => x.id === el.dataset.id); if (!f) return;
    if (!sel.has(f.id)) select([f.id], f.id);
    const u = urls[f.id];
    if (u && e.dataTransfer) {       // Chrome／Edge：デスクトップやフォルダーへドラッグして取り出せる
      try { e.dataTransfer.setData('DownloadURL', (f.mime_type || 'application/octet-stream') + ':' + f.file_name.replace(/:/g, '_') + ':' + u); e.dataTransfer.effectAllowed = 'copy'; } catch (er) {}
    }
  }

  // ---- 右クリックメニュー ------------------------------------------------
  function closeCtx() { const m = document.querySelector('.tf-ctx'); if (m) m.remove(); }
  function onContext(e) {
    e.preventDefault(); closeCtx();
    if (state !== 'ok') return;
    const el = e.target.closest('[data-id]');
    if (el && !sel.has(el.dataset.id)) select([el.dataset.id], el.dataset.id);
    if (!el) select([], null);
    const n = sel.size;
    const items = n
      ? [['open', '📂 開く', n !== 1], ['download', '⬇ ダウンロード', false], ['rename', '✏ 名前の変更', n !== 1], ['-'], ['delete', '🗑 削除', false]]
      : [['upload', '⬆ アップロード…', false], ['refresh', '🔄 更新', false], ['-'], [view === 'icons' ? 'v-detail' : 'v-icons', view === 'icons' ? '☰ 詳細表示にする' : '▦ アイコン表示にする', false]];
    const m = document.createElement('div'); m.className = 'tf-ctx'; m.setAttribute('role', 'menu');
    m.innerHTML = items.map(it => it[0] === '-' ? '<hr>' : '<button type="button" role="menuitem" data-a="' + it[0] + '"' + (it[2] ? ' disabled' : '') + '>' + it[1] + '</button>').join('');
    document.body.appendChild(m);
    const w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(4, Math.min(e.clientX, window.innerWidth - w - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(e.clientY, window.innerHeight - h - 4)) + 'px';
    m.addEventListener('click', ev => {
      const b = ev.target.closest('button'); if (!b || b.disabled) return;
      const a = b.dataset.a; closeCtx();
      if (a === 'v-detail') setView('detail'); else if (a === 'v-icons') setView('icons'); else act(a);
    });
  }

  // ---- 操作 --------------------------------------------------------------
  function act(a) {
    if (a === 'upload') { if (state === 'ok') $('tfInput').click(); return; }
    if (a === 'refresh') { load(true); return; }
    const chosen = files.filter(f => sel.has(f.id));
    if (!chosen.length) return;
    if (a === 'open' && chosen.length === 1) return openFile(chosen[0]);
    if (a === 'download') return downloadFiles(chosen);
    if (a === 'rename' && chosen.length === 1) return startRename(chosen[0].id);
    if (a === 'delete') return deleteFiles(chosen);
  }
  async function signed(f, download) {
    const c = client(); if (!c) return null;
    const res = await c.storage.from(BUCKET).createSignedUrl(f.storage_path, 300, download ? { download: f.file_name } : undefined);
    if (res.error || !res.data) { toast('⚠️ リンクを作れませんでした（期限が切れたかもしれません）', 'warn', 4500); load(true); return null; }
    return res.data.signedUrl;
  }
  async function openFile(f) {
    if (!canPreview(f)) return downloadFiles([f]);
    const u = await signed(f, false); if (u) window.open(u, '_blank', 'noopener');
  }
  async function downloadFiles(list) {
    for (let i = 0; i < list.length; i++) {
      const u = await signed(list[i], true); if (!u) continue;
      const a = document.createElement('a'); a.href = u; a.download = list[i].file_name; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
      if (i < list.length - 1) await new Promise(r => setTimeout(r, 350));
    }
  }
  async function deleteFiles(list) {
    const c = client(); if (!c || !list.length) return;
    const names = list.slice(0, 5).map(f => '・' + f.file_name);
    if (list.length > 5) names.push('ほか ' + (list.length - 5) + ' 個');
    const ok = typeof window.uiConfirm === 'function'
      ? await window.uiConfirm({ title: list.length === 1 ? 'このファイルを削除しますか？' : list.length + ' 個のファイルを削除しますか？', lines: names, irreversible: '削除したファイルは元に戻せません（ゴミ箱はありません）。', okLabel: '削除する', danger: true })
      : window.confirm(names.join('\n') + '\n\n削除しますか？');
    if (!ok) return;
    const ids = list.map(f => f.id);
    // 先に実体、次に行（行を先に消すと、保存領域の読み取りポリシー＝「期限内の行がある」を満たさず、実体を消せなくなる）
    try { await c.storage.from(BUCKET).remove(list.map(f => f.storage_path)); } catch (e) { /* 失敗しても行は消す。実体は掃除が消す */ }
    const del = await c.from('quote_temp_files').delete().in('id', ids);
    if (del.error) { toast('⚠️ 削除できませんでした：' + del.error.message, 'warn', 6000); return; }
    files = files.filter(f => ids.indexOf(f.id) < 0); sel = new Set();
    renderAll(); toast('🗑 ' + list.length + ' 個を削除しました', 'info', 2200);
  }
  function startRename(id) { renamingId = id; renderMain(); }
  function startRenameUi() {
    const el = document.querySelector('#tfMain .tf-rename'); if (!el) return;
    const f = files.find(x => x.id === renamingId); if (!f) { renamingId = null; return; }
    el.focus();
    const dot = f.file_name.lastIndexOf('.');
    try { el.setSelectionRange(0, dot > 0 ? dot : f.file_name.length); } catch (e) {}   // 拡張子の前までを選ぶ（Windows と同じ）
    let done = false;
    const finish = async commit => {
      if (done) return; done = true;
      const v = el.value.trim(), id = renamingId; renamingId = null;
      if (commit && v && v !== f.file_name) {
        if (/[\\/]/.test(v) || v.length > 200) { toast('⚠️ ファイル名に / \\ は使えません（200 文字まで）', 'warn', 4000); }
        else {
          const c = client();
          const res = await c.from('quote_temp_files').update({ file_name: v }).eq('id', id).select('id');
          if (res.error || !(res.data && res.data.length)) toast('⚠️ 名前を変えられませんでした（期限が切れたかもしれません）', 'warn', 4500);
          else f.file_name = v;
        }
      }
      renderMain(); const m = $('tfMain'); if (m) m.focus({ preventScroll: true });
    };
    el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    el.addEventListener('blur', () => finish(true));
    el.addEventListener('click', e => e.stopPropagation());
    el.addEventListener('dblclick', e => e.stopPropagation());
  }

  // ---- アップロード ------------------------------------------------------
  function storageKey(id, file) {
    const nm = file.name || 'file', dot = nm.lastIndexOf('.');
    const ext = dot >= 0 ? nm.slice(dot).replace(/[^A-Za-z0-9.]/g, '').slice(0, 10) : '';
    const base = (dot >= 0 ? nm.slice(0, dot) : nm).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'file';
    return id + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + base + ext;
  }
  async function upload(list) {
    list = (list || []).filter(Boolean);
    if (!list.length) return;
    if (state !== 'ok') { toast(state === 'unsaved' ? '⚠️ 先に案件を保存してください（💾 保存）' : '⚠️ いまは置けません', 'warn', 4500); return; }
    const c = client(), id = caseId(); if (!c || !id) return;
    let okN = 0;
    for (const file of list) {
      const used = files.reduce((s, f) => s + (+f.file_size || 0), 0);
      if (file.size > MAX_FILE) { toast('⚠️ ' + file.name + ' は 25MB を超えるため置けません', 'warn', 5000); continue; }
      if (files.length >= MAX_COUNT) { toast('⚠️ 1 案件に置けるのは ' + MAX_COUNT + ' ファイルまでです', 'warn', 5000); break; }
      if (used + file.size > MAX_TOTAL) { toast('⚠️ 1 案件の合計 100MB を超えるため ' + file.name + ' は置けません', 'warn', 5000); continue; }
      const p = { name: file.name, size: file.size }; pending.push(p); renderMain();
      const path = storageKey(id, file);
      try {
        const up = await c.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (up.error) throw new Error(up.error.message);
        const ins = await c.from('quote_temp_files').insert({ preset_id: id, storage_path: path, file_name: file.name, mime_type: file.type || null }).select().single();
        if (ins.error) { try { await c.storage.from(BUCKET).remove([path]); } catch (e) {} throw new Error(ins.error.message); }
        if (caseId() === id) { files.unshift(ins.data); okN++; }
      } catch (e) { toast('⚠️ ' + file.name + ' を置けませんでした：' + (e.message || e), 'warn', 6500); }
      finally { pending = pending.filter(x => x !== p); renderAll(); }
    }
    if (okN) { toast('📁 ' + okN + ' 個を置きました（3 時間で自動削除）', 'success', 3000); prefetchUrls(); }
  }

  // ---- remark-sheet.js から ----------------------------------------------
  window.tfOnShow = function () { if (!ready) return; load(false); const m = $('tfMain'); if (m && m.offsetParent) { /* 焦点は奪わない */ } };
  window.tfRefresh = function (force) { load(force !== false); };
  window.tfState = function () { return { state, count: files.length, selected: sel.size, view }; };

  function init() {
    if (ready) return;
    if (!build()) return;
    ready = true;
    renderAll();
    setInterval(tick, 1000);
    load(true);
    // ログイン・ログアウトで読み直す（cloud.js は cloudCurrentUser を返すだけなので、tick の案件 ID 監視と併用）
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0)); else setTimeout(init, 0);
  window.addEventListener('load', () => setTimeout(init, 0));
})();
