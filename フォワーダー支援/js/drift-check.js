/* ===================================================================
 * 🔍 ゆらぎ（表記ゆれ）チェック：定期チェック＋自動対応＋人への振り分け（2026-11）
 *
 * 判定は js/drift-engine.js（純粋関数）。このファイルは、画面のデータを集めて判定にかけ、
 *   ① 自動対応：代表（マスター）が決まっていて、読みが完全に同じ表記 → 別名として自動登録（管理者のログイン時に、前回から 1 週間以上あいていれば。
 *      1 回の上限 100 件。登録は「別名」＝元の案件データは書き換えない。元に戻せる）
 *   ② 要確認：代表が未決定のゆらぎ・綴りや社名の一部がよく似た別々の名前 → マスター管理の上部のカードに出し、1 クリックで決められる
 *   ③ 人間が判断：代表が複数ある・単位（意味が変わりうる）→ 理由つきで一覧に出すだけ（自動では触らない）
 * に仕分ける。AI・外部への送信はなし。保存は、別名＝既存の synonym_groups。記録（登録した別名・元に戻したもの・別物と決めた組・前回の実行日）は
 * チーム共有のテーブル drift_log（docs/sql/drift-log.sql を実行すると共有される。未実行の間はこの端末のブラウザ localStorage に残す）。
 * =================================================================== */
