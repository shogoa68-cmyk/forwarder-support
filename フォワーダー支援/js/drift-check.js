/* ===================================================================
 * 🔍 ゆらぎ（表記ゆれ）チェック：定期チェック＋自動対応＋人への振り分け（2026-11）
 *
 * 判定は js/drift-engine.js（純粋関数）。このファイルは、画面のデータを集めて判定にかけ、
 *   ① 自動対応：代表（マスター）が決まっていて、読みが完全に同じ表記 → 別名として自動登録（管理者のログイン時に、前回から 1 週間以上あいていれば。
 *      1 回の上限 100 件。登録は「別名」＝元の案件データは書き換えない。元に戻せる）
 *   ② 要確認：代表が未決定のゆらぎ・綴りや社名の一部がよく似た別々の名前 → マスター管理の上部のカードに出し、1 クリックで決められる
 *   ③ 人間が判断：代表が複数ある・単位（意味が変わりうる）→ 理由つきで一覧に出すだけ（自動では触らない）
 * に仕分ける。AI・外部への送信はなし。保存は、別名＝既存の synonym_groups、記録（自動対応のログ・別物と決めた組・前回の実行日）はこのブラウザ
 * （localStorage）。SQL は不要。
 * =================================================================== */
(function () {
  'use strict';

  const FIELDS = [['customer', 'お客様'], ['sv', 'サブコン'], ['port', '港'], ['nm', '品名'], ['un', '単位']];
  const LBL = Object.fromEntries(FIELDS);
  const LOG_KEY = 'driftLog_v1', RUN_KEY = 'driftLastRun_v1', DISMISS_KEY = 'driftDismissed_v1';
  const INTERVAL_MS = 7 * 86400000;   // 前回の自動チェックからこれだけ経っていれば、管理者のログイン時に走らせる
  const AUTO_CAP = 100;               // 1 回の自動登録の上限（残りは次回）
  const LOG_MAX = 200;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const jget = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (e) { return d; } };
  const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 保存できなくても動く */ } };
  const toast = (m, k, ms) => { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(m, k || 'info', ms || 4000); };
  const isAdmin = () => window._myRole === 'admin';
  const cloudOn = () => typeof window.cloudCurrentUser === 'function' && !!window.cloudCurrentUser();
  const needsApproval = () => typeof window.statsAliasNeedsApproval === 'function' && window.statsAliasNeedsApproval();
  const fmt = t => { const d = new Date(t); return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

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
    const dismissed = new Set(jget(DISMISS_KEY, []));
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
  async function registerAliases(field, items, mode) {
    // items: [{canonical, aliases:[...]}]
    const before = typeof window.synGetNormalizeMap === 'function' ? window.synGetNormalizeMap(field) : {};
    if (needsApproval()) {   // 承認制のメンバーは、1 件ずつ申請になる
      for (const it of items) for (const a of it.aliases) await window.synAddAlias(field, a, it.canonical);
      return { added: 0, requested: items.reduce((s, x) => s + x.aliases.length, 0) };
    }
    const r = await window.synAddAliasesMany(field, items);
    const after = window.synGetNormalizeMap(field);
    const log = jget(LOG_KEY, []);
    let added = 0;
    items.forEach(it => it.aliases.forEach(a => {
      if (after[a] === it.canonical && before[a] !== it.canonical) {
        added++;
        log.unshift({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), at: new Date().toISOString(), field, alias: a, canonical: it.canonical, mode, by: (window.cloudCurrentUser && window.cloudCurrentUser() && window.cloudCurrentUser().email) || '' });
      }
    }));
    jset(LOG_KEY, log.slice(0, LOG_MAX));
    return Object.assign({ added }, r && r.restricted ? { restricted: true } : {});
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
      let res = await analyzeAll();
      if (!res) return null;
      let applied = null;
      if (opts.apply && isAdmin() && counts(res).auto) {
        applied = await applyAuto(res);
        res = await analyzeAll();   // 登録後の状態で判定し直す
      }
      if (opts.apply) jset(RUN_KEY, Date.now());
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
    const last = jget(RUN_KEY, 0);
    const head = '<div class="drift-head"><span class="drift-title">🔍 ゆらぎチェック</span>' +
      `<span class="drift-sub">${last ? '前回の自動チェック ' + esc(fmt(last)) : '自動チェックはまだ実行されていません'}（管理者のログイン時、1 週間おき）</span>` +
      `<button type="button" class="drift-btn drift-run" onclick="driftRunNow()"${_busy ? ' disabled' : ''}>${_busy ? '確認中…' : '今すぐチェック'}</button></div>`;
    const hint = '<p class="drift-note">別名にしても、過去の案件に入っている表記は書き換わりません（統計はまとめて数えられます）。過去の案件の表記も揃えたいときは「エイリアス是正」の一括置換から。</p>';
    let body = '';

    // 自動対応（管理者の実行で登録されたもの＝ログ）＋これから自動で登録されるもの
    const log = jget(LOG_KEY, []).filter(x => !x.undone);
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
        log.slice(0, 12).map(x => `<li><span class="drift-fld">${esc(LBL[x.field] || x.field)}</span>「${esc(x.alias)}」→「${esc(x.canonical)}」<small>${esc(fmt(x.at))}・${x.mode === 'auto' ? '自動' : '手動'}</small> ${isAdmin() ? nameBtn(act({ t: 'undo', id: x.id }), '元に戻す', 'drift-ghost') : ''}</li>`).join('') + '</ul>';
    }
    if (autoInner) body += sec('auto', '✅ 自動対応（読みが完全に同じ）', pend.length + log.slice(0, 12).length, autoInner, 'auto');

    // 要確認
    let rev = '';
    FIELDS.forEach(([f]) => {
      const r = _res[f]; if (!r) return;
      r.pick.forEach(p => {
        rev += `<li><span class="drift-fld">${esc(LBL[f])}</span>読みが同じ表記が複数あります（代表が未決定）：` +
          p.variants.map(v => `「${esc(v.value)}」<small>${v.count}件</small>`).join(' ') + '<div class="drift-actions">' +
          p.variants.map(v => nameBtn(act({ t: 'alias', field: f, canonical: v.value, aliases: p.variants.filter(x => x !== v).map(x => x.value) }), `「${esc(v.value)}」を代表にする`, v.value === p.suggested ? 'drift-primary' : '')).join('') + '</div></li>';
      });
      r.near.slice(0, 40).forEach(n => {
        rev += `<li><span class="drift-fld">${esc(LBL[f])}</span>「${esc(n.a)}」<small>${n.aCount}件</small> ≈ 「${esc(n.b)}」<small>${n.bCount}件</small><span class="drift-why">${esc(n.reason)}</span><div class="drift-actions">` +
          nameBtn(act({ t: 'alias', field: f, canonical: n.suggest.canonical, aliases: [n.suggest.alias] }), `「${esc(n.suggest.alias)}」を「${esc(n.suggest.canonical)}」の別名にする`, 'drift-primary') +
          nameBtn(act({ t: 'alias', field: f, canonical: n.suggest.alias, aliases: [n.suggest.canonical] }), '逆にする', 'drift-ghost') +
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
        (h.kind === 'multi-master' ? '<div class="drift-actions">' + h.masters.slice(0, 3).map(m => nameBtn(act({ t: 'jump', field: f, value: m }), `「${esc(m)}」を開く`, 'drift-ghost')).join('') + '</div>' : '') + '</li>';
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
      const k = window.DriftEngine.pairKey(a.field, a.a, a.b);
      const d = jget(DISMISS_KEY, []); if (!d.includes(k)) d.push(k); jset(DISMISS_KEY, d);
      await analyzeAll(); render(); toast('別物として記録しました（この端末で、今後は候補に出しません）', 'info', 3000); return;
    }
    if (a.t === 'jump') { if (typeof window.statsJumpToMaster === 'function') window.statsJumpToMaster(a.field, a.value, true); return; }
    if (a.t === 'undo') {
      if (!isAdmin()) return;
      const log = jget(LOG_KEY, []); const x = log.find(y => y.id === a.id); if (!x) return;
      if (typeof window.synRemoveAlias === 'function') await window.synRemoveAlias(x.field, x.alias, x.canonical);
      x.undone = true; jset(LOG_KEY, log);
      // 外した名前を、次の自動チェックですぐ同じ別名にしないよう「別物」と同様に覚える
      const d = jget(DISMISS_KEY, []); const k = window.DriftEngine.pairKey(x.field, x.alias, x.canonical); if (!d.includes(k)) d.push(k); jset(DISMISS_KEY, d);
      await analyzeAll(); render(); return;
    }
    if (a.t === 'alias') {
      const r = await registerAliases(a.field, [{ canonical: a.canonical, aliases: a.aliases }], 'manual');
      if (r.requested) toast('📨 管理者への申請を出しました（' + r.requested + ' 件）', 'success');
      else if (r.restricted) toast('マスター・別名の変更は管理者が行います', 'warn');
      else if (r.added) toast('✅ 別名 ' + r.added + ' 件を登録しました', 'success');
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
    if (Date.now() - jget(RUN_KEY, 0) < INTERVAL_MS) { return; }   // まだ前回から間もない
    try {
      if (typeof window.statsRefresh === 'function') await window.statsRefresh();   // 投票（マスター）・別名・詳細を読み込む
    } catch (e) { /* 読めなければ次回 */ }
    if (typeof window.statsMastersReady === 'function' && !window.statsMastersReady()) return;
    await run({ apply: true, notify: true });
  }
  window.addEventListener('load', () => setTimeout(tick, 4000));
  window.driftDebug = { analyzeAll, run, counts: () => counts(_res), res: () => _res };
})();
