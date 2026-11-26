/* ai-ocr.js — 📷 画像（見積書の写真・スキャン・文字の無い PDF）を AI で読み、メール取込の確認画面へ流す（2026-11・準備段階）
 *
 * 流れ：画像を選ぶ → 表だけ切り抜く・社名などを黒く塗る → 確認して送る → 料金の行が返る → いつもの確認画面（eiParse）
 *   ・外へ出るのは「切り抜いて黒塗りした画像」だけ。JPEG に作り直すので、元のファイルの中の隠れた情報（作成者など）は落ちる
 *   ・どのサブコンの見積かは画面（サブコン見出しの入口）で決める。AI には伝えない
 *   ・読み取りは Supabase の Edge Function「ai-ocr」（鍵はそこだけ）。管理者が鍵と「使う」設定を入れるまでは送れない（準備だけ）
 *   ・読んだ結果は必ず確認画面で人が確かめてから挿入する
 * 入口：取り込みの選択画面の「📷 画像を AI で読む」（email-import.js icChoose('aiocr') → aiOcrOpen(canon)）
 * 手順は docs/AI-OCR-セットアップ.md、試験は scripts/design-tests/ai-ocr-test.js */
(function () {
  'use strict';
  const MAX_SIDE = 2000;        // 送る画像の長辺（px）
  const JPEG_Q = 0.85;
  let _canon = '', _status = null, _statusAt = 0;
  let _work = null;             // いまの画像（canvas）
  let _hist = [];               // 戻すための控え（canvas）
  let _tool = 'crop';           // 'crop'＝表だけ切り抜く／'black'＝黒く塗る
  let _pdf = null, _page = 1;   // PDF のとき
  let _drag = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t, ms) => { if (window.quoteShowToast) window.quoteShowToast(m, t || 'info', ms); };

  // ---------- 通信（Edge Function ai-ocr） ----------
  function cfg() { return window.CLOUD_CONFIG || {}; }
  function fnUrl() { return String(cfg().url || '').replace(/\/$/, '') + '/functions/v1/ai-ocr'; }
  async function post(body) {
    const c = typeof window.cloudGetClient === 'function' ? window.cloudGetClient() : null;
    const s = c ? (await c.auth.getSession()).data.session : null;
    if (!s) return { ok: false, error: 'login', message: 'ログインすると使えます' };
    if (!cfg().url) return { ok: false, error: 'network', message: 'クラウドの接続設定がありません' };
    let res;
    try {
      res = await fetch(fnUrl(), { method: 'POST', headers: { Authorization: 'Bearer ' + s.access_token, apikey: cfg().publishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) { return { ok: false, error: 'network', message: '通信できませんでした（Edge Function「ai-ocr」の AI_OCR_ALLOWED_ORIGINS にこの画面の URL が入っているか確認してください）' }; }
    const j = await res.json().catch(() => ({}));
    if (res.status === 404 && !j.error) return { ok: false, error: 'nofunction', message: 'サーバー側がまだ準備されていません（Edge Function「ai-ocr」が未配置）' };
    if (!res.ok || j.ok === false) return Object.assign({ ok: false, error: j.error || 'error', message: j.message || ('エラー（' + res.status + '）') }, { status: res.status });
    return j;
  }
  async function loadStatus(force) {
    if (!force && _status && Date.now() - _statusAt < 60_000) return _status;
    const r = await post({ action: 'status' });
    _status = r.ok ? { ready: !!r.ready, reason: r.reason || '', model: r.model || '' } : { ready: false, reason: r.error, message: r.message };
    _statusAt = r.ok ? Date.now() : 0;   // 未ログイン・通信の失敗は覚えない（ログインした直後に使えるように）
    return _status;
  }
  const STATUS_TEXT = {
    login: 'ログインすると使えます。切り抜き・黒塗りまでは試せます。',
    nofunction: 'AI 読み取りは準備中です（サーバー側の部品がまだ配置されていません）。切り抜き・黒塗りまでは試せます。',
    not_configured: 'AI 読み取りは準備中です（管理者が鍵を設定するまで送れません）。切り抜き・黒塗りまでは試せます。',
    no_key: 'AI 読み取りは準備中です（管理者が鍵を設定するまで送れません）。切り抜き・黒塗りまでは試せます。',
    disabled: 'AI 読み取りは準備中です（社内の確認が済んで、管理者が「使う」設定にするまで送れません）。切り抜き・黒塗りまでは試せます。',
  };

  // ---------- 画面 ----------
  function ensureModal() {
    if ($('aoModal')) return;
    const m = document.createElement('div');
    m.id = 'aoModal';
    m.innerHTML =
      '<div class="ao-box" role="dialog" aria-modal="true" aria-labelledby="aoTitle">' +
        '<div class="ao-head"><h3 id="aoTitle">📷 画像を AI で読む</h3><button type="button" class="ao-x" data-ao="close" aria-label="閉じる">✕</button></div>' +
        '<p class="ao-sub" id="aoSub"></p>' +
        '<div class="ao-banner" id="aoBanner" hidden></div>' +
        '<div class="ao-pick" id="aoPick"><button type="button" class="ao-primary" data-ao="pick">画像・PDF を選ぶ</button><span>写真・スキャン・文字の無い PDF（1 ページずつ）</span></div>' +
        '<div class="ao-edit" id="aoEdit" hidden>' +
          '<div class="ao-tools" role="toolbar" aria-label="画像の加工">' +
            '<button type="button" class="ao-tool" data-ao="tool" data-t="crop" aria-pressed="true">✂️ 表だけ切り抜く</button>' +
            '<button type="button" class="ao-tool" data-ao="tool" data-t="black" aria-pressed="false">⬛ 黒く塗る</button>' +
            '<button type="button" data-ao="undo" id="aoUndo">↩ 戻す</button>' +
            '<button type="button" data-ao="reset">最初から</button>' +
            '<span class="ao-pager" id="aoPager" hidden><button type="button" data-ao="prev" aria-label="前のページ">‹</button><span id="aoPageNo"></span><button type="button" data-ao="next" aria-label="次のページ">›</button></span>' +
          '</div>' +
          '<p class="ao-hint" id="aoHint"></p>' +
          '<div class="ao-stage" id="aoStage"><canvas id="aoCanvas"></canvas><div class="ao-sel" id="aoSel" hidden></div></div>' +
          '<p class="ao-size" id="aoSize"></p>' +
          '<fieldset class="ao-check"><legend>送る前に確かめてください（外部の AI に画像を送ります）</legend>' +
            '<label><input type="checkbox" class="ao-ck"> 宛先・差出人・署名・ロゴは写っていない（切り抜いた・塗った）</label>' +
            '<label><input type="checkbox" class="ao-ck"> 表の中の会社名・人名・区間・本船名・番号は塗った</label>' +
            '<label><input type="checkbox" class="ao-ck"> 社内の決まり・お客様やサブコンとの約束で、料金の表を送ってよいことを確認した</label>' +
          '</fieldset>' +
          '<div class="ao-foot"><button type="button" data-ao="pick">別の画像にする</button><button type="button" class="ao-primary" id="aoSend" data-ao="send" disabled>AI で読む（外部に送る）</button></div>' +
        '</div>' +
        '<input type="file" id="aoFile" accept="image/*,application/pdf,.pdf" hidden>' +
      '</div>';
    document.body.appendChild(m);
    m.addEventListener('click', onClick);
    m.addEventListener('change', (e) => { if (e.target.classList.contains('ao-ck')) syncSend(); });
    $('aoFile').addEventListener('change', onFile);
    const cv = $('aoCanvas');
    cv.addEventListener('pointerdown', dragStart);
    cv.addEventListener('pointermove', dragMove);
    cv.addEventListener('pointerup', dragEnd);
    cv.addEventListener('pointercancel', () => { _drag = null; $('aoSel').hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('aoModal')?.classList.contains('open')) { e.stopPropagation(); close(); } }, true);
  }

  async function open(canon) {
    ensureModal();
    _canon = String(canon || '').trim();
    $('aoSub').textContent = (_canon ? '「' + _canon + '」の明細グループに取り込みます。' : '') + '見積の表の部分だけを切り抜き、会社名などを黒く塗ってから送ります。読んだ結果はいつもの確認画面で確かめてから挿入します。';
    resetAll();
    $('aoModal').classList.add('open');
    const st = await loadStatus(false);
    renderBanner(st);
    syncSend();
  }
  function close() { $('aoModal')?.classList.remove('open'); resetAll(); }
  function resetAll() {
    _work = null; _hist = []; _pdf = null; _page = 1; _tool = 'crop';
    if ($('aoEdit')) { $('aoEdit').hidden = true; $('aoPick').hidden = false; $('aoSend').disabled = true; }
    document.querySelectorAll('#aoModal .ao-ck').forEach((c) => { c.checked = false; });
    syncTools();
  }
  function renderBanner(st) {
    const b = $('aoBanner'); if (!b) return;
    if (st && st.ready) { b.hidden = true; return; }
    b.hidden = false;
    b.textContent = (st && STATUS_TEXT[st.reason]) || (st && st.message ? st.message + '（切り抜き・黒塗りまでは試せます）' : '');
  }
  function syncSend() {
    const all = [...document.querySelectorAll('#aoModal .ao-ck')].every((c) => c.checked);
    const btn = $('aoSend'); if (!btn) return;
    btn.disabled = !(_work && all && _status && _status.ready);
    btn.title = !(_status && _status.ready) ? 'AI 読み取りはまだ使えません（準備中）' : (!all ? '3 つの確認にチェックを入れてください' : '');
  }
  function syncTools() {
    document.querySelectorAll('#aoModal .ao-tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === _tool)));
    const h = $('aoHint'); if (h) h.textContent = _tool === 'crop' ? '表の部分を囲むようにドラッグすると、その部分だけが残ります。' : '隠したい所（会社名・人名・区間・番号など）をドラッグで囲むと、黒く塗ります。';
    const u = $('aoUndo'); if (u) u.disabled = !_hist.length;
  }

  function onClick(e) {
    if (e.target.id === 'aoModal') { close(); return; }
    const b = e.target.closest('[data-ao]'); if (!b) return;
    const a = b.dataset.ao;
    if (a === 'close') close();
    else if (a === 'pick') $('aoFile').click();
    else if (a === 'tool') { _tool = b.dataset.t; syncTools(); }
    else if (a === 'undo') { if (_hist.length) { _work = _hist.pop(); draw(); } }
    else if (a === 'reset') { if (_hist.length) { _work = _hist[0]; _hist = []; draw(); } }
    else if (a === 'prev' && _pdf && _page > 1) renderPdfPage(_page - 1);
    else if (a === 'next' && _pdf && _page < _pdf.numPages) renderPdfPage(_page + 1);
    else if (a === 'send') send();
  }

  // ---------- 画像の読み込み ----------
  async function onFile(e) {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) {
        if (typeof window.pdfjsLib === 'undefined') { toast('⚠️ PDF の部品を読み込めませんでした。時間をおいてもう一度お試しください', 'warn'); return; }
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/' + pdfjsLib.version + '/pdf.worker.min.js';
        _pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer() }).promise;
        await renderPdfPage(1);
      } else if (/^image\//.test(f.type)) {
        _pdf = null;
        const img = await loadImg(f);
        setWork(fit(img, img.naturalWidth || img.width, img.naturalHeight || img.height));
      } else { toast('画像（JPEG・PNG など）か PDF を選んでください', 'warn'); }
    } catch (err) { toast('⚠️ ファイルを開けませんでした', 'warn'); }
  }
  function loadImg(file) {
    return new Promise((res, rej) => { const u = URL.createObjectURL(file); const i = new Image(); i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = () => { URL.revokeObjectURL(u); rej(new Error('img')); }; i.src = u; });
  }
  async function renderPdfPage(n) {
    const page = await _pdf.getPage(n);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(3, MAX_SIDE / Math.max(v1.width, v1.height));
    const vp = page.getViewport({ scale });
    const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    _page = n;
    setWork(c);
  }
  // 長辺を MAX_SIDE 以下にして描き直す（ここで元のファイルの中の隠れた情報も落ちる）
  function fit(src, w, h) {
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  function setWork(c) {
    _work = c; _hist = [];
    $('aoPick').hidden = true; $('aoEdit').hidden = false;
    const pg = $('aoPager'); pg.hidden = !_pdf;
    if (_pdf) $('aoPageNo').textContent = _page + ' / ' + _pdf.numPages + ' ページ';
    document.querySelectorAll('#aoModal .ao-ck').forEach((x) => { x.checked = false; });
    draw();
  }
  function draw() {
    const cv = $('aoCanvas'); if (!cv || !_work) return;
    cv.width = _work.width; cv.height = _work.height;
    cv.getContext('2d').drawImage(_work, 0, 0);
    const kb = Math.round((_work.width * _work.height * 0.12) / 1024);   // 目安（JPEG にしたときの大きさのおおよそ）
    $('aoSize').textContent = '送る画像：' + _work.width + '×' + _work.height + ' px（約 ' + kb + ' KB の JPEG に作り直して送ります）';
    syncTools(); syncSend();
  }

  // ---------- ドラッグで囲む（切り抜き・黒塗り） ----------
  function pt(e) {
    const cv = $('aoCanvas'), r = cv.getBoundingClientRect();
    return { x: Math.max(0, Math.min(cv.width, (e.clientX - r.left) * cv.width / r.width)), y: Math.max(0, Math.min(cv.height, (e.clientY - r.top) * cv.height / r.height)), cx: e.clientX - r.left, cy: e.clientY - r.top };
  }
  function dragStart(e) { if (!_work) return; e.preventDefault(); $('aoCanvas').setPointerCapture?.(e.pointerId); _drag = { a: pt(e), b: pt(e) }; showSel(); }
  function dragMove(e) { if (!_drag) return; _drag.b = pt(e); showSel(); }
  function showSel() {
    const s = $('aoSel'), d = _drag; if (!d) return;
    s.hidden = false; s.className = 'ao-sel ' + (_tool === 'black' ? 'is-black' : 'is-crop');
    s.style.left = Math.min(d.a.cx, d.b.cx) + 'px'; s.style.top = Math.min(d.a.cy, d.b.cy) + 'px';
    s.style.width = Math.abs(d.a.cx - d.b.cx) + 'px'; s.style.height = Math.abs(d.a.cy - d.b.cy) + 'px';
  }
  function dragEnd(e) {
    if (!_drag) return;
    _drag.b = pt(e);
    const d = _drag; _drag = null; $('aoSel').hidden = true;
    applyRect(Math.min(d.a.x, d.b.x), Math.min(d.a.y, d.b.y), Math.abs(d.a.x - d.b.x), Math.abs(d.a.y - d.b.y));
  }
  // 画像の座標で四角を当てる（試験からも呼べる）
  function applyRect(x, y, w, h) {
    if (!_work || w < 8 || h < 8) return false;
    x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
    _hist.push(_work);
    const c = document.createElement('canvas');
    if (_tool === 'crop') {
      c.width = w; c.height = h; c.getContext('2d').drawImage(_work, x, y, w, h, 0, 0, w, h);
    } else {
      c.width = _work.width; c.height = _work.height;
      const ctx = c.getContext('2d'); ctx.drawImage(_work, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h);
    }
    _work = c;
    // 画像が変わったら、確認のチェックはやり直してもらう
    document.querySelectorAll('#aoModal .ao-ck').forEach((k) => { k.checked = false; });
    draw();
    return true;
  }

  // ---------- 送る ----------
  // 返ってきた料金の行を、メール取込の表として読める文にする（列は Tab・見出しつき）
  function rowsToText(r) {
    const lines = ['項目\t数量\t単位\t通貨\t単価\t金額\t備考'];
    (r.rows || []).forEach((x) => lines.push([x.name, x.qty, x.unit, x.ccy, x.price, x.amount, x.note].map((v) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ')).join('\t')));
    if (r.remarks && r.remarks.length) { lines.push('', '【リマーク】'); r.remarks.forEach((t) => lines.push(t)); }
    return lines.join('\n');
  }
  async function send() {
    const btn = $('aoSend'); if (!btn || btn.disabled || !_work) return;
    btn.disabled = true; const label = btn.textContent; btn.textContent = '読み取り中…';
    try {
      const data = _work.toDataURL('image/jpeg', JPEG_Q).split(',')[1];
      const r = await post({ action: 'read', image: data, mediaType: 'image/jpeg' });
      if (!r.ok) { toast('⚠️ ' + (r.message || '読み取れませんでした'), 'warn', 7000); if (['disabled', 'not_configured', 'nofunction', 'bad_key'].includes(r.error)) { _status = null; renderBanner(await loadStatus(true)); } return; }
      if (!r.rows || !r.rows.length) { toast('料金の行が見つかりませんでした。表の部分を切り抜き直してお試しください', 'warn', 6000); return; }
      const canon = _canon;
      close();
      if (canon && typeof window.eiOpenForSubcon === 'function') window.eiOpenForSubcon(canon); else if (typeof window.openEmailImport === 'function') window.openEmailImport();
      const t = $('eiText'); if (!t) return;
      t.value = rowsToText(r);
      if (typeof window.eiParse === 'function') window.eiParse();
      toast('📷 AI が ' + r.rows.length + ' 行を読みました' + (r.unreadable && r.unreadable.length ? '（読みにくい行 ' + r.unreadable.length + ' 件は入れていません）' : '') + '。金額・単位を確かめてから挿入してください', 'success', 7000);
    } finally { btn.textContent = label; syncSend(); }
  }

  window.aiOcrOpen = open;
  window.aiOcrClose = close;
  window.aiOcrStatus = loadStatus;
  window.aiOcrDebug = { applyRect: (t, x, y, w, h) => { _tool = t; return applyRect(x, y, w, h); }, setTool: (t) => { _tool = t; syncTools(); }, size: () => _work ? [_work.width, _work.height] : null, rowsToText, pixel: (x, y) => _work ? [..._work.getContext('2d').getImageData(x, y, 1, 1).data] : null, setCanvas: (c) => setWork(c) };
})();
