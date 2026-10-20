// エイリアスルール管理（ゆらぎ是正）
// ④ ルール登録 → ①② 一括置換（ローカル＋クラウド） → ③ 入力補完提供
(function () {
  'use strict';

  const LOCAL_KEY     = 'aliasRules_v1';
  const EXCL_KEY      = 'statsExclusions_v1';
  const ABBREV_KEY    = 'abbrevPairs_v1';
  const TABLE         = 'alias_rules';
  const PRESETS_TABLE = 'quote_presets';

  // cells 配列インデックス（v3 format）
  const CI = { sv: 2, nm: 4, un: 6 };

  // === ストレージ ===

  function _loadLocal() {
    try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); }
    catch (e) { return []; }
  }

  function _loadExclusions() {
    try { return JSON.parse(localStorage.getItem(EXCL_KEY) || '[]'); }
    catch (e) { return []; }
  }
  function _saveExclusions(arr) { localStorage.setItem(EXCL_KEY, JSON.stringify(arr)); }

  function _loadAbbrevPairs() {
    try { return JSON.parse(localStorage.getItem(ABBREV_KEY) || '[]'); }
    catch (e) { return []; }
  }

  // === Supabase ヘルパー ===

  function _c()    { return typeof window.cloudGetClient   === 'function' ? window.cloudGetClient()   : null; }
  function _me()   { const u = typeof window.cloudCurrentUser === 'function' ? window.cloudCurrentUser() : null; return u ? (u.email || '') : ''; }
  function _cloud(){ return !!_c() && !!_me(); }
  // マスター関連（投票・同義グループ・統合ルール・略称・マスター詳細）はクラウド必須（2026-10）。
  // このブラウザの保存分（*_v1）は読み書きに使わず、ログイン後の「チームへ移す」（masterMigrateLocal）にだけ使う
  function _needCloud(what) {
    if (_cloud()) return true;
    if (typeof window.quoteShowToast === 'function')
      window.quoteShowToast('🔒 ' + (what || 'マスター') + 'の登録・変更にはログインが必要です（チーム共有のマスターに保存します）', 'warn', 3600);
    return false;
  }
  window.masterNeedCloud = _needCloud;

  // === ルール取得 ===

  async function _fetchCloud() {
    const c = _c(); if (!c) return [];
    const { data } = await c.from(TABLE).select('*').order('created_at', { ascending: false });
    return data || [];
  }

  let _arCloud = [];   // クラウドの統合ルール（入力候補・代表名の読み替え用のキャッシュ）
  window.arLoadCloud = async function () {
    _arCloud = _cloud() ? await _fetchCloud() : [];
    await _exclLoadCloud();
    return true;
  };
  window.arGetRules = async function (field) {
    if (!_cloud()) return [];
    _arCloud = await _fetchCloud();
    return _arCloud.filter(r => !field || r.field === field);
  };

  // === ルール保存 ===

  window.arSaveRule = async function (field, from_value, to_value) {
    if (!field || !from_value || !to_value) return;
    if (!_needCloud('統合ルール')) return;
    const { error } = await _c().from(TABLE).upsert(
      { field, from_value, to_value, created_by: _me() },
      { onConflict: 'field,from_value' }
    );
    if (error && typeof window.quoteShowToast === 'function') {
      window.quoteShowToast('⚠️ ルールの保存に失敗しました：' + error.message, 'warn', 6000);
    }
    await window.arLoadCloud();
    await _afterChange();
  };

  // === ルール削除 ===

  window.arDeleteRule = async function (id) {
    if (!_needCloud('統合ルール')) return;
    await _c().from(TABLE).delete().eq('id', id);
    await window.arLoadCloud();
    await _afterChange();
  };

  // === 一括置換 ===

  function _applyToData(data, rules) {
    if (!data || typeof data !== 'object') return data;
    const out = JSON.parse(JSON.stringify(data));
    // sv / nm / un は明細行セルに格納
    const rowRules = rules.filter(r => CI[r.field] != null);
    if (rowRules.length && Array.isArray(out.rows)) {
      out.rows.forEach(row => {
        if (row._type !== 'data' || !Array.isArray(row.cells)) return;
        rowRules.forEach(r => {
          const ci = CI[r.field];
          if ((row.cells[ci] || '').trim() === r.from_value.trim()) row.cells[ci] = r.to_value;
        });
      });
    }
    // port は引き合い条件フィールド（z2Pol/z2Pod/z2Via）と複数航路（z2-routes-data）に格納
    const portRules = rules.filter(r => r.field === 'port');
    if (portRules.length && out.fields && typeof out.fields === 'object') {
      const f = out.fields;
      const _rep = cur => {
        const t = (cur || '').trim();
        const hit = portRules.find(r => r.from_value.trim() === t);
        return hit ? hit.to_value : cur;
      };
      ['z2Pol', 'z2Pod', 'z2Via'].forEach(k => { if (f[k] != null) f[k] = _rep(f[k]); });
      if (f['z2-routes-data']) {
        try {
          const rts = JSON.parse(f['z2-routes-data']);
          if (Array.isArray(rts)) {
            rts.forEach(rt => ['pol', 'pod', 'via'].forEach(k => { if (rt[k] != null) rt[k] = _rep(rt[k]); }));
            f['z2-routes-data'] = JSON.stringify(rts);
          }
        } catch (e) {}
      }
    }
    // customer は引き合い条件の qf-customer、carrier は z2Carrier と複数航路（z2-routes-data）に格納
    const custRules = rules.filter(r => r.field === 'customer');
    const carRules  = rules.filter(r => r.field === 'carrier');
    if ((custRules.length || carRules.length) && out.fields && typeof out.fields === 'object') {
      const f = out.fields;
      const _repBy = (list, cur) => {
        const t = (cur || '').trim();
        const hit = list.find(r => r.from_value.trim() === t);
        return hit ? hit.to_value : cur;
      };
      if (custRules.length && f['qf-customer'] != null) f['qf-customer'] = _repBy(custRules, f['qf-customer']);
      if (carRules.length) {
        if (f['z2Carrier'] != null) f['z2Carrier'] = _repBy(carRules, f['z2Carrier']);
        if (f['z2-routes-data']) {
          try {
            const rts = JSON.parse(f['z2-routes-data']);
            if (Array.isArray(rts)) {
              rts.forEach(rt => { if (rt.carrier != null) rt.carrier = _repBy(carRules, rt.carrier); });
              f['z2-routes-data'] = JSON.stringify(rts);
            }
          } catch (e) {}
        }
      }
    }
    return out;
  }

  // data.fields から pol/pod 列値を再導出（cloud.js の列昇格ロジックと同形）。
  // 港の一括置換後にクラウド側の pol/pod 列を整合させるために使う。
  function _derivePortCols(data) {
    const f = (data && data.fields) || {};
    let pol = (f['z2Pol'] || '').trim() || null;
    let pod = (f['z2Pod'] || '').trim() || null;
    if (!pol && !pod) {
      try {
        const rts = JSON.parse(f['z2-routes-data'] || '[]');
        if (Array.isArray(rts) && rts.length) {
          pol = rts.map(r => r.pol).filter(Boolean).join(', ') || null;
          pod = rts.map(r => r.pod).filter(Boolean).join(', ') || null;
        }
      } catch (e) {}
    }
    return { pol, pod };
  }

  // data.fields から customer / carrier 列値を再導出（cloud.js の列昇格ロジックと同形）。
  function _deriveCustCarrierCols(data) {
    const f = (data && data.fields) || {};
    const customer = (f['qf-customer'] || '').trim() || null;
    let carrier = (f['z2Carrier'] || '').trim() || null;
    if (!carrier && !(f['z2Pol'] || '').trim() && !(f['z2Pod'] || '').trim()) {
      try {
        const rts = JSON.parse(f['z2-routes-data'] || '[]');
        if (Array.isArray(rts) && rts.length) carrier = rts.map(r => r.carrier).filter(Boolean).join(', ') || null;
      } catch (e) {}
    }
    return { customer, carrier };
  }

  window.arApplyLocal = async function (rules, dryRun) {
    if (!rules || !rules.length) return 0;
    let presets;
    try { presets = JSON.parse(localStorage.getItem('quotePresets_v1') || '[]'); } catch { presets = []; }
    let count = 0;
    presets.forEach(p => {
      const before = JSON.stringify(p.data);
      p.data = _applyToData(p.data, rules);
      if (JSON.stringify(p.data) !== before) count++;
    });
    if (!dryRun) localStorage.setItem('quotePresets_v1', JSON.stringify(presets));
    return count;
  };

  window.arApplyCloud = async function (rules, dryRun) {
    const c = _c();
    if (!c || !rules || !rules.length) return 0;
    const hasPort = rules.some(r => r.field === 'port');
    const hasCust = rules.some(r => r.field === 'customer');
    const hasCar  = rules.some(r => r.field === 'carrier');
    const { data: presets } = await c.from(PRESETS_TABLE).select('id,data');
    if (!presets) return 0;
    let count = 0;
    for (const p of presets) {
      const before = JSON.stringify(p.data);
      const after  = _applyToData(p.data, rules);
      if (JSON.stringify(after) !== before) {
        if (dryRun) { count++; continue; }   // 件数の事前確認だけ（書き込まない）
        const upd = { data: after };
        // 港の置換時は pol/pod 列も再導出して整合（クラウド一覧の航路フィルタ用）
        if (hasPort) { const { pol, pod } = _derivePortCols(after); upd.pol = pol; upd.pod = pod; }
        // お客様・キャリアの置換時も customer / carrier 列を再導出（一覧の表示・検索用）
        if (hasCust || hasCar) {
          const cc = _deriveCustCarrierCols(after);
          if (hasCust) upd.customer = cc.customer;
          if (hasCar)  upd.carrier  = cc.carrier;
        }
        await c.from(PRESETS_TABLE).update(upd).eq('id', p.id);
        count++;
      }
    }
    return count;
  };

  // === 除外リスト管理 ===

  // 共有テーブル（docs/sql/stats-exclusions.sql）があれば、ログイン中はチーム共有の除外リストを使う。
  // テーブルが無い間・未ログインのときは、従来どおりこのブラウザの保存分（statsExclusions_v1）を使う
  const EXCL_TABLE = 'stats_exclusions';
  let _exclCloud = null;   // null＝共有テーブルが使えない
  async function _exclLoadCloud() {
    if (!_cloud()) { _exclCloud = null; return; }
    const { data, error } = await _c().from(EXCL_TABLE).select('field,value,created_at').order('created_at', { ascending: false });
    _exclCloud = error ? null : (data || []);
  }
  const _exclOn = () => _cloud() && _exclCloud !== null;
  function _exclAll() { return _exclOn() ? _exclCloud : _loadExclusions(); }
  async function _exclAdd(field, value) {
    if (_exclOn()) {
      await _c().from(EXCL_TABLE).upsert({ field, value, created_by: _me() }, { onConflict: 'field,value' });
      await _exclLoadCloud();
      return;
    }
    const arr = _loadExclusions();
    if (!arr.find(e => e.field === field && e.value === value)) {
      arr.unshift({ field, value, created_at: new Date().toISOString() });
      _saveExclusions(arr);
    }
  }

  window.arGetExclusions = function (field) {
    const all = _exclAll();
    return field ? all.filter(e => e.field === field) : all;
  };

  window.arAddExclusion = async function (field, value) {
    if (!field || !value) return;
    await _exclAdd(field, value);
    await _afterChange();
    if (typeof window.statsRefresh === 'function') await window.statsRefresh();
  };

  window.arRemoveExclusion = async function (field, value) {
    if (_exclOn()) {
      await _c().from(EXCL_TABLE).delete().match({ field, value });
      await _exclLoadCloud();
    } else {
      _saveExclusions(_loadExclusions().filter(e => !(e.field === field && e.value === value)));
    }
    await _afterChange();
    if (typeof window.statsRefresh === 'function') await window.statsRefresh();
  };

  // === 略称辞書管理 ===

  // 略称は同義グループ（クラウド）で管理する。このブラウザの略称辞書（abbrevPairs_v1）は移行にだけ使う
  window.arGetAbbrevPairs = function () { return []; };

  window.arAddAbbrevPair = async function (field, abbrev, full) {
    if (!field || !abbrev || !full || abbrev === full) return;
    if (!_needCloud('略称')) return;
    // 略称＝正式名称は「同義グループ」（正式名称が代表・略称が別名）として登録し、チームで共有する
    if (typeof window.synAddAlias === 'function') await window.synAddAlias(field, abbrev, full);
    await _afterChange();
    if (typeof window.statsRefresh === 'function') await window.statsRefresh();
  };


  // 同義グループにまだ載っていない（このブラウザにだけある）略称
  function _abbrevUnshared(pairs) {
    if (typeof window.synGetGroups !== 'function') return [];
    return pairs.filter(p => !window.synGetGroups(p.field).some(g => g.canonical === p.full && (g.aliases || []).includes(p.abbrev)));
  }
  function _abbrevShareHtml(pairs) {
    const n = _abbrevUnshared(pairs).length;
    if (!n) return '';
    return `<p class="ar-abbrev-desc">このブラウザにだけ保存されている略称が ${n} 件あります。` +
      `<button class="ar-add-btn" onclick="arShareAbbrevPairs()" title="同義グループとして登録し、チームの全員の画面で効くようにします">☁️ チームに共有</button></p>`;
  }
  window.arShareAbbrevPairs = async function () {
    const list = _abbrevUnshared(_loadAbbrevPairs());
    if (!list.length || typeof window.synAddAlias !== 'function') return;
    if (!confirm(`略称 ${list.length} 件を同義グループ（正式名称が代表）として登録し、チームで共有します。よろしいですか？`)) return;
    for (const p of list) await window.synAddAlias(p.field, p.abbrev, p.full);
    await _afterChange();
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast(`☁️ 略称 ${list.length} 件を共有しました`, 'success');
  };

  window.arSubmitAbbrevForm = async function () {
    const field  = document.getElementById('arAbbrevField')?.value;
    const abbrev = (document.getElementById('arAbbrevShort')?.value || '').trim();
    const full   = (document.getElementById('arAbbrevFull')?.value  || '').trim();
    if (!abbrev || !full)   { alert('略称と正式名称の両方を入力してください。'); return; }
    if (abbrev === full)    { alert('略称と正式名称が同じです。'); return; }
    await window.arAddAbbrevPair(field, abbrev, full);
    const s = document.getElementById('arAbbrevShort'); if (s) s.value = '';
    const f = document.getElementById('arAbbrevFull');  if (f) f.value = '';
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('✅ 略称を登録しました', 'success');
  };

  // === 名前の突き合わせ（全機能共通） ===
  // 入力候補・ブックマーク・類似見積・自動入力・御見積書の英語名で、同じ会社／品名を同じものとして扱うための共通関数。
  // 以前は機能ごとに照合のしかたが違い（完全一致／大小文字だけ無視／部分一致）、別名で入力するとつながらなかった。

  // 表記の違いを無視した比較キー（stats.js の _normalize と同じ規則。お客様・サブコン・キャリアは法人格も除く）
  const _CORP_RE = /株式会社|有限会社|合同会社|合資会社|\(株\)|\(有\)|\(合\)|\(同\)|\bco\.?,?\s*ltd\b\.?|\binc\b\.?|\bcorp\b\.?|\bllc\b/g;
  function _nameKey(s, field) {
    let t = String(s == null ? '' : s).normalize('NFKC').replace(/^\*+/, '').replace(/【[^】]*】/g, '').toLowerCase();
    if (field === 'customer' || field === 'sv' || field === 'carrier') t = t.replace(_CORP_RE, '');
    t = t.replace(/[\s　・ー―\-\/\\.,，、。()「」『』"'“”]+/g, '')
         .replace(/[ァ-ン]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
    return t || String(s == null ? '' : s).normalize('NFKC').toLowerCase();
  }
  window.nameKey = (field, s) => _nameKey(s, field);

  // field ごとの「名前 → 代表名」の表（同義グループ ＞ 略称辞書 ＞ 統合ルール ＞ マスター）。短時間だけ使い回す
  const _canonCache = {};
  function _canonIndex(field) {
    const c = _canonCache[field];
    if (c && Date.now() - c.at < 2000) return c;
    const exact = new Map(), byKey = new Map();
    const put = (name, canon) => {
      name = String(name || '').trim(); canon = String(canon || '').trim();
      if (!name || !canon) return;
      if (!exact.has(name)) exact.set(name, canon);
      const k = _nameKey(name, field);
      if (k && !byKey.has(k)) byKey.set(k, canon);
    };
    const groups = typeof window.synGetGroups === 'function' ? window.synGetGroups(field) : [];
    groups.forEach(g => { put(g.canonical, g.canonical); (g.aliases || []).forEach(a => put(a, g.canonical)); });
    _arCloud.filter(r => r.field === field).forEach(r => { put(r.to_value, r.to_value); put(r.from_value, r.to_value); });
    const masters = typeof window.statsGetMasters === 'function' ? window.statsGetMasters() : [];
    masters.filter(m => m.field === field).forEach(m => put(m.value, m.value));
    // 代表名どうしが連鎖する場合（A→B、B→C）は最後まで辿る
    const resolve = v => { let x = v, n = 0; while (exact.has(x) && exact.get(x) !== x && n++ < 5) x = exact.get(x); return x; };
    exact.forEach((v, k) => exact.set(k, resolve(v)));
    byKey.forEach((v, k) => byKey.set(k, resolve(v)));
    return (_canonCache[field] = { at: Date.now(), exact, byKey });
  }

  // 入力された名前の代表名。登録が無ければ、そのまま（前後の空白と品名先頭の課税マーク * は除く）
  window.nameCanon = function (field, raw) {
    let v = String(raw == null ? '' : raw).trim();
    if (field === 'nm') v = v.replace(/^\*\s?/, '');
    if (!v) return v;
    const ix = _canonIndex(field);
    return ix.exact.get(v) || ix.byKey.get(_nameKey(v, field)) || v;
  };
  // 代表名とその別名（検索で別名側の登録も拾うため）。fields は 1 つまたは複数（ブックマークはサブコン・キャリア共通）
  window.nameVariants = function (fields, raw) {
    const out = new Set();
    [].concat(fields).forEach(field => {
      const v = String(raw == null ? '' : raw).trim();
      if (!v) return;
      out.add(v);
      const canon = window.nameCanon(field, v);
      out.add(canon);
      _canonIndex(field).exact.forEach((c, name) => { if (c === canon) out.add(name); });
    });
    return [...out];
  };
  // 2 つの名前が同じ会社／品名か
  window.nameSame = function (field, a, b) {
    if (!a || !b) return false;
    return _nameKey(window.nameCanon(field, a), field) === _nameKey(window.nameCanon(field, b), field);
  };
  window.nameCacheClear = function () { Object.keys(_canonCache).forEach(k => delete _canonCache[k]); };

  // === 入力補完用 ===

  window.arGetCanonicals = function (field) {
    return _arCloud.filter(r => r.field === field).map(r => r.to_value);
  };

  function _refreshDatalist() {
    const rules   = _arCloud;
    // マスター一覧（statsGetMasters があればクラウド投票も含む、なければ localStorage フォールバック）
    let masters = [];
    if (typeof window.statsGetMasters === 'function') {
      masters = window.statsGetMasters();
    }

    // masterOnly=true：候補をマスター登録済みの代表名だけにする（別名・略称・統合ルールは候補に出さない）。
    // 表記の揺らぎを入力時点で増やさないため（現在はサブコン欄で使用）
    const _fill = (dlId, field, masterOnly) => {
      const dl = document.getElementById(dlId);
      if (!dl) return;
      const fromRules  = rules.filter(r => r.field === field).map(r => r.to_value);
      const fromMaster = masters.filter(m => m.field === field).map(m => m.value);
      const abbrevPairs = typeof window.arGetAbbrevPairs === 'function' ? window.arGetAbbrevPairs(field) : [];
      const synGroups = typeof window.synGetGroups === 'function' ? window.synGetGroups(field) : [];
      // 候補は代表名だけにする（以前は別名・略称も同じ並びに出て、選ぶたびに表記の揺れが増えていた）。
      // 別名は option の label に入れるので、別名・略称で打っても代表名の候補が出る
      if (typeof window.nameCacheClear === 'function') window.nameCacheClear();
      const canonOf = v => (typeof window.nameCanon === 'function' ? window.nameCanon(field, v) : v);
      const fromCanon = [
        ...fromRules, ...fromMaster,
        ...abbrevPairs.map(p => p.full),
        ...synGroups.map(g => g.canonical),
      ];
      const isCanon = v => canonOf(v) === v;
      const all = masterOnly
        ? [...new Set(fromMaster.filter(isCanon))]
        : [...new Set(fromCanon.filter(isCanon))];
      const aliasesOf = {};
      const addAlias = (canon, a) => { if (a && a !== canon) (aliasesOf[canon] = aliasesOf[canon] || new Set()).add(a); };
      synGroups.forEach(g => (g.aliases || []).forEach(a => addAlias(g.canonical, a)));
      abbrevPairs.forEach(p => addAlias(p.full, p.abbrev));
      rules.filter(r => r.field === field).forEach(r => addAlias(canonOf(r.to_value), r.from_value));
      // マスター詳細のふりがな・英語名称を option label に反映（読みひらがな／英字入力でも候補にヒット）
      const furi = {}, eng = {};
      (typeof window.mdGetAll === 'function' ? window.mdGetAll(field) : []).forEach(m => {
        const d = m.details || {};
        const f = (d.furigana || '').trim();
        const e = (d.enName || '').trim();
        if (f) furi[m.value] = f;
        if (e) eng[m.value] = e;
      });
      const aliasLabel = v => (aliasesOf[v] && aliasesOf[v].size ? '別名: ' + [...aliasesOf[v]].slice(0, 6).join('・') : '');
      // datalist 内の動的 option（data-master）だけを入れ替える
      dl.querySelectorAll('option[data-master]').forEach(o => o.remove());
      // 静的／別処理で作られた同名 option（内蔵DBのキャリア等）があれば重複追加せず、読み・英語名だけ付与する
      const existing = new Map();
      Array.from(dl.children).forEach(o => { if (o.tagName === 'OPTION') existing.set(o.value, o); });
      all.forEach(v => {
        const ex = existing.get(v);
        if (ex) {
          const lab0 = [furi[v], eng[v], aliasLabel(v)].filter(Boolean).join(' / ');
          if (lab0) ex.label = lab0;
          if (furi[v]) ex.dataset.furi = furi[v];
          if (eng[v])  ex.dataset.en   = eng[v];
          if (aliasesOf[v]) ex.dataset.alias = [...aliasesOf[v]].join('|');
          return;
        }
        const o = document.createElement('option');
        o.value = v;
        const lab = [furi[v], eng[v], aliasLabel(v)].filter(Boolean).join(' / ');
        if (lab) o.label = lab;
        if (furi[v]) o.dataset.furi = furi[v];
        if (eng[v])  o.dataset.en   = eng[v];
        if (aliasesOf[v]) o.dataset.alias = [...aliasesOf[v]].join('|');
        o.dataset.master = '1';
        dl.appendChild(o);
      });
    };

    _fill('svSuggestions', 'sv', true);   // サブコンはマスターからの引用のみ
    _fill('nmSuggestions', 'nm');
    _fill('unit-list',     'un');
    _fill('custSuggestions', 'customer');
    _fill('portSuggestions', 'port');
    _fill('carriers-dl',   'carrier');

    // ユニット同義語グループをunitdatalistに追加
    const unDl = document.getElementById('unit-list');
    if (unDl) {
      const uaGroups = typeof window.uaGetGroups === 'function' ? window.uaGetGroups() : [];
      const fromUA = uaGroups.flatMap(g => [g.canonical, ...(g.aliases || [])]);
      fromUA.forEach(v => {
        if (!unDl.querySelector(`option[value="${v.replace(/"/g,'&quot;')}"]`)) {
          const o = document.createElement('option'); o.value = v; o.dataset.master = '1';
          unDl.appendChild(o);
        }
      });
    }
  }
  window.arRefreshDatalist = _refreshDatalist;

  // === クイック登録ステート ===

  let _quickFill = null; // { field, canonical, nonCanonical: string[] }

  window.arSetQuickFill = function (field, canonical, nonCanonical) {
    _quickFill = { field, canonical, nonCanonical: (nonCanonical || []).slice() };
  };

  window.arQuickRegister = async function (idx) {
    if (!_quickFill || idx >= _quickFill.nonCanonical.length) return;
    const from = _quickFill.nonCanonical[idx];
    const { field, canonical } = _quickFill;
    await window.arSaveRule(field, from, canonical);
    _quickFill.nonCanonical.splice(idx, 1);
    await window.arRenderPane();
  };

  window.arExcludeVariant = async function (idx) {
    if (!_quickFill || idx >= _quickFill.nonCanonical.length) return;
    const from = _quickFill.nonCanonical[idx];
    const { field } = _quickFill;
    await _exclAdd(field, from);
    _quickFill.nonCanonical.splice(idx, 1);
    await _afterChange();
    if (typeof window.statsRefresh === 'function') await window.statsRefresh();
    await window.arRenderPane();
  };

  window.arClearQuickFill = async function () {
    _quickFill = null;
    await window.arRenderPane();
  };

  // === レンダリング ===

  function _esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  // onclick の JS 文字列リテラル用
  function _ea(s)  { return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  // HTML value="" 属性用（&#39; が正しい）
  function _eav(s) { return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  window.arRenderPane = async function () {
    const pane = document.getElementById('statsPane-alias');
    if (!pane) return;

    const rules = await window.arGetRules();
    const fields = ['sv', 'carrier', 'customer', 'nm', 'un', 'port'];
    const fieldLabel = { sv: 'サブコン', carrier: 'キャリア', nm: '品名', un: '単位', port: '港', customer: 'お客様' };
    const grouped = {};
    fields.forEach(f => { grouped[f] = rules.filter(r => r.field === f); });

    let h = '<div class="ar-pane">';

    // === クイック登録セクション（バッジクリック時） ===
    if (_quickFill && _quickFill.nonCanonical.length > 0) {
      const fl = fieldLabel[_quickFill.field] || _quickFill.field;
      h += `<div class="ar-quick-section">
  <div class="ar-quick-header">
    <span class="ar-quick-title">⚡ ゆらぎ是正ショートカット — <strong>${_esc(_quickFill.canonical)}</strong>（${fl}）</span>
    <button class="ar-quick-clear" onclick="arClearQuickFill()" title="クリア">✕</button>
  </div>
  <p class="ar-quick-desc">以下の表記を <strong>"${_esc(_quickFill.canonical)}"</strong> に統一するルールをワンクリックで登録できます:</p>
  <div class="ar-quick-items">`;
      _quickFill.nonCanonical.forEach((from, idx) => {
        h += `<div class="ar-quick-item">
    <span class="ar-from">${_esc(from)}</span>
    <span class="ar-arrow-label">→</span>
    <span class="ar-to">${_esc(_quickFill.canonical)}</span>
    <button class="ar-quick-reg-btn" onclick="arQuickRegister(${idx})">＋ 登録</button>
    <button class="ar-quick-excl-btn" onclick="arExcludeVariant(${idx})" title="別物として扱い、ゆらぎ判定から外す">除外</button>
  </div>`;
      });
      h += `  </div>
</div>`;
    } else if (_quickFill && _quickFill.nonCanonical.length === 0) {
      // 全バリアント登録済み
      h += `<div class="ar-quick-section ar-quick-done">
  <span class="ar-quick-title">✅ <strong>${_esc(_quickFill.canonical)}</strong> グループの全ゆらぎを登録しました</span>
  <button class="ar-quick-clear" onclick="arClearQuickFill()">✕</button>
</div>`;
    }

    // 追加フォーム
    const preField = _quickFill ? _quickFill.field : 'sv';
    const preTo    = _quickFill ? _quickFill.canonical : '';
    h += `<div class="ar-add-section">
  <h4 class="ar-section-title">＋ ルール追加</h4>
  <div class="ar-add-form">
    <select id="arField" class="ar-select">
      <option value="sv"${preField==='sv'?' selected':''}>サブコン</option>
      <option value="carrier"${preField==='carrier'?' selected':''}>キャリア</option>
      <option value="customer"${preField==='customer'?' selected':''}>お客様</option>
      <option value="nm"${preField==='nm'?' selected':''}>品名</option>
      <option value="un"${preField==='un'?' selected':''}>単位</option>
      <option value="port"${preField==='port'?' selected':''}>港</option>
    </select>
    <input id="arFrom" class="ar-input" type="text" placeholder="元の表記（ゆらぎ）">
    <span class="ar-arrow-label">→</span>
    <input id="arTo"   class="ar-input" type="text" placeholder="正規形（統一後）" value="${_eav(preTo)}">
    <button class="ar-add-btn" onclick="arSubmitForm()">登録</button>
  </div>
</div>`;

    // ルール一覧
    const hasAny = rules.length > 0;
    if (hasAny) {
      h += `<h4 class="ar-section-title ar-rules-title">📋 登録済みルール（${rules.length}件）</h4>`;
      fields.forEach(field => {
        if (!grouped[field].length) return;
        h += `<div class="ar-group">
  <div class="ar-group-title">${fieldLabel[field]}</div>
  <table class="ar-table"><thead><tr><th>置換元</th><th></th><th>正規形</th><th></th></tr></thead><tbody>`;
        grouped[field].forEach(r => {
          h += `<tr>
    <td class="ar-from">${_esc(r.from_value)}</td>
    <td class="ar-arrow-cell">→</td>
    <td class="ar-to">${_esc(r.to_value)}</td>
    <td><button class="ar-del-btn" onclick="arDeleteRule('${_ea(String(r.id))}')">削除</button></td>
  </tr>`;
        });
        h += '</tbody></table></div>';
      });
    } else {
      h += '<p class="ar-empty">ルールはまだありません。<br>各集計タブのゆらぎを確認してルールを登録してください。</p>';
    }

    // 一括置換
    const cloudOn = _cloud();
    h += `<div class="ar-bulk-section">
  <h4 class="ar-section-title">一括置換</h4>
  <p class="ar-bulk-desc">登録済みルールでプリセットの表記を一括置換します。<strong>この操作は元に戻せません。</strong></p>
  <div class="ar-bulk-btns">
    <button class="ar-bulk-btn ar-bulk-local" onclick="arApplyWithConfirm('local')"${!hasAny?' disabled':''}>💾 ローカルに適用</button>
    ${cloudOn ? `<button class="ar-bulk-btn ar-bulk-cloud" onclick="arApplyWithConfirm('cloud')"${!hasAny?' disabled':''}>☁️ クラウドに適用</button>` : ''}
    ${cloudOn ? `<button class="ar-bulk-btn ar-bulk-both"  onclick="arApplyWithConfirm('both')"${!hasAny?' disabled':''}>🔄 両方に適用</button>` : ''}
  </div>
</div>`;

    // 略称辞書セクション
    const abbrevPairs = _loadAbbrevPairs();
    const abbrevFieldLabel = { sv: 'サブコン', carrier: 'キャリア', nm: '品名', un: '単位', customer: 'お客様', port: '港' };
    h += `<div class="ar-abbrev-section">
  <h4 class="ar-section-title">📖 略称辞書${abbrevPairs.length ? `（${abbrevPairs.length}件）` : ''}</h4>
  <p class="ar-abbrev-desc">略称と正式名称を関連付けます。統計タブで同一グループとして表示され、登録すると同義グループ（正式名称が代表）としてチームで共有されます（例：NTL ＝ NAIGAI TRANS LINES）。</p>${_abbrevShareHtml(abbrevPairs)}
  <div class="ar-add-form">
    <select id="arAbbrevField" class="ar-select">
      <option value="sv">サブコン</option>
      <option value="carrier">キャリア</option>
      <option value="customer">お客様</option>
      <option value="nm">品名</option>
      <option value="un">単位</option>
      <option value="port">港</option>
    </select>
    <input id="arAbbrevShort" class="ar-input" type="text" placeholder="略称（例: NTL）">
    <span class="ar-arrow-label">=</span>
    <input id="arAbbrevFull" class="ar-input" type="text" placeholder="正式名称（例: NAIGAI TRANS LINES）">
    <button class="ar-add-btn" onclick="arSubmitAbbrevForm()">登録</button>
  </div>`;
    // 登録済みの略称は「同義グループ」（統計タブ・マスター）に表示される。このブラウザにだけある古い略称は上の「チームに共有」で移す
    h += '</div>';

    // 除外リスト
    const excl = _exclAll();
    if (excl.length > 0) {
      const fl = { sv: 'サブコン', carrier: 'キャリア', nm: '品名', un: '単位', port: '港', customer: 'お客様' };
      h += `<div class="ar-excl-section">
  <h4 class="ar-section-title">🚫 ゆらぎ判定 除外リスト（${excl.length}件）</h4>
  <p class="ar-excl-desc">以下の表記はゆらぎ判定から外れています（別物として扱います）。</p>
  <table class="ar-table ar-excl-table"><thead><tr><th>種別</th><th>除外値</th><th></th></tr></thead><tbody>`;
      excl.forEach(e => {
        h += `<tr>
    <td>${_esc(fl[e.field] || e.field)}</td>
    <td class="ar-from">${_esc(e.value)}</td>
    <td><button class="ar-del-btn" onclick="arRemoveExclusion('${_ea(e.field)}','${_ea(e.value)}')">解除</button></td>
  </tr>`;
      });
      h += '</tbody></table></div>';
    }

    h += '</div>';
    pane.innerHTML = h;
  };

  window.arSubmitForm = async function () {
    const field = document.getElementById('arField')?.value;
    const from  = (document.getElementById('arFrom')?.value || '').trim();
    const to    = (document.getElementById('arTo')?.value   || '').trim();
    if (!from || !to) { alert('置換元と正規形の両方を入力してください。'); return; }
    if (from === to)  { alert('置換元と正規形が同じです。'); return; }
    await window.arSaveRule(field, from, to);
    const fEl = document.getElementById('arFrom'); if (fEl) fEl.value = '';
    const tEl = document.getElementById('arTo');   if (tEl) tEl.value = '';
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('✅ ルールを登録しました', 'success');
  };

  window.arApplyWithConfirm = async function (target) {
    const rules = await window.arGetRules();
    if (!rules.length) {
      if (typeof window.quoteShowToast === 'function') window.quoteShowToast('ルールが登録されていません', 'warn');
      return;
    }
    const labels = { local: 'このブラウザのプリセット', cloud: 'クラウド（チーム共有）の案件', both: 'このブラウザ＋クラウドの案件' };
    const doLocal = target === 'local' || target === 'both';
    const doCloud = (target === 'cloud' || target === 'both') && _cloud();
    // 書き込む前に「いくつの案件が書き換わるか」を数える（dryRun）
    const nLocal = doLocal ? await window.arApplyLocal(rules, true) : 0;
    const nCloud = doCloud ? await window.arApplyCloud(rules, true) : 0;
    if (!nLocal && !nCloud) {
      if (typeof window.quoteShowToast === 'function') window.quoteShowToast('置換の対象になる案件はありませんでした', 'info');
      return;
    }
    const fl = { sv: 'サブコン', carrier: 'キャリア', customer: 'お客様', nm: '品名', un: '単位', port: '港' };
    const ruleLines = rules.slice(0, 6).map(r => `・${fl[r.field] || r.field}：「${r.from_value}」→「${r.to_value}」`);
    if (rules.length > 6) ruleLines.push(`　ほか ${rules.length - 6} 件のルール`);
    const counts = [doLocal ? `ブラウザ ${nLocal} 件` : '', doCloud ? `クラウド ${nCloud} 件` : ''].filter(Boolean).join('／');
    const ok = await (typeof window.uiConfirm === 'function' ? window.uiConfirm({
      title: `${labels[target]}の表記を一括置換しますか？`,
      lines: [`書き換わる案件：${counts}`, `適用するルール（${rules.length} 件）`, ...ruleLines],
      irreversible: '元に戻せません。提示済み・受注済みの案件も書き換わります。必要なら先にバックアップを取ってください。',
      okLabel: '置換する',
      danger: true,
    }) : Promise.resolve(confirm(`${counts} を書き換えます。元に戻せません。続けますか？`)));
    if (!ok) return;
    let msg = '';
    if (doLocal) msg += `ブラウザ: ${await window.arApplyLocal(rules)} 件更新。`;
    if (doCloud) msg += ` クラウド: ${await window.arApplyCloud(rules)} 件更新。`;
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('✅ ' + msg.trim(), 'success');
    if (typeof window.statsRefresh === 'function') await window.statsRefresh();
  };

  async function _afterChange() {
    _refreshDatalist();
    if (typeof window.arRenderPane === 'function') await window.arRenderPane();
  }

  document.addEventListener('DOMContentLoaded', _refreshDatalist);

  // === 入力支援：統合表記を入力したら代表表記への置換を提案（インライン） ===
  // 入力欄の list 属性 → フィールド種別。これらの datalist は見積タブ内にしか存在しない。
  const _LIST_FIELD = {
    svSuggestions: 'sv', nmSuggestions: 'nm', 'unit-list': 'un',
    custSuggestions: 'customer', portSuggestions: 'port', 'carriers-dl': 'carrier',
  };
  // 入力値が「ある同義グループの統合表記（別名）」なら代表名を返す。代表名そのもの・未登録なら null。
  function _canonicalFor(field, value) {
    const v = (value || '').trim();
    if (!v) return null;
    const map = (field === 'un')
      ? (typeof window.uaGetNormalizeMap === 'function' ? window.uaGetNormalizeMap() : {})
      : (typeof window.synGetNormalizeMap === 'function' ? window.synGetNormalizeMap(field) : {});
    let canon = map[v];
    // 同義グループの完全一致に加え、略称辞書・統合ルール・表記の違い（全角半角・大小・記号・法人格）でも代表名を提案する
    if (!canon && field !== 'un' && typeof window.nameCanon === 'function') {
      // 品名先頭の課税マーク（*）は残したまま、名前の部分だけを比べる
      const mark = field === 'nm' ? (v.match(/^\*\s?/) || [''])[0] : '';
      const base = v.slice(mark.length);
      const c = window.nameCanon(field, base);
      if (c && c !== base) canon = mark + c;
    }
    return (canon && canon !== v) ? canon : null;
  }

  let _suggestEl = null, _suggestTimer = null;
  function _dismissSuggest() {
    if (_suggestTimer) { clearTimeout(_suggestTimer); _suggestTimer = null; }
    if (_suggestEl) { _suggestEl.remove(); _suggestEl = null; }
    document.removeEventListener('scroll', _dismissSuggest, true);
    window.removeEventListener('resize', _dismissSuggest);
  }
  // 入力欄の下に出す小さな提案ポップアップ（共通）。wire(el) でボタンの動作を結ぶ
  function _openSuggest(input, innerHtml, wire, ms) {
    _dismissSuggest();
    const r = input.getBoundingClientRect();
    const el = document.createElement('div');
    el.className = 'syn-suggest';
    el.innerHTML = innerHtml;
    el.style.position = 'fixed';
    el.style.left = Math.round(r.left) + 'px';
    el.style.top  = Math.round(r.bottom + 4) + 'px';
    document.body.appendChild(el);
    // はみ出し補正
    const er = el.getBoundingClientRect();
    if (er.right > window.innerWidth - 8) el.style.left = Math.max(8, window.innerWidth - er.width - 8) + 'px';
    wire(el);
    el.querySelector('.syn-suggest-dismiss').addEventListener('click', _dismissSuggest);
    document.addEventListener('scroll', _dismissSuggest, true);
    window.addEventListener('resize', _dismissSuggest);
    _suggestTimer = setTimeout(_dismissSuggest, ms || 9000);
    _suggestEl = el;
  }
  function _showSynSuggest(input, canonical) {
    _openSuggest(input,
      `<span class="syn-suggest-msg">💡 代表表記 <b>${_esc(canonical)}</b> に揃える？</span>` +
      `<button type="button" class="syn-suggest-apply">置換</button>` +
      `<button type="button" class="syn-suggest-dismiss" title="閉じる">✕</button>`,
      el => el.querySelector('.syn-suggest-apply').addEventListener('click', () => {
        input.value = canonical;
        input.dispatchEvent(new Event('input',  { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        _dismissSuggest();
        try { input.focus(); } catch (e) {}
      }));
  }

  // サブコン欄：マスター未登録の名称を確定したとき、登録するか確認する（揺らぎを増やさないため）
  function _masterValues(field) {
    let masters = [];
    if (typeof window.statsGetMasters === 'function') masters = window.statsGetMasters();
    return masters.filter(m => m.field === field).map(m => m.value);
  }
  function _showMasterRegisterSuggest(input, value) {
    _openSuggest(input,
      `<span class="syn-suggest-msg">⚠️ 「<b>${_esc(value)}</b>」はサブコンのマスターに未登録です</span>` +
      `<button type="button" class="syn-suggest-apply">マスター登録</button>` +
      `<button type="button" class="syn-suggest-dismiss" title="登録せずこのまま使う">このまま使う</button>`,
      el => el.querySelector('.syn-suggest-apply').addEventListener('click', async () => {
        _dismissSuggest();
        // 誤字のまま登録されると、チーム全員の候補に出て表記の揺れの元になるため、ひと呼吸おく
        const asRequest = typeof window.statsIsApprovalOn === 'function' && window.statsIsApprovalOn();
        if (!confirm('サブコン「' + value + '」' + (asRequest ? 'のマスター登録を申請します（管理者の承認後に、チーム全員の入力候補に出ます）。' : 'をマスターに登録します。\nチーム全員の入力候補に出ます。') +
          '\n表記（社名・略称・全角半角）に誤りがないか確認してください。\n\nよろしいですか？')) return;
        if (typeof window.statsEnsureMaster === 'function') await window.statsEnsureMaster('sv', value);
        const prev = (typeof window.mdGet === 'function' && window.mdGet('sv', value))?.details || {};
        if (typeof window.mdSave === 'function') await window.mdSave('sv', value, prev);
        _refreshDatalist();
        if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive();
        if (!asRequest && typeof window.quoteShowToast === 'function') window.quoteShowToast('📇 サブコン「' + value + '」をマスター登録しました', 'success', 2800);
      }),
      12000);
  }
  // 未登録のサブコン名を確認。マスターが1件も無い間（未整備・読込前）は出さない。
  // 空白・大小文字・全半角だけ違うマスターがあれば、登録を促す前に「代表表記に揃える」を提案する
  function _checkSubconMaster(input) {
    const v = (input.value || '').trim();
    if (!v) { _dismissSuggest(); return; }
    const masters = _masterValues('sv');
    if (!masters.length || masters.includes(v)) { _dismissSuggest(); return; }
    const key = (typeof window.subconNormKey === 'function') ? window.subconNormKey(v) : v.toLowerCase();
    const near = masters.find(m => ((typeof window.subconNormKey === 'function') ? window.subconNormKey(m) : m.toLowerCase()) === key);
    if (near) _showSynSuggest(input, near);
    else _showMasterRegisterSuggest(input, v);
  }

  // 入力確定（change＝blur時など）で別名一致を判定して提案
  document.addEventListener('change', function (e) {
    const t = e.target;
    if (!t || t.tagName !== 'INPUT') return;
    const field = _LIST_FIELD[t.getAttribute('list')];
    if (!field) return;
    if (!t.closest || !t.closest('#tab-quote-make')) return;   // 見積タブ内のみ
    // ふりがな（読み）そのままの確定 → マスター値に自動変換（例: かいじょううんちん → 海上運賃）
    // ※ 同期変換すると sv 欄では renderSubconGroups の DOM 並べ替え中に再発火した change が
    //    レンダリングと競合するため、setTimeout で描画完了後に変換する
    const fv = (typeof window.mdValueForFurigana === 'function') ? window.mdValueForFurigana(field, t.value) : null;
    if (fv && fv !== t.value) {
      const orig = t.value;
      setTimeout(() => {
        if (t.value !== orig) return;  // 変換待ちの間にユーザーが編集していたら何もしない
        t.value = fv;
        t.dispatchEvent(new Event('input',  { bubbles: true }));
        t.dispatchEvent(new Event('change', { bubbles: true }));  // nm オートフィル・グループ再描画等を連動（変換後は再変換されない）
        if (typeof window.quoteShowToast === 'function') window.quoteShowToast('🔤 ふりがなから「' + fv + '」に変換しました', 'info', 2000);
      }, 0);
      return;
    }
    const canon = _canonicalFor(field, t.value);
    _markUnregistered(t, field, !canon);
    if (canon) _showSynSuggest(t, canon);
    else if (field === 'sv') _checkSubconMaster(t);   // サブコンはマスター引用：未登録なら確認
    else _dismissSuggest();
  });

  // 品名・港・お客様・キャリア：マスター（入力候補）に無い名前に、控えめな印を付ける（吹き出しは出さない＝入力の邪魔をしない）。
  // そのまま使ってよいが、新人が「合っているのか」を確認できるように。マスターが 1 件も無い間（未整備・読込前）は付けない
  const _UNREG_FIELDS = ['nm', 'port', 'customer', 'carrier'];
  function _markUnregistered(input, field, check) {
    if (!_UNREG_FIELDS.includes(field)) return;
    let v = (input.value || '').trim();
    if (field === 'nm') v = v.replace(/^\*\s?/, '');
    let unreg = false;
    if (check && v) {
      const dl = document.getElementById(input.getAttribute('list'));
      const known = new Set(dl ? Array.from(dl.children).map(o => o.value) : []);
      const canon = typeof window.nameCanon === 'function' ? window.nameCanon(field, v) : v;
      unreg = known.size > 0 && !known.has(v) && !known.has(canon);
    }
    input.classList.toggle('name-unregistered', unreg);
    if (unreg) {
      if (!input.dataset.titleOrig) input.dataset.titleOrig = input.getAttribute('title') || '';
      input.title = '「' + v + '」は入力候補（マスター）にない名前です。そのまま使えますが、表記に誤りがないか確認してください。';
    } else if (input.dataset.titleOrig !== undefined) {
      input.title = input.dataset.titleOrig; delete input.dataset.titleOrig;
    }
  }

  // お客様ご担当者：読み（ひらがな／カタカナ）をそのまま確定したら、マスター登録の氏名へ変換
  document.addEventListener('change', function (e) {
    const t = e.target;
    if (!t || t.id !== 'qf-person' || !t.closest || !t.closest('#tab-quote-make')) return;
    const sq = x => _toHira(x).replace(/[\s\u3000]+/g, '');   // 姓名間の空白は無視して比較
    const v = sq(t.value);
    if (!v) return;
    const dl = document.getElementById('qfPersonSuggestions');
    const hit = dl && Array.from(dl.children).find(o => o.dataset.furi && sq(o.dataset.furi) === v);
    if (!hit || hit.value === t.value) return;
    t.value = hit.value;
    t.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('🔤 ふりがなから「' + hit.value + '」に変換しました', 'info', 2000);
  });

  // === 入力中の候補並び替え：読み（ふりがな）・名称が前方一致する候補を datalist 先頭へ ===
  // Chrome 系の datalist ドロップダウンは option の DOM 順で表示されるため、
  // 入力のたびに「前方一致 → 部分一致 → その他」の順に option を並べ替える。
  // （例: 「か」入力時、かいじょううんちん（海上運賃）を ゆしゅつつうかんりょう より先頭に）
  document.addEventListener('input', function (e) {
    const t = e.target;
    if (!t || t.tagName !== 'INPUT') return;
    const listId = t.getAttribute('list');
    const field = _LIST_FIELD[listId] || (listId === 'qfPersonSuggestions' ? 'person' : null);
    if (!field) return;
    if (!t.closest || !t.closest('#tab-quote-make')) return;
    const dl = document.getElementById(listId);
    if (!dl) return;
    const norm = s => _toHira(s).toLowerCase();
    const q = norm(t.value);
    if (!q) return;
    const opts = Array.from(dl.children).filter(o => o.tagName === 'OPTION');
    const rank = o => {
      // 候補の照合対象：値・ふりがな・英語名称・別名（それぞれ単独で前方一致を判定）
      const keys = [o.value, o.dataset.furi, o.dataset.en, ...(o.dataset.alias ? o.dataset.alias.split('|') : [])].filter(Boolean).map(norm);
      if (keys.some(k => k.startsWith(q))) return 0;  // 前方一致
      if (keys.some(k => k.includes(q)))   return 1;  // 部分一致
      return 2;
    };
    const ranked = opts.map((o, i) => ({ o, i, r: rank(o) }));
    // 既に並び順が正しければ DOM を触らない（ドロップダウンのちらつき防止）
    let needSort = false;
    for (let k = 1; k < ranked.length; k++) {
      if (ranked[k].r < ranked[k - 1].r) { needSort = true; break; }
    }
    if (!needSort) return;
    ranked.sort((a, b) => a.r - b.r || a.i - b.i);
    ranked.forEach(x => dl.appendChild(x.o));
  });


  const UA_KEY = 'unitAlias_v1';
  // 統計タブでは品名/サブコン/キャリア等の描画中に行・チップ単位で繰り返し呼ばれるため、
  // 毎回 JSON.parse し直すとデータ量に比例して重くなる。保存時のみ無効化するキャッシュで
  // 同一レンダリング内の再パースを避ける。
  let _uaCache = null;
  function _loadUA()  {
    if (_uaCache !== null) return _uaCache;
    try { _uaCache = JSON.parse(localStorage.getItem(UA_KEY) || '[]'); } catch(e) { _uaCache = []; }
    return _uaCache;
  }
  function _saveUA(a) { _uaCache = a; localStorage.setItem(UA_KEY, JSON.stringify(a)); }
  function _notifyUA() {
    _refreshDatalist();
    if (typeof window.statsRefreshUnPane === 'function') window.statsRefreshUnPane();
  }

  window.uaGetGroups = function() { return _loadUA(); };

  window.uaGetNormalizeMap = function() {
    const map = {};
    _loadUA().forEach(g => { (g.aliases || []).forEach(a => { map[a] = g.canonical; }); });
    return map;
  };

  window.uaSetCanonical = function(unit) {
    if (!unit) return;
    const groups = _loadUA();
    groups.forEach(g => { g.aliases = (g.aliases || []).filter(a => a !== unit); });
    if (!groups.find(g => g.canonical === unit))
      groups.push({ id: Date.now() + '_' + Math.random().toString(36).slice(2), canonical: unit, aliases: [] });
    _saveUA(groups);
    _notifyUA();
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('⭐ 「' + unit + '」を代表単位に設定しました', 'success');
  };

  // 代表単位の新規入力・編集（リネーム）。旧名称は別名として残す。
  window.uaRenameCanonical = function(oldCanon, newCanon) {
    oldCanon = (oldCanon || '').trim(); newCanon = (newCanon || '').trim();
    if (!oldCanon || !newCanon || oldCanon === newCanon) return;
    const groups = _loadUA();
    const old    = groups.find(g => g.canonical === oldCanon);
    const target = groups.find(g => g.canonical === newCanon);
    const merged = new Set([
      ...(target ? (target.aliases || []) : []),
      ...(old ? (old.aliases || []) : []),
      oldCanon,
    ]);
    merged.delete(newCanon);
    const out = groups.filter(g => g.canonical !== oldCanon && g.canonical !== newCanon);
    out.push({ id: (old && old.id) || (Date.now() + '_' + Math.random().toString(36).slice(2)), canonical: newCanon, aliases: [...merged] });
    _saveUA(out);
    _notifyUA();
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('✏️ 代表単位を「' + newCanon + '」に変更しました', 'success');
  };

  window.uaAddAlias = function(alias, canonical) {
    if (!alias || !canonical || alias === canonical) return;
    const groups = _loadUA();
    groups.forEach(g => { g.aliases = (g.aliases || []).filter(a => a !== alias); });
    let g = groups.find(g => g.canonical === canonical);
    if (!g) { g = { id: Date.now() + '_' + Math.random().toString(36).slice(2), canonical, aliases: [] }; groups.push(g); }
    if (!g.aliases.includes(alias)) g.aliases.push(alias);
    _saveUA(groups);
    _notifyUA();
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('✅ 「' + alias + '」→「' + canonical + '」に統合しました', 'success');
  };

  window.uaRemoveAlias = function(alias, canonical) {
    const groups = _loadUA();
    const g = groups.find(g => g.canonical === canonical);
    if (g) g.aliases = (g.aliases || []).filter(a => a !== alias);
    _saveUA(groups);
    _notifyUA();
  };

  window.uaRemoveGroup = function(canonical) {
    _saveUA(_loadUA().filter(g => g.canonical !== canonical));
    _notifyUA();
  };

  window.uaShowMergePicker = function(unit, btn) {
    document.querySelectorAll('.ua-inline-picker').forEach(el => el.remove());
    const groups = _loadUA();
    if (!groups.length) {
      if (typeof window.quoteShowToast === 'function') window.quoteShowToast('⭐ 先に代表単位を設定してください', 'warn');
      return;
    }
    const row = btn.closest('tr');
    if (!row) return;
    const selId = 'uaPS_' + Math.random().toString(36).slice(2);
    const _ej = s => String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const tr = document.createElement('tr');
    tr.className = 'ua-inline-picker';
    tr.innerHTML =
      `<td colspan="4" class="ua-picker-cell">` +
      `<span class="ua-picker-label">「${unit.replace(/&/g,'&amp;').replace(/</g,'&lt;')}」を統合する代表：</span>` +
      `<select class="ua-picker-sel" id="${selId}">` +
      groups.map(g => `<option value="${_eav(g.canonical)}">${_esc(g.canonical)}</option>`).join('') +
      `</select>` +
      `<button class="ua-picker-ok" onclick="uaConfirmMerge('${_ej(unit)}','${selId}')">統合する</button>` +
      `<button class="ua-picker-cancel" onclick="document.querySelectorAll('.ua-inline-picker').forEach(function(e){e.remove()})">✕</button>` +
      `</td>`;
    row.after(tr);
  };

  window.uaConfirmMerge = function(unit, selId) {
    const sel = document.getElementById(selId);
    if (!sel) return;
    window.uaAddAlias(unit, sel.value);
    document.querySelectorAll('.ua-inline-picker').forEach(el => el.remove());
  };

  // === フィールド対応 同義グループ（⭐代表→統合・非破壊・クラウド共有 + ローカルフォールバック） ===
  //   対象フィールド: sv / nm / customer / port（単位 un は上記 ua* の専用機構を継続使用）
  //   保存: cloud = synonym_groups テーブル（チーム共有）、ローカル = synonymGroups_v1
  //   形式: [{ id, field, canonical, aliases: [] }]
  const SYN_KEY   = 'synonymGroups_v1';
  const SYN_TABLE = 'synonym_groups';
  let _synCloud = null;          // cloud キャッシュ（未ロード時 null）
  let _synTableMissing = false;  // テーブル未作成を検知したら以後ローカルにフォールバック

  // 有効なソース（ログイン中でキャッシュ済みなら cloud、なければ local）
  function _synAll() {
    return (_cloud() && _synCloud !== null) ? _synCloud : [];   // クラウド必須（未ログイン・読込前は空）
  }
  function _synMissingErr(error) {
    return error && /relation|does not exist|schema cache|not find/i.test(error.message || '');
  }

  // Supabase（PostgREST）は 1 回の取得が最大 1000 行。超える分は黙って切り捨てられ、
  // 後から登録した項目（候補・マスター）が丸ごと欠けるため、range で全件を取り切る。
  async function _selectAll(makeQuery) {
    const PAGE = 1000, out = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await makeQuery().range(from, from + PAGE - 1);
      if (error) return { data: null, error };
      out.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return { data: out, error: null };
  }

  window.synLoadCloud = async function () {
    if (!_cloud() || _synTableMissing) { _synCloud = null; return false; }
    const { data, error } = await _selectAll(() => _c().from(SYN_TABLE).select('id,field,canonical,aliases').order('id'));
    if (error) { if (_synMissingErr(error)) _synTableMissing = true; _synCloud = null; return false; }
    _synCloud = (data || []).map(r => ({
      id: r.id, field: r.field, canonical: r.canonical,
      aliases: Array.isArray(r.aliases) ? r.aliases : [],
    }));
    return true;
  };

  window.synGetGroups = function (field) {
    const all = _synAll();
    return field ? all.filter(g => g.field === field) : all.slice();
  };
  window.synGetNormalizeMap = function (field) {
    const map = {};
    _synAll().filter(g => !field || g.field === field)
      .forEach(g => (g.aliases || []).forEach(a => { map[a] = g.canonical; }));
    return map;
  };

  // 書き込みはクラウドだけ。続けて読む処理（synAddAlias 等）のため、成功したら手元のキャッシュも同じ内容に更新する
  async function _synUpsert(field, canonical, aliases) {
    if (!_needCloud('同義グループ') || _synTableMissing) return false;
    const { error } = await _c().from(SYN_TABLE).upsert(
      { field, canonical, aliases, updated_by: _me(), updated_at: new Date().toISOString() },
      { onConflict: 'field,canonical' }
    );
    if (error) { if (_synMissingErr(error)) _synTableMissing = true; return false; }
    if (_synCloud === null) _synCloud = [];
    const g = _synCloud.find(x => x.field === field && x.canonical === canonical);
    if (g) g.aliases = aliases; else _synCloud.push({ id: 'tmp_' + Date.now(), field, canonical, aliases });
    return true;
  }
  async function _synDelete(field, canonical) {
    if (!_needCloud('同義グループ') || _synTableMissing) return false;
    const { error } = await _c().from(SYN_TABLE).delete().match({ field, canonical });
    if (error) return false;
    if (_synCloud) _synCloud = _synCloud.filter(g => !(g.field === field && g.canonical === canonical));
    return true;
  }

  window.synSetCanonical = async function (field, value) {
    if (!field || !value) return;
    // value が他グループの alias なら外す
    for (const g of _synAll()) {
      if (g.field === field && (g.aliases || []).includes(value))
        await _synUpsert(field, g.canonical, g.aliases.filter(a => a !== value));
    }
    if (!_synAll().find(g => g.field === field && g.canonical === value))
      await _synUpsert(field, value, []);
    // 統合（A案）: 代表は自動的にマスター登録
    if (typeof window.statsEnsureMaster === 'function') await window.statsEnsureMaster(field, value);
    await _synAfter('⭐「' + value + '」を代表（マスター）に設定しました');
  };

  window.synAddAlias = async function (field, alias, canonical) {
    if (!field || !alias || !canonical || alias === canonical) return;
    // alias を他グループの alias リストから外す
    for (const g of _synAll()) {
      if (g.field === field && g.canonical !== canonical && (g.aliases || []).includes(alias))
        await _synUpsert(field, g.canonical, g.aliases.filter(a => a !== alias));
    }
    // alias 自体が別グループの代表なら、その配下を吸収して解体（チェーン化を防ぐ）
    let absorbed = [];
    const aliasGroup = _synAll().find(g => g.field === field && g.canonical === alias);
    if (aliasGroup) { absorbed = aliasGroup.aliases || []; await _synDelete(field, alias); }
    const g = _synAll().find(x => x.field === field && x.canonical === canonical);
    const aliases = [...new Set([...((g && g.aliases) || []), alias, ...absorbed])];
    await _synUpsert(field, canonical, aliases);
    // 統合（A案）: 代表は自動マスター化、統合した別名（および吸収した旧代表）はマスターから外す
    if (typeof window.statsEnsureMaster === 'function') await window.statsEnsureMaster(field, canonical);
    if (typeof window.statsEnsureNotMaster === 'function') {
      await window.statsEnsureNotMaster(field, alias);
      for (const a of absorbed) await window.statsEnsureNotMaster(field, a);
    }
    await _synAfter('✅「' + alias + '」→「' + canonical + '」に統合しました');
  };

  window.synRemoveAlias = async function (field, alias, canonical) {
    const g = _synAll().find(x => x.field === field && x.canonical === canonical);
    if (g) await _synUpsert(field, canonical, (g.aliases || []).filter(a => a !== alias));
    await _synAfter();
  };
  window.synRemoveGroup = async function (field, canonical) {
    await _synDelete(field, canonical);
    await _synAfter();
  };

  // 代表名の新規入力・編集（リネーム）。旧名称は別名として残す（実データの紐付けを維持）。
  // newCanon が既存の別代表なら、その配下も取り込んで統合する。
  window.synRenameCanonical = async function (field, oldCanon, newCanon) {
    oldCanon = (oldCanon || '').trim(); newCanon = (newCanon || '').trim();
    if (!field || !oldCanon || !newCanon || oldCanon === newCanon) return;
    const all = _synAll().filter(g => g.field === field);
    const old    = all.find(g => g.canonical === oldCanon);
    const target = all.find(g => g.canonical === newCanon);
    const merged = new Set([
      ...(target ? (target.aliases || []) : []),
      ...(old ? (old.aliases || []) : []),
      oldCanon,
    ]);
    merged.delete(newCanon);
    if (old) await _synDelete(field, oldCanon);
    await _synUpsert(field, newCanon, [...merged]);
    // 統合（A案）: 新代表をマスター化、旧代表・別名はマスターから外す
    if (typeof window.statsEnsureMaster === 'function') await window.statsEnsureMaster(field, newCanon);
    if (typeof window.statsEnsureNotMaster === 'function') {
      for (const a of merged) await window.statsEnsureNotMaster(field, a);
    }
    await _synAfter('✏️ 代表名を「' + newCanon + '」に変更しました');
  };

  async function _synAfter(toast) {
    await window.synLoadCloud();
    _refreshDatalist();
    if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive();
    else if (typeof window.statsRefresh === 'function') await window.statsRefresh();
    if (toast && typeof window.quoteShowToast === 'function') window.quoteShowToast(toast, 'success');
  }

  // === このブラウザにだけあるマスターデータの移行（クラウド必須化） ===
  // 以前は書き込みのたびにこのブラウザにも写しを保存していたため、クラウドに無いもの（＝このブラウザにだけあるもの）だけを数える。
  // ほかの人がクラウドで削除した古い写しも含まれうるので、移す前に件数と例を見せて選んでもらう（移す／移さずに使わない）
  // MD_KEY 等はこの後で定義されるため、使う時点で一覧にする
  // 除外リストは、共有テーブルがあるときだけ移行・削除の対象（無い間はこのブラウザの分を使い続けるため）
  const _migKeys = () => ['masterCandidates_v1', SYN_KEY, MD_KEY, LOCAL_KEY, ABBREV_KEY].concat(_exclOn() ? [EXCL_KEY] : []);
  function _migInfo() {
    if (!_cloud()) return null;
    const k = (f, v) => f + '\x00' + v;
    const cloudM = new Set((typeof window.statsGetMasters === 'function' ? window.statsGetMasters() : []).map(m => k(m.field, m.value)));
    const masters = (typeof window.statsLocalMasters === 'function' ? window.statsLocalMasters() : []).filter(m => !cloudM.has(k(m.field, m.value)));
    const cloudSyn = _synCloud || [];
    const syn = [];
    (function () { try { return JSON.parse(localStorage.getItem(SYN_KEY) || '[]'); } catch (e) { return []; } })().forEach(g => {
      const cg = cloudSyn.find(x => x.field === g.field && x.canonical === g.canonical);
      const missing = (g.aliases || []).filter(a => !cg || !(cg.aliases || []).includes(a));
      if (!cg || missing.length) syn.push({ field: g.field, canonical: g.canonical, aliases: missing, isNew: !cg });
    });
    const cloudMd = new Set((_mdCloud || []).map(m => k(m.field, m.value)));
    const md = _mdLoadLocal().filter(m => !cloudMd.has(k(m.field, m.value)));
    const cloudR = new Set(_arCloud.map(r => k(r.field, r.from_value)));
    const rules = _loadLocal().filter(r => !cloudR.has(k(r.field, r.from_value)));
    const abbrev = _abbrevUnshared(_loadAbbrevPairs());
    const cloudX = new Set((_exclCloud || []).map(e => k(e.field, e.value)));
    const excl = _exclOn() ? _loadExclusions().filter(e => !cloudX.has(k(e.field, e.value))) : [];
    const total = masters.length + syn.length + md.length + rules.length + abbrev.length + excl.length;
    return { masters, syn, md, rules, abbrev, excl, total };
  }
  function _migBackupAndClear() {
    const backup = { at: new Date().toISOString() };
    _migKeys().forEach(key => { const v = localStorage.getItem(key); if (v !== null) backup[key] = v; });
    try { localStorage.setItem('masterLocalBackup_v1', JSON.stringify(backup)); } catch (e) {}
    _migKeys().forEach(key => localStorage.removeItem(key));
    if (typeof window.statsClearLocalMasters === 'function') window.statsClearLocalMasters();
  }
  async function _migAfter(msg) {
    if (typeof window.statsLoadMasterCache === 'function') await window.statsLoadMasterCache();
    if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive();
    if (typeof window.arRenderPane === 'function') await window.arRenderPane();
    if (msg && typeof window.quoteShowToast === 'function') window.quoteShowToast(msg, 'success', 3600);
  }
  // マスター管理画面の先頭に出す案内（未ログイン／このブラウザにだけあるデータ）
  window.masterTopNoticeHtml = function () {
    if (!_cloud()) {
      return '<div class="master-cloud-notice">🔒 マスター（入力候補・同義グループ・マスター詳細）はチームで共有しています。表示・登録にはログインしてください。</div>';
    }
    const info = _migInfo();
    if (!info || !info.total) return '';
    const cells = [
      ['マスター', info.masters.length], ['同義グループ', info.syn.length], ['マスター詳細', info.md.length],
      ['統合ルール', info.rules.length], ['略称', info.abbrev.length], ['除外リスト', info.excl.length],
    ].filter(c => c[1]).map(c => '<div><b>' + c[1] + '</b><span>' + c[0] + '</span></div>').join('');
    const ex = [...info.masters.map(m => m.value), ...info.syn.map(g => g.canonical), ...info.md.map(m => m.value),
                ...info.rules.map(r => r.from_value + '→' + r.to_value), ...info.abbrev.map(p => p.abbrev + '=' + p.full)]
      .slice(0, 6).map(_esc).join('、');
    return '<div class="master-cloud-notice is-migrate"><p class="notice-title">📦 このブラウザにだけ保存されているマスターのデータがあります</p>' +
      '<div class="counts">' + cells + '</div>' +
      '<p class="notice-ex">例：' + ex + '</p>' +
      '<p>マスターはチーム共有に一本化したため、このブラウザの分は使われません。チームへ移すと、ほかの人の入力候補にも出ます。</p>' +
      '<div class="notice-actions">' +
      '<button type="button" class="ar-add-btn btn-primary" onclick="masterMigrateLocal()">☁️ チームへ移す</button>' +
      '<button type="button" class="ar-del-btn btn-skip" onclick="masterDiscardLocal()" title="移さずに、このブラウザの分を使わないようにします（念のためバックアップは残します）">移さない…</button>' +
      '<span class="skip-warn">「移さない」は元に戻せません（バックアップだけ残ります）</span></div></div>';
  };
  window.masterMigrateLocal = async function () {
    const info = _migInfo();
    if (!info || !info.total) return;
    const ok = await window.uiConfirm({
      title: 'チームへ移しますか？',
      lines: ['このブラウザにだけあるマスターのデータ ' + info.total + ' 件を、チーム共有のマスターへ移します。',
              'ほかの人が削除した古いデータが含まれている場合は、それも戻ります。内容に心当たりがなければ「やめる」を選び、「移さない」を検討してください。'],
      okLabel: 'チームへ移す',
    });
    if (!ok) return;
    for (const m of info.masters) if (typeof window.statsEnsureMaster === 'function') await window.statsEnsureMaster(m.field, m.value);
    for (const g of info.syn) {
      const cg = (_synCloud || []).find(x => x.field === g.field && x.canonical === g.canonical);
      await _synUpsert(g.field, g.canonical, [...new Set([...((cg && cg.aliases) || []), ...g.aliases])]);
    }
    for (const m of info.md) await window.mdSave(m.field, m.value, m.details || {});
    for (const r of info.rules) await _c().from(TABLE).upsert({ field: r.field, from_value: r.from_value, to_value: r.to_value, created_by: _me() }, { onConflict: 'field,from_value' });
    for (const p of info.abbrev) if (typeof window.synAddAlias === 'function') await window.synAddAlias(p.field, p.abbrev, p.full);
    for (const e of info.excl) await _c().from(EXCL_TABLE).upsert({ field: e.field, value: e.value, created_by: _me() }, { onConflict: 'field,value' });
    _migBackupAndClear();
    await window.arLoadCloud();
    await _migAfter('☁️ ' + info.total + ' 件をチーム共有のマスターへ移しました');
  };
  window.masterDiscardLocal = async function () {
    const ok = await window.uiConfirm({
      title: 'チームへ移さずに、使わないようにしますか？',
      lines: ['このブラウザにだけあるマスターのデータを、チームへ移さずに使わないようにします。', '念のため、バックアップ（masterLocalBackup_v1）は残ります。'],
      irreversible: 'このブラウザの分は、以後どの画面でも使われません（元に戻す操作はありません）。',
      okLabel: '移さない', danger: true,
    });
    if (!ok) return;
    _migBackupAndClear();
    await _migAfter('このブラウザのマスターデータは使わないようにしました（バックアップ：masterLocalBackup_v1）');
  };

  // === マスター詳細情報（種別ごとの追加項目・非破壊・クラウド共有 + ローカルフォールバック） ===
  //   対象フィールド: customer（ふりがな/担当/所在地/メイン商材/仕向国輸入国/傾向/社内メモ）
  //                 nm（ふりがな/デフォルト単位/デフォルト備考）
  //                 sv / carrier / port（ふりがなのみ）
  //   ふりがなは datalist の option label に反映し、読み（ひらがな）でもサジェストにヒットする
  //   保存: cloud = master_details テーブル（チーム共有）、ローカル = masterDetails_v1
  //   形式: [{ field, value, details: {...} }]
  const MD_KEY   = 'masterDetails_v1';
  const MD_TABLE = 'master_details';
  let _mdCloud = null;
  let _mdTableMissing = false;

  const _FURIGANA_FIELD = { key: 'furigana', label: 'ふりがな', placeholder: '例）かいじょううんちん（読みで入力補完にヒットします）' };
  // 英語名称（全種別共通キー enName。品名は PDF 英語出力でも使う）
  const _EN_FIELD = { key: 'enName', label: '英語名称', placeholder: '例）ABC Trading Co., Ltd.（英字入力でも入力補完にヒットします）' };
  window.MD_SCHEMA = {
    customer: [
      _FURIGANA_FIELD,
      _EN_FIELD,
      { key: 'contacts',     label: '担当者', contacts: true },
      { key: 'location',     label: '所在地' },
      { key: 'mainGoods',    label: 'メイン商材' },
      { key: 'destCountry',  label: '仕向国/輸入国' },
      { key: 'tendency',     label: '傾向' },
      { key: 'website',      label: 'ウェブサイト', link: true, placeholder: '例）https://example.com' },
      { key: 'tags',         label: 'タグ', tags: true },
      { key: 'memo',         label: '社内メモ', textarea: true },
    ],
    nm: [
      _FURIGANA_FIELD,
      { key: 'enName',      label: '英語品名', placeholder: '例）Ocean Freight（英字入力でも入力補完にヒット／御見積書PDFの「英語で出力」ON時にこの品名で出力されます）' },
      { key: 'defaultUnit', label: 'デフォルト単位' },
      { key: 'defaultNote', label: 'デフォルト備考' },
      { key: 'defaultCat',  label: 'デフォルトカテゴリ' },
      { key: 'defaultTax',  label: '課税区分', options: [
        { value: '',         label: '（未指定・自動判定しない）' },
        { value: 'taxed',    label: '課税' },
        { value: 'nontaxed', label: '非課税' },
      ] },
      { key: 'refCost',     label: '代表仕入単価（参考）' },
      { key: 'refSell',     label: '代表売単価（参考）' },
      { key: 'refCcy',      label: '代表単価の通貨' },
    ],
    sv:      [_FURIGANA_FIELD, _EN_FIELD],
    carrier: [_FURIGANA_FIELD, _EN_FIELD],
    port:    [_FURIGANA_FIELD, _EN_FIELD],
  };

  // カタカナ→ひらがな正規化（読み比較用）
  function _toHira(s) {
    return String(s || '').trim().replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }
  // 入力値が登録済みふりがな（読み）または英語名称（大小文字無視）と完全一致するマスター値を返す。なければ null。
  window.mdValueForFurigana = function (field, input) {
    const v = _toHira(input);
    if (!v) return null;
    const lv = v.toLowerCase();
    const hit = _mdAll().find(m => {
      if (m.field !== field) return false;
      const d = m.details || {};
      return _toHira(d.furigana) === v || String(d.enName || '').trim().toLowerCase() === lv;
    });
    return hit ? hit.value : null;
  };

  function _mdLoadLocal() {
    try { return JSON.parse(localStorage.getItem(MD_KEY) || '[]'); } catch (e) { return []; }
  }
  function _mdAll() {
    return (_cloud() && _mdCloud !== null) ? _mdCloud : [];   // クラウド必須（未ログイン・読込前は空）
  }
  function _mdMissingErr(error) {
    return error && /relation|does not exist|schema cache|not find/i.test(error.message || '');
  }

  window.mdLoadCloud = async function () {
    if (!_cloud() || _mdTableMissing) { _mdCloud = null; return false; }
    const { data, error } = await _selectAll(() => _c().from(MD_TABLE).select('field,value,details').order('field').order('value'));
    if (error) { if (_mdMissingErr(error)) _mdTableMissing = true; _mdCloud = null; return false; }
    _mdCloud = (data || []).map(r => ({ field: r.field, value: r.value, details: r.details || {} }));
    return true;
  };

  window.mdGet = function (field, value) {
    return _mdAll().find(m => m.field === field && m.value === value) || null;
  };
  // 入力側（自動入力・御見積書の英語名など）用：完全一致が無ければ代表名で探す（別名で入力しても詳細が効くように）。
  // マスター管理画面は登録された名前そのものを扱うので、引き続き mdGet（完全一致）を使う
  window.mdGetCanon = function (field, value) {
    const v = String(value == null ? '' : value).trim();
    if (!v) return null;
    const hit = window.mdGet(field, v);
    if (hit || typeof window.nameCanon !== 'function') return hit;
    const canon = window.nameCanon(field, v);
    return canon && canon !== v ? window.mdGet(field, canon) : null;
  };
  window.mdGetAll = function (field) {
    return _mdAll().filter(m => m.field === field);
  };

  window.mdSave = async function (field, value, details) {
    if (!field || !value) return;
    if (!_needCloud('マスター詳細') || _mdTableMissing) return;
    const { error } = await _c().from(MD_TABLE).upsert(
      { field, value, details, updated_by: _me(), updated_at: new Date().toISOString() },
      { onConflict: 'field,value' }
    );
    if (_mdMissingErr(error)) _mdTableMissing = true;
    await window.mdLoadCloud();
  };

  window.mdDelete = async function (field, value) {
    if (!_needCloud('マスター詳細') || _mdTableMissing) return;
    await _c().from(MD_TABLE).delete().match({ field, value });
    await window.mdLoadCloud();
  };

  // === マスター詳細情報：添付ファイル（field/value 単位・保管期限なし） ===
  //   保存先: master_attachments テーブル + Storage バケット masterAttachmentBucket。
  //   quote_attachments（案件添付・14日で自動削除）とは別テーブル・別バケットで、
  //   自動削除の仕組みは一切無い。クラウド専用機能（ローカルフォールバックは無し）。
  const MA_TABLE  = 'master_attachments';
  const MA_BUCKET = () => (window.CLOUD_CONFIG && window.CLOUD_CONFIG.masterAttachmentBucket) || 'master-attachments';
  let _maTableMissing = false;

  window.mdListAttachments = async function (field, value) {
    if (!_cloud() || _maTableMissing || !field || !value) return [];
    const { data, error } = await _c().from(MA_TABLE)
      .select('id,file_name,file_size,mime_type,storage_path,uploaded_by,created_at')
      .eq('field', field).eq('value', value)
      .order('created_at', { ascending: false });
    if (error) { if (_mdMissingErr(error)) _maTableMissing = true; return []; }
    return data || [];
  };

  window.mdAttachUpload = async function (field, value, files) {
    files = Array.prototype.slice.call(files || []);
    if (!files.length || !field || !value) return;
    const c = _c();
    if (!c || !_me()) { if (window.quoteShowToast) window.quoteShowToast('⚠️ 添付にはログインが必要です', 'warn', 4000); return; }
    let okN = 0;
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) { if (window.quoteShowToast) window.quoteShowToast('⚠️ ' + file.name + ' は25MB超のため添付不可', 'warn', 5000); continue; }
      const src = (typeof window._compressImage === 'function') ? await window._compressImage(file) : file;
      // Storage キーは ASCII 安全のみ（日本語/全角は Invalid key）。表示名は file_name に原文保持
      const nm = src.name || file.name || 'file';
      const dot = nm.lastIndexOf('.');
      const ext = dot >= 0 ? nm.slice(dot).replace(/[^A-Za-z0-9.]/g, '') : '';
      const base = (dot >= 0 ? nm.slice(0, dot) : nm).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_{2,}/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'file';
      const path = field + '/' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '_' + base + ext;
      const up = await c.storage.from(MA_BUCKET()).upload(path, src, { contentType: src.type || undefined, upsert: false });
      if (up.error) { if (window.quoteShowToast) window.quoteShowToast('⚠️ アップロード失敗：' + up.error.message, 'warn', 6000); continue; }
      const ins = await c.from(MA_TABLE).insert({ field, value, storage_path: path, file_name: file.name, file_size: src.size, mime_type: src.type || null, uploaded_by: _me() });
      if (ins.error) { if (window.quoteShowToast) window.quoteShowToast('⚠️ 記録失敗：' + ins.error.message, 'warn', 6000); try { await c.storage.from(MA_BUCKET()).remove([path]); } catch (e) {} continue; }
      okN++;
    }
    if (okN && window.quoteShowToast) window.quoteShowToast('📎 ' + okN + ' 件を添付しました', 'success', 2500);
    if (typeof window.statsRefreshMasterAttachments === 'function') window.statsRefreshMasterAttachments(field, value);
  };

  window.mdAttachOpen = async function (rawPath) {
    const c = _c(); if (!c) return;
    // download:false を明示 → Supabase が Content-Disposition: attachment を付けず、
    // ブラウザが表示可能な形式（PDF/画像等）は新規タブでそのまま開ける
    const res = await c.storage.from(MA_BUCKET()).createSignedUrl(decodeURIComponent(rawPath), 120, { download: false });
    if (res.error || !res.data) { if (window.quoteShowToast) window.quoteShowToast('⚠️ リンク作成に失敗しました', 'warn'); return; }
    window.open(res.data.signedUrl, '_blank', 'noopener');
  };

  window.mdAttachDelete = async function (attId, rawPath, field, value) {
    if (!confirm('この添付ファイルを削除しますか？（チーム全員から消えます）')) return;
    const c = _c(); if (!c) return;
    const del = await c.from(MA_TABLE).delete().eq('id', attId);
    if (del.error) { if (window.quoteShowToast) window.quoteShowToast('⚠️ 削除に失敗：' + del.error.message, 'warn', 6000); return; }
    try { await c.storage.from(MA_BUCKET()).remove([decodeURIComponent(rawPath)]); } catch (e) {}
    if (window.quoteShowToast) window.quoteShowToast('🗑️ 添付を削除しました', 'info', 2200);
    if (typeof window.statsRefreshMasterAttachments === 'function') window.statsRefreshMasterAttachments(field, value);
  };

})();
