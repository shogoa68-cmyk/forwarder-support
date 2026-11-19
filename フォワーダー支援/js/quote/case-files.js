// 📎 案件のファイル：参照資料（14 日）と一時ファイル（3 時間）を、1 つの一覧・1 つの追加画面で見せる（Design 38 案X・表示層）。
//   ・保存先は今までどおり 2 つ（添付＝quote_attachments／送付用＝quote_temp_files）。ここは一覧を合成して見せ、追加のとき期間で保存先を切り替えるだけ。
//   ・URL は参照URL（#qf-refurl）のまま＝社内の資料（期限なし）。
//   ・入口：①基本の「参照資料」の場所（#cfRefBtn）と、⑤の「出力する」枠の［📁 案件のファイル］。
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, k, ms) => { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(m, k || 'info', ms || 2600); };
  const MAX_FILE = 25 * 1024 * 1024;
  let items = [], attState = 'ok', attErr = '', loading = false, period = 'send', picked = [], addOpen = false, tickT = null;

  const extOf = n => { const m = /\.([A-Za-z0-9]{1,8})$/.exec(n || ''); return m ? m[1].toLowerCase() : ''; };
  const iconOf = n => { const e = extOf(n); return /^(pdf)$/.test(e) ? '📕' : /^(xls|xlsx|xlsm|csv)$/.test(e) ? '📊' : /^(doc|docx)$/.test(e) ? '📝' : /^(png|jpe?g|gif|webp|bmp)$/.test(e) ? '🖼️' : /^(zip)$/.test(e) ? '🗜️' : /^(msg|eml)$/.test(e) ? '✉️' : '📎'; };
  function sizeText(n) { n = +n || 0; return !n ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB'; }
  // 残り時間の札：1日以上＝灰／1日未満＝橙／1時間未満＝赤（色だけに頼らず文字も付ける）
  function leftInfo(ms) {
    if (ms == null) return { t: '期限なし', cls: 'is-none' };
    if (ms <= 0) return { t: '残り 0分', cls: 'is-red' };
    const min = Math.floor(ms / 60000), h = Math.floor(min / 60), d = Math.floor(h / 24);
    if (d >= 1) return { t: '残り ' + d + '日', cls: '' };
    if (h >= 1) return { t: '残り ' + h + '時間' + (min % 60 ? (min % 60) + '分' : ''), cls: 'is-orange' };
    return { t: '残り ' + Math.max(1, min) + '分', cls: 'is-red' };
  }
  const urlsNow = () => { const ta = $('qf-refurl'); return ta && typeof window.refUrlExtract === 'function' ? window.refUrlExtract(ta.value) : []; };
  const urlLabel = u => { try { const x = new URL(u); return (x.hostname + (x.pathname === '/' ? '' : x.pathname)).replace(/\/$/, ''); } catch (e) { return u; } };

  // ---- 読み込み（2 つの保存先＋URL を 1 つの一覧に合成）----------------
  async function collect() {
    const out = []; let state = 'ok', err = '';
    const tf = typeof window.tfList === 'function' ? window.tfList() : { state: 'nosql', files: [] };
    (tf.files || []).forEach(f => out.push({ kind: 'send', id: f.id, name: f.file_name, size: f.file_size, ms: new Date(f.expires_at).getTime() - Date.now(), raw: f }));
    if (typeof window.qfAttachList === 'function') {
      const a = await window.qfAttachList();
      if (a.state !== 'ok') { state = a.state; err = a.error || ''; }
      (a.rows || []).forEach(r => out.push({ kind: 'doc', id: r.id, name: r.file_name, size: r.file_size, ms: r.expires_at ? new Date(r.expires_at).getTime() - Date.now() : null, raw: r }));
    }
    if (state === 'ok' && tf.state === 'nologin') state = 'nologin';
    urlsNow().forEach(u => out.push({ kind: 'url', id: u, name: urlLabel(u), url: u, ms: null }));
    return { out, state, err, tfState: tf.state };
  }
  async function load() {
    if (loading) return; loading = true;
    try { const r = await collect(); items = r.out; attState = r.state; attErr = r.err; window.__cfTfState = r.tfState; }
    catch (e) { attState = 'error'; attErr = String(e && e.message || e); }
    finally { loading = false; }
    render(); syncEntries();
  }
  const sorted = () => items.slice().sort((a, b) => (a.ms == null ? Infinity : a.ms) - (b.ms == null ? Infinity : b.ms));

  // ---- 一覧 ---------------------------------------------------------------
  function rowHtml(it) {
    const li = leftInfo(it.ms);
    const label = it.kind === 'send' ? '<span class="cf-lab is-send">📤 送付用</span>' : '<span class="cf-lab is-int">🔒 社内</span>';
    const ico = it.kind === 'url' ? '🔗' : iconOf(it.name);
    const sz = it.kind === 'url' ? '' : sizeText(it.size);
    const act = it.kind === 'url' ? '<button type="button" class="cf-ic" data-a="open" title="開く（新しいタブ）">↗</button>' : '<button type="button" class="cf-ic" data-a="dl" title="ダウンロード">⬇</button>';
    return '<div class="cf-row" data-k="' + it.kind + '" data-id="' + esc(it.id) + '">' +
      '<span class="cf-ico" aria-hidden="true">' + ico + '</span>' +
      '<span class="cf-name" title="' + esc(it.kind === 'url' ? it.url : it.name) + '">' + esc(it.name) + (sz ? '<small>' + sz + '</small>' : '') + '</span>' +
      label + '<span class="cf-left ' + li.cls + '">' + li.t + '</span>' + act +
      '<button type="button" class="cf-ic cf-more" data-a="more" title="その他（削除）" aria-haspopup="true">⋯</button></div>';
  }
  function render() {
    const body = $('cfBody'); if (!body) return;
    const cnt = $('cfCount'); if (cnt) cnt.textContent = items.length + ' 件';
    const add = $('cfAddBtn'); if (add) add.disabled = !(attState === 'ok' || attState === 'error');
    let note = '';
    if (attState === 'nologin') note = '🔒 ログインすると使えます（URL の確認だけはログインなしでもできます）。';
    else if (attState === 'unsaved') note = '💾 案件を保存すると、ファイルを置けます（URL はすぐ追加できます）。';
    else if (attState === 'error') note = '⚠️ 一部を読み込めませんでした：' + esc(attErr);
    if (window.__cfTfState === 'nosql' && attState === 'ok') note = 'ℹ️ 送付用（3時間）のサーバー側の準備がまだです。社内の資料（14日）は使えます。';
    const soon = items.some(i => i.kind === 'send' && i.ms != null && i.ms > 0 && i.ms < 3600000);
    let html = '';
    if (note) html += '<p class="cf-note">' + note + '</p>';
    if (soon) html += '<p class="cf-soon">あと1時間で消えるファイルがあります。必要ならダウンロードしてください。</p>';
    if (!items.length) {
      html += '<div class="cf-empty"><b>まだファイルがありません</b><span>お客様からの資料や、見積に添えて送るファイルを置けます。</span></div>';
    } else html += '<div class="cf-list">' + sorted().map(rowHtml).join('') + '</div>';
    body.innerHTML = html;
  }
  function closeMenu() { const m = document.querySelector('.cf-menu'); if (m) m.remove(); }
  function find(row) { const k = row.dataset.k, id = row.dataset.id; return items.find(i => i.kind === k && String(i.id) === id); }
  async function onAct(e) {
    const btn = e.target.closest('[data-a]'); if (!btn) { closeMenu(); return; }
    const row = btn.closest('.cf-row'); const it = row && find(row); if (!it) return;
    const a = btn.dataset.a;
    if (a === 'open') { window.open(it.url, '_blank', 'noopener'); return; }
    if (a === 'dl') {
      if (it.kind === 'send') window.tfDownloadId(it.id);
      else if (typeof window.qfAttachOpen === 'function') window.qfAttachOpen(encodeURIComponent(it.raw.storage_path));
      return;
    }
    if (a === 'more') {
      closeMenu();
      const m = document.createElement('div'); m.className = 'cf-menu';
      m.innerHTML = '<button type="button" data-a="del">🗑 ' + (it.kind === 'url' ? 'URL を外す' : '削除') + '</button>';
      const r = btn.getBoundingClientRect(); document.body.appendChild(m);
      m.style.top = Math.min(window.innerHeight - 56, r.bottom + 4) + 'px'; m.style.left = Math.max(8, r.right - 150) + 'px';
      m.addEventListener('click', ev => { ev.stopPropagation(); m.remove(); doDelete(it); });
      return;
    }
  }
  async function doDelete(it) {
    if (it.kind === 'send') { await window.tfDeleteId(it.id); await load(); return; }
    if (it.kind === 'url') { if (typeof window.refUrlRemove === 'function') window.refUrlRemove(it.url); if (typeof window.ciSync === 'function') window.ciSync(); await load(); return; }
    const ok = typeof window.uiConfirm === 'function'
      ? await window.uiConfirm({ title: 'このファイルを削除しますか？', lines: ['・' + it.name], irreversible: '削除したファイルは元に戻せません（チーム全員から消えます）。', okLabel: '削除する', danger: true })
      : window.confirm('このファイルを削除しますか？');
    if (!ok) return;
    if (await window.qfAttachRemove(it.id, encodeURIComponent(it.raw.storage_path))) { toast('🗑 削除しました', 'info', 2000); await load(); }
  }

  // ---- 本体の画面 -----------------------------------------------------------
  function ensure() {
    if ($('cfOverlay')) return;
    const o = document.createElement('div'); o.id = 'cfOverlay'; o.className = 'cf-overlay'; o.hidden = true;
    o.innerHTML = '<div class="cf-box" role="dialog" aria-modal="true" aria-label="案件のファイル">' +
      '<div class="cf-head"><b>📎 案件のファイル</b><span class="cf-count" id="cfCount">0 件</span><span class="cf-sp"></span>' +
      '<button type="button" class="cf-add" id="cfAddBtn">＋ 追加</button><button type="button" class="cf-x" id="cfClose" aria-label="閉じる">✕</button></div>' +
      '<div class="cf-body" id="cfBody"></div></div>';
    document.body.appendChild(o);
    o.addEventListener('click', e => { if (e.target === o) cfClose(); });
    $('cfClose').addEventListener('click', cfClose);
    $('cfAddBtn').addEventListener('click', () => openAdd(period));
    $('cfBody').addEventListener('click', onAct);
    document.addEventListener('click', e => { if (!e.target.closest('.cf-menu') && !e.target.closest('.cf-more')) closeMenu(); }, true);
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (addOpen) { e.stopPropagation(); closeAdd(); return; }
      if (!o.hidden) { e.stopPropagation(); cfClose(); }
    }, true);
    document.addEventListener('tf:changed', () => { if (!o.hidden) load(); else syncEntries(); });
  }
  window.cfOpen = function (initial) {
    ensure(); period = initial === 'internal' ? 'internal' : 'send';
    const o = $('cfOverlay'); o.hidden = false; render();
    if (typeof window.tfRefresh === 'function') window.tfRefresh(true);
    load();
    clearInterval(tickT); tickT = setInterval(() => { if (!o.hidden) { items.forEach(i => { if (i.ms != null) i.ms -= 15000; }); render(); } }, 15000);
    setTimeout(() => { const b = $('cfAddBtn'); if (b && !b.disabled) b.focus(); }, 0);
  };
  function cfClose() { const o = $('cfOverlay'); if (o) o.hidden = true; clearInterval(tickT); closeMenu(); }
  window.cfClose = cfClose;

  // ---- 追加の画面（幅 460px）--------------------------------------------------
  function openAdd(initial) {
    closeAdd(); period = initial === 'internal' ? 'internal' : 'send'; picked = []; addOpen = true;
    const a = document.createElement('div'); a.id = 'cfAddOverlay'; a.className = 'cf-overlay cf-add-overlay';
    a.innerHTML = '<div class="cf-box cf-add-box" role="dialog" aria-modal="true" aria-label="ファイルを追加">' +
      '<div class="cf-add-t">ファイルを追加</div>' +
      '<div class="cf-drop" id="cfDrop" tabindex="0"><span>ここにファイルをドロップ、またはクリックして選ぶ</span><small>1つ25MBまで・送付用は合計100MB／50個まで</small>' +
      '<input type="file" id="cfFile" multiple hidden></div><div class="cf-picked" id="cfPicked"></div>' +
      '<div class="cf-per" id="cfPer"><div class="cf-per-q">どれだけ置きますか？</div>' +
      '<div class="cf-seg" role="radiogroup"><button type="button" role="radio" data-p="send">📤 送付用（3時間）</button><button type="button" role="radio" data-p="internal">🔒 社内の資料（14日）</button></div>' +
      '<p class="cf-per-d" id="cfPerD"></p></div>' +
      '<div class="cf-url"><label for="cfUrl">またはURLを追加（社内の資料・期限なし）</label><input type="text" id="cfUrl" placeholder="https://…"></div>' +
      '<p class="cf-msg" id="cfMsg" hidden></p>' +
      '<div class="cf-add-foot"><button type="button" id="cfCancel">キャンセル</button><button type="button" class="cf-primary" id="cfGo">追加する</button></div></div>';
    document.body.appendChild(a);
    a.addEventListener('click', e => { if (e.target === a) closeAdd(); });
    $('cfCancel').addEventListener('click', closeAdd);
    const drop = $('cfDrop'), inp = $('cfFile');
    drop.addEventListener('click', () => inp.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('is-over'); pick(e.dataTransfer && e.dataTransfer.files); });
    inp.addEventListener('change', () => { pick(inp.files); inp.value = ''; });
    a.querySelectorAll('.cf-seg [data-p]').forEach(b => b.addEventListener('click', () => { period = b.dataset.p; syncAdd(); }));
    $('cfUrl').addEventListener('input', syncAdd);
    $('cfUrl').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); go(); } });
    $('cfGo').addEventListener('click', go);
    syncAdd(); setTimeout(() => drop.focus(), 0);
  }
  function closeAdd() { const a = $('cfAddOverlay'); if (a) a.remove(); addOpen = false; picked = []; }
  function pick(list) {
    Array.prototype.slice.call(list || []).forEach(f => { if (!picked.some(p => p.name === f.name && p.size === f.size)) picked.push(f); });
    syncAdd();
  }
  function msg(t, err) { const m = $('cfMsg'); if (!m) return; m.textContent = t || ''; m.hidden = !t; m.classList.toggle('is-err', !!err); }
  function syncAdd() {
    const hasUrl = !!($('cfUrl') && $('cfUrl').value.trim());
    const per = $('cfPer'); if (per) per.hidden = hasUrl && !picked.length;   // URL だけのときは期間の選択を出さない（社内の資料に固定）
    document.querySelectorAll('.cf-seg [data-p]').forEach(b => { const on = b.dataset.p === period; b.classList.toggle('is-on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
    const d = $('cfPerD'); if (d) d.textContent = period === 'send' ? 'お客様に添付するためのファイルです。3時間後に自動で消えます。' : '社内で使う根拠・参考の資料です。14日後に自動で消えます。';
    const pk = $('cfPicked'); if (pk) pk.innerHTML = picked.map((f, i) => '<span class="cf-chip">' + esc(f.name) + ' <small>' + sizeText(f.size) + '</small><button type="button" data-i="' + i + '" aria-label="外す">✕</button></span>').join('');
    if (pk) pk.querySelectorAll('button[data-i]').forEach(b => b.addEventListener('click', () => { picked.splice(+b.dataset.i, 1); syncAdd(); }));
    const go2 = $('cfGo'); if (go2) go2.disabled = !(picked.length || hasUrl);
    const needFile = picked.length && !(attState === 'ok' || attState === 'error');
    if (needFile) msg(attState === 'nologin' ? 'ファイルを置くにはログインが必要です。' : 'ファイルは、先に案件を保存（💾 保存）してから置けます。', true); else if (!($('cfMsg') && $('cfMsg').classList.contains('is-ok'))) msg('');
  }
  async function go() {
    const urlTxt = ($('cfUrl') && $('cfUrl').value.trim()) || '';
    if (picked.length && !(attState === 'ok' || attState === 'error')) { syncAdd(); return; }
    const files = picked.slice();
    for (const f of files) if (f.size > MAX_FILE) { msg(f.name + ' は 25MB を超えるため置けません。', true); return; }
    if (urlTxt) {
      const si = $('srcUrlInput');
      if (si && typeof window.srcAddUrlsFromInput === 'function') { si.value = urlTxt; window.srcAddUrlsFromInput(); const sm = $('srcUrlMsg'); if (sm && sm.classList.contains('is-err')) { msg(sm.textContent, true); return; } }
    }
    if (files.length) {
      if (period === 'send') await window.tfUploadFiles(files);
      else if (typeof window.qfAttachUpload === 'function') await window.qfAttachUpload(files);
    }
    closeAdd(); await load();
  }

  // ---- 入口（①の参照資料の場所・⑤の出力枠）と件数 ----------------------------
  function syncEntries() {
    const total = items.length || (document.querySelectorAll('#qfSrcUrls .qf-attach-item, #qfAttachList .qf-attach-item').length + ((window.tfList && window.tfList().files.length) || 0));
    const b = $('cfRefBtn'); if (b) { const t = '📎 案件のファイル' + (total ? '（' + total + '）' : ''); if (b.textContent !== t) b.textContent = t; }
    const send = (window.tfList && window.tfList().files.length) || 0;
    const o = document.querySelector('#e2Out [data-e2o="files"]');
    if (o) { const t = '📁 案件のファイル' + (send ? ' <small>送付用 ' + send + '</small>' : ''); if (o.dataset.h !== t) { o.dataset.h = t; o.innerHTML = t; } }
  }
  function mount() {
    const card = document.querySelector('#qfSources .src-card');
    if (card && !$('cfRefBtn')) {
      const b = document.createElement('button'); b.type = 'button'; b.id = 'cfRefBtn'; b.className = 'cf-ref-btn'; b.textContent = '📎 案件のファイル';
      b.title = '参照資料（14日）と、見積に添えて送るファイル（3時間）を、まとめて見る・置く';
      b.addEventListener('click', () => window.cfOpen('internal'));
      card.appendChild(b);
    }
    syncEntries();
  }
  function init() { ensure(); mount(); setInterval(() => { mount(); }, 2000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0)); else setTimeout(init, 0);
})();
