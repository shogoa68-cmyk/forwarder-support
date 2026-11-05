// ============================================================
// 📁 作業フォルダ（js/workfolder.js）
//   メンバーごとの個人フォルダ。見た目・操作はファイルエクスプローラー風。
//   ・「どのフォルダに何があるか」は Supabase の wf_nodes 表（docs/sql/work-folders.sql）
//   ・ファイルの中身の置き場は 2 通り（wf_config の backend で切り替え。画面は同じ）：
//       storage … Supabase の保存領域（標準。画面から直接アップロード。予約→送信→確定の 3 段階）
//       drive   … 管理者の Google ドライブ（Edge Function `workfolder` が出し入れ）
//   ・フォルダの作成／名前変更／移動／ゴミ箱は表を書き換えるだけ（RLS で自分の行だけ）
//   セットアップは docs/作業フォルダ-セットアップ.md
// ============================================================
(function () {
  'use strict';

  // ---------- 状態 ----------
  var S = {
    ready: false,            // 初回の読み込みが終わったか
    nodes: new Map(),        // id → 行（フォルダ・ファイルのぜんぶ）
    kids: new Map(),         // parent_id(null は 'root') → 行の配列（描画のたびに作り直す）
    cwd: null,               // 開いているフォルダ（null＝いちばん上）
    view: 'files',           // 'files' | 'trash' | 'search'
    sel: new Set(),          // 選択中の id
    anchor: null,            // Shift 選択の起点
    mode: 'list',            // 'list'（詳細）| 'grid'（アイコン）
    sort: { key: 'name', dir: 1 },
    q: '',                   // 検索語
    usage: { quota: 50 * 1024 * 1024 },
    backend: 'storage',      // 'storage' | 'drive'（DB の wf_config から読む）
    fileLimit: 50 * 1024 * 1024,
    expanded: new Set(),     // ツリーで開いているフォルダ
    renaming: null,          // 名前変更中の id
    cut: [],                 // 「切り取り」した id（貼り付けで移動）
    dragIds: null,           // ドラッグ中の id
    back: [], fwd: [],       // 戻る／進む の履歴
    error: null,             // 'login' | 'nosetup' | 'noconfig' | 文字列
    uploads: [],             // アップロードの進み具合
    loading: false,
  };
  var BUCKET = 'work-folders';   // Supabase の保存領域のバケット名
  var UP_PARALLEL = 2;       // 同時にアップロードする数
  var PREVIEW_MAX = 30 * 1024 * 1024;

  // ---------- 小道具 ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg, kind, ms) { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(msg, kind || 'info', ms || 3000); }
  function client() { return typeof window.cloudGetClient === 'function' ? window.cloudGetClient() : null; }
  function email() { return typeof window.cloudCurrentEmail === 'function' ? window.cloudCurrentEmail() : ''; }
  function fmtSize(n) {
    n = Number(n) || 0;
    if (n < 1024) return n + ' B';
    var u = ['KB', 'MB', 'GB', 'TB'], i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return (n >= 100 ? n.toFixed(0) : n >= 10 ? n.toFixed(1) : n.toFixed(2)) + ' ' + u[i];
  }
  function fmtDate(s) {
    if (!s) return '';
    var d = new Date(s); if (isNaN(d)) return '';
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function extOf(name) { var m = /\.([^.]+)$/.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  var ICONS = { pdf: '📕', xls: '📗', xlsx: '📗', xlsm: '📗', csv: '📗', doc: '📘', docx: '📘', ppt: '📙', pptx: '📙', txt: '📄', md: '📄', zip: '🗜️', rar: '🗜️', '7z': '🗜️', mp4: '🎞️', mov: '🎞️', mp3: '🎵', wav: '🎵', json: '🧾', msg: '✉️', eml: '✉️' };
  function iconOf(n) {
    if (n.kind === 'folder') return '📁';
    var e = extOf(n.name);
    if (ICONS[e]) return ICONS[e];
    var m = n.mime || '';
    if (m.indexOf('image/') === 0) return '🖼️';
    if (m.indexOf('video/') === 0) return '🎞️';
    if (m.indexOf('audio/') === 0) return '🎵';
    return '📄';
  }
  function typeOf(n) { return n.kind === 'folder' ? 'フォルダー' : (extOf(n.name) ? extOf(n.name).toUpperCase() + ' ファイル' : 'ファイル'); }
  function collator() { return new Intl.Collator('ja', { numeric: true, sensitivity: 'base' }); }

  // ---------- ツリー用の索引 ----------
  function reindex() {
    S.kids = new Map();
    S.nodes.forEach(function (n) {
      var k = n.parent_id || 'root';
      if (!S.kids.has(k)) S.kids.set(k, []);
      S.kids.get(k).push(n);
    });
  }
  function childrenOf(pid) { return S.kids.get(pid || 'root') || []; }
  function pathOf(id) {               // いちばん上から id までのフォルダ名の並び
    var out = [], cur = S.nodes.get(id), guard = 0;
    while (cur && guard++ < 100) { out.unshift(cur); cur = cur.parent_id ? S.nodes.get(cur.parent_id) : null; }
    return out;
  }
  function trashedAncestor(n) {       // 自分より上のどこかがゴミ箱に入っているか
    var cur = n.parent_id ? S.nodes.get(n.parent_id) : null, guard = 0;
    while (cur && guard++ < 100) { if (cur.trashed_at) return true; cur = cur.parent_id ? S.nodes.get(cur.parent_id) : null; }
    return false;
  }
  function isDescendant(id, ancestorId) {
    var cur = S.nodes.get(id), guard = 0;
    while (cur && guard++ < 100) { if (cur.id === ancestorId) return true; cur = cur.parent_id ? S.nodes.get(cur.parent_id) : null; }
    return false;
  }
  function usedBytes() { var t = 0; S.nodes.forEach(function (n) { if (n.kind === 'file') t += Number(n.size) || 0; }); return t; }

  // いま一覧に出す項目（並べ替え済み）
  function visibleItems() {
    var list;
    if (S.view === 'trash') {
      list = []; S.nodes.forEach(function (n) { if (n.trashed_at && !trashedAncestor(n)) list.push(n); });
    } else if (S.view === 'search') {
      var q = S.q.toLowerCase(); list = [];
      S.nodes.forEach(function (n) { if (!n.trashed_at && !trashedAncestor(n) && n.name.toLowerCase().indexOf(q) >= 0) list.push(n); });
    } else {
      list = childrenOf(S.cwd).filter(function (n) { return !n.trashed_at; });
    }
    var col = collator(), k = S.sort.key, d = S.sort.dir;
    list.sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;          // フォルダーが先
      var r = 0;
      if (k === 'size') r = (Number(a.size) || 0) - (Number(b.size) || 0);
      else if (k === 'date') r = String(a.updated_at).localeCompare(String(b.updated_at));
      else if (k === 'type') r = col.compare(typeOf(a), typeOf(b));
      else r = col.compare(a.name, b.name);
      return (r || col.compare(a.name, b.name)) * d;
    });
    return list;
  }

  // ---------- 通信 ----------
  function fnUrl() { return String((window.CLOUD_CONFIG || {}).url || '').replace(/\/$/, '') + '/functions/v1/workfolder'; }
  async function authHeaders() {
    var c = client(); var s = c ? (await c.auth.getSession()).data.session : null;
    if (!s) throw mkErr('login', 'ログインが必要です');
    return { Authorization: 'Bearer ' + s.access_token, apikey: window.CLOUD_CONFIG.publishableKey, 'Content-Type': 'application/json' };
  }
  function mkErr(code, msg) { var e = new Error(msg); e.code = code; return e; }
  async function fnPost(body, raw) {
    var res;
    try { res = await fetch(fnUrl(), { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body) }); }
    catch (e) { if (e.code) throw e; throw mkErr('network', '通信できませんでした（Edge Function が未設定の可能性があります）'); }
    if (raw && res.ok) return res;
    var j = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      if (res.status === 404) throw mkErr('nofunction', '作業フォルダのサーバー側が未設定です（Edge Function を配置してください）');
      throw mkErr(j.error || 'error', j.message || ('エラー（' + res.status + '）'));
    }
    return j;
  }
  function dbErrMsg(e) {
    if (!e) return '';
    if (e.code === '23505') return '同じ名前がすでにあります';
    var m = e.message || String(e);
    if (e.code === 'PGRST202' || /Could not find the function/i.test(m)) return 'サーバー側の準備が未完了です（docs/sql/work-folders-storage.sql を実行してください）';
    return m.replace(/^wf:\s*/, '');       // SQL 関数が返す「wf: …」の日本語メッセージだけを見せる
  }

  // ---------- 読み込み ----------
  async function load() {
    var c = client();
    if (!c || !email()) { S.error = 'login'; S.ready = true; render(); return; }
    S.loading = true; S.error = null; render();
    try {
      var all = [], from = 0, size = 1000;
      for (;;) {                               // API は 1 回 1000 行までなので、分けて取る
        var r = await c.from('wf_nodes').select('*').order('created_at', { ascending: true }).range(from, from + size - 1);
        if (r.error) throw r.error;
        all = all.concat(r.data || []);
        if ((r.data || []).length < size) break;
        from += size;
      }
      S.nodes = new Map(all.map(function (n) { return [n.id, n]; }));
      var u = await c.rpc('wf_my_usage');
      if (!u.error && u.data && u.data.length) {
        S.usage.quota = Number(u.data[0].quota) || S.usage.quota;
        S.fileLimit = Number(u.data[0].file_limit) || S.fileLimit;
        S.backend = u.data[0].backend === 'drive' ? 'drive' : 'storage';
      }
      if (S.cwd && !S.nodes.has(S.cwd)) S.cwd = null;
    } catch (e) {
      var m = String(e && (e.message || e.code) || e);
      S.error = (e && (e.code === '42P01' || e.code === 'PGRST205' || /wf_nodes/.test(m))) ? 'nosetup' : m;
    }
    S.loading = false; S.ready = true; render();
  }

  // ---------- 描画 ----------
  function render() {
    var root = $('wfRoot'); if (!root) return;
    if (S.error === 'login') {
      root.innerHTML = '<div class="wf-empty"><b>📁 作業フォルダはログインすると使えます</b><br>管理者から分けてもらった容量に、自分用のフォルダを作れます。<br><br><button class="wf-btn is-primary" data-act="login">Google でログイン</button></div>';
      return;
    }
    if (S.error === 'nosetup') {
      root.innerHTML = '<div class="wf-empty"><b>⚙️ 作業フォルダの準備がまだです</b><br>管理者が <code>docs/sql/work-folders.sql</code> を Supabase で実行すると使えるようになります。<br>（手順は <code>docs/作業フォルダ-セットアップ.md</code>）</div>';
      return;
    }
    if (S.error) {
      root.innerHTML = '<div class="wf-empty"><b>⚠️ 読み込めませんでした</b><br>' + esc(S.error) + '<br><br><button class="wf-btn" data-act="reload">もう一度読み込む</button></div>';
      return;
    }
    reindex();
    var items = visibleItems();
    // 存在しなくなった選択を外す
    S.sel.forEach(function (id) { if (!S.nodes.has(id)) S.sel.delete(id); });
    var selN = S.sel.size, inTrash = S.view === 'trash';
    var used = usedBytes(), quota = S.usage.quota, pct = Math.min(100, Math.round(used / quota * 1000) / 10);

    var h = '<div class="wf-toolbar" role="toolbar" aria-label="操作">';
    if (!inTrash) {
      h += '<button class="wf-btn is-primary" data-act="upload" title="ファイルを選んでアップロード">⬆ アップロード</button>' +
        '<button class="wf-btn" data-act="newfolder" title="新しいフォルダを作る（Ctrl+Shift+N）">📁 新しいフォルダ</button><span class="wf-sep"></span>' +
        '<button class="wf-btn" data-act="open"' + (selN === 1 ? '' : ' disabled') + '>📂 開く</button>' +
        '<button class="wf-btn" data-act="download"' + (selN && hasFile() ? '' : ' disabled') + '>⬇ ダウンロード</button>' +
        '<button class="wf-btn" data-act="rename"' + (selN === 1 ? '' : ' disabled') + ' title="名前の変更（F2）">✏ 名前の変更</button>' +
        '<button class="wf-btn" data-act="cut"' + (selN ? '' : ' disabled') + ' title="切り取り（Ctrl+X）">✂ 切り取り</button>' +
        '<button class="wf-btn" data-act="paste"' + (S.cut.length && S.view === 'files' ? '' : ' disabled') + ' title="貼り付け（Ctrl+V）">📋 貼り付け</button>' +
        '<button class="wf-btn is-danger" data-act="trash"' + (selN ? '' : ' disabled') + ' title="ゴミ箱へ（Delete）">🗑 ゴミ箱へ</button>';
    } else {
      h += '<button class="wf-btn" data-act="restore"' + (selN ? '' : ' disabled') + '>↩ 元に戻す</button>' +
        '<button class="wf-btn is-danger" data-act="purge"' + (selN ? '' : ' disabled') + '>❌ 完全に削除</button>' +
        '<button class="wf-btn is-danger" data-act="empty"' + (items.length ? '' : ' disabled') + '>🗑 ゴミ箱を空にする</button>';
    }
    h += '<span class="wf-sep"></span><button class="wf-btn" data-act="mode" title="表示の切り替え">' + (S.mode === 'list' ? '▦ アイコン' : '☰ 詳細') + '</button>' +
      '<input class="wf-search" id="wfSearch" type="search" placeholder="🔍 名前で検索" value="' + esc(S.q) + '" aria-label="名前で検索"></div>';

    // 使用量
    h += '<div class="wf-usage' + (pct >= 95 ? ' is-full' : pct >= 80 ? ' is-warn' : '') + '"><div class="wf-usage-bar"><i style="width:' + pct + '%"></i></div>' +
      '<span>使用量 ' + fmtSize(used) + ' / ' + fmtSize(quota) + '（' + pct + '%）</span></div>';

    // パンくず
    var crumbs = '';
    if (S.view === 'trash') crumbs = '<span class="wf-crumb is-last">🗑 ゴミ箱</span>';
    else if (S.view === 'search') crumbs = '<span class="wf-crumb is-last">🔍 「' + esc(S.q) + '」の検索結果</span>';
    else {
      crumbs = '<span class="wf-crumb' + (S.cwd ? '' : ' is-last') + '" data-crumb="" data-drop="root">📁 作業フォルダ</span>';
      pathOf(S.cwd).forEach(function (p, i, a) {
        crumbs += '<span class="wf-crumb-sep">›</span><span class="wf-crumb' + (i === a.length - 1 ? ' is-last' : '') + '" data-crumb="' + p.id + '" data-drop="' + p.id + '">' + esc(p.name) + '</span>';
      });
    }
    h += '<div class="wf-pathbar"><button class="wf-nav" data-act="back" title="戻る"' + (S.back.length ? '' : ' disabled') + '>←</button>' +
      '<button class="wf-nav" data-act="fwd" title="進む"' + (S.fwd.length ? '' : ' disabled') + '>→</button>' +
      '<button class="wf-nav" data-act="up" title="1つ上へ（Backspace）"' + (S.view === 'files' && S.cwd ? '' : ' disabled') + '>↑</button>' +
      '<div class="wf-crumbs">' + crumbs + '</div></div>';

    // 本体
    h += '<div class="wf-body"><aside class="wf-tree" aria-label="フォルダー">' + treeHtml() + '</aside>' +
      '<section class="wf-main" id="wfMain" tabindex="0" aria-label="ファイル一覧">' + listHtml(items) + '</section></div>';

    // 下の状態表示
    var selSize = 0; S.sel.forEach(function (id) { var n = S.nodes.get(id); if (n && n.kind === 'file') selSize += Number(n.size) || 0; });
    h += '<div class="wf-status"><span>' + items.length + ' 個の項目' + (selN ? '　／　' + selN + ' 個を選択' + (selSize ? '（' + fmtSize(selSize) + '）' : '') : '') + '</span>' +
      '<span>' + (S.cut.length ? '✂ ' + S.cut.length + ' 個を切り取り中　' : '') + 'ドラッグで移動／ファイルをドロップでアップロード／右クリックでメニュー</span></div>';

    // 入力中の検索欄を壊さないよう、検索欄にフォーカスがあるときは位置を保つ
    var hadFocus = document.activeElement && document.activeElement.id === 'wfSearch';
    var selStart = hadFocus ? document.activeElement.selectionStart : 0;
    var oldMain = $('wfMain'), oldTree = root.querySelector('.wf-tree');
    var keepMain = oldMain ? oldMain.scrollTop : 0, keepTree = oldTree ? oldTree.scrollTop : 0, keepKey = !!oldMain && document.activeElement === oldMain;
    root.innerHTML = h;
    var nm = $('wfMain'), nt = root.querySelector('.wf-tree');
    if (nm) { nm.scrollTop = keepMain; if (keepKey && !S.renaming && !hadFocus) nm.focus({ preventScroll: true }); }
    if (nt) nt.scrollTop = keepTree;
    if (hadFocus) { var si = $('wfSearch'); si.focus(); try { si.setSelectionRange(selStart, selStart); } catch (e) {} }
    if (S.renaming) {
      var ri = root.querySelector('.wf-rename');
      if (ri) { ri.focus(); var dot = ri.value.lastIndexOf('.'); var node = S.nodes.get(S.renaming); ri.setSelectionRange(0, (node && node.kind === 'file' && dot > 0) ? dot : ri.value.length); }
    }
    renderUploads();
  }
  function hasFile() { var f = false; S.sel.forEach(function (id) { var n = S.nodes.get(id); if (n && n.kind === 'file') f = true; }); return f; }

  function treeHtml() {
    var h = '<div class="wf-tnode' + (S.view === 'files' && !S.cwd ? ' is-cur' : '') + '" data-tree="" data-drop="root"><span class="wf-tcaret"></span><span class="wf-ico">📁</span><span class="wf-tlabel">作業フォルダ</span></div>';
    (function walk(pid, depth) {
      childrenOf(pid).filter(function (n) { return n.kind === 'folder' && !n.trashed_at; })
        .sort(function (a, b) { return collator().compare(a.name, b.name); })
        .forEach(function (f) {
          var has = childrenOf(f.id).some(function (n) { return n.kind === 'folder' && !n.trashed_at; });
          var open = S.expanded.has(f.id);
          h += '<div class="wf-tnode' + (S.view === 'files' && S.cwd === f.id ? ' is-cur' : '') + '" style="padding-left:' + (4 + depth * 14) + 'px" data-tree="' + f.id + '" data-drop="' + f.id + '">' +
            '<span class="wf-tcaret" data-caret="' + f.id + '">' + (has ? (open ? '▾' : '▸') : '') + '</span><span class="wf-ico">' + (open ? '📂' : '📁') + '</span><span class="wf-tlabel">' + esc(f.name) + '</span></div>';
          if (open) walk(f.id, depth + 1);
        });
    })(null, 1);
    var tn = 0; S.nodes.forEach(function (n) { if (n.trashed_at && !trashedAncestor(n)) tn++; });
    h += '<div class="wf-tsep"></div><div class="wf-tnode' + (S.view === 'trash' ? ' is-cur' : '') + '" data-tree="trash"><span class="wf-tcaret"></span><span class="wf-ico">🗑</span><span class="wf-tlabel">ゴミ箱' + (tn ? '（' + tn + '）' : '') + '</span></div>';
    return h;
  }

  function pendTag(n) { return n.upload_state === 'pending' ? ' <span class="wf-pend" title="アップロードが完了していません。削除してやり直してください">⚠ 未完了</span>' : ''; }
  function nameCell(n, grid) {
    if (S.renaming === n.id) return '<input class="wf-rename" data-rename="' + n.id + '" value="' + esc(n.name) + '" maxlength="255" aria-label="新しい名前">';
    return grid ? '<span class="wf-cname">' + esc(n.name) + pendTag(n) + '</span>' : '<b>' + esc(n.name) + '</b>' + pendTag(n);
  }
  function listHtml(items) {
    if (!items.length) {
      var msg = S.view === 'trash' ? 'ゴミ箱は空です。' : S.view === 'search' ? '見つかりませんでした。' : '<b>このフォルダは空です</b><br>ファイルをここへドラッグ＆ドロップするか、「⬆ アップロード」を押してください。<br>右クリックで「新しいフォルダ」も作れます。';
      return '<div class="wf-empty">' + msg + '</div>';
    }
    var h = '';
    if (S.mode === 'grid') {
      h += '<div class="wf-grid" role="listbox" aria-multiselectable="true">';
      items.forEach(function (n) {
        h += '<div class="wf-card' + (S.sel.has(n.id) ? ' is-sel' : '') + (S.cut.indexOf(n.id) >= 0 ? ' is-cut' : '') + '" role="option" aria-selected="' + S.sel.has(n.id) + '" draggable="' + (S.renaming === n.id ? 'false' : 'true') + '" data-id="' + n.id + '"' + (n.kind === 'folder' && S.view === 'files' ? ' data-drop="' + n.id + '"' : '') + ' title="' + esc(n.name) + '">' +
          '<span class="wf-ico">' + iconOf(n) + '</span>' + nameCell(n, true) + '</div>';
      });
      return h + '</div>';
    }
    var arrow = function (k) { return S.sort.key === k ? ' class="is-sorted" data-arrow="' + (S.sort.dir > 0 ? '▲' : '▼') + '"' : ''; };
    h += '<div class="wf-lhead" role="row"><span data-sort="name"' + arrow('name') + '>名前</span><span data-sort="date"' + arrow('date') + '>更新日時</span><span data-sort="type"' + arrow('type') + '>種類</span><span data-sort="size"' + arrow('size') + '>サイズ</span></div>';
    items.forEach(function (n) {
      var sub = '';
      if (S.view === 'search' || S.view === 'trash') {
        var p = pathOf(n.parent_id).map(function (x) { return x.name; }).join(' › ');
        sub = '<span class="wf-path">' + esc('作業フォルダ' + (p ? ' › ' + p : '')) + '</span>';
      }
      h += '<div class="wf-row' + (S.sel.has(n.id) ? ' is-sel' : '') + (S.cut.indexOf(n.id) >= 0 ? ' is-cut' : '') + '" role="row" aria-selected="' + S.sel.has(n.id) + '" draggable="' + (S.renaming === n.id ? 'false' : 'true') + '" data-id="' + n.id + '"' + (n.kind === 'folder' && S.view === 'files' ? ' data-drop="' + n.id + '"' : '') + '>' +
        '<span class="wf-name"><span class="wf-ico">' + iconOf(n) + '</span><span style="min-width:0">' + nameCell(n, false) + sub + '</span></span>' +
        '<span class="wf-dim">' + fmtDate(n.updated_at) + '</span><span class="wf-dim">' + typeOf(n) + '</span>' +
        '<span class="wf-dim">' + (n.kind === 'file' ? fmtSize(n.size) : '') + '</span></div>';
    });
    return h;
  }

  // ---------- 場所の移動 ----------
  function go(where, opts) {     // where: null＝いちばん上 / id / 'trash'
    opts = opts || {};
    if (S.renaming) S.renaming = null;
    var prev = { view: S.view, cwd: S.cwd };
    if (where === 'trash') { S.view = 'trash'; }
    else { S.view = 'files'; S.cwd = where || null; }
    S.q = ''; S.sel.clear(); S.anchor = null;
    if (!opts.history) { S.back.push(prev); if (S.back.length > 50) S.back.shift(); S.fwd = []; }
    if (S.view === 'files' && S.cwd) pathOf(S.cwd).slice(0, -1).forEach(function (p) { S.expanded.add(p.id); });
    render();
    var m = $('wfMain'); if (m) m.focus({ preventScroll: true });
  }
  function goBack() { var p = S.back.pop(); if (!p) return; S.fwd.push({ view: S.view, cwd: S.cwd }); S.view = p.view; S.cwd = p.cwd; S.sel.clear(); S.q = ''; render(); }
  function goFwd() { var p = S.fwd.pop(); if (!p) return; S.back.push({ view: S.view, cwd: S.cwd }); S.view = p.view; S.cwd = p.cwd; S.sel.clear(); S.q = ''; render(); }
  function goUp() { if (S.view !== 'files' || !S.cwd) return; var n = S.nodes.get(S.cwd); go(n ? n.parent_id : null); }

  function openNode(n) {
    if (!n) return;
    if (n.kind === 'folder') { if (S.view === 'trash') { toast('ゴミ箱の中のフォルダは、元に戻すと開けます', 'info'); return; } go(n.id); }
    else if (S.view === 'trash') toast('ゴミ箱の中のファイルは、元に戻すと開けます', 'info');
    else if (n.upload_state === 'pending') toast('アップロードが完了していないファイルです。削除してやり直してください', 'warn', 4000);
    else previewNode(n);
  }

  // ---------- 名前まわり ----------
  function siblingNames(pid, exceptId) {
    var set = new Set();
    childrenOf(pid).forEach(function (n) { if (!n.trashed_at && n.id !== exceptId) set.add(n.name.toLowerCase()); });
    return set;
  }
  function uniqueName(name, taken) {
    if (!taken.has(name.toLowerCase())) return name;
    var dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
    for (var i = 2; i < 10000; i++) { var c = base + ' (' + i + ')' + ext; if (!taken.has(c.toLowerCase())) return c; }
    return name + '-' + Date.now();
  }
  function validName(s) {
    s = String(s || '').normalize('NFC').trim();
    if (!s) return { err: '名前を入力してください' };
    if (s.length > 255) return { err: '名前が長すぎます（255 文字まで）' };
    if (/[\/\\]/.test(s)) return { err: '名前に / や \\ は使えません' };
    if (s === '.' || s === '..') return { err: 'この名前は使えません' };
    return { ok: s };
  }

  // ---------- 操作：フォルダ作成・名前変更 ----------
  async function newFolder(name, pid) {
    var c = client(); if (!c) return null;
    pid = pid === undefined ? S.cwd : pid;
    var nm = uniqueName(name || '新しいフォルダ', siblingNames(pid));
    var r = await c.from('wf_nodes').insert({ parent_id: pid, kind: 'folder', name: nm }).select().single();
    if (r.error) { toast('⚠️ フォルダを作れませんでした：' + dbErrMsg(r.error), 'warn', 5000); return null; }
    S.nodes.set(r.data.id, r.data); reindex();
    return r.data;
  }
  async function createFolderInline() {
    if (S.view !== 'files') go(S.cwd);
    var f = await newFolder('新しいフォルダ');
    if (!f) return;
    S.sel = new Set([f.id]); S.anchor = f.id; S.renaming = f.id;     // 作ってすぐ名前を打てる（エクスプローラーと同じ）
    if (S.cwd) S.expanded.add(S.cwd);
    render();
  }
  async function commitRename(id, value, silent) {
    var n = S.nodes.get(id); S.renaming = null;
    if (!n) { render(); return; }
    var v = validName(value);
    if (v.err) { toast('⚠️ ' + v.err, 'warn'); render(); return; }
    if (v.ok === n.name) { render(); return; }
    if (siblingNames(n.parent_id, n.id).has(v.ok.toLowerCase())) { toast('⚠️ 同じ名前がすでにあります', 'warn'); render(); return; }
    var c = client();
    var r = await c.from('wf_nodes').update({ name: v.ok }).eq('id', id).select().single();
    if (r.error) toast('⚠️ 名前を変更できませんでした：' + dbErrMsg(r.error), 'warn', 5000);
    else { S.nodes.set(id, r.data); if (!silent) toast('名前を変更しました', 'ok'); }
    render();
  }

  // ---------- 操作：移動・ゴミ箱・復元・完全削除 ----------
  async function moveNodes(ids, targetId) {      // targetId: null＝いちばん上
    var c = client(), moved = 0, skipped = [];
    ids = ids.filter(function (id) { return S.nodes.has(id); });
    for (var i = 0; i < ids.length; i++) {
      var n = S.nodes.get(ids[i]);
      if ((n.parent_id || null) === (targetId || null)) continue;
      if (targetId && (targetId === n.id || isDescendant(targetId, n.id))) { skipped.push(n.name + '（自分の中には移せません）'); continue; }
      if (siblingNames(targetId, n.id).has(n.name.toLowerCase())) { skipped.push(n.name + '（同じ名前があります）'); continue; }
      var r = await c.from('wf_nodes').update({ parent_id: targetId || null }).eq('id', n.id).select().single();
      if (r.error) skipped.push(n.name + '（' + dbErrMsg(r.error) + '）'); else { S.nodes.set(n.id, r.data); moved++; reindex(); }
    }
    if (targetId) S.expanded.add(targetId);
    S.sel.clear(); S.cut = [];
    if (moved) toast(moved + ' 個を移動しました', 'ok');
    if (skipped.length) toast('⚠️ 移動できなかった項目：' + skipped.slice(0, 3).join('、') + (skipped.length > 3 ? ' ほか' : ''), 'warn', 6000);
    render();
  }
  async function trashNodes(ids) {
    var c = client(), ts = new Date().toISOString(), n = 0;
    for (var i = 0; i < ids.length; i++) {
      var r = await c.from('wf_nodes').update({ trashed_at: ts }).eq('id', ids[i]).select().single();
      if (r.error) toast('⚠️ ゴミ箱へ移せませんでした：' + dbErrMsg(r.error), 'warn', 5000); else { S.nodes.set(ids[i], r.data); n++; }
    }
    S.sel.clear(); S.cut = [];
    if (n) toast(n + ' 個をゴミ箱へ移しました（ゴミ箱から元に戻せます）', 'ok');
    render();
  }
  async function restoreNodes(ids) {
    var c = client(), n = 0;
    for (var i = 0; i < ids.length; i++) {
      var node = S.nodes.get(ids[i]); if (!node) continue;
      var parent = node.parent_id && S.nodes.get(node.parent_id);
      var pid = node.parent_id;
      if (!parent || parent.trashed_at || trashedAncestor(node)) pid = null;       // 元の場所が無い／ゴミ箱の中なら、いちばん上へ戻す
      var nm = uniqueName(node.name, siblingNames(pid, node.id));
      var r = await c.from('wf_nodes').update({ trashed_at: null, parent_id: pid, name: nm }).eq('id', node.id).select().single();
      if (r.error) toast('⚠️ 元に戻せませんでした：' + dbErrMsg(r.error), 'warn', 5000); else { S.nodes.set(node.id, r.data); n++; reindex(); }
    }
    S.sel.clear();
    if (n) toast(n + ' 個を元に戻しました', 'ok');
    render();
  }
  async function purgeNodes(ids) {
    if (!ids.length) return;
    var files = 0; ids.forEach(function (id) { (function walk(x) { var nd = S.nodes.get(x); if (!nd) return; if (nd.kind === 'file') files++; else childrenOf(x).forEach(function (k) { walk(k.id); }); })(id); });
    var ok = await window.uiConfirm({
      title: '完全に削除しますか？', danger: true, okLabel: '完全に削除する',
      lines: ['選んだ ' + ids.length + ' 個の項目と、その中のファイル（計 ' + files + ' 個）を削除します。'],
      irreversible: 'この操作は取り消せません。管理者のドライブからも消えます。',
    });
    if (!ok) return;
    try {
      await purgeBackend(ids);
      ids.forEach(function (id) { (function drop(x) { childrenOf(x).slice().forEach(function (k) { drop(k.id); }); S.nodes.delete(x); })(id); });
      S.sel.clear(); toast('完全に削除しました', 'ok'); render();
    } catch (e) { toast('⚠️ 削除できませんでした：' + e.message, 'warn', 6000); }
  }
  // 置き場ごとの完全削除。どちらも「中身のファイルを先に消し、成功してから行を消す」（取り残しを防ぐ）
  async function purgeBackend(ids) {
    if (S.backend === 'drive') { await fnPost({ action: 'purge', ids: ids }); return; }
    var c = client();
    var t = await c.rpc('wf_my_tree', { p_ids: ids });
    if (t.error) throw mkErr('db', dbErrMsg(t.error));
    var paths = (t.data || []).map(function (r) { return r.storage_path; }).filter(Boolean);
    for (var i = 0; i < paths.length; i += 100) {
      var rm = await c.storage.from(BUCKET).remove(paths.slice(i, i + 100));
      if (rm.error) throw mkErr('storage', '保存領域からの削除に失敗しました：' + (rm.error.message || rm.error));
    }
    var del = await c.rpc('wf_my_delete', { p_ids: ids });
    if (del.error) throw mkErr('db', dbErrMsg(del.error));
  }
  function emptyTrash() {
    var ids = []; S.nodes.forEach(function (n) { if (n.trashed_at && !trashedAncestor(n)) ids.push(n.id); });
    purgeNodes(ids);
  }

  // ---------- ダウンロード・プレビュー ----------
  async function fetchBlob(n) {
    if (n.upload_state === 'pending') throw mkErr('pending', 'アップロードが完了していないファイルです（削除してやり直してください）');
    if (S.backend === 'storage') {
      var d = await client().storage.from(BUCKET).download(n.storage_path);
      if (d.error) throw mkErr('storage', 'ファイルを取得できませんでした：' + (d.error.message || d.error));
      return d.data;
    }
    var res = await fnPost({ action: 'download', id: n.id }, true);
    return res.blob();
  }
  async function downloadNodes(ids) {
    var files = ids.map(function (id) { return S.nodes.get(id); }).filter(function (n) { return n && n.kind === 'file' && n.upload_state !== 'pending'; });
    for (var i = 0; i < files.length; i++) {
      try {
        toast('⬇ ' + files[i].name + ' を取得しています…', 'info', 1800);
        var blob = await fetchBlob(files[i]);
        var url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = files[i].name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
      } catch (e) { toast('⚠️ ダウンロードできませんでした：' + e.message, 'warn', 6000); }
    }
  }
  async function previewNode(n) {
    var e = extOf(n.name), m = n.mime || '';
    var kind = (m.indexOf('image/') === 0 || /^(png|jpe?g|gif|webp|bmp|svg)$/.test(e)) ? 'img'
      : (m === 'application/pdf' || e === 'pdf') ? 'pdf'
      : (m.indexOf('text/') === 0 || /^(txt|md|csv|json|log|xml|html?)$/.test(e)) ? 'text' : null;
    if (!kind || Number(n.size) > PREVIEW_MAX) { downloadNodes([n.id]); return; }     // 見られない種類・大きいものは、そのままダウンロード
    var ov = document.createElement('div'); ov.className = 'wf-pv';
    ov.innerHTML = '<div class="wf-pv-box" role="dialog" aria-modal="true"><div class="wf-pv-head"><span>' + esc(n.name) + '</span><button class="wf-btn" data-pv="dl">⬇ ダウンロード</button><button class="wf-btn" data-pv="x" aria-label="閉じる">✕</button></div><div class="wf-pv-body">読み込み中…</div></div>';
    document.body.appendChild(ov);
    var url = null;
    function close() { document.removeEventListener('keydown', onKey, true); ov.remove(); if (url) URL.revokeObjectURL(url); }
    function onKey(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } }
    document.addEventListener('keydown', onKey, true);
    ov.addEventListener('click', function (ev) {
      if (ev.target === ov || (ev.target.dataset && ev.target.dataset.pv === 'x')) close();
      else if (ev.target.dataset && ev.target.dataset.pv === 'dl') downloadNodes([n.id]);
    });
    try {
      var blob = await fetchBlob(n), body = ov.querySelector('.wf-pv-body');
      if (!ov.isConnected) return;
      if (kind === 'text') { var t = await blob.text(); body.innerHTML = '<pre></pre>'; body.firstChild.textContent = t.length > 300000 ? t.slice(0, 300000) + '\n…（長いため途中まで）' : t; }
      else {
        url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: kind === 'pdf' ? 'application/pdf' : (m || 'image/*') }));
        body.innerHTML = kind === 'img' ? '<img alt="">' : '<iframe title="プレビュー"></iframe>';
        body.firstChild.src = url;
      }
    } catch (err) { var b = ov.querySelector('.wf-pv-body'); if (b) b.textContent = '⚠️ 読み込めませんでした：' + err.message; }
  }

  // ---------- アップロード ----------
  // 画面 → Edge Function（入口 URL を作ってもらう）→ ブラウザからドライブへ直接送る → Edge Function（登録・サイズ確認）
  function putFile(item, url) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('PUT', url);
      x.upload.onprogress = function (ev) { if (ev.lengthComputable) { item.loaded = ev.loaded; renderUploads(); } };
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) { try { resolve(JSON.parse(x.responseText)); } catch (e) { reject(new Error('ドライブからの応答が読み取れません')); } }
        else reject(new Error('ドライブへの送信に失敗しました（' + x.status + '）'));
      };
      x.onerror = function () { reject(new Error('ドライブへ送信できませんでした（通信エラー）')); };
      x.send(item.file);
    });
  }
  // Supabase の保存領域へ直接送る（進み具合を出すため XHR。supabase-js の upload と同じ形式＝FormData）
  async function putStorage(item, path, mime) {
    var h = await authHeaders();
    var url = String(window.CLOUD_CONFIG.url).replace(/\/$/, '') + '/storage/v1/object/' + BUCKET + '/' + path.split('/').map(encodeURIComponent).join('/');
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open('POST', url);
      x.setRequestHeader('Authorization', h.Authorization);
      x.setRequestHeader('apikey', h.apikey);
      x.setRequestHeader('x-upsert', 'false');                 // 上書きしない
      x.upload.onprogress = function (ev) { if (ev.lengthComputable) { item.loaded = ev.loaded; renderUploads(); } };
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) { resolve(); return; }
        var msg = ''; try { var j = JSON.parse(x.responseText); msg = j.message || j.error || ''; } catch (e) {}
        reject(new Error('保存領域への送信に失敗しました（' + x.status + (msg ? '：' + msg : '') + '）'));
      };
      x.onerror = function () { reject(new Error('保存領域へ送信できませんでした（通信エラー）')); };
      var fd = new FormData(); fd.append('cacheControl', '3600'); fd.append('', item.file, item.file.name);
      x.send(fd);
    });
  }
  // 予約（容量・名前・場所の確認）→ 送信 → 確定（実際の大きさの確認）。途中で失敗したら後始末をして行を消す
  async function uploadStorage(item) {
    var c = client(), mime = item.file.type || 'application/octet-stream';
    var rs = await c.rpc('wf_storage_reserve', { p_parent: item.parentId, p_name: item.name, p_size: item.file.size, p_mime: mime });
    if (rs.error) throw mkErr('db', dbErrMsg(rs.error));
    var node = rs.data;
    try {
      await putStorage(item, node.storage_path, mime);
      var fin = await c.rpc('wf_storage_finalize', { p_id: node.id });
      if (fin.error) throw mkErr('db', dbErrMsg(fin.error));
      return fin.data;
    } catch (e) {
      try { await c.storage.from(BUCKET).remove([node.storage_path]); } catch (e2) {}       // 先に中身を消し（行が残っているうちに）…
      try { await c.rpc('wf_storage_abort', { p_id: node.id }); } catch (e3) {}               // …そのあと予約の行を消す
      throw e;
    }
  }
  async function uploadOne(item) {
    item.status = 'run'; renderUploads();
    try {
      var mime = item.file.type || 'application/octet-stream';
      if (item.file.size > S.fileLimit) throw new Error('1 ファイルの上限（' + fmtSize(S.fileLimit) + '）を超えています');
      if (S.backend === 'storage') {
        var node = await uploadStorage(item);
        S.nodes.set(node.id, node); item.status = 'done'; item.loaded = item.file.size;
        if (S.ready && $('wfMain')) render(); else renderUploads();
        return;
      }
      var init = await fnPost({ action: 'init', parent_id: item.parentId, name: item.name, size: item.file.size, mime: mime });
      var done = await putFile(item, init.upload_url);
      var r = await fnPost({ action: 'complete', parent_id: item.parentId, name: item.name, drive_file_id: done.id, mime: mime });
      S.nodes.set(r.node.id, r.node); item.status = 'done'; item.loaded = item.file.size;
    } catch (e) { item.status = 'err'; item.msg = e.message; }
    if (S.ready && $('wfMain')) render(); else renderUploads();
  }
  var upRunning = 0;
  function pump() {
    while (upRunning < UP_PARALLEL) {
      var next = S.uploads.find(function (u) { return u.status === 'wait'; });
      if (!next) break;
      upRunning++; next.status = 'run';
      uploadOne(next).then(function () { upRunning--; pump(); });
    }
    renderUploads();
  }
  function enqueue(files, pid) {
    var reserved = {};     // 同じ場所に同時に入れるファイルの名前も先取りして、重ならないようにする
    var key = pid || 'root';
    reserved[key] = reserved[key] || siblingNames(pid);
    var skippedBig = 0;
    files.forEach(function (f) {
      var p = f.__pid === undefined ? pid : f.__pid, k = p || 'root';
      reserved[k] = reserved[k] || siblingNames(p);
      var nm = uniqueName(f.name, reserved[k]); reserved[k].add(nm.toLowerCase());
      S.uploads.push({ id: 'u' + Date.now() + Math.random().toString(36).slice(2, 6), file: f, name: nm, parentId: p || null, loaded: 0, status: 'wait', msg: '' });
    });
    if (skippedBig) toast('一部のファイルは大きすぎるため除きました', 'warn');
    pump();
  }
  function renderUploads() {
    var box = $('wfUploads'); if (!box) return;
    if (!S.uploads.length) { box.hidden = true; return; }
    var done = S.uploads.filter(function (u) { return u.status === 'done'; }).length, err = S.uploads.filter(function (u) { return u.status === 'err'; }).length;
    var h = '<div class="wf-up-head"><span>⬆ アップロード（' + done + ' / ' + S.uploads.length + (err ? '・失敗 ' + err : '') + '）</span><button data-act="upclose" aria-label="閉じる">✕</button></div>';
    S.uploads.forEach(function (u) {
      var pct = u.file.size ? Math.round(u.loaded / u.file.size * 100) : (u.status === 'done' ? 100 : 0);
      h += '<div class="wf-up-item' + (u.status === 'err' ? ' is-err' : '') + '"><div class="wf-up-name"><span>' + esc(u.name) + '</span><span>' +
        (u.status === 'wait' ? '待機中' : u.status === 'done' ? '✅' : u.status === 'err' ? '⚠️' : pct + '%') + '</span></div>' +
        '<div class="wf-up-bar"><i style="width:' + pct + '%"></i></div>' + (u.msg ? '<div class="wf-up-msg">' + esc(u.msg) + '</div>' : '') + '</div>';
    });
    box.innerHTML = h; box.hidden = false;
  }
  function pickFiles() {
    if (S.view !== 'files') go(S.cwd);
    var inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
    inp.onchange = function () { if (inp.files.length) enqueue(Array.prototype.slice.call(inp.files), S.cwd); };
    inp.click();
  }

  // OS からドロップされたもの（フォルダごとの場合は中身まで）を取り出す
  async function filesFromDrop(dt, pid) {
    var items = dt.items ? Array.prototype.slice.call(dt.items) : [];
    var entries = items.map(function (i) { return i.webkitGetAsEntry && i.webkitGetAsEntry(); }).filter(Boolean);
    if (!entries.length) return Array.prototype.slice.call(dt.files || []).map(function (f) { f.__pid = pid; return f; });
    var out = [];
    async function readAll(reader) {
      var all = [];
      for (;;) { var batch = await new Promise(function (res, rej) { reader.readEntries(res, rej); }); if (!batch.length) break; all = all.concat(batch); }
      return all;
    }
    async function walk(entry, parent) {
      if (entry.isFile) {
        var f = await new Promise(function (res, rej) { entry.file(res, rej); });
        f.__pid = parent; out.push(f);
      } else if (entry.isDirectory) {
        var existing = childrenOf(parent).find(function (n) { return n.kind === 'folder' && !n.trashed_at && n.name.toLowerCase() === entry.name.toLowerCase(); });
        var folder = existing || await newFolder(entry.name, parent);
        if (!folder) return;
        var kids = await readAll(entry.createReader());
        for (var i = 0; i < kids.length; i++) await walk(kids[i], folder.id);
      }
    }
    for (var i = 0; i < entries.length; i++) await walk(entries[i], pid);
    return out;
  }

  // ---------- 右クリックメニュー ----------
  function closeMenu() { var m = document.querySelector('.wf-menu'); if (m) m.remove(); }
  function showMenu(x, y, rows) {
    closeMenu();
    var m = document.createElement('div'); m.className = 'wf-menu'; m.setAttribute('role', 'menu');
    m.innerHTML = rows.map(function (r) {
      if (r === '-') return '<hr>';
      return '<button role="menuitem" data-act="' + r.act + '"' + (r.off ? ' disabled' : '') + (r.danger ? ' class="is-danger"' : '') + '><span>' + r.label + '</span>' + (r.key ? '<kbd>' + r.key + '</kbd>' : '') + '</button>';
    }).join('');
    document.body.appendChild(m);
    var w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 4)) + 'px';
    m.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 4)) + 'px';
    m.addEventListener('click', function (e) { var b = e.target.closest('button[data-act]'); if (b && !b.disabled) { closeMenu(); act(b.dataset.act); } });
  }
  function contextMenu(e, id) {
    e.preventDefault();
    if (id && !S.sel.has(id)) { S.sel = new Set([id]); S.anchor = id; render(); }
    var one = S.sel.size === 1, hasSel = S.sel.size > 0, rows;
    if (S.view === 'trash') rows = id ? [{ act: 'restore', label: '↩ 元に戻す' }, '-', { act: 'purge', label: '❌ 完全に削除', danger: true, key: 'Delete' }] : [{ act: 'empty', label: '🗑 ゴミ箱を空にする', danger: true }];
    else if (id) rows = [{ act: 'open', label: '📂 開く', off: !one, key: 'Enter' }, { act: 'download', label: '⬇ ダウンロード', off: !hasFile() }, '-',
      { act: 'cut', label: '✂ 切り取り', key: 'Ctrl+X' }, { act: 'rename', label: '✏ 名前の変更', off: !one, key: 'F2' }, '-', { act: 'trash', label: '🗑 ゴミ箱へ移動', danger: true, key: 'Del' }];
    else rows = [{ act: 'newfolder', label: '📁 新しいフォルダ', off: S.view === 'search' }, { act: 'upload', label: '⬆ アップロード', off: S.view === 'search' }, '-', { act: 'paste', label: '📋 貼り付け', off: !S.cut.length || S.view !== 'files', key: 'Ctrl+V' }, '-', { act: 'mode', label: '表示の切り替え' }];
    showMenu(e.clientX, e.clientY, rows);
  }

  // ---------- 操作の振り分け（ボタン・メニュー・キーボード共通） ----------
  function selIds() { return Array.from(S.sel); }
  function act(a) {
    var ids = selIds();
    switch (a) {
      case 'login': if (typeof window.cloudLogin === 'function') window.cloudLogin(); break;
      case 'reload': load(); break;
      case 'upload': pickFiles(); break;
      case 'newfolder': createFolderInline(); break;
      case 'open': if (ids.length === 1) openNode(S.nodes.get(ids[0])); break;
      case 'download': downloadNodes(ids); break;
      case 'rename': if (ids.length === 1) { S.renaming = ids[0]; render(); } break;
      case 'cut': S.cut = ids.slice(); toast('✂ ' + ids.length + ' 個を切り取りました（移動先で「貼り付け」）', 'info', 2200); render(); break;
      case 'paste': if (S.cut.length && S.view === 'files') moveNodes(S.cut.slice(), S.cwd); break;
      case 'trash': if (ids.length) trashNodes(ids); break;
      case 'restore': if (ids.length) restoreNodes(ids); break;
      case 'purge': purgeNodes(ids); break;
      case 'empty': emptyTrash(); break;
      case 'mode': S.mode = S.mode === 'list' ? 'grid' : 'list'; try { localStorage.setItem('wf.mode', S.mode); } catch (e) {} render(); break;
      case 'back': goBack(); break;
      case 'fwd': goFwd(); break;
      case 'up': goUp(); break;
      case 'upclose': S.uploads = S.uploads.filter(function (u) { return u.status === 'wait' || u.status === 'run'; }); renderUploads(); break;
    }
  }

  // ---------- 選択 ----------
  function select(id, ev) {
    var order = visibleItems().map(function (n) { return n.id; });
    if (ev && ev.shiftKey && S.anchor && order.indexOf(S.anchor) >= 0) {
      var a = order.indexOf(S.anchor), b = order.indexOf(id), lo = Math.min(a, b), hi = Math.max(a, b);
      S.sel = new Set(order.slice(lo, hi + 1));
    } else if (ev && (ev.ctrlKey || ev.metaKey)) {
      if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
      S.anchor = id;
    } else { S.sel = new Set([id]); S.anchor = id; }
    render();
  }
  function moveSel(delta, ev) {
    var order = visibleItems().map(function (n) { return n.id; }); if (!order.length) return;
    var cur = S.anchor && order.indexOf(S.anchor) >= 0 ? order.indexOf(S.anchor) : (delta > 0 ? -1 : order.length);
    var nx = Math.max(0, Math.min(order.length - 1, cur + delta));
    if (ev && ev.shiftKey) { var a = order.indexOf(S.sel.size ? S.anchor : order[nx]); S.sel = new Set(order.slice(Math.min(a, nx), Math.max(a, nx) + 1)); }
    else { S.sel = new Set([order[nx]]); S.anchor = order[nx]; }
    render();
    var el = document.querySelector('#wfMain [data-id="' + order[nx] + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }

  // ---------- イベント（ここで一括して受ける） ----------
  var wired = false;
  function wire() {
    if (wired) return; wired = true;
    var root = $('wfRoot');
    var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

    root.addEventListener('click', function (e) {
      closeMenu();
      var t = e.target;
      if (t.closest('.wf-rename')) return;
      var b = t.closest('[data-act]'); if (b && !b.disabled) { act(b.dataset.act); return; }
      var car = t.closest('[data-caret]');
      if (car) { var id = car.dataset.caret; if (S.expanded.has(id)) S.expanded.delete(id); else S.expanded.add(id); render(); return; }
      var tn = t.closest('[data-tree]'); if (tn) { go(tn.dataset.tree === '' ? null : tn.dataset.tree); return; }
      var cr = t.closest('[data-crumb]'); if (cr) { go(cr.dataset.crumb === '' ? null : cr.dataset.crumb); return; }
      var so = t.closest('[data-sort]');
      if (so) { var k = so.dataset.sort; S.sort = { key: k, dir: S.sort.key === k ? -S.sort.dir : 1 }; render(); return; }
      var it = t.closest('[data-id]');
      if (it) {
        var plain = !e.shiftKey && !e.ctrlKey && !e.metaKey;
        select(it.dataset.id, e);
        // ダブルクリック＝2 回目の click（e.detail===2）で開く。1 回目で画面を描き直すため、dblclick イベントは当てにしない
        if (plain && (e.detail === 2 || coarse)) openNode(S.nodes.get(it.dataset.id));    // スマホは 1 回タップで開く
        return;
      }
      if (t.closest('#wfMain') && S.sel.size) { S.sel.clear(); render(); }
    });
    root.addEventListener('contextmenu', function (e) {
      if (e.target.closest('.wf-rename') || e.target.closest('#wfSearch')) return;
      if (!e.target.closest('#wfMain')) return;
      var it = e.target.closest('[data-id]'); contextMenu(e, it ? it.dataset.id : null);
    });
    root.addEventListener('input', function (e) {
      if (e.target.id !== 'wfSearch') return;
      S.q = e.target.value.trim();
      if (S.q) { if (S.view !== 'search') S.prevView = { view: S.view, cwd: S.cwd }; S.view = 'search'; }
      else if (S.view === 'search') { var p = S.prevView || { view: 'files', cwd: null }; S.view = p.view; S.cwd = p.cwd; }
      S.sel.clear(); render();
    });
    root.addEventListener('keydown', function (e) {
      var t = e.target;
      if (t.classList && t.classList.contains('wf-rename')) {
        if (e.key === 'Enter') { e.preventDefault(); t.dataset.done = '1'; commitRename(t.dataset.rename, t.value); }
        else if (e.key === 'Escape') { e.preventDefault(); t.dataset.done = '1'; S.renaming = null; render(); }
        return;
      }
      if (t.id === 'wfSearch') { if (e.key === 'Escape') { t.value = ''; t.dispatchEvent(new Event('input', { bubbles: true })); } return; }
      var mod = e.ctrlKey || e.metaKey;
      if (e.key === 'F2' && S.sel.size === 1) { e.preventDefault(); act('rename'); }
      else if (e.key === 'Delete' || (e.key === 'Backspace' && mod)) { e.preventDefault(); act(S.view === 'trash' ? 'purge' : 'trash'); }
      else if (e.key === 'Enter' && S.sel.size === 1) { e.preventDefault(); act('open'); }
      else if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowUp')) { e.preventDefault(); goUp(); }
      else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
      else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goFwd(); }
      else if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); S.sel = new Set(visibleItems().map(function (n) { return n.id; })); render(); }
      else if (mod && e.key.toLowerCase() === 'x' && S.sel.size) { e.preventDefault(); act('cut'); }
      else if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); act('paste'); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); act('newfolder'); }
      else if (e.key === 'ArrowDown' || (S.mode === 'grid' && e.key === 'ArrowRight')) { e.preventDefault(); moveSel(1, e); }
      else if (e.key === 'ArrowUp' || (S.mode === 'grid' && e.key === 'ArrowLeft')) { e.preventDefault(); moveSel(-1, e); }
      else if (e.key === 'Escape') { if (S.sel.size || S.cut.length) { S.sel.clear(); S.cut = []; render(); } }
    });
    root.addEventListener('focusout', function (e) {      // 名前の入力欄から外れたら確定（Enter／Esc で済んだものは除く）
      var t = e.target;
      if (t.classList && t.classList.contains('wf-rename') && !t.dataset.done) { t.dataset.done = '1'; commitRename(t.dataset.rename, t.value); }
    });

    // ---- ドラッグ＆ドロップ（項目の移動／OS からのアップロード） ----
    function dropTarget(e) { var d = e.target.closest('[data-drop]'); return d ? (d.dataset.drop === 'root' ? null : d.dataset.drop) : undefined; }
    function clearDrop() { root.querySelectorAll('.is-drop').forEach(function (x) { x.classList.remove('is-drop'); }); var m = $('wfMain'); if (m) m.classList.remove('is-filedrop'); }
    root.addEventListener('dragstart', function (e) {
      var it = e.target.closest('[data-id]'); if (!it || S.view === 'trash') { e.preventDefault(); return; }
      if (!S.sel.has(it.dataset.id)) { S.sel = new Set([it.dataset.id]); S.anchor = it.dataset.id; }
      S.dragIds = selIds();
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', S.dragIds.length + ' 個の項目');
    });
    root.addEventListener('dragend', function () { S.dragIds = null; clearDrop(); render(); });
    root.addEventListener('dragover', function (e) {
      var isFiles = e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0;
      if (!S.dragIds && !isFiles) return;
      if (S.view === 'trash' || S.view === 'search') { if (isFiles) e.preventDefault(); return; }
      var tgt = dropTarget(e);
      e.preventDefault(); e.dataTransfer.dropEffect = isFiles ? 'copy' : 'move';
      root.querySelectorAll('.is-drop').forEach(function (x) { x.classList.remove('is-drop'); });
      if (tgt !== undefined) {
        var d = e.target.closest('[data-drop]');
        if (!S.dragIds || S.dragIds.indexOf(tgt) < 0) d.classList.add('is-drop');
      } else if (isFiles) { var m = $('wfMain'); if (m && m.contains(e.target)) m.classList.add('is-filedrop'); }
    });
    root.addEventListener('dragleave', function (e) { if (!root.contains(e.relatedTarget)) clearDrop(); });
    root.addEventListener('drop', async function (e) {
      var isFiles = e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0;
      if (!S.dragIds && !isFiles) return;
      e.preventDefault();
      var tgt = dropTarget(e); clearDrop();
      if (S.view === 'trash' || S.view === 'search') { S.dragIds = null; return; }
      var dest = tgt === undefined ? S.cwd : tgt;
      if (S.dragIds) { var ids = S.dragIds; S.dragIds = null; await moveNodes(ids, dest); return; }
      try { var files = await filesFromDrop(e.dataTransfer, dest); if (files.length) enqueue(files, dest); else render(); }
      catch (err) { toast('⚠️ ドロップを読み取れませんでした：' + err.message, 'warn', 5000); }
    });

    document.addEventListener('click', function (e) { if (!e.target.closest('.wf-menu')) closeMenu(); });
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('beforeunload', function (e) {
      if (S.uploads.some(function (u) { return u.status === 'run' || u.status === 'wait'; })) { e.preventDefault(); e.returnValue = ''; }
    });
    // ログイン／ログアウトで作り直す
    var c = client();
    if (c && c.auth && c.auth.onAuthStateChange) c.auth.onAuthStateChange(function (ev) {
      if (ev === 'INITIAL_SESSION' || ev === 'TOKEN_REFRESHED' || ev === 'USER_UPDATED') return;
      S.ready = false; S.nodes = new Map(); S.sel.clear(); S.cwd = null; S.view = 'files';
      var tab = $('tab-workfolder'); if (tab && tab.classList.contains('active')) setTimeout(load, 400);
    });
  }

  // ---------- 入口（switchTab から呼ばれる） ----------
  window.initWorkFolderTab = function () {
    var root = $('wfRoot'); if (!root) return;
    try { var m = localStorage.getItem('wf.mode'); if (m === 'grid' || m === 'list') S.mode = m; } catch (e) {}
    wire();
    if (!$('wfUploads')) { var u = document.createElement('div'); u.id = 'wfUploads'; u.className = 'wf-uploads'; u.hidden = true; u.addEventListener('click', function (e) { var b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); }); document.body.appendChild(u); }
    // ログインの確認が済んでいないことがあるので、少し待って 1 回だけ読む（以降はタブを開き直しても再利用）
    if (!S.ready || S.error) {
      var tries = 0;
      (function waitLogin() {
        if (email() || tries++ > 12) load(); else setTimeout(waitLogin, 250);
      })();
    } else render();
  };
  // テスト用（画面の確認で使う。通常の操作には影響しない）
  window.__wf = { S: S, render: render, load: load };
})();
