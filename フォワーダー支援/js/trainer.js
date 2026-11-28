// ============================================================
// 🎓 AI トレーナー（初めての人に使い方を教える）
//   ① 練習（ツアー）：実際の画面に印（光る枠）を付け、横の吹き出しで 1 歩ずつ案内する。AI は使わない。
//      手順はマニュアルの原稿の ```lesson ブロック（data/manual.js の lessons）。
//   ② 質問：ふだんの言葉で聞くと、マニュアルをもとに AI（Edge Function「ai-trainer」）が答える。
//      送るのは「質問の文・直前のやりとり・いまの画面の名前・関係しそうなマニュアルの章」だけ（案件の中身は送らない）。
//      AI が使えないとき（未ログイン・未設定）は、マニュアルの中から近い章を探して出す。
//   窓口：window.trainerOpen(tab, opt)／trainerClose()／trainerStartLesson(id)／trainerStopLesson()
// ============================================================
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ls = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };

  // ---------- 通信（Edge Function ai-trainer。作りは ai-ocr と同じ） ----------
  const cfg = () => window.CLOUD_CONFIG || {};
  const fnUrl = () => String(cfg().url || '').replace(/\/$/, '') + '/functions/v1/ai-trainer';
  async function post(body) {
    const c = typeof window.cloudGetClient === 'function' ? window.cloudGetClient() : null;
    let s = null;
    try { s = c ? (await c.auth.getSession()).data.session : null; } catch (e) { s = null; }
    if (!s) return { ok: false, error: 'login', message: 'ログインすると AI に質問できます' };
    if (!cfg().url) return { ok: false, error: 'network', message: 'クラウドの接続設定がありません' };
    let res;
    try {
      res = await fetch(fnUrl(), { method: 'POST', headers: { Authorization: 'Bearer ' + s.access_token, apikey: cfg().publishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch (e) { return { ok: false, error: 'network', message: 'AI に接続できませんでした' }; }
    const j = await res.json().catch(() => ({}));
    if (res.status === 404 && !j.error) return { ok: false, error: 'nofunction', message: 'AI トレーナーはまだ準備中です' };
    if (!res.ok || j.ok === false) return { ok: false, error: j.error || 'error', message: j.message || ('エラー（' + res.status + '）') };
    return j;
  }
  let _status = null, _statusAt = 0;
  async function loadStatus() {
    if (_status && Date.now() - _statusAt < 60_000) return _status;
    const r = await post({ action: 'status' });
    _status = r.ok ? { ready: !!r.ready, reason: r.reason || '' } : { ready: false, reason: r.error, message: r.message };
    _statusAt = r.ok ? Date.now() : 0;
    return _status;
  }
  const NOT_READY = {
    login: 'ログインすると、AI に質問できます。いまは、マニュアルの中から近い説明を探して出します。',
    nofunction: 'AI の準備中です（管理者の設定がまだです）。いまは、マニュアルの中から近い説明を探して出します。',
    no_key: 'AI の準備中です（管理者の設定がまだです）。いまは、マニュアルの中から近い説明を探して出します。',
    disabled: 'AI の準備中です（管理者が「使う」設定にするまで使えません）。いまは、マニュアルの中から近い説明を探して出します。',
  };

  // ---------- いまの画面の名前（AI に渡す・案件の中身は渡さない） ----------
  function screenName() {
    const t = document.querySelector('.tab-content.active'); if (!t) return '';
    const b = document.querySelector('.cat-btn[aria-controls="' + t.id + '"]');
    let name = b ? b.textContent.replace(/\s+/g, ' ').trim() : t.id;
    if (t.id === 'tab-quote-make') {
      const dash = document.body.classList.contains('qp-dash-active') || t.classList.contains('qp-dash');
      if (dash) name += '（案件の一覧）';
      else { const s = document.getElementById('tab-quote-make').getAttribute('data-e2'); name += '（入力画面' + (s ? '・ステップ ' + s : '') + '）'; }
    }
    return { tab: t.id, name };
  }

  // ---------- パネル ----------
  let _tab = 'ask', _log = [], _busy = false;
  function ensurePanel() {
    if ($('trnPanel')) return;
    const p = document.createElement('section');
    p.id = 'trnPanel'; p.className = 'trn-panel'; p.hidden = true;
    p.setAttribute('role', 'dialog'); p.setAttribute('aria-label', 'AI トレーナー');
    p.innerHTML =
      '<div class="trn-head"><span class="trn-ic" aria-hidden="true">🎓</span><b>AI トレーナー</b><button type="button" class="trn-x" data-trn="close" aria-label="閉じる">✕</button></div>' +
      '<div class="trn-tabs" role="tablist"><button type="button" role="tab" class="trn-tab" data-trn-tab="ask">💬 質問する</button><button type="button" role="tab" class="trn-tab" data-trn-tab="learn">▶ 練習する</button></div>' +
      '<div class="trn-pane" id="trnAsk">' +
        '<div class="trn-log" id="trnLog" aria-live="polite"></div>' +
        '<div class="trn-status" id="trnStatus" hidden></div>' +
        '<form class="trn-form" id="trnForm"><textarea id="trnQ" rows="2" placeholder="例）LCL の見積はどう作る？" aria-label="質問"></textarea><button type="submit" class="trn-send" id="trnSend">送る</button></form>' +
        '<p class="trn-note">🔒 質問の文と、いま開いている画面の名前だけを送ります。お客様名・金額などは書かないでください。</p>' +
      '</div>' +
      '<div class="trn-pane" id="trnLearn" hidden></div>';
    document.body.appendChild(p);
    p.addEventListener('click', onPanelClick);
    $('trnForm').addEventListener('submit', (e) => { e.preventDefault(); ask($('trnQ').value); });
    $('trnQ').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask($('trnQ').value); } });
  }
  const SUGGEST = ['見積はどうやって作るの？', '仕入・乗せ幅・売値の違いは？', '保存できないときは？', 'PDF の出し方は？', '受注したあとは何をする？'];
  function renderLog() {
    const el = $('trnLog'); if (!el) return;
    if (!_log.length) {
      const sc = screenName();
      el.innerHTML = '<div class="trn-msg trn-ai"><p>こんにちは。アプリの使い方の質問に答えます。' + (sc && sc.name ? '<br>いまは「' + esc(sc.name) + '」の画面ですね。' : '') + '</p></div>' +
        '<div class="trn-sugs">' + SUGGEST.map((q) => '<button type="button" class="trn-sug" data-trn-q="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>';
      return;
    }
    el.innerHTML = _log.map((m) => m.role === 'user'
      ? '<div class="trn-msg trn-me"><p>' + esc(m.text) + '</p></div>'
      : '<div class="trn-msg trn-ai">' + (m.html || '<p>' + esc(m.text) + '</p>') + '</div>').join('') +
      (_busy ? '<div class="trn-msg trn-ai trn-wait"><p>考えています…</p></div>' : '');
    el.scrollTop = el.scrollHeight;
  }
  function renderLearn() {
    const el = $('trnLearn'); if (!el) return;
    const all = [];
    (window.manualChapters ? window.manualChapters() : []).forEach((c) => (c.lessons || []).forEach((L) => all.push({ L, c })));
    const done = JSON.parse(ls.get('trnDone_v1') || '{}');
    el.innerHTML = '<p class="trn-lead">実際の画面に印を付けて、1 歩ずつ案内します。押す場所が光るので、その通りに進めてみてください。</p>' +
      (all.length ? all.map(({ L, c }) => '<div class="trn-lesson"><div><b>' + esc(L.title) + '</b><span>' + esc(c.title) + '・' + L.steps.length + ' 歩' + (done[L.id] ? '・✓ 練習済み' : '') + '</span></div><button type="button" class="trn-go" data-lesson="' + esc(L.id) + '">▶ 始める</button></div>').join('')
        : '<p class="trn-lead">練習はまだありません。</p>') +
      '<button type="button" class="trn-link" data-trn="manual">📘 マニュアルを読む</button>';
  }
  function setTab(t) {
    _tab = t === 'learn' ? 'learn' : 'ask';
    document.querySelectorAll('#trnPanel .trn-tab').forEach((b) => { const on = b.dataset.trnTab === _tab; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    $('trnAsk').hidden = _tab !== 'ask'; $('trnLearn').hidden = _tab !== 'learn';
    if (_tab === 'learn') renderLearn(); else { renderLog(); syncStatus(); }
  }
  async function syncStatus() {
    const st = await loadStatus(); const el = $('trnStatus'); if (!el) return;
    if (st.ready) { el.hidden = true; return; }
    el.hidden = false; el.textContent = NOT_READY[st.reason] || NOT_READY.nofunction;
  }
  function open(tab, opt) {
    ensurePanel();
    const p = $('trnPanel'); p.hidden = false;
    document.body.classList.add('trn-open');
    setTab(tab || _tab);
    if (opt && opt.chapter && window.manualChapters) {
      const c = window.manualChapters().find((x) => x.id === opt.chapter);
      if (c && !$('trnQ').value) $('trnQ').value = '「' + c.title + '」について：';
    }
    if (_tab === 'ask') setTimeout(() => { const q = $('trnQ'); if (q && !(window.matchMedia && matchMedia('(pointer: coarse)').matches)) q.focus(); }, 30);
  }
  function close() { const p = $('trnPanel'); if (p) p.hidden = true; document.body.classList.remove('trn-open'); }
  function onPanelClick(e) {
    const t = e.target.closest('[data-trn],[data-trn-tab],[data-trn-q],[data-lesson],[data-man]'); if (!t) return;
    if (t.dataset.trn === 'close') return close();
    if (t.dataset.trn === 'manual') { close(); if (window.manualOpen) window.manualOpen(); return; }
    if (t.dataset.trnTab) return setTab(t.dataset.trnTab);
    if (t.dataset.trnQ) return ask(t.dataset.trnQ);
    if (t.dataset.lesson) return startLesson(t.dataset.lesson);
    if (t.dataset.man != null) { e.preventDefault(); close(); if (window.manualOpen) window.manualOpen(t.dataset.man); }
  }

  // ---------- 質問 ----------
  function chapterBtns(ids) {
    const all = window.manualChapters ? window.manualChapters() : [];
    return ids.map((id) => all.find((c) => c.id === id)).filter(Boolean)
      .map((c) => '<button type="button" class="trn-ref" data-man="' + esc(c.id) + '">📘 ' + esc(c.title) + '</button>').join('');
  }
  function lessonBtn(id) {
    const L = id && window.manualLesson ? window.manualLesson(id) : null;
    return L ? '<button type="button" class="trn-ref trn-ref-go" data-lesson="' + esc(L.id) + '">▶ 練習する：' + esc(L.title) + '</button>' : '';
  }
  function answerHtml(text, chapters, lesson) {
    const paras = String(text || '').split(/\n{2,}/).map((p) => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
    const refs = chapterBtns(chapters || []) + lessonBtn(lesson);
    return paras + (refs ? '<div class="trn-refs">' + refs + '</div>' : '');
  }
  function localAnswer(q, note) {
    const hits = window.manualSearch ? window.manualSearch(q, 3) : [];
    if (!hits.length) return '<p>' + esc(note || '') + '</p><p>マニュアルの中に、近い説明が見つかりませんでした。言葉を変えて聞くか、右下の ❓ → 🐞 から質問を送ってください。</p>';
    const lesson = hits.map((c) => (c.lessons || [])[0]).find(Boolean);
    return '<p>' + esc(note || 'マニュアルから近い説明を探しました。') + '</p>' +
      hits.map((c) => '<div class="trn-hit"><b>' + esc(c.title) + '</b><span>' + esc(snippet(c.text, q)) + '</span></div>').join('') +
      '<div class="trn-refs">' + chapterBtns(hits.map((c) => c.id)) + (lesson ? lessonBtn(lesson.id) : '') + '</div>';
  }
  function snippet(text, q) {
    const t = String(text || '').replace(/\s+/g, ' ');
    const w = String(q || '').replace(/[？?。、\s]/g, '').slice(0, 2);
    const i = w ? t.indexOf(w) : -1;
    const s = Math.max(0, (i < 0 ? 0 : i) - 30);
    return (s ? '…' : '') + t.slice(s, s + 90) + '…';
  }
  async function ask(raw) {
    const q = String(raw || '').trim().slice(0, 600);
    if (!q || _busy) return;
    ensurePanel(); $('trnQ').value = '';
    _log.push({ role: 'user', text: q }); _busy = true; renderLog();
    const st = await loadStatus();
    if (!st.ready) {
      _busy = false;
      _log.push({ role: 'ai', text: '', html: localAnswer(q, NOT_READY[st.reason] || NOT_READY.nofunction) });
      renderLog(); return;
    }
    const sc = screenName();
    const hits = window.manualSearch ? window.manualSearch(q + ' ' + (sc && sc.name || ''), 4) : [];
    const cur = sc && window.manualForTab ? window.manualForTab(sc.tab) : null;
    const pick = []; [cur].concat(hits).forEach((c) => { if (c && !pick.includes(c)) pick.push(c); });
    const excerpts = pick.slice(0, 4).map((c) => ({ id: c.id, title: c.title, text: String(c.text).slice(0, 3500), lessons: (c.lessons || []).map((L) => ({ id: L.id, title: L.title })) }));
    const history = _log.slice(-7, -1).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', text: String(m.text || '').slice(0, 800) }));
    const level = ls.get('trnLevel_v1') || '初級';
    const r = await post({ action: 'ask', question: q, history, screen: sc ? sc.name : '', level, excerpts, toc: (window.manualChapters ? window.manualChapters() : []).map((c) => ({ id: c.id, title: c.title })) });
    _busy = false;
    if (!r.ok) {
      _log.push({ role: 'ai', text: '', html: localAnswer(q, (r.message || 'AI に答えてもらえませんでした') + '。かわりに、マニュアルから近い説明を探しました。') });
    } else {
      _log.push({ role: 'ai', text: r.answer || '', html: answerHtml(r.answer, r.chapters, r.lesson) });
    }
    renderLog();
  }

  // ---------- 練習（ツアー） ----------
  let _tour = null;
  function ensureTour() {
    if ($('trnTour')) return;
    const t = document.createElement('div');
    t.id = 'trnTour'; t.hidden = true;
    t.innerHTML = '<div class="trn-ring" id="trnRing" aria-hidden="true"></div>' +
      '<div class="trn-bubble" id="trnBubble" role="dialog" aria-live="polite" aria-label="練習の案内">' +
      '<p class="trn-b-h"><span id="trnBTitle"></span><span id="trnBStep"></span></p><p class="trn-b-t" id="trnBText"></p><p class="trn-b-miss" id="trnBMiss" hidden>この場所は、いまの画面には見つかりません。説明だけ読んで「次へ」を押してください。</p>' +
      '<div class="trn-b-acts"><button type="button" class="trn-b-btn" data-tour="stop">やめる</button><span></span><button type="button" class="trn-b-btn" data-tour="prev">← 戻る</button><button type="button" class="trn-b-btn trn-b-pri" data-tour="next">次へ →</button></div></div>';
    document.body.appendChild(t);
    t.addEventListener('click', (e) => { const b = e.target.closest('[data-tour]'); if (!b) return; const a = b.dataset.tour; if (a === 'stop') stopLesson(); else if (a === 'prev') go(_tour.i - 1); else go(_tour.i + 1); });
  }
  function findTarget(sel) {
    if (!sel) return null;
    let els = [];
    try { els = Array.from(document.querySelectorAll(sel)); } catch (e) { return null; }
    return els.find((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; }) || null;
  }
  function place() {
    if (!_tour) return;
    const st = _tour.L.steps[_tour.i], ring = $('trnRing'), bub = $('trnBubble');
    let el = st.sel ? findTarget(st.sel) : null;
    // 場所が無いとき：代わり（else:）があればそちら。代わりの場所も無いなら「見つかりません」
    const alt = st.sel && !el && st.alt && (_tour.waited || !st.alt.sel || findTarget(st.alt.sel)) ? st.alt : null;
    if (alt) el = alt.sel ? findTarget(alt.sel) : null;
    const txt = alt ? alt.text : st.text;
    if ($('trnBText').textContent !== txt) $('trnBText').textContent = txt;
    _tour.el = el;
    $('trnBMiss').hidden = !(st.sel && !el && !alt && _tour.waited) && !(alt && alt.sel && !el && _tour.waited);
    const vw = window.innerWidth, vh = window.innerHeight;
    const bw = Math.min(360, vw - 24);
    bub.style.width = bw + 'px';
    if (!el) {
      ring.style.cssText = 'left:50%;top:50%;width:0;height:0;';
      ring.classList.add('is-none');
      const bh = bub.offsetHeight;
      bub.style.left = Math.round((vw - bw) / 2) + 'px'; bub.style.top = Math.round(Math.max(12, (vh - bh) / 2)) + 'px';
      return;
    }
    ring.classList.remove('is-none');
    const r = el.getBoundingClientRect(), pad = 6;
    ring.style.cssText = 'left:' + (r.left - pad) + 'px;top:' + (r.top - pad) + 'px;width:' + (r.width + pad * 2) + 'px;height:' + (r.height + pad * 2) + 'px;';
    const bh = bub.offsetHeight;
    let top = r.bottom + 14;
    if (top + bh > vh - 8) top = r.top - bh - 14;
    if (top < 8) top = Math.min(vh - bh - 8, Math.max(8, r.bottom + 14));
    let left = r.left + r.width / 2 - bw / 2;
    left = Math.max(12, Math.min(vw - bw - 12, left));
    bub.style.left = Math.round(left) + 'px'; bub.style.top = Math.round(top) + 'px';
  }
  function go(i) {
    if (!_tour) return;
    const n = _tour.L.steps.length;
    if (i >= n) return finishLesson();
    _tour.i = Math.max(0, i); _tour.waited = false;
    const st = _tour.L.steps[_tour.i];
    $('trnBTitle').textContent = _tour.L.title;
    $('trnBStep').textContent = (_tour.i + 1) + ' / ' + n;
    $('trnBText').textContent = st.text;
    const nx = document.querySelector('#trnBubble [data-tour="next"]');
    nx.textContent = _tour.i === n - 1 ? '終わる ✓' : (st.wait ? '次へ（押さずに進む）' : '次へ →');
    document.querySelector('#trnBubble [data-tour="prev"]').disabled = _tour.i === 0;
    const t0 = Date.now();
    clearInterval(_tour.timer);
    let scrolled = false;
    _tour.timer = setInterval(() => {
      if (!_tour) return;
      if (!_tour.waited && Date.now() - t0 > 1500) _tour.waited = true;
      const el = st.sel ? findTarget(st.sel) : null;
      if (el && !scrolled) { scrolled = true; const r = el.getBoundingClientRect(); if (r.top < 60 || r.bottom > window.innerHeight - 60) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      place();
    }, 250);
    place();
  }
  function onDocClick(e) {
    if (!_tour) return;
    const st = _tour.L.steps[_tour.i];
    if (!st || !st.wait || !_tour.el) return;
    if (e.target.closest('#trnTour')) return;
    if (_tour.el.contains(e.target)) { const i = _tour.i; setTimeout(() => { if (_tour && _tour.i === i) go(i + 1); }, 450); }
  }
  function onKey(e) { if (_tour && e.key === 'Escape') { e.stopPropagation(); stopLesson(); } }
  function startLesson(id) {
    const L = window.manualLesson ? window.manualLesson(id) : null;
    if (!L) { if (window.quoteShowToast) window.quoteShowToast('練習が見つかりませんでした', 'warn'); return; }
    stopLesson(true);
    close();
    if (L.open) {
      const tab = document.getElementById(L.open);
      if (!tab || !tab.classList.contains('active')) { const b = document.querySelector('.cat-btn[aria-controls="' + L.open + '"]'); if (b) b.click(); }
    }
    ensureTour();
    _tour = { L, i: 0, timer: 0, el: null, waited: false };
    $('trnTour').hidden = false;
    document.body.classList.add('trn-touring');
    document.addEventListener('click', onDocClick, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    go(0);
  }
  function finishLesson() {
    if (!_tour) return;
    const done = JSON.parse(ls.get('trnDone_v1') || '{}'); done[_tour.L.id] = Date.now(); ls.set('trnDone_v1', JSON.stringify(done));
    stopLesson(true);
    if (window.quoteShowToast) window.quoteShowToast('🎓 練習が終わりました。おつかれさまでした！', 'success');
  }
  function stopLesson(silent) {
    if (!_tour) return;
    clearInterval(_tour.timer); _tour = null;
    const t = $('trnTour'); if (t) t.hidden = true;
    document.body.classList.remove('trn-touring');
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    if (!silent && window.quoteShowToast) window.quoteShowToast('練習をやめました。マニュアルからいつでも再開できます', 'info');
  }

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !_tour) { const p = $('trnPanel'); if (p && !p.hidden && !e.defaultPrevented) close(); } });
  window.trainerOpen = open;
  window.trainerClose = close;
  window.trainerAsk = (q) => { open('ask'); return ask(q); };
  window.trainerStartLesson = startLesson;
  window.trainerStopLesson = () => stopLesson();
  window.trainerActive = () => !!_tour;
})();