(function () {
  'use strict';

  const FIELDS = [['customer', 'お客様'], ['sv', 'サブコン'], ['port', '港'], ['nm', '品名'], ['un', '単位']];
  const LBL = Object.fromEntries(FIELDS);
  const LEGACY_LOG = 'driftLog_v1', LEGACY_RUN = 'driftLastRun_v1', LEGACY_DISMISS = 'driftDismissed_v1';   // 共有化の前の保存（取り込んだら消す）
  const LOCAL_KEY = 'driftLog_v2', TABLE = 'drift_log';
  const INTERVAL_MS = 7 * 86400000;   // 前回の自動チェックからこれだけ経っていれば、管理者のログイン時に走らせる
  const AUTO_CAP = 100;               // 1 回の自動登録の上限（残りは次回）

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const jget = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できなくても動く */ } };
  const toast = (m, k, ms) => { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(m, k || 'info', ms || 4000); };
  const isAdmin = () => window._myRole === 'admin';
  const cloudOn = () => typeof window.cloudCurrentUser === 'function' && !!window.cloudCurrentUser();
  const needsApproval = () => typeof window.statsAliasNeedsApproval === 'function' && window.statsAliasNeedsApproval();
  const fmt = t => { const d = new Date(t); return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

  // ---------- 記録（チーム共有テーブル drift_log。使えない間はこの端末のブラウザだけ） ----------
  // 1 件＝{id, at, kind:'alias'|'undo'|'dismiss'|'run', mode:'auto'|'manual', field, alias, canonical, by}。追記のみ（書き換え・削除はしない）
  let _entries = [];
  let _shared = false;      // 共有テーブルが使えているか
  let _loaded = false;
  let _warned = false;
  const client = () => (typeof window.cloudGetClient === 'function' ? window.cloudGetClient() : null);
  const me = () => { const u = typeof window.cloudCurrentUser === 'function' ? window.cloudCurrentUser() : null; return (u && u.email) || ''; };
  const keyOf = e => e.field + '\x00' + e.alias + '\x00' + e.canonical;
  const dayOf = e => +new Date(e.at) || 0;

  function localEntries() {
    let a = jget(LOCAL_KEY, null);
    if (Array.isArray(a)) return a;
    a = [];   // 共有化の前（v1）の保存を、同じ形に直して引き継ぐ
    jget(LEGACY_LOG, []).forEach(x => {
      a.push({ id: x.id, at: x.at, kind: 'alias', mode: x.mode, field: x.field, alias: x.alias, canonical: x.canonical, by: x.by || '' });
      if (x.undone) a.push({ at: x.at, kind: 'undo', field: x.field, alias: x.alias, canonical: x.canonical, by: x.by || '' });
    });
    jget(LEGACY_DISMISS, []).forEach(k => { const [f, x, y] = String(k).split('\x00'); if (f && x && y) a.push({ at: new Date(0).toISOString(), kind: 'dismiss', field: f, alias: x, canonical: y, by: '' }); });
    const lr = jget(LEGACY_RUN, 0); if (lr) a.push({ at: new Date(lr).toISOString(), kind: 'run', by: '' });
    jset(LOCAL_KEY, a);
    return a;
  }
  async function loadLog() {
    const c = client();
    if (c && cloudOn()) {
      try {
        const { data, error } = await c.from(TABLE).select('*').order('at', { ascending: true }).limit(5000);
        if (!error) {
          _shared = true; _entries = data || []; _loaded = true;
          await migrateLocal();
          return;
        }
      } catch (e) { /* 共有テーブルが無い（SQL 未実行）ときは、この端末の保存を使う */ }
    }
    _shared = false; _entries = localEntries(); _loaded = true;
  }
  // 共有テーブルが使えるようになったら、この端末に残っていた記録を一度だけ共有へ移す（管理者だけ。別名・元に戻す・実行記録は管理者しか書けないため）
  async function migrateLocal() {
    const loc = jget(LOCAL_KEY, null);
    const legacy = jget(LEGACY_LOG, []).length || jget(LEGACY_DISMISS, []).length || jget(LEGACY_RUN, 0);
    if (!isAdmin() || (!(Array.isArray(loc) && loc.length) && !legacy)) return;
    const rows = localEntries().map(e => ({ at: e.at, kind: e.kind, mode: e.mode || null, field: e.field || null, alias: e.alias || null, canonical: e.canonical || null, by: me(), note: e.note || null }));
    if (rows.length) {
      const { error } = await client().from(TABLE).insert(rows);
      if (error) return;   // 移せなければ、この端末の保存はそのまま残す
      _entries = _entries.concat(rows);
    }
    [LOCAL_KEY, LEGACY_LOG, LEGACY_RUN, LEGACY_DISMISS].forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* 無視 */ } });
    toast('🔍 この端末のゆらぎチェックの記録を、チーム共有へ移しました（' + rows.length + ' 件）', 'info', 5000);
  }
  async function append(list) {
    const now = new Date().toISOString();
    const rows = list.map(e => Object.assign({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), at: now, by: me() }, e));
    if (_shared) {
      const { error } = await client().from(TABLE).insert(rows.map(r => ({ at: r.at, kind: r.kind, mode: r.mode || null, field: r.field || null, alias: r.alias || null, canonical: r.canonical || null, by: r.by, note: r.note || null })));
      if (!error) { _entries = _entries.concat(rows); return true; }
      if (!_warned) { _warned = true; toast('⚠️ ゆらぎチェックの記録を共有に書けませんでした（この端末にだけ残します）：' + error.message, 'warn', 6000); }
    }
    const loc = localEntries().concat(rows); jset(LOCAL_KEY, loc);
    _entries = _entries.concat(rows);
    return false;
  }
  // 記録から、前回の実行日時・「別物／元に戻した」の組・いま有効な登録の一覧（新しい順）を求める
  function derive() {
    const sorted = _entries.slice().sort((a, b) => dayOf(a) - dayOf(b));
    let lastRun = 0; const dismissed = new Set(); const active = new Map();
    sorted.forEach(e => {
      if (e.kind === 'run') lastRun = Math.max(lastRun, dayOf(e));
      else if (e.kind === 'alias') active.set(keyOf(e), e);
      else if (e.kind === 'undo') { active.delete(keyOf(e)); if (window.DriftEngine) dismissed.add(window.DriftEngine.pairKey(e.field, e.alias, e.canonical)); }
      else if (e.kind === 'dismiss') {
        const sn = /^snooze:(\d{4}-\d{2}-\d{2})/.exec(e.note || '');   // 「保留」＝期限まで候補から外す（期限が過ぎたらまた出る）
        if (sn && Date.now() >= +new Date(sn[1] + 'T00:00:00')) return;
        if (window.DriftEngine) dismissed.add(window.DriftEngine.pairKey(e.field, e.alias, e.canonical));
      }
    });
    return { lastRun, dismissed, history: [...active.values()].reverse() };
  }
  const who = by => (by && typeof window.quoteDisplayName === 'function' ? window.quoteDisplayName(by) : by) || '';

  let _res = null;        // 最新の分析 {field: {auto, pick, near, human}}
  let _resAt = 0;
  let _busy = false;
  let _kicked = false;    // カードを開いたときの最初の分析は 1 回だけ自動で始める
  let _acts = [];         // カードのボタンが指す操作（onclick は番号で参照する）
  let _openSec = { auto: false, review: true, human: false };

  // ---------- 分析 ----------
  async function analyzeAll() {
    if (typeof window.statsDriftInput !== 'function' || !window.DriftEngine) return null;
    const input = window.statsDriftInput();
    if (!_loaded) await loadLog();
    const dismissed = derive().dismissed;
    const masters = typeof window.statsGetMasters === 'function' ? window.statsGetMasters() : [];
    const res = {};
    for (const [f] of FIELDS) {
      const ms = new Set(masters.filter(m => m.field === f).map(m => m.value));
      (typeof window.synGetGroups === 'function' ? window.synGetGroups(f) : []).forEach(g => ms.add(g.canonical));
      const aliasMap = typeof window.synGetNormalizeMap === 'function' ? window.synGetNormalizeMap(f) : {};
      const excluded = (typeof window.arGetExclusions === 'function' ? window.arGetExclusions(f) : []).map(e => e.value);
      res[f] = window.DriftEngine.analyze({
        field: f, groups: input[f] || [], masters: ms, aliasMap, dismissed, excluded,
        normalize: v => window.statsNormalizeKey(v, f), humanOnly: f === 'un',
      });
      await new Promise(r => setTimeout(r, 0));   // 画面を固めない
    }
    _res = res; _resAt = Date.now();
    updateBadge();
    return res;
  }
  const counts = res => {
    let auto = 0, review = 0, human = 0;
    FIELDS.forEach(([f]) => { const r = res && res[f]; if (!r) return; auto += r.auto.length; review += r.pick.length + r.near.length; human += r.human.length; });
    return { auto, review, human };
  };
  function updateBadge() {
    const btn = document.querySelector('.cat-btn[aria-controls="tab-master"]'); if (!btn) return;
    let b = document.getElementById('driftTabBadge');
    const c = counts(_res), n = c.review + c.human + c.auto;
    if (!n) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('span'); b.id = 'driftTabBadge'; b.className = 'drift-tab-badge'; btn.appendChild(b); }
    b.textContent = n; b.title = 'ゆらぎチェック：要確認 ' + c.review + ' 件・人が判断 ' + c.human + ' 件' + (c.auto ? '・自動で別名にできるもの ' + c.auto + ' 件' : '');
  }

  // ---------- 別名の登録（自動・手動の共通） ----------
  async function registerAliases(field, items, mode, opts) {
    // items: [{canonical, aliases:[...]}]
    const before = typeof window.synGetNormalizeMap === 'function' ? window.synGetNormalizeMap(field) : {};
    if (needsApproval()) {   // 承認制のメンバーは、1 件ずつ申請になる
      for (const it of items) for (const a of it.aliases) await window.synAddAlias(field, a, it.canonical);
      return { added: 0, requested: items.reduce((s, x) => s + x.aliases.length, 0) };
    }
    // seq：すでにマスターの名前も別名にできるよう、1 件ずつ synAddAlias（詳細の合流・旧別名の引き継ぎも行う）で登録する
    let r = null;
    if (opts && opts.seq) { for (const it of items) for (const a of it.aliases) await window.synAddAlias(field, a, it.canonical); }
    else r = await window.synAddAliasesMany(field, items);
    const after = window.synGetNormalizeMap(field);
    const entries = [];
    items.forEach(it => it.aliases.forEach(a => {
      if (after[a] === it.canonical && before[a] !== it.canonical) entries.push({ kind: 'alias', mode, field, alias: a, canonical: it.canonical });
    }));
    if (entries.length) await append(entries);
    return Object.assign({ added: entries.length }, r && r.restricted ? { restricted: true } : {});
  }

  async function applyAuto(res) {
    if (!isAdmin() || !cloudOn() || typeof window.synAddAliasesMany !== 'function') return { added: 0, total: 0 };
    let left = AUTO_CAP, added = 0, total = 0;
    for (const [f] of FIELDS) {
      if (f === 'un' || !res[f] || !res[f].auto.length) continue;
      const by = new Map();
      for (const x of res[f].auto) { total++; if (left <= 0) continue; left--; if (!by.has(x.canonical)) by.set(x.canonical, []); by.get(x.canonical).push(x.alias); }
      const items = [...by.entries()].map(([canonical, aliases]) => ({ canonical, aliases }));
      if (!items.length) continue;
      const r = await registerAliases(f, items, 'auto');
      added += r.added || 0;
    }
    return { added, total };
  }

  // ---------- 実行 ----------
  async function run(opts) {
    opts = opts || {};
    if (_busy) return null;
    _busy = true; render();
    try {
      await loadLog();   // 他の管理者の記録（元に戻した・別物・前回の実行日）も取り込む
      let res = await analyzeAll();
      if (!res) return null;
      let applied = null;
      if (opts.apply && isAdmin() && counts(res).auto) {
        applied = await applyAuto(res);
        res = await analyzeAll();   // 登録後の状態で判定し直す
      }
      if (opts.apply && isAdmin()) await append([{ kind: 'run' }]);
      if (opts.notify) {
        const c = counts(res);
        if (applied && applied.added) toast('🔍 ゆらぎチェック：別名 ' + applied.added + ' 件を自動登録しました' + (c.review + c.human ? '（要確認 ' + (c.review + c.human) + ' 件：マスター管理で確認できます）' : ''), 'success', 6000);
        else if (c.review + c.human) toast('🔍 ゆらぎチェック：確認が必要なものが ' + (c.review + c.human) + ' 件あります（マスター管理）', 'info', 6000);
      }
      return res;
    } catch (e) {
      console.warn('[drift]', e);
      return null;
    } finally { _busy = false; render(); }
  }
  window.driftRunNow = () => run({ apply: isAdmin(), notify: true });

  // ---------- 「別の名前にまとめる」用：名前の入力ダイアログと、提案する名前 ----------
  function askName(opts) {
    return new Promise(resolve => {
      const ov = document.createElement('div'); ov.className = 'confirm-overlay';
      const dlg = document.createElement('div'); dlg.className = 'confirm-dialog'; dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true');
      const h = document.createElement('h3'); h.className = 'confirm-title'; h.textContent = opts.title; dlg.appendChild(h);
      const body = document.createElement('div'); body.className = 'confirm-body';
      (opts.lines || []).forEach(t => { const p = document.createElement('p'); p.textContent = t; body.appendChild(p); });
      const inp = document.createElement('input'); inp.type = 'text'; inp.id = 'driftMergeName'; inp.className = 'drift-merge-input'; inp.value = opts.value || ''; inp.setAttribute('data-allow-focus', '1');
      body.appendChild(inp); dlg.appendChild(body);
      const act = document.createElement('div'); act.className = 'confirm-actions';
      const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn-cancel'; cancel.textContent = 'やめる';
      const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn-primary'; ok.textContent = opts.okLabel || 'まとめる';
      act.appendChild(cancel); act.appendChild(ok); dlg.appendChild(act); ov.appendChild(dlg); document.body.appendChild(ov);
      const done = v => { document.removeEventListener('keydown', onKey, true); ov.remove(); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } else if (e.key === 'Enter' && document.activeElement === inp) { e.preventDefault(); done(inp.value.trim() || null); } };
      document.addEventListener('keydown', onKey, true);
      cancel.addEventListener('click', () => done(null));
      ok.addEventListener('click', () => done(inp.value.trim() || null));
      ov.addEventListener('pointerdown', e => { if (e.target === ov) done(null); });
      inp.focus(); inp.select();
    });
  }
  // まとめる名前の提案：全部が「社名(括弧)」で社名が同じなら社名、そうでなければ共通の先頭部分、無ければ先頭の名前
  function suggestName(names) {
    const P = window.DriftEngine && window.DriftEngine.parenOf;
    const ps = names.map(n => (P ? P(n) : null));
    if (ps.every(Boolean) && new Set(ps.map(x => x.base.toLowerCase())).size === 1) return ps[0].base;
    let pre = names[0];
    names.forEach(n => { let i = 0; while (i < pre.length && i < n.length && pre[i].toLowerCase() === n[i].toLowerCase()) i++; pre = pre.slice(0, i); });
    pre = pre.replace(/[\s\-_/.,(（・]+$/, '');
    return pre.length >= 3 ? pre : names[0];
  }

  // ---------- カード ----------
  const nameBtn = (idx, label, cls) => `<button type="button" class="drift-btn${cls ? ' ' + cls : ''}" onclick="driftAct(${idx})">${label}</button>`;
  const act = a => { _acts.push(a); return _acts.length - 1; };

  function render() {
    const el = document.getElementById('driftCard'); if (!el) return;
    if (!cloudOn()) { el.innerHTML = ''; return; }
    _acts = [];
    if (!_res) {
      el.innerHTML = '<div class="drift-head"><span class="drift-title">🔍 ゆらぎチェック</span><span class="drift-sub">' + (_busy ? '確認しています…' : '準備しています…') + '</span></div>';
      if (!_busy && !_kicked && typeof window.statsMastersReady === 'function' && window.statsMastersReady()) { _kicked = true; run({ apply: false }); }
      return;
    }
    const c = counts(_res);
    const dv = derive();
    const last = dv.lastRun;
    const head = '<div class="drift-head"><span class="drift-title">🔍 ゆらぎチェック</span>' +
      `<span class="drift-sub">${last ? '前回の自動チェック ' + esc(fmt(last)) : '自動チェックはまだ実行されていません'}（管理者のログイン時、1 週間おき）${_shared ? '・🌐 チームで共有' : '・この端末だけに記録（docs/sql/drift-log.sql を実行すると共有されます）'}</span>` +
      `<button type="button" class="drift-btn drift-run" onclick="driftRunNow()"${_busy ? ' disabled' : ''}>${_busy ? '確認中…' : '今すぐチェック'}</button></div>`;
    const hint = '<p class="drift-note">別名にしても、過去の案件に入っている表記は書き換わりません（統計はまとめて数えられます）。過去の案件の表記も揃えたいときは「エイリアス是正」の一括置換から。</p>';
    let body = '';

    // 自動対応（管理者の実行で登録されたもの＝ログ）＋これから自動で登録されるもの
    const log = dv.history;
    const sec = (key, title, n, inner, tone) => `<details class="drift-sec drift-${tone}"${_openSec[key] ? ' open' : ''} ontoggle="driftToggle('${key}', this.open)"><summary>${title}<span class="drift-count">${n}</span></summary>${inner}</details>`;
    const pend = FIELDS.flatMap(([f]) => (_res[f] ? _res[f].auto.map(x => Object.assign({ field: f }, x)) : []));
    let autoInner = '';
    if (pend.length) {
      autoInner += `<p class="drift-lead">次の表記は、読みが完全に同じで代表が決まっているため、自動で別名になります${isAdmin() ? '（管理者のログイン時・または「今すぐチェック」で）' : '（管理者が実行します）'}。</p><ul class="drift-list">` +
        pend.slice(0, 30).map(x => `<li><span class="drift-fld">${esc(LBL[x.field])}</span>「${esc(x.alias)}」→「${esc(x.canonical)}」<small>（${x.count} 件）</small></li>`).join('') +
        (pend.length > 30 ? `<li class="drift-more">ほか ${pend.length - 30} 件</li>` : '') + '</ul>';
    }
    if (log.length) {
      autoInner += `<p class="drift-lead">最近、登録された別名（自動・手動）。間違いは「元に戻す」で別名を外せます。</p><ul class="drift-list">` +
        log.slice(0, 12).map(x => `<li><span class="drift-fld">${esc(LBL[x.field] || x.field)}</span>「${esc(x.alias)}」→「${esc(x.canonical)}」<small>${esc(fmt(x.at))}・${x.mode === 'auto' ? '自動' : '手動'}${x.by ? '・' + esc(who(x.by)) : ''}</small> ${isAdmin() ? nameBtn(act({ t: 'undo', id: x.id }), '元に戻す', 'drift-ghost') : ''}</li>`).join('') + '</ul>';
    }
    if (autoInner) body += sec('auto', '✅ 自動対応（読みが完全に同じ）', pend.length + log.slice(0, 12).length, autoInner, 'auto');

    // 要確認
    let rev = '';
    FIELDS.forEach(([f]) => {
      const r = _res[f]; if (!r) return;
      r.pick.forEach(p => {
        rev += `<li><span class="drift-fld">${esc(LBL[f])}</span>読みが同じ表記が複数あります（代表が未決定）：` +
          p.variants.map(v => `「${esc(v.value)}」<small>${v.count}件</small>`).join(' ') + '<div class="drift-actions">' +
          p.variants.map(v => nameBtn(act({ t: 'alias', field: f, canonical: v.value, aliases: p.variants.filter(x => x !== v).map(x => x.value) }), `「${esc(v.value)}」を代表にする`, v.value === p.suggested ? 'drift-primary' : '')).join('') +
          nameBtn(act({ t: 'merge', field: f, names: p.variants.map(v => v.value) }), '別の名前にまとめる…', 'drift-ghost') + '</div></li>';
      });
      r.near.slice(0, 40).forEach(n => {
        rev += `<li><span class="drift-fld">${esc(LBL[f])}</span>「${esc(n.a)}」<small>${n.aCount}件</small> ≈ 「${esc(n.b)}」<small>${n.bCount}件</small><span class="drift-why">${esc(n.reason)}</span><div class="drift-actions">` +
          nameBtn(act({ t: 'alias', field: f, canonical: n.suggest.canonical, aliases: [n.suggest.alias] }), `「${esc(n.suggest.alias)}」を「${esc(n.suggest.canonical)}」の別名にする`, 'drift-primary') +
          nameBtn(act({ t: 'alias', field: f, canonical: n.suggest.alias, aliases: [n.suggest.canonical] }), '逆にする', 'drift-ghost') +
          nameBtn(act({ t: 'merge', field: f, names: [n.a, n.b] }), '別の名前にまとめる…', 'drift-ghost') +
          nameBtn(act({ t: 'snooze', field: f, a: n.a, b: n.b }), '保留（30日）', 'drift-ghost') +
          nameBtn(act({ t: 'dismiss', field: f, a: n.a, b: n.b }), '≠ 別物', 'drift-ghost') + '</div></li>';
      });
      if (r.near.length > 40) rev += `<li class="drift-more">${esc(LBL[f])}：ほか ${r.near.length - 40} 件（上から順に片付けると出てきます）</li>`;
    });
    if (rev) body += sec('review', '🟠 要確認（人が「同じ／別物」を決める）', c.review, '<ul class="drift-list">' + rev + '</ul>', 'review');

    // 人間が判断
    let hum = '';
    FIELDS.forEach(([f]) => (_res[f] ? _res[f].human : []).forEach(h => {
      const vs = h.variants.map(v => `「${esc(v.value)}」<small>${v.count}件</small>`).join(' ');
      hum += `<li><span class="drift-fld">${esc(LBL[f])}</span>${vs}<span class="drift-why">${esc(h.note)}</span>` +
        (h.kind === 'multi-master' ? '<div class="drift-actions">' + h.masters.slice(0, 3).map(m => nameBtn(act({ t: 'jump', field: f, value: m }), `「${esc(m)}」を開く`, 'drift-ghost')).join('') + '</div>' : '') +
        (h.kind === 'paren' ? '<div class="drift-actions">' +
          nameBtn(act({ t: 'merge', field: f, names: h.pair }), '同じ会社として別の名前にまとめる…', 'drift-primary') +
          nameBtn(act({ t: 'snooze', field: f, a: h.pair[0], b: h.pair[1] }), '保留（30日）', 'drift-ghost') +
          nameBtn(act({ t: 'dismiss', field: f, a: h.pair[0], b: h.pair[1] }), '≠ 別物（このまま）', 'drift-ghost') + '</div>' : '') + '</li>';
    }));
    if (hum) body += sec('human', '🔵 人が判断（自動では触りません）', c.human, '<ul class="drift-list">' + hum + '</ul>', 'human');

    if (!body) body = '<p class="drift-ok">✅ 確認が必要なゆらぎはありません。</p>';
    el.innerHTML = head + body + hint;
  }
  window.driftRenderCard = render;
  window.driftToggle = (k, open) => { _openSec[k] = !!open; };

  window.driftAct = async function (i) {
    const a = _acts[i]; if (!a) return;
    if (a.t === 'dismiss') {
      await append([{ kind: 'dismiss', field: a.field, alias: a.a, canonical: a.b }]);
      await analyzeAll(); render(); toast('別物として記録しました（今後は候補に出しません' + (_shared ? '。チーム全員に反映されます' : '・この端末のみ') + '）', 'info', 3500); return;
    }
    if (a.t === 'snooze') {
      const d = new Date(Date.now() + 30 * 86400000);
      const ymd = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      await append([{ kind: 'dismiss', field: a.field, alias: a.a, canonical: a.b, note: 'snooze:' + ymd }]);
      await analyzeAll(); render(); toast('30 日間（' + ymd + ' まで）保留にしました。そのあとまた候補に出ます', 'info', 3500); return;
    }
    if (a.t === 'merge') {
      const name = await askName({
        title: '別の名前にまとめる',
        lines: ['次の表記を、ひとつの名前の別名としてまとめます。まとめる名前（マスター名）を入れてください。', a.names.map(n => '・' + n).join('\n'), '過去の案件の表記は書き換わりません（統計はまとめて数えられます）。'],
        value: suggestName(a.names), okLabel: 'この名前でまとめる',
      });
      if (!name) return;
      const r = await registerAliases(a.field, [{ canonical: name, aliases: a.names.filter(x => x !== name) }], 'manual', { seq: true });
      if (r.requested) toast('📨 管理者への申請を出しました（' + r.requested + ' 件）', 'success');
      else if (r.added) toast('✅「' + name + '」に ' + r.added + ' 件をまとめました', 'success');
      await analyzeAll(); render(); return;
    }
    if (a.t === 'jump') { if (typeof window.statsJumpToMaster === 'function') window.statsJumpToMaster(a.field, a.value, true); return; }
    if (a.t === 'undo') {
      if (!isAdmin()) return;
      const x = _entries.find(y => y.id === a.id); if (!x) return;
      if (typeof window.synRemoveAlias === 'function') await window.synRemoveAlias(x.field, x.alias, x.canonical);
      // 外した名前を、次の自動チェックで（他の管理者の端末も含めて）同じ別名にし直さないよう記録する
      await append([{ kind: 'undo', field: x.field, alias: x.alias, canonical: x.canonical }]);
      await analyzeAll(); render(); return;
    }
    if (a.t === 'alias') {
      // 手動の操作は、マスターの名前を別名にする場合（「逆にする」など）もあるため、1 件ずつ synAddAlias（マスターの付け替え・詳細の合流つき）で登録する
      const r = await registerAliases(a.field, [{ canonical: a.canonical, aliases: a.aliases }], 'manual', { seq: true });
      if (r.requested) toast('📨 管理者への申請を出しました（' + r.requested + ' 件）', 'success');
      else if (r.restricted) toast('マスター・別名の変更は管理者が行います', 'warn');
      else if (r.added) toast('✅ 別名 ' + r.added + ' 件を登録しました', 'success');
      else toast('別名を登録できませんでした（すでに登録済みか、書き込みに失敗しました）。マスター管理で状態を確認してください', 'warn', 6000);
      await analyzeAll(); render();
    }
  };

  // ---------- 定期実行（管理者のログイン時・前回から 1 週間以上） ----------
  let _scheduled = false, _tries = 0;
  async function tick() {
    if (_scheduled) return;
    _tries++;
    if (_tries > 40) return;                                  // 約 2 分あきらめる
    if (!cloudOn() || !isAdmin()) return setTimeout(tick, 3000);
    const rows = typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : [];
    if (!rows.length) return setTimeout(tick, 3000);
    _scheduled = true;
    await loadLog();
    if (Date.now() - derive().lastRun < INTERVAL_MS) { return; }   // まだ前回から間もない（共有の記録なので、管理者が何人いても週 1 回だけ）
    try {
      if (typeof window.statsRefresh === 'function') await window.statsRefresh();   // 投票（マスター）・別名・詳細を読み込む
    } catch (e) { /* 読めなければ次回 */ }
    if (typeof window.statsMastersReady === 'function' && !window.statsMastersReady()) return;
    await run({ apply: true, notify: true });
  }
  window.addEventListener('load', () => setTimeout(tick, 4000));
  window.driftDebug = { analyzeAll, run, loadLog, derive, counts: () => counts(_res), res: () => _res, entries: () => _entries, shared: () => _shared, due: () => Date.now() - derive().lastRun >= INTERVAL_MS };
})();
