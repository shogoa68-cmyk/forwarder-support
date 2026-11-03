/* feedback.js — 不具合報告（常駐ボタン・スクショ/動画の添付・不具合報告ページ）
 *
 * 既存のフィードバック送信（js/quote/save.js の openFeedback / submitFeedback）に、次を足す：
 *   1. 画面に小さく常駐する「🐞」ボタン（どのタブでもすぐ報告できる）
 *   2. スクリーンショット（画面共有の1コマ／貼り付け／ドラッグ／ファイル選択）と
 *      画面録画（最大60秒）の添付。保存先は非公開バケット feedback-attachments（ログイン必須）
 *   3. 報告時の画面情報（開いていたタブ・表示サイズ・ブラウザ・直近のコンソールエラー）の自動添付
 *   4. 「🐞 不具合報告」ページ：報告の一覧・対応状況（未対応／対応中／解決済み／対応しない）・対応メモ
 *   5. 「📋 AI用にコピー」：一覧を Markdown にして Claude へ貼り付け（js/feedback-md.js）
 *
 * スキーマ：docs/sql/feedback-reports.sql（未適用でも従来どおりテキストの送信は動く）
 */
(function () {
  'use strict';

  const BUCKET   = 'feedback-attachments';
  const MAX_IMG  = 5;                    // 画像は1報告あたり5枚まで
  const MAX_VID  = 1;                    // 動画は1報告あたり1本まで
  const MAX_BYTES = 45 * 1024 * 1024;    // 1ファイル45MB（バケット上限50MBの手前）
  const REC_MAX_SEC = 60;                // 録画は最長60秒（容量対策）
  const IMG_MAX_W = 1920;

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t, ms) => (typeof window.quoteShowToast === 'function' ? window.quoteShowToast(m, t || 'info', ms) : console.log(m));
  const db = () => window.SupabaseClient || null;
  const me = () => (typeof window.cloudCurrentUser === 'function' ? window.cloudCurrentUser() : null);
  const nameOf = e => (typeof window.cloudNameFor === 'function' ? window.cloudNameFor(e) : String(e || '').split('@')[0]);

  // ================================================================
  // 1. 直近のコンソールエラーを控えておく（報告に自動で付ける）
  // ================================================================
  const _errs = [];
  function _pushErr(msg) {
    msg = String(msg || '').replace(/\s+/g, ' ').slice(0, 300);
    if (!msg) return;
    _errs.push(msg);
    if (_errs.length > 8) _errs.shift();
  }
  window.addEventListener('error', e => _pushErr((e.message || 'error') + (e.filename ? ' @' + String(e.filename).split('/').pop() + ':' + e.lineno : '')));
  window.addEventListener('unhandledrejection', e => _pushErr('unhandledrejection: ' + ((e.reason && (e.reason.message || e.reason)) || '')));
  (function wrapConsole() {
    const orig = console.error;
    console.error = function () {
      try { _pushErr(Array.prototype.slice.call(arguments).map(a => (a && a.message) || (typeof a === 'object' ? '' : String(a))).join(' ')); } catch (e) {}
      return orig.apply(console, arguments);
    };
  })();

  function _browser() {
    const ua = navigator.userAgent || '';
    const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'ブラウザ不明';
    const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
    return b + (os ? '/' + os : '');
  }
  function buildContext() {
    const tabEl = document.querySelector('.tab-content.active');
    const cls = (document.documentElement.className || '').split(/\s+/).filter(c => /^(theme|mode)-/.test(c)).join(' ');
    const ver = ((document.querySelector('script[src*="app.js"]') || {}).src || '').match(/[?&]v=([^&]+)/);
    return {
      tab: tabEl ? tabEl.id.replace(/^tab-/, '') : '',
      nav: ((document.querySelector('.cat-btn.active') || {}).textContent || '').trim().slice(0, 30),
      viewport: window.innerWidth + 'x' + window.innerHeight,
      browser: _browser(),
      theme: cls,
      ver: ver ? ver[1].slice(0, 12) : '',
      errors: _errs.slice(-5),
    };
  }

  // ================================================================
  // 2. 添付（スクリーンショット／動画）
  // ================================================================
  let _pending = [];     // { id, blob, name, type, size, kind, url }
  let _seq = 0;

  function _canCapture() { return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia); }
  function _loggedIn() { return !!me(); }
  function _fmtSize(n) { return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  function _overlay() { return $('fbOverlay'); }
  function _hideModal() { const o = _overlay(); if (o) o.classList.remove('open'); const f = $('fbQuickFab'); if (f) f.hidden = true; }
  function _showModal() { const o = _overlay(); if (o) o.classList.add('open'); const f = $('fbQuickFab'); if (f) f.hidden = false; }

  function renderAttachments() {
    const wrap = $('fbAttList');
    if (!wrap) return;
    wrap.innerHTML = _pending.map(a => {
      const th = a.kind === 'video'
        ? '<video src="' + a.url + '" muted preload="metadata" class="fb-att-thumb"></video>'
        : '<img src="' + a.url + '" alt="" class="fb-att-thumb">';
      return '<div class="fb-att-item" data-id="' + a.id + '">' + th +
        '<div class="fb-att-info"><span class="fb-att-name">' + (a.kind === 'video' ? '🎥 ' : '🖼 ') + esc(a.name) + (a.ops && a.ops.length ? ' <em class="fb-att-marked">書き込み済み</em>' : '') + '</span>' +
        '<span class="fb-att-size">' + _fmtSize(a.size) + '</span></div>' +
        (a.kind === 'image' && window.FeedbackAnnotate ? '<button type="button" class="fb-att-edit" onclick="fbAnnotate(' + a.id + ')" title="矢印・丸・文字などを書き込む">✏️ 書き込む</button>' : '') +
        '<button type="button" class="fb-att-del" onclick="fbRemoveAtt(' + a.id + ')" title="この添付を外す" aria-label="添付を外す">✕</button></div>';
    }).join('');
  }

  function refreshAttachAvailability() {
    const ok = _loggedIn();
    const cap = _canCapture();
    ['fbBtnShot', 'fbBtnRec'].forEach(id => { const b = $(id); if (b) { b.hidden = !cap; b.disabled = !ok; } });
    const pick = $('fbBtnPick'); if (pick) pick.classList.toggle('is-disabled', !ok);
    const inp = $('fbFileInput'); if (inp) inp.disabled = !ok;
    const hint = $('fbAttHint');
    if (hint) {
      hint.textContent = !ok
        ? '🔒 スクリーンショット・動画の添付は、Google でログインすると使えます（画面に顧客名などが写るため、ログインしたメンバーだけに限定しています）'
        : cap
          ? '画像は貼り付け（Ctrl+V）やドラッグ＆ドロップでも追加できます。録画は最長 ' + REC_MAX_SEC + ' 秒です'
          : 'この端末では画面の撮影・録画ができません。端末の機能で撮影し、「ファイルを選ぶ」から添付してください';
      hint.classList.toggle('is-warn', !ok);
    }
  }

  function _compressToJpeg(blobOrFile) {
    return new Promise(resolve => {
      const url = URL.createObjectURL(blobOrFile);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, IMG_MAX_W / img.width);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => resolve(b || blobOrFile), 'image/jpeg', 0.86);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(blobOrFile); };
      img.src = url;
    });
  }

  async function addBlob(blob, name) {
    if (!_loggedIn()) { toast('🔒 添付するには Google でログインしてください', 'warn', 4500); return false; }
    const isVideo = (blob.type || '').startsWith('video/');
    const isImage = (blob.type || '').startsWith('image/');
    if (!isVideo && !isImage) { toast('⚠️ 画像か動画のみ添付できます', 'warn'); return false; }
    if (isVideo && _pending.filter(a => a.kind === 'video').length >= MAX_VID) { toast('⚠️ 動画は1本までです（外してから追加してください）', 'warn', 4500); return false; }
    if (isImage && _pending.filter(a => a.kind === 'image').length >= MAX_IMG) { toast('⚠️ 画像は' + MAX_IMG + '枚までです', 'warn', 4500); return false; }
    let out = blob;
    if (isImage && blob.type !== 'image/gif') out = await _compressToJpeg(blob);
    if (out.size > MAX_BYTES) { toast('⚠️ ファイルが大きすぎます（' + _fmtSize(out.size) + '／上限 ' + _fmtSize(MAX_BYTES) + '）。録画は短めにしてください', 'warn', 6000); return false; }
    const ext = isVideo ? ((out.type || '').includes('mp4') ? 'mp4' : (out.type || '').includes('quicktime') ? 'mov' : 'webm') : (out.type === 'image/gif' ? 'gif' : 'jpg');
    const base = (name || (isVideo ? 'rec' : 'shot')).replace(/\.[^.]+$/, '').replace(/[^\w\-]/g, '_').slice(0, 40) || 'file';
    const att = { id: ++_seq, blob: out, name: base + '.' + ext, type: out.type || (isVideo ? 'video/webm' : 'image/jpeg'), size: out.size, kind: isVideo ? 'video' : 'image', url: URL.createObjectURL(out), orig: null, ops: null };
    _pending.push(att);
    renderAttachments();
    return att.id;
  }

  // 書き込みエディタを開く。結果は元画像を残したまま差し替える（開き直せば前の書き込みから続きを編集できる）
  async function fbAnnotate(id) {
    const a = _pending.find(x => x.id === id);
    if (!a || a.kind !== 'image' || !window.FeedbackAnnotate) return;
    const src = a.orig || a.blob;
    const res = await window.FeedbackAnnotate.open(src, a.ops || []);
    if (!res || res.unchanged) return;
    a.orig = src;
    a.ops = res.ops;
    try { URL.revokeObjectURL(a.url); } catch (e) {}
    a.blob = res.blob; a.type = 'image/jpeg'; a.size = res.blob.size;
    a.url = URL.createObjectURL(res.blob);
    renderAttachments();
  }
  async function addFiles(files) {
    for (const f of Array.from(files || [])) { await addBlob(f, f.name); }
  }

  function fbRemoveAtt(id) {
    const i = _pending.findIndex(a => a.id === id);
    if (i < 0) return;
    try { URL.revokeObjectURL(_pending[i].url); } catch (e) {}
    _pending.splice(i, 1);
    renderAttachments();
  }
  function fbResetAttachments() {
    _pending.forEach(a => { try { URL.revokeObjectURL(a.url); } catch (e) {} });
    _pending = [];
    renderAttachments();
  }
  function fbOnFilesPicked(input) {
    const files = input && input.files ? input.files : [];
    addFiles(files).then(() => { try { input.value = ''; } catch (e) {} });
  }

  // 画面共有の選択ダイアログ → 1コマだけ取り出す。モーダルは一時的に閉じて、問題の画面が写るようにする
  async function fbCaptureScreenshot() {
    if (!_canCapture()) { toast('⚠️ この端末では画面の撮影ができません。「ファイルを選ぶ」から添付してください', 'warn', 5000); return; }
    if (!_loggedIn()) { toast('🔒 添付するには Google でログインしてください', 'warn'); return; }
    _hideModal();
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false, preferCurrentTab: true });
      const v = document.createElement('video');
      v.srcObject = stream; v.muted = true; v.playsInline = true;
      await v.play();
      await new Promise(r => setTimeout(r, 450));            // 共有ダイアログが消えてから撮る
      const c = document.createElement('canvas');
      c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      stream.getTracks().forEach(t => t.stop()); stream = null;
      _showModal();
      if (blob) { const id = await addBlob(blob, 'screenshot'); if (id) fbAnnotate(id); }   // 撮ったらすぐ書き込める（そのまま「完了」で書き込みなしも可）
    } catch (e) {
      if (stream) stream.getTracks().forEach(t => t.stop());
      _showModal();
      if (e && e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast('⚠️ 画面を撮影できませんでした：' + (e.message || e), 'warn', 5000);
    }
  }

  // 画面録画（MediaRecorder）。録画中は小さなバーを出し、止めるとモーダルに戻る
  let _rec = null, _recTimer = null, _recBar = null, _recStarting = false;
  function _pickMime() {
    const list = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    return list.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
  }
  async function fbRecordStart() {
    if (!_canCapture() || !window.MediaRecorder) { toast('⚠️ この端末では画面の録画ができません。端末の画面収録で撮影し、「ファイルを選ぶ」から添付してください', 'warn', 6000); return; }
    if (!_loggedIn()) { toast('🔒 添付するには Google でログインしてください', 'warn'); return; }
    if (_pending.some(a => a.kind === 'video')) { toast('⚠️ 動画は1本までです（外してから録画してください）', 'warn', 4500); return; }
    if (_rec || _recBar || _recStarting) return;   // 録画中・開始待ちの二重起動を防ぐ（タイマーや画面共有が残るため）
    _recStarting = true;
    _hideModal();
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false, preferCurrentTab: true });
    } catch (e) {
      _recStarting = false;
      _showModal();
      if (e && e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast('⚠️ 録画を開始できませんでした：' + (e.message || e), 'warn', 5000);
      return;
    }
    _recStarting = false;
    const mime = _pickMime();
    const chunks = [];
    try { _rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 1500000 } : { videoBitsPerSecond: 1500000 }); }
    catch (e) { stream.getTracks().forEach(t => t.stop()); _showModal(); toast('⚠️ 録画を開始できませんでした', 'warn'); return; }
    _rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    _rec.onstop = async () => {
      clearInterval(_recTimer); _recTimer = null;
      if (_recBar) { _recBar.remove(); _recBar = null; }
      stream.getTracks().forEach(t => t.stop());
      const blob = new Blob(chunks, { type: (_rec && _rec.mimeType) || mime || 'video/webm' });
      _rec = null;
      _showModal();
      if (blob.size) await addBlob(blob, 'rec');
    };
    // ブラウザ側の「共有を停止」ボタンでも止まる
    stream.getVideoTracks()[0].addEventListener('ended', () => { if (_rec && _rec.state !== 'inactive') _rec.stop(); });
    _rec.start(1000);
    let sec = 0;
    _recBar = document.createElement('div');
    _recBar.className = 'fb-rec-bar';
    _recBar.innerHTML = '<span class="fb-rec-dot"></span><span id="fbRecTime">録画中 0:00</span><button type="button" class="fb-rec-stop" id="fbRecStop">■ 止める</button>';
    document.body.appendChild(_recBar);
    $('fbRecStop').onclick = () => { if (_rec && _rec.state !== 'inactive') _rec.stop(); };
    _recTimer = setInterval(() => {
      sec++;
      const t = $('fbRecTime'); if (t) t.textContent = '録画中 ' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0') + ' / ' + REC_MAX_SEC + '秒';
      if (sec >= REC_MAX_SEC && _rec && _rec.state !== 'inactive') _rec.stop();
    }, 1000);
  }

  // 貼り付け・ドラッグ＆ドロップ（モーダル内）
  document.addEventListener('paste', e => {
    const o = _overlay();
    if (!o || !o.classList.contains('open')) return;
    const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'));
    if (!files.length) return;
    e.preventDefault();
    addFiles(files);
  });
  document.addEventListener('dragover', e => { const o = _overlay(); if (o && o.classList.contains('open') && e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) e.preventDefault(); });
  document.addEventListener('drop', e => {
    const o = _overlay();
    if (!o || !o.classList.contains('open')) return;
    if (!(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length)) return;
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  });

  // ================================================================
  // 3. 送信時の追加項目（save.js の submitFeedback から呼ばれる）
  // ================================================================
  async function fbBuildExtra() {
    const u = me();
    const extra = { page_url: String(location.href).slice(0, 500), context: buildContext() };
    const title = ($('fbTitle') || {}).value;
    if (title && title.trim()) extra.title = title.trim().slice(0, 120);
    if (u && u.email) extra.reporter_email = u.email;
    if (!_pending.length) return extra;
    if (!u) throw new Error('添付にはログインが必要です。添付を外すか、ログインしてください');
    const client = db();
    if (!client) throw new Error('データベース接続が初期化されていません');
    const { data: { session } } = await client.auth.getSession();
    const uid = (session && session.user && session.user.id) || 'unknown';
    const done = [];
    const btn = $('fbSubmitBtn');
    try {
      for (let i = 0; i < _pending.length; i++) {
        const a = _pending[i];
        if (btn) btn.textContent = 'アップロード中 ' + (i + 1) + '/' + _pending.length + '…';
        const path = uid + '/' + Date.now() + '_' + i + '_' + a.name;
        const { error } = await client.storage.from(BUCKET).upload(path, a.blob, { contentType: a.type, upsert: false });
        if (error) throw error;
        done.push({ path, name: a.name, type: a.type, size: a.size, kind: a.kind });
      }
    } catch (err) {
      if (done.length) { try { await client.storage.from(BUCKET).remove(done.map(d => d.path)); } catch (e) {} }
      const m = String((err && err.message) || err);
      throw new Error(/bucket not found/i.test(m) ? '添付の保存先が未設定です（管理者へ：docs/sql/feedback-reports.sql を実行してください）' : '添付のアップロードに失敗しました：' + m);
    }
    extra.attachments = done;
    return extra;
  }
  // 新しい列が未作成（SQL 未適用）のときは、テキストのみで送り直すための判定
  function fbIsMissingColumn(err) {
    const m = String((err && (err.message || err.details)) || '');
    return (err && (err.code === 'PGRST204' || err.code === '42703')) || /column .* (does not exist|of relation)|could not find the .* column|schema cache/i.test(m);
  }
  function fbAfterSubmit() {
    fbResetAttachments();
    if ($('fbTitle')) $('fbTitle').value = '';
    if ($('tab-bugreports') && $('tab-bugreports').classList.contains('active')) loadReports();
  }
  function fbOnOpen() {
    fbResetAttachments();
    if ($('fbTitle')) $('fbTitle').value = '';
    refreshAttachAvailability();
  }

  // 常駐ボタン／ページの「報告する」から：バグ報告を選んだ状態で開く
  function fbOpenQuick() {
    if (typeof window.openFeedback !== 'function') return;
    window.openFeedback('全体');
    const secSel = $('fbSection'); if (secSel) secSel.value = 'わからない';     // 該当セクションは任意（開いていた画面は自動で記録される）
    const r = document.querySelector('#fbForm input[name="fbCategory"][value="バグ報告"]');
    if (r) { r.checked = true; const lab = r.closest('.fb-radio'); if (lab) { document.querySelectorAll('#fbForm .fb-radio').forEach(x => x.classList.remove('checked')); lab.classList.add('checked'); } }
    refreshAttachAvailability();
  }

  // ================================================================
  // 4. 不具合報告ページ
  // ================================================================
  const ST = (window.FeedbackMd && window.FeedbackMd.ST_LABEL) || { open: '未対応', need_info: '確認待ち', in_progress: '対応中', resolved: '解決済み', wontfix: '対応しない' };
  const ST_KEYS = ['open', 'need_info', 'in_progress', 'resolved', 'wontfix'];
  const KIND_LABEL = { question: '❓ 質問', answer: '↩ 返信', comment: '💬 コメント' };
  const CAT = { 'バグ報告': '🐛', '改善要望': '💡', '質問': '❓', 'その他': '📌' };
  const fmt = iso => (window.FeedbackMd ? window.FeedbackMd.fmtDate(iso) : String(iso || ''));

  let _rows = [];
  let _flt = { status: 'open+', cat: '', mine: false, q: '' };    // 'open+' = 未対応＋確認待ち＋対応中
  let _comments = {};    // 報告id → コメント配列（開いたときに読む）
  let _open = new Set();
  let _loaded = false;

  // チームメンバーか（ロールが取れていればそれで、取れなければ「他人の報告が見えている＝メンバー」で判定）
  function _isStaff() { return !!window._myRole || _rows.some(r => !_isMine(r)); }
  function _secLabel(r) {
    const ctx = r.context || {};
    if (!r.section || r.section === 'わからない') return ctx.nav ? '画面: ' + ctx.nav : '場所の指定なし';
    return r.section;
  }
  function _isMine(r) { const u = me(); return !!u && (r.user_id === u.id || (r.reporter_email && r.reporter_email === u.email)); }
  function _noOf(r) { return r.report_no != null ? '#' + r.report_no : '#' + String(r.id).slice(0, 6); }
  function _titleOf(r) { const t = r.title || String(r.body || '').split('\n')[0]; return t.length > 70 ? t.slice(0, 70) + '…' : t; }

  async function loadReports() {
    const list = $('fbrList');
    if (!list) return;
    if (!_loaded) list.innerHTML = '<p class="fbr-empty">読み込み中…</p>';
    const client = db();
    if (!client) { list.innerHTML = '<p class="fbr-empty">⚠️ データベース接続が初期化されていません</p>'; return; }
    const { data, error } = await client.from('feedbacks').select('*').order('created_at', { ascending: false }).limit(500);
    if (error) { list.innerHTML = '<p class="fbr-empty">⚠️ 読み込みエラー：' + esc(error.message) + '</p>'; return; }
    _rows = data || [];
    _loaded = true;
    renderReports();
  }

  function _filtered(ignoreStatus) {
    const q = _flt.q.trim().toLowerCase();
    return _rows.filter(r => {
      if (_flt.cat && r.category !== _flt.cat) return false;
      if (_flt.mine && !_isMine(r)) return false;
      if (q && !((r.title || '') + ' ' + (r.body || '') + ' ' + (r.section || '') + ' ' + (r.response || '')).toLowerCase().includes(q)) return false;
      if (!ignoreStatus) {
        const st = r.status || 'open';
        if (_flt.status === 'open+') { if (st !== 'open' && st !== 'need_info' && st !== 'in_progress') return false; }
        else if (_flt.status && st !== _flt.status) return false;
      }
      return true;
    });
  }

  function renderReports() {
    const chips = $('fbrChips');
    const list = $('fbrList');
    if (!list) return;
    const base = _filtered(true);
    const cnt = {}; base.forEach(r => { const k = r.status || 'open'; cnt[k] = (cnt[k] || 0) + 1; });
    const open2 = (cnt.open || 0) + (cnt.need_info || 0) + (cnt.in_progress || 0);
    const defs = [['open+', 'これから対応（' + open2 + '）'], ['', 'すべて（' + base.length + '）']]
      .concat(ST_KEYS.map(k => [k, ST[k] + '（' + (cnt[k] || 0) + '）']));
    if (chips) {
      chips.innerHTML = defs.map(d => '<button type="button" class="fbr-chip' + (_flt.status === d[0] ? ' is-on' : '') + '" data-st="' + d[0] + '">' + esc(d[1]) + '</button>').join('');
    }
    renderBanner();
    const rows = _filtered(false);
    if (!me()) {
      list.innerHTML = '<p class="fbr-empty">🔒 ログインすると、チームの不具合報告と対応状況を確認できます。右上の「Google でログイン」からどうぞ。<br>ログインしなくても「＋ 不具合を報告する」から報告はできます。</p>';
      return;
    }
    if (!rows.length) { list.innerHTML = '<p class="fbr-empty">該当する報告はありません</p>'; return; }
    list.innerHTML = rows.map(cardHtml).join('');
    rows.forEach(r => { if (_open.has(r.id)) _fillDetail(r.id); });
  }

  // 「あなたの報告に質問が届いています」の案内（報告者本人にだけ出る）
  function renderBanner() {
    const el = $('fbrBanner');
    if (!el) return;
    const n = me() ? _rows.filter(r => r.status === 'need_info' && _isMine(r)).length : 0;
    el.hidden = !n;
    el.innerHTML = n ? '<span>💬 あなたの報告 <b>' + n + '</b> 件に、確認の質問が届いています。</span><button type="button" class="fbr-btn fbr-btn-primary" data-act="banner">質問を見て返信する</button>' : '';
  }

  function cardHtml(r) {
    const st = r.status || 'open';
    const attN = Array.isArray(r.attachments) ? r.attachments.length : 0;
    const opened = _open.has(r.id);
    return '<article class="fbr-card fbr-st-' + st + (opened ? ' is-open' : '') + '" data-id="' + esc(r.id) + '">' +
      '<div class="fbr-card-head" data-act="toggle" tabindex="0" role="button" aria-expanded="' + opened + '">' +
        '<span class="fbr-no">' + esc(_noOf(r)) + '</span>' +
        '<span class="fbr-status fbr-badge-' + st + '">' + esc(ST[st] || st) + '</span>' +
        (st === 'need_info' && _isMine(r) ? '<span class="fbr-ask">あなたへの質問</span>' : '') +
        '<span class="fbr-ttl">' + (CAT[r.category] || '📌') + ' ' + esc(_titleOf(r)) + '</span>' +
        '<span class="fbr-meta">📍' + esc(_secLabel(r)) + ' ・ ' + esc(r.reporter_email ? nameOf(r.reporter_email) : '匿名') + ' ・ ' + esc(fmt(r.created_at)) +
          (attN ? ' ・ 📎' + attN : '') + (r.response ? ' ・ 💬対応メモあり' : '') + '</span>' +
      '</div>' +
      '<div class="fbr-card-body"' + (opened ? '' : ' hidden') + '></div>' +
    '</article>';
  }

  function _fillDetail(id) {
    const r = _rows.find(x => x.id === id);
    const card = document.querySelector('.fbr-card[data-id="' + CSS.escape(id) + '"]');
    if (!r || !card) return;
    const body = card.querySelector('.fbr-card-body');
    if (!body || body.dataset.filled === '1') return;
    body.dataset.filled = '1';
    const ctx = r.context || {};
    const ctxLine = [ctx.nav && ('画面: ' + ctx.nav), ctx.tab && ('タブ: ' + ctx.tab), ctx.viewport && ('表示: ' + ctx.viewport), ctx.browser, ctx.theme && ('テーマ: ' + ctx.theme), ctx.ver && ('版: ' + ctx.ver)].filter(Boolean).join(' ／ ');
    const errs = Array.isArray(ctx.errors) && ctx.errors.length
      ? '<details class="fbr-ctx"><summary>コンソールエラー（直近 ' + ctx.errors.length + ' 件）</summary><pre>' + esc(ctx.errors.join('\n')) + '</pre></details>' : '';
    const opts = ST_KEYS.map(k => '<option value="' + k + '"' + ((r.status || 'open') === k ? ' selected' : '') + '>' + esc(ST[k]) + '</option>').join('');
    const respTtl = '<div class="fbr-resp-ttl">💬 対応状況・メモ' + (r.responded_at ? '<small>（' + esc(r.responded_by ? nameOf(r.responded_by) : '') + ' ' + esc(fmt(r.responded_at)) + '）</small>' : '') + '</div>';
    const resp = _isStaff()
      ? '<div class="fbr-resp">' + respTtl +
          '<div class="fbr-resp-row"><select data-fld="status" class="fbr-sel">' + opts + '</select>' +
          '<button type="button" class="fbr-btn fbr-btn-primary" data-act="save">保存</button></div>' +
          '<textarea data-fld="response" class="fbr-ta" rows="3" placeholder="対応の状況や、直した内容・今後の予定など（報告者とチーム全員に表示されます）">' + esc(r.response || '') + '</textarea>' +
        '</div>'
      : '<div class="fbr-resp">' + respTtl + '<div class="fbr-text">' + (r.response ? esc(r.response) : '<span class="fbr-dim">まだ対応メモはありません</span>') + '</div></div>';
    body.innerHTML =
      '<div class="fbr-text">' + esc(r.body || '') + '</div>' +
      '<div class="fbr-atts" data-atts></div>' +
      (ctxLine ? '<div class="fbr-ctxline">🧭 ' + esc(ctxLine) + '</div>' : '') + errs +
      '<div class="fbr-thread" data-thread></div>' +
      resp;
    _loadAtts(r, body.querySelector('[data-atts]'));
    _loadThread(r, body.querySelector('[data-thread]'));
  }

  // ---------- やりとり（管理者→報告者の質問・報告者の返信・コメント） ----------
  async function _loadThread(r, box) {
    if (!box) return;
    box.innerHTML = '<div class="fbr-thread-ttl">💬 やりとり</div><span class="fbr-dim">読み込み中…</span>';
    try {
      const { data, error } = await db().from('feedback_comments').select('*').eq('feedback_id', r.id).order('created_at', { ascending: true });
      if (error) throw error;
      _comments[r.id] = data || [];
      _renderThread(r, box);
    } catch (e) { box.innerHTML = ''; box.dataset.off = '1'; }     // SQL 未適用など：やりとり欄は出さない（報告本文・対応メモは使える）
  }
  function _renderThread(r, box) {
    const list = _comments[r.id] || [];
    const mine = _isMine(r), staff = _isStaff(), waiting = r.status === 'need_info';
    const items = list.map(c =>
      '<div class="fbr-cm fbr-cm-' + esc(c.kind) + '"><div class="fbr-cm-head"><b>' + esc(nameOf(c.author_email || '')) + '</b>' +
      '<span class="fbr-cm-kind">' + esc(KIND_LABEL[c.kind] || '💬') + '</span><small>' + esc(fmt(c.created_at)) + '</small></div>' +
      '<div class="fbr-cm-body">' + esc(c.body) + '</div></div>').join('');
    const callout = (waiting && mine)
      ? '<div class="fbr-callout">💬 確認のための質問が届いています。下の欄に返信してください（返信すると「未対応」に戻り、担当者に伝わります）。</div>'
      : (waiting ? '<div class="fbr-callout fbr-callout-wait">⏳ 報告者への質問を送り、返信待ちです。</div>' : '');
    const canQuestion = staff && !mine;
    const noReply = canQuestion && !r.user_id;
    const btns =
      (mine && waiting ? '<button type="button" class="fbr-btn fbr-btn-primary" data-act="post" data-kind="answer">↩ 返信する</button>' : '') +
      (canQuestion ? '<button type="button" class="fbr-btn fbr-btn-primary" data-act="post" data-kind="question"' + (noReply ? ' disabled title="ログインせずに報告されたため、返信を受け取れません"' : '') + '>❓ 報告者に質問する</button>' : '') +
      '<button type="button" class="fbr-btn" data-act="post" data-kind="comment">💬 コメントする</button>';
    box.innerHTML = '<div class="fbr-thread-ttl">💬 やりとり</div>' + callout +
      (items || '<div class="fbr-dim fbr-thread-empty">まだやりとりはありません</div>') +
      '<textarea data-fld="comment" class="fbr-ta" rows="2" placeholder="' + (canQuestion ? 'わからない点があれば、ここに質問を書いて「報告者に質問する」を押してください（報告者に通知バッジが出ます）' : 'コメントを書く') + '"></textarea>' +
      (noReply ? '<div class="fbr-dim">※ この報告はログインせずに送られたため、質問しても返信は受け取れません（コメントは残せます）</div>' : '') +
      '<div class="fbr-composer-btns">' + btns + '</div>';
  }
  async function _postComment(card, kind) {
    const id = card.dataset.id;
    const r = _rows.find(x => x.id === id);
    const u = me();
    if (!r || !u) { toast('🔒 ログインしてください', 'warn'); return; }
    const ta = card.querySelector('[data-fld="comment"]');
    const text = (ta.value || '').trim();
    if (!text) { toast('内容を入力してください', 'warn', 2500); ta.focus(); return; }
    const btns = card.querySelectorAll('.fbr-composer-btns button'); btns.forEach(b => b.disabled = true);
    const client = db();
    const { error } = await client.from('feedback_comments').insert({ feedback_id: id, kind, body: text, author_id: u.id, author_email: u.email });
    if (error) {
      btns.forEach(b => b.disabled = false);
      toast('⚠️ 送信できませんでした：' + error.message, 'warn', 6000);
      return;
    }
    // トリガーで状態が変わる（質問→確認待ち／返信→未対応）ので取り直す
    const st = await client.from('feedbacks').select('id,status').eq('id', id);
    if (!st.error && st.data && st.data[0]) r.status = st.data[0].status;
    _comments[id] = null;
    // 状態が変わって今の絞り込みから外れる場合は「これから対応」に切り替え、いま操作したカードが消えないようにする
    if (_flt.status && _flt.status !== 'open+' && _flt.status !== (r.status || 'open')) _flt.status = 'open+';
    toast(kind === 'question' ? '✅ 質問を送りました（報告者に通知バッジが出ます）' : kind === 'answer' ? '✅ 返信しました' : '✅ コメントしました', 'success', 3500);
    renderReports();
    refreshBadge();
  }

  async function _loadAtts(r, box) {
    const atts = Array.isArray(r.attachments) ? r.attachments : [];
    if (!box || !atts.length) return;
    box.innerHTML = '<span class="fbr-dim">添付を読み込み中…</span>';
    const client = db();
    const { data, error } = await client.storage.from(BUCKET).createSignedUrls(atts.map(a => a.path), 3600);
    if (error || !data) { box.innerHTML = '<span class="fbr-dim">⚠️ 添付を読み込めませんでした</span>'; return; }
    box.innerHTML = atts.map((a, i) => {
      const u = data[i] && data[i].signedUrl;
      if (!u) return '<div class="fbr-att fbr-att-gone">🗑 ' + esc(a.name) + '<br><small>保存期間（90日）を過ぎて削除されました</small></div>';
      return a.kind === 'video'
        ? '<div class="fbr-att"><video src="' + esc(u) + '" controls preload="metadata"></video><small>🎥 ' + esc(a.name) + '</small></div>'
        : '<div class="fbr-att"><a href="' + esc(u) + '" target="_blank" rel="noopener"><img src="' + esc(u) + '" alt="' + esc(a.name) + '" loading="lazy"></a><small>🖼 ' + esc(a.name) + '</small></div>';
    }).join('');
  }

  async function _saveResp(card) {
    const id = card.dataset.id;
    const r = _rows.find(x => x.id === id);
    if (!r) return;
    const status = card.querySelector('[data-fld="status"]').value;
    const response = card.querySelector('[data-fld="response"]').value.trim();
    const btn = card.querySelector('[data-act="save"]');
    btn.disabled = true;
    const { data, error } = await db().from('feedbacks').update({ status, response: response || null }).eq('id', id)
      .select('id,status,response,responded_by,responded_at');
    btn.disabled = false;
    if (error) {
      // response 列が未作成（SQL 未適用）なら、ステータスだけでも更新する
      if (fbIsMissingColumn(error)) {
        const r2 = await db().from('feedbacks').update({ status }).eq('id', id).select('id');
        if (!r2.error && r2.data && r2.data.length) { r.status = status; toast('✅ ステータスを更新しました（対応メモは SQL 適用後に保存できます）', 'info', 5000); renderReports(); return; }
      }
      toast('⚠️ 保存に失敗しました：' + error.message, 'warn', 6000);
      return;
    }
    if (!data || !data.length) { toast('🔒 この報告を更新する権限がありません（チームメンバーのみ）', 'warn', 5000); return; }
    Object.assign(r, data[0]);
    toast('✅ 対応状況を保存しました', 'success', 2500);
    card.querySelector('.fbr-card-body').dataset.filled = '0';
    renderReports();
  }

  function _onListClick(e) {
    const actEl = e.target.closest('[data-act]');
    if (!actEl) return;
    const card = actEl.closest('.fbr-card');
    if (!card) return;
    const act = actEl.dataset.act;
    if (act === 'toggle') {
      const id = card.dataset.id;
      const body = card.querySelector('.fbr-card-body');
      const willOpen = body.hidden;
      body.hidden = !willOpen;
      card.classList.toggle('is-open', willOpen);
      actEl.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) { _open.add(id); _fillDetail(id); } else { _open.delete(id); }
    } else if (act === 'save') {
      _saveResp(card);
    } else if (act === 'post') {
      _postComment(card, actEl.dataset.kind);
    }
  }
  function _onBannerClick(e) {
    if (!e.target.closest('[data-act="banner"]')) return;
    _flt.status = 'need_info'; _flt.mine = true;
    const m = $('fbrMine'); if (m) m.checked = true;
    renderReports();
  }

  // 報告者への通知バッジ（ヘッダーのリンクと常駐ボタン）：自分の報告で「確認待ち」の件数
  let _badgeAt = 0;
  async function refreshBadge() {
    _badgeAt = Date.now();
    const u = me(), client = db();
    let n = 0;
    if (u && client) {
      try {
        const res = await client.from('feedbacks').select('id', { count: 'exact', head: true }).eq('status', 'need_info').eq('user_id', u.id);
        if (!res.error) n = res.count || 0;
      } catch (e) {}
    }
    const link = $('hdrBugReportsBtn');
    if (link) {
      let b = link.querySelector('.hdr-fb-badge');
      if (n && !b) { b = document.createElement('span'); b.className = 'hdr-fb-badge'; link.appendChild(b); }
      if (b) { if (n) { b.textContent = String(n); b.title = '確認の質問が届いています'; } else b.remove(); }
    }
    const fab = $('fbQuickFab');
    if (fab) { fab.classList.toggle('has-badge', n > 0); if (n) fab.dataset.n = String(n); else delete fab.dataset.n; }
  }

  async function fbrCopyForAI() {
    if (!window.FeedbackMd) return;
    const rows = _filtered(false);
    if (!rows.length) { toast('コピーする報告がありません', 'info'); return; }
    let list = rows.slice(0, 80);
    try {                       // やりとり（質問・返信）も一緒に渡す。取れなければ本文だけ
      const cr = await db().from('feedback_comments').select('*').in('feedback_id', list.map(r => r.id)).order('created_at', { ascending: true });
      if (!cr.error && cr.data) { const g = {}; cr.data.forEach(c => { (g[c.feedback_id] = g[c.feedback_id] || []).push(c); }); list = list.map(r => Object.assign({}, r, { comments: g[r.id] || [] })); }
    } catch (e) {}
    const md = window.FeedbackMd.toMarkdown(list, { nameOf, title: '不具合報告一覧（フォワーダー支援）' });
    try { await navigator.clipboard.writeText(md); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = md; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) {} ta.remove();
    }
    toast('📋 ' + Math.min(rows.length, 80) + '件を Markdown でコピーしました。Claude に貼り付けて渡してください（メールアドレスは含まれません）', 'success', 6000);
  }

  function initBugReportsTab() {
    const root = $('fbrRoot');
    if (root && !root.dataset.bound) {
      root.dataset.bound = '1';
      $('fbrList').addEventListener('click', _onListClick);
      $('fbrList').addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-act="toggle"]')) { e.preventDefault(); _onListClick(e); } });
      $('fbrBanner').addEventListener('click', _onBannerClick);
      $('fbrChips').addEventListener('click', e => { const b = e.target.closest('.fbr-chip'); if (!b) return; _flt.status = b.dataset.st; renderReports(); });
      $('fbrCat').addEventListener('change', e => { _flt.cat = e.target.value; renderReports(); });
      $('fbrMine').addEventListener('change', e => { _flt.mine = e.target.checked; renderReports(); });
      $('fbrSearch').addEventListener('input', e => { _flt.q = e.target.value; renderReports(); });
    }
    loadReports();
    refreshBadge();
  }

  // ================================================================
  // 5. 常駐ボタン
  // ================================================================
  function mountFab() {
    if ($('fbQuickFab')) return;
    const b = document.createElement('button');
    b.id = 'fbQuickFab';
    b.type = 'button';
    b.className = 'fb-quick-fab';
    b.title = '不具合を見つけたら、すぐ報告（スクリーンショット・録画も添付できます）';
    b.setAttribute('aria-label', '不具合を報告');
    b.textContent = '🐞';
    b.addEventListener('click', fbOpenQuick);
    document.body.appendChild(b);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountFab); else mountFab();
  // 通知バッジは、読み込み後・画面に戻ってきたとき（1分以上あいていれば）・5分ごとに更新
  setTimeout(refreshBadge, 3000);
  window.addEventListener('focus', () => { if (Date.now() - _badgeAt > 60000) refreshBadge(); });
  setInterval(() => { if (!document.hidden) refreshBadge(); }, 5 * 60 * 1000);

  // ---------- 公開（onclick 用） ----------
  window.fbCaptureScreenshot = fbCaptureScreenshot;
  window.fbRecordStart = fbRecordStart;
  window.fbOnFilesPicked = fbOnFilesPicked;
  window.fbRemoveAtt = fbRemoveAtt;
  window.fbAnnotate = fbAnnotate;
  window.fbResetAttachments = fbResetAttachments;
  window.fbOnOpen = fbOnOpen;
  window.fbBuildExtra = fbBuildExtra;
  window.fbIsMissingColumn = fbIsMissingColumn;
  window.fbAfterSubmit = fbAfterSubmit;
  window.fbOpenQuick = fbOpenQuick;
  window.fbrReload = loadReports;
  window.fbRefreshBadge = refreshBadge;
  window.fbrCopyForAI = fbrCopyForAI;
  window.initBugReportsTab = initBugReportsTab;
})();
