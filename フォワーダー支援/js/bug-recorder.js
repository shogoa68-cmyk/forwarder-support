/* ================================================================
   🔴 不具合の再現を記録する「見張り番」
   使い方：Ctrl+Shift+L（Mac は Control+Shift+L でも Cmd+Shift+L でも可）で記録を始める
          → 不具合を再現する → もう一度 Ctrl+Shift+L（または「止めて報告」）
          → 「再現手順つき」の不具合報告が下書きされる（js/feedback.js の報告フォームを使う）
   記録するもの：押したボタン・入力した欄（種類）・タブの移動・画面の警告通知・エラー・画面の状態の要約
   伏せるもの：金額などの数字（9 に置き換え）・お客様名など自由入力の文字（文字数だけ）
   残すもの  ：品名・カテゴリ・サブコン・パターン・単位・港名・キャリアなどの文字、選択肢の名前
   ページを再読み込みしても記録は続く（sessionStorage）。サーバーには、報告を送るまで何も送らない。
   ================================================================ */
(function () {
  'use strict';

  const KEY = 'fwd.bugRec_v1';
  const MAX_STEPS = 300;
  const $ = id => document.getElementById(id);
  const g = v => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  let rec = null;            // { t0, steps:[{t, tab, text, snap?}], errors:[], startState }
  let timer = null;
  let origToast = null, wrappedToast = null;

  // ---------------- 状態の要約（金額・お客様名は含めない） ----------------
  function stateNow() {
    const tabEl = document.querySelector('.tab-content.active');
    const sel = id => { const e = $(id); return e ? g(e.options ? ((e.options[e.selectedIndex] || {}).text || '') : e.value) : ''; };
    const rows = document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual="1"])').length;
    const cls = (document.documentElement.className || '').split(/\s+/).filter(c => /^(theme|mode|editor)-/.test(c)).join(' ');
    const bits = [
      '画面=' + (tabEl ? tabEl.id.replace(/^tab-/, '') : '?'),
      '幅=' + window.innerWidth + 'x' + window.innerHeight,
      cls && 'クラス=' + cls,
      rows ? '明細行=' + rows : '',
      sel('cond-mode') && '輸送モード=' + sel('cond-mode'),
      sel('cond-incoterms') && '貿易条件=' + sel('cond-incoterms'),
      ($('qadMode') && g($('qadMode').textContent)) ? '状態=' + g($('qadMode').textContent) : '',
    ];
    return bits.filter(Boolean).join(' / ');
  }

  // ---------------- 要素の説明 ----------------
  const FIELD_LABEL = { nm: '品名', cat: 'カテゴリ', sv: 'サブコン', pt: 'パターン', pq: '数量', un: '単位', pc: '仕入の通貨', pp: '仕入単価', mk: '乗せ幅', bc: '売の通貨', nt: '備考', vf: '有効期間（開始）', vt: '有効期間（終了）', tx: '課税' };
  const KEEP_FIELDS = new Set(['nm', 'cat', 'sv', 'pt', 'un', 'pc', 'bc']);          // 文字を残す明細の欄
  const KEEP_ID = /^(z2(Pol|Pod|Via|Carrier|Service|Icd)|cond-)/;                    // 港・キャリアなど（選択肢はすべて残す）

  function rowNo(el) {
    const tr = el.closest && el.closest('#tableBody tr[id^="row-"]');
    if (!tr) return 0;
    const all = Array.from(document.querySelectorAll('#tableBody tr[id^="row-"]:not([data-virtual="1"])'));
    const i = all.indexOf(tr);
    return i >= 0 ? i + 1 : 0;
  }
  function labelOf(el) {
    const f = el.dataset && el.dataset.field;
    if (f && FIELD_LABEL[f]) return FIELD_LABEL[f];
    if (el.matches('button, a, summary, [role="button"], .cat-btn, label')) {
      const t = g(el.textContent);
      if (t) return cut(t, 26);
    }
    let t = g(el.getAttribute('aria-label'));
    if (!t && el.id) { try { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) t = g(l.textContent); } catch (e) {} }
    if (!t) { const l = el.closest('label'); if (l) t = g(l.textContent); }
    if (!t) t = g(el.placeholder) || g(el.title);
    if (!t) t = g(el.textContent);
    if (!t) t = el.name || el.id || el.tagName.toLowerCase();
    return cut(t, 26);
  }
  // 入力値の見せ方（B：品名・単位・港名などの文字は残し、金額＝数字とお客様名など自由入力の文字は伏せる）
  function valueOf(el) {
    const tag = el.tagName;
    if (tag === 'SELECT') return cut(g((el.options[el.selectedIndex] || {}).text || el.value), 40);
    if (el.type === 'checkbox') return el.checked ? 'ON' : 'OFF';
    if (el.type === 'radio') return g((el.closest('label') || {}).textContent || el.value) || '選択';
    if (el.type === 'file') return '（ファイル）';
    if (el.type === 'date' || el.type === 'datetime-local' || el.type === 'time') return '（日付・時刻）';
    const v = g(el.value);
    if (!v) return '（空にした）';
    const f = el.dataset && el.dataset.field;
    if (tag !== 'TEXTAREA' && ((f && KEEP_FIELDS.has(f)) || KEEP_ID.test(el.id || ''))) return cut(v, 40);
    if (tag !== 'TEXTAREA' && /^[\d.,\s\-+/:¥$€£%*×xX]+$/.test(v)) return '数値 ' + v.replace(/\d/g, '9');
    return '（文字 ' + v.length + ' 字）';
  }
  function describeClick(el) {
    const where = [];
    const n = rowNo(el);
    if (n) where.push('明細' + n + '行目');
    const idv = el.id && !/^row-/.test(el.id) && !/^\d/.test(el.id) ? ' #' + el.id : '';
    return { label: labelOf(el) + idv, where: where.join(' ') };
  }

  // ---------------- 記録 ----------------
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(rec)); } catch (e) {} }
  function push(text, extra) {
    if (!rec) return;
    const tab = document.querySelector('.tab-content.active');
    const s = { t: Math.round((Date.now() - rec.t0) / 100) / 10, tab: tab ? tab.id.replace(/^tab-/, '') : '', text: cut(String(text), 160) };
    if (extra) Object.assign(s, extra);
    const last = rec.steps[rec.steps.length - 1];
    if (last && last.text === s.text && s.t - last.t < 0.6) { last.n = (last.n || 1) + 1; }      // 連打は 1 行にまとめる
    else rec.steps.push(s);
    if (rec.steps.length > MAX_STEPS) rec.steps.splice(30, rec.steps.length - MAX_STEPS);          // 最初の 30 件と直近を残す
    save();
    updateBar();
  }
  function inBar(el) { return !!(el && el.closest && el.closest('#fbBrecBar, #fbOverlay, #fbHelpCard, #fbQuickFab, #fbFabHint')); }

  function onClick(e) {
    if (!rec || e.isTrusted === false) return;
    const raw = e.target;
    if (!(raw instanceof Element) || inBar(raw)) return;
    const el = raw.closest('button, a[href], summary, [role="button"], .cat-btn, label, input[type="checkbox"], input[type="radio"], [onclick]');
    if (!el) return;
    if (el.tagName === 'LABEL' && el.querySelector('input, select, textarea')) return;           // 中の入力欄の変更で記録する
    if (el.matches('input[type="checkbox"], input[type="radio"]')) return;                       // change で記録
    const d = describeClick(el);
    push('「' + d.label + '」を押す' + (d.where ? '（' + d.where + '）' : ''));
  }
  function onChange(e) {
    if (!rec || e.isTrusted === false) return;
    const el = e.target;
    if (!(el instanceof Element) || inBar(el) || !el.matches('input, select, textarea')) return;
    const d = describeClick(el);
    push('「' + d.label + '」' + (el.matches('select') ? 'を選ぶ → ' : 'に入力 → ') + valueOf(el) + (d.where ? '（' + d.where + '）' : ''));
  }
  function onKey(e) {
    if (!rec || e.isComposing) return;
    if (e.shiftKey && (e.ctrlKey || e.metaKey) && e.code === 'KeyL') return;                    // 記録の開始・終了そのもの
    const k = e.key;
    const mod = (e.ctrlKey || e.metaKey);
    if (mod && /^[a-z]$/i.test(k) && !e.altKey) { push('キー操作：' + (e.metaKey ? 'Cmd' : 'Ctrl') + '+' + (e.shiftKey ? 'Shift+' : '') + k.toUpperCase()); return; }
    if (k === 'Escape' || k === 'Delete' || /^F\d+$/.test(k)) push('キー操作：' + k);
  }
  function onErr(e) { if (!rec) return; const m = g((e.message || 'error') + (e.filename ? ' @' + String(e.filename).split('/').pop() + ':' + e.lineno : '')); rec.errors.push(cut(m, 200)); push('⚠ エラーが出た：' + cut(m, 120)); }
  function onRej(e) { if (!rec) return; const m = g('unhandledrejection: ' + ((e.reason && (e.reason.message || e.reason)) || '')); rec.errors.push(cut(m, 200)); push('⚠ エラーが出た：' + cut(m, 120)); }
  function wrapConsole() {
    const orig = console.error;
    console.error = function () {
      try {
        if (rec) {
          const m = g(Array.prototype.slice.call(arguments).map(a => (a && a.message) || (typeof a === 'object' ? '' : String(a))).join(' '));
          if (m) { rec.errors.push(cut(m, 200)); push('⚠ エラーが出た：' + cut(m, 120)); }
        }
      } catch (er) {}
      return orig.apply(console, arguments);
    };
  }
  function wrapToast() {
    if (typeof window.quoteShowToast !== 'function' || window.quoteShowToast === wrappedToast) return;
    origToast = window.quoteShowToast;
    wrappedToast = function (m, type) {
      try { if (rec && !muteToast) push('🔔 通知' + (type && type !== 'info' ? '（' + type + '）' : '') + '：' + cut(g(m), 100)); } catch (er) {}
      return origToast.apply(this, arguments);
    };
    window.quoteShowToast = wrappedToast;
  }
  function unwrapToast() { if (wrappedToast && window.quoteShowToast === wrappedToast && origToast) window.quoteShowToast = origToast; wrappedToast = null; }

  // ---------------- 記録中のバー ----------------
  function mmss(sec) { return Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0'); }
  function updateBar() {
    const i = $('fbBrecInfo');
    if (i && rec) i.textContent = '記録中 ' + mmss((Date.now() - rec.t0) / 1000) + '・' + rec.steps.length + '手順';
  }
  function mountBar() {
    if ($('fbBrecBar')) return;
    const b = document.createElement('div');
    b.id = 'fbBrecBar'; b.className = 'fb-brec-bar'; b.setAttribute('role', 'status');
    b.innerHTML = '<span class="fb-brec-dot"></span><span id="fbBrecInfo" class="fb-brec-info">記録中</span>'
      + '<button type="button" id="fbBrecMark" title="いま不具合が起きた瞬間に押すと、目印と画面の状態を残します">🚩 ここが不具合</button>'
      + '<button type="button" id="fbBrecStop" class="fb-brec-stop" title="Ctrl+Shift+L">⏹ 止めて報告</button>'
      + '<button type="button" id="fbBrecCancel" class="fb-brec-x" title="記録を捨てる" aria-label="記録を捨てる">✕</button>';
    document.body.appendChild(b);
    $('fbBrecMark').addEventListener('click', mark);
    $('fbBrecStop').addEventListener('click', stop);
    $('fbBrecCancel').addEventListener('click', cancel);
  }
  function unmountBar() { const b = $('fbBrecBar'); if (b) b.remove(); }

  let muteToast = false;     // 見張り番自身の通知は手順に混ぜない
  function toast(m, t) { if (typeof window.quoteShowToast !== 'function') return; muteToast = true; try { window.quoteShowToast(m, t || 'info', 5000); } finally { muteToast = false; } }

  // ---------------- 開始・目印・終了 ----------------
  function attach() {
    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    wrapToast();
    mountBar();
    clearInterval(timer); timer = setInterval(updateBar, 1000);
    updateBar();
  }
  function detach() {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('error', onErr);
    window.removeEventListener('unhandledrejection', onRej);
    unwrapToast(); unmountBar(); clearInterval(timer); timer = null;
  }
  function start() {
    if (rec) return;
    const o = $('fbOverlay');
    if (o && o.classList.contains('open')) return;                      // 報告フォームを開いている間は始めない
    rec = { t0: Date.now(), steps: [], errors: [], startState: stateNow() };
    save();
    attach();
    toast('🔴 記録を始めました。不具合を再現してください。終わったら Ctrl+Shift+L（または「止めて報告」）');
  }
  function mark() {
    if (!rec) return;
    push('🚩 ここで不具合に気づいた', { snap: stateNow() });
    toast('🚩 目印をつけました');
  }
  function cancel() {
    if (!rec) return;
    rec = null;
    try { sessionStorage.removeItem(KEY); } catch (e) {}
    detach();
    toast('記録を捨てました');
  }
  function fmtSteps(r) {
    return r.steps.map((s, i) => (i + 1) + '. [' + mmss(s.t) + (s.tab ? '・' + s.tab : '') + '] ' + s.text + (s.n > 1 ? ' ×' + s.n : '')).join('\n');
  }
  function buildReport(r, mode) {
    const marks = r.steps.filter(s => s.snap);
    const dur = Math.round((Date.now() - r.t0) / 1000);
    const lines = [
      modeLine(mode),
      '',
      '【起きたこと】（何がおかしかったか、ここに書いてください）',
      '',
      '【本当はこうなるはず】（期待していた動きを、ここに書いてください）',
      '',
      '【再現手順（自動記録）】',
      r.steps.length ? fmtSteps(r) : '（操作は記録されませんでした）',
      '',
      '【記録の開始時の画面の状態】' + (r.startState || ''),
    ];
    if (marks.length) lines.push('【不具合に気づいた時点の画面の状態】' + marks.map(m => m.snap).join(' ／ '));
    lines.push('【記録の終了時の画面の状態】' + stateNow());
    if (r.errors.length) lines.push('【記録中に出たエラー】\n' + Array.from(new Set(r.errors)).slice(-8).map(e => '- ' + e).join('\n'));
    lines.push('', '（記録 ' + mmss(dur) + '・' + r.steps.length + '手順。金額などの数字・自由入力の文字は伏せています。送る前に内容を確認・修正できます）');
    return lines.join('\n');
  }
  // ---------------- 処理の方法（記録が終わったあとに選ぶ） ----------------
  //   realtime＝⚡ すぐ直す（ほかの報告より先に・届いたら早めに AI が取りかかる）
  //   batch   ＝🕐 まとめて直す（ほかの報告と一緒に、決まった時間にまとめて）
  //   選んだ結果は本文の【処理の方法】と context.recording.mode に入る（scripts/fetch-feedback.js --mode で絞れる）
  const MODES = {
    realtime: { label: '⚡ リアルタイム（すぐ直す）', short: 'リアルタイム' },
    batch: { label: '🕐 バッチ（まとめて直す）', short: 'バッチ' },
  };
  function chooseMode(done) {
    const old = $('fbBrecMode'); if (old) old.remove();
    const w = document.createElement('div');
    w.id = 'fbBrecMode'; w.className = 'fb-brec-mode';
    w.innerHTML = '<div class="fb-brec-mode-box" role="dialog" aria-modal="true" aria-labelledby="fbBrecModeT">'
      + '<h3 id="fbBrecModeT">記録が終わりました。この不具合をどう直しますか？</h3>'
      + '<button type="button" class="fb-brec-mode-btn is-rt" data-mode="realtime"><b>⚡ リアルタイム処理</b><span>すぐ直してほしいとき。ほかの報告より先に取りかかります。</span></button>'
      + '<button type="button" class="fb-brec-mode-btn" data-mode="batch"><b>🕐 バッチ処理</b><span>急がないとき。ほかの報告とまとめて、決まった時間に直します。</span></button>'
      + '<p class="fb-brec-mode-note">このあと報告の下書きが開きます。送る前に、選び直すこともできます。</p>'
      + '</div>';
    document.body.appendChild(w);
    let fin = false;
    const pick = m => {
      if (fin) return; fin = true;
      document.removeEventListener('keydown', onEsc, true);
      w.remove();
      done(MODES[m] ? m : 'batch');
    };
    const onEsc = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); pick('batch'); } };   // 閉じたときは急がない方
    document.addEventListener('keydown', onEsc, true);
    w.addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) pick(b.dataset.mode); });
    try { w.querySelector('[data-mode]').focus(); } catch (e) {}
  }
  function modeLine(m) { return '【処理の方法】' + (MODES[m] || MODES.batch).label; }
  // 報告フォームで選び直したとき（本文の行を書き換える）
  function setMode(m) {
    if (!MODES[m]) return;
    if (window.__fbRecCtx) window.__fbRecCtx.mode = m;
    const body = $('fbBody');
    if (body && /【処理の方法】[^\n]*/.test(body.value)) {
      body.value = body.value.replace(/【処理の方法】[^\n]*/, modeLine(m));
      body.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const sw = $('fbBrecModeSw');
    if (sw) sw.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
  }
  function mountModeSwitch(m) {
    const body = $('fbBody'); if (!body) return;
    let sw = $('fbBrecModeSw');
    if (!sw) {
      sw = document.createElement('div');
      sw.id = 'fbBrecModeSw'; sw.className = 'fb-brec-modesw';
      sw.innerHTML = '<span>処理の方法：</span>'
        + '<button type="button" data-mode="realtime">⚡ リアルタイム</button>'
        + '<button type="button" data-mode="batch">🕐 バッチ</button>';
      sw.addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });
      body.parentNode.insertBefore(sw, body);
    }
    sw.hidden = false;
    setMode(m);
  }
  function stop() {
    if (!rec) return;
    const r = rec;
    rec = null;
    try { sessionStorage.removeItem(KEY); } catch (e) {}
    detach();
    const ctx = { steps: r.steps.length, seconds: Math.round((Date.now() - r.t0) / 1000), marks: r.steps.filter(s => s.snap).length, errors: r.errors.length };
    chooseMode(m => openReport(r, Object.assign(ctx, { mode: m })));
  }
  function openReport(r, ctx) {
    window.__fbRecCtx = ctx;
    if (typeof window.fbOpenQuick !== 'function') { toast('⚠ 報告フォームを開けませんでした', 'warn'); return; }
    window.fbOpenQuick();
    const body = $('fbBody');
    if (body) {
      body.value = buildReport(r, ctx.mode);
      body.dispatchEvent(new Event('input', { bubbles: true }));
      try { body.focus(); body.setSelectionRange(0, 0); body.scrollTop = 0; } catch (e) {}
    }
    mountModeSwitch(ctx.mode);
    const t = $('fbTitle');
    if (t && !t.value) t.value = (ctx.mode === 'realtime' ? '⚡' : '') + '（再現記録）';
  }
  function toggle() { if (rec) stop(); else start(); }

  // ---------------- ショートカット（Ctrl+Shift+L）と再開 ----------------
  document.addEventListener('keydown', e => {
    if (e.isComposing) return;
    if (e.shiftKey && (e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'KeyL') { e.preventDefault(); toggle(); }
  });
  (function resume() {
    let saved = null;
    try { saved = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (!saved || !Array.isArray(saved.steps)) return;
    const go = () => {
      rec = saved; rec.errors = rec.errors || [];
      attach();
      push('（ページを再読み込みした）');
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  })();
  wrapConsole();

  window.bugRecToggle = toggle;
  window.bugRecStart = start;
  window.bugRecStop = stop;
  window.bugRecMark = mark;
  window.bugRecActive = () => !!rec;
  window.bugRecSetMode = setMode;
})();
