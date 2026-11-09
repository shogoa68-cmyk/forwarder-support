// キャリア → サブコン 統合（段階 2）：キャリアのマスターを、サブコンのマスターへ移す（管理者のみ・実行前に一覧で確認・控えを自動ダウンロード）
//   ・そのまま移せる（サブコンに同じ会社が無い）：サブコンのマスターとして新規登録（詳細・別名・グループを引き継ぎ、種別を付ける）
//   ・合流が要る／要判断（サブコンに同じ会社がある）：新しいマスターは作らず、既存のサブコンへ「種別（キャリア系）を足す」
//     「詳細は空欄だけ補う」「別名を足す（キャリア側の別名と、表記が違うキャリア側の名前）」
//   ・元のキャリアのマスターは消さない（段階 3 まで残す）。何度実行しても二重にならない（足りない分だけ足す）
//   種別は、ブックマークの種別（FCL／LCL／AIR／RORO／在来船）から自動で付ける（判定できないものは付けず、一覧に出す）
(function () {
  'use strict';

  const TYPE_LABEL = { FCL: 'FCL CARRIER', LCL: 'LCL CARRIER', AIR: 'AIR CARRIER', RORO: 'RORO CARRIER', BREAKBULK: '在来船 CARRIER' };
  const _esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const _isAdmin = () => window._myRole === 'admin';
  const _toast = (m, t, ms) => { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(m, t || 'success', ms || 3600); };
  const _norm = t => String(t || '').replace(/[\s　]+/g, ' ').trim().toUpperCase();
  const _key = v => String(v || '').normalize('NFKC').toLowerCase().replace(/[\s　.,()（）・\-_'"’]/g, '').replace(/(株式会社|有限会社|co\.?ltd|ltd|inc|corp|kk)$/g, '');
  const _empty = v => v == null || v === '' || (Array.isArray(v) && !v.length);
  const _detail = (f, v) => { const r = typeof window.mdGet === 'function' ? window.mdGet(f, v) : null; return (r && r.details) || {}; };

  // 変更の一覧を作る（何も変更しない）。すでに反映済みの分は含めない
  window.cmBuildPlan = async function () {
    const rep = await window.statsCarrierMigrationReport();
    if (!rep.ok) return { ok: false, notes: rep.notes, steps: [] };
    const svGroups = window.synGetGroups('sv');
    // サブコン側の名前の持ち主（表記を正規化して照合）。別名にしようとする名前が、別のサブコンのものなら、別名にしない
    const svOwner = new Map();
    window.statsGetMasters().filter(m => m.field === 'sv').forEach(m => svOwner.set(_key(m.value), m.value));
    svGroups.forEach(g => { svOwner.set(_key(g.canonical), g.canonical); (g.aliases || []).forEach(a => svOwner.set(_key(a), g.canonical)); });
    const steps = [];
    rep.items.forEach(it => {
      const target = it.kind === 'move' ? it.name : (it.sameSv || it.aliasHits[0]);
      const types = it.bmTypes.map(t => TYPE_LABEL[t]).filter(Boolean);
      const cDet = _detail('carrier', it.name);
      const sDet = _detail('sv', target);
      const step = { carrier: it.name, kind: it.kind, target, create: false, addTypes: [], fillKeys: [], addAliases: [], notes: [], details: null };
      // 1) サブコンのマスター（無ければ新規）
      const svMaster = window.statsGetMasters().some(m => m.field === 'sv' && m.value === target);
      step.create = it.kind === 'move' && !svMaster;
      // 2) 詳細：種別を足し、空欄だけキャリアの詳細で補う
      const merged = Object.assign({}, sDet);
      const curTypes = Array.isArray(sDet.svTypes) ? sDet.svTypes.slice() : [];
      types.forEach(t => { if (!curTypes.some(x => _norm(x) === _norm(t))) { curTypes.push(t); step.addTypes.push(t); } });
      if (curTypes.length) merged.svTypes = curTypes;
      Object.keys(cDet).forEach(k => { if (k === 'svTypes') return; if (!_empty(cDet[k]) && _empty(merged[k])) { merged[k] = cDet[k]; step.fillKeys.push(k); } });
      if (step.addTypes.length || step.fillKeys.length) step.details = merged;
      if (!types.length) step.notes.push('種別を自動判定できません（あとで手動で付けてください）');
      // 3) 別名：キャリア側の別名と、表記が違うキャリア側の名前
      const g = svGroups.find(x => x.canonical === target);
      const have = new Set([target, ...((g && g.aliases) || [])]);
      [...it.aliases, ...(it.kind === 'move' ? [] : [it.name])].forEach(a => {
        if (!a || have.has(a)) return;
        const owner = svOwner.get(_key(a));
        if (owner && owner !== target) { step.notes.push('「' + a + '」はサブコンの別のマスターのため、別名にしません（要確認）'); return; }
        have.add(a); step.addAliases.push(a);
      });
      if (step.create || step.addTypes.length || step.fillKeys.length || step.addAliases.length) steps.push(step);
    });
    const done = rep.items.length - steps.length;
    return { ok: true, notes: rep.notes, steps, total: rep.items.length, done };
  };

  function _backupJson() {
    const masters = window.statsGetMasters();
    const pick = f => ({
      masters: masters.filter(m => m.field === f).map(m => m.value),
      groups: window.synGetGroups(f).map(g => ({ canonical: g.canonical, aliases: g.aliases || [] })),
      details: (typeof window.mdGetAll === 'function' ? window.mdGetAll(f) : []).map(d => ({ value: d.value, details: d.details })),
    });
    return JSON.stringify({ kind: 'carrier-sv-migration-backup', at: new Date().toISOString(), carrier: pick('carrier'), sv: pick('sv') }, null, 2);
  }
  function _download(name, text) {
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return true;
    } catch (e) { return false; }
  }

  // 実行（管理者のみ）。足りない分だけ足すので、途中で止まっても、もう一度実行すれば続きから反映される
  window.cmExecute = async function (opts) {
    opts = opts || {};
    if (!_isAdmin()) { _toast('移行は管理者だけが実行できます', 'warn'); return { ok: false, reason: 'not-admin' }; }
    const plan = await window.cmBuildPlan();
    if (!plan.ok) return { ok: false, reason: 'plan', plan };
    if (opts.backup !== false) _download('carrier-sv-migration-backup-' + new Date().toISOString().slice(0, 10) + '.json', _backupJson());
    const fail = [];
    for (const s of plan.steps) {
      try {
        if (s.create && typeof window.statsEnsureMaster === 'function') await window.statsEnsureMaster('sv', s.target);
        if (s.details) { const ok = await window.mdSave('sv', s.target, s.details); if (!ok) fail.push(s.carrier + '：詳細を保存できませんでした'); }
        for (const a of s.addAliases) await window.synAddAlias('sv', a, s.target);
      } catch (e) { fail.push(s.carrier + '：' + (e && e.message || e)); }
    }
    // 反映の確認（もう一度、一覧を作って残りを数える）
    if (typeof window.statsLoadMasterCache === 'function') await window.statsLoadMasterCache();
    if (typeof window.synLoadCloud === 'function') await window.synLoadCloud();
    if (typeof window.mdLoadCloud === 'function') await window.mdLoadCloud();
    const after = await window.cmBuildPlan();
    if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
    if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive();
    return { ok: true, applied: plan.steps.length, remaining: after.steps.length, fail };
  };

  const _stepLine = s => {
    const parts = [];
    if (s.create) parts.push('🆕 サブコンのマスターとして新規登録');
    if (s.addTypes.length) parts.push('🏷 種別を追加：' + s.addTypes.map(_esc).join('、'));
    if (s.fillKeys.length) parts.push('📇 詳細を補う：' + s.fillKeys.map(_esc).join('、'));
    if (s.addAliases.length) parts.push('🔗 別名を追加：' + s.addAliases.map(_esc).join('、'));
    return `<tr><td>${_esc(s.carrier)}</td><td>${s.create ? '（新規）' : '→ ' + _esc(s.target)}</td><td>${parts.join('<br>') || '—'}${s.notes.map(n => `<div class="cm-na">⚠ ${_esc(n)}</div>`).join('')}</td></tr>`;
  };

  // 変更の一覧の確認画面 → 実行
  window.cmShowPlan = async function () {
    const old = document.getElementById('cmPlanModal'); if (old) old.remove();
    const wrap = document.createElement('div');
    wrap.id = 'cmPlanModal'; wrap.className = 'md-modal-overlay'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = '<div class="md-modal"><div class="md-modal-head"><h3>🔀 移行の変更一覧（実行前の確認）</h3><button type="button" class="md-modal-close" title="閉じる" onclick="document.getElementById(\'cmPlanModal\').remove()">✕</button></div><div class="md-modal-body"><p>作成中…</p></div></div>';
    document.body.appendChild(wrap);
    const body = wrap.querySelector('.md-modal-body');
    const plan = await window.cmBuildPlan();
    if (!plan.ok) { body.innerHTML = '<p class="stats-empty">' + _esc(plan.notes.join(' ')) + '</p>'; return; }
    const admin = _isAdmin();
    body.innerHTML =
      `<p>移行の対象 <b>${plan.total}</b> 社のうち、これから反映するのは <b>${plan.steps.length}</b> 社、すでに反映済みは <b>${plan.done}</b> 社です。</p>` +
      `<ul class="cm-facts"><li>元のキャリアのマスターは<b>消しません</b>（段階 3 まで残ります）。</li><li>実行すると、元のデータの控え（JSON）を自動でダウンロードします。</li><li>足りない分だけ足すので、もう一度実行しても二重に登録されません。</li></ul>` +
      `<table class="stats-table cm-table"><thead><tr><th>キャリア</th><th>移し先（サブコン）</th><th>反映する内容</th></tr></thead><tbody>${plan.steps.map(_stepLine).join('') || '<tr><td colspan="3">反映するものはありません（すべて反映済みです）。</td></tr>'}</tbody></table>` +
      (admin ? `<div class="cm-run"><button type="button" class="master-detail-save" id="cmRunBtn"${plan.steps.length ? '' : ' disabled'}>この内容で移行する</button><span id="cmRunMsg"></span></div>`
             : '<p class="cm-note">移行は管理者が実行します。この一覧を管理者に共有してください。</p>');
    const btn = body.querySelector('#cmRunBtn');
    if (btn) btn.addEventListener('click', async () => {
      const go = typeof window.uiConfirm === 'function'
        ? await window.uiConfirm({ title: 'キャリアをサブコンへ移しますか？', lines: ['上の ' + plan.steps.length + ' 社の変更を、チーム共有のサブコンのマスターへ反映します。', '元のキャリアのマスターは残ります。控えのファイルを自動でダウンロードします。'], okLabel: '移行する' })
        : confirm('移行を実行しますか？');
      if (!go) return;
      btn.disabled = true; body.querySelector('#cmRunMsg').textContent = '　実行中…';
      const r = await window.cmExecute();
      body.querySelector('#cmRunMsg').innerHTML = r.ok
        ? `　✅ ${r.applied} 社を反映しました。未反映：${r.remaining} 社` + (r.fail.length ? '<br>⚠ ' + r.fail.map(_esc).join('<br>⚠ ') : '')
        : '　⚠ 実行できませんでした';
      if (r.ok && !r.remaining) _toast('✅ キャリアのサブコンへの移行が完了しました', 'success', 5000);
      btn.disabled = false;
    });
  };
})();
