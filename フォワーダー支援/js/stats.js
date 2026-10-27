// 統計タブ: 見積プリセット行データを集計・マスター管理（ローカル＋クラウド投票）
(function () {
  'use strict';

  // cells 配列のインデックス（v3 format: [0]=selected [1]=cat [2]=sv [3]=tx [4]=nm [5]=pq [6]=un ...）
  const CI = { cat: 1, sv: 2, nm: 4, un: 6, bq: 7, pc: 8, bc: 9, pp: 10, bp: 11, pt: 19, ppmin: 30, bpmin: 31 };
  const LOCAL_KEY    = 'masterCandidates_v1';
  const VOTES_TABLE  = 'master_votes';

  let _data    = null;
  let _cvMap   = null;  // Map<`field\x00value`, { total, isMine }> — クラウド投票キャッシュ
  const _renderedGroups = {};  // { groupId → { aliasField, variants[] } } — バッジクリック用

  // === Supabase ヘルパー ===

  function _c()    { return typeof window.cloudGetClient   === 'function' ? window.cloudGetClient()   : null; }
  function _me()   { const u = typeof window.cloudCurrentUser === 'function' ? window.cloudCurrentUser() : null; return u ? (u.email || '') : ''; }
  function _cloud(){ return !!_c() && !!_me(); }

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

  async function _loadCloudVotes() {
    const c = _c();
    if (!c) { _cvMap = null; return; }
    const { data, error } = await _selectAll(() => c.from(VOTES_TABLE).select('field,value,voter_email')
      .order('field').order('value').order('voter_email'));
    if (error) { _cvMap = null; return; }
    _cvMap = new Map();
    const me = _me();
    (data || []).forEach(r => {
      const key = r.field + '\x00' + r.value;
      if (!_cvMap.has(key)) _cvMap.set(key, { total: 0, isMine: false });
      const v = _cvMap.get(key);
      v.total++;
      if (r.voter_email === me) v.isMine = true;
    });
    // 項目ごとの「マスター登録件数」：その項目のマスターが 1 件も無い間（未整備・読込前）は、未登録の印を出さないため
    _cvFieldCount = {};
    _cvMap.forEach(({ total }, key) => { if (total >= 1) { const f = key.split('\x00')[0]; _cvFieldCount[f] = (_cvFieldCount[f] || 0) + 1; } });
    await _loadRequests();
  }
  let _cvFieldCount = {};

  // ===== マスターの承認制（docs/sql/master-approval.sql）=====
  // 申請テーブル（master_requests）があるときだけ有効：メンバーの登録は「申請」になり、管理者が承認するとマスターになる。
  // 解除は管理者だけ（ほかの人の登録も解除できる）。テーブルが無い間は従来どおり（メンバーも直接登録・自分の票だけ解除）
  const REQ_TABLE = 'master_requests';
  let _reqs = [];              // 申請（新しい順）
  let _reqOn = false;          // 申請テーブルが使える
  async function _loadRequests() {
    const c = _c();
    if (!c) { _reqs = []; _reqOn = false; return; }
    const { data, error } = await c.from(REQ_TABLE).select('id,field,value,requested_by,status,decided_by,decided_at,created_at')
      .order('created_at', { ascending: false }).limit(300);
    if (error) { _reqs = []; _reqOn = false; return; }
    _reqs = data || []; _reqOn = true;
  }
  const _isAdmin = () => window._myRole === 'admin';
  const _approvalOn = () => _cloud() && _reqOn;
  const _pendingReq = (field, value) => _reqs.find(r => r.status === 'pending' && r.field === field && r.value === value);
  const _FIELD_LABEL = { sv: 'サブコン', carrier: 'キャリア', nm: '品名', un: '単位', customer: 'お客様', port: '港' };
  function _toast(msg, type, ms) { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(msg, type || 'success', ms || 3200); }

  async function _request(field, value) {
    if (_pendingReq(field, value)) { _toast('「' + value + '」はすでに申請中です（管理者の承認待ち）', 'info'); return; }
    const { error } = await _c().from(REQ_TABLE).insert({ field, value, requested_by: _me(), status: 'pending' });
    if (error) { _toast('申請に失敗しました: ' + error.message, 'warn'); return; }
    await _loadRequests();
    if (typeof window.refreshAllRowSvChips === 'function') window.refreshAllRowSvChips();   // 行の「申請中」の印を反映
    _toast('📨 ' + (_FIELD_LABEL[field] || field) + '「' + value + '」をマスターに申請しました。管理者の承認後に入力候補に出ます', 'success', 4200);
  }
  async function _decide(id, approve) {
    const r = _reqs.find(x => x.id === id);
    if (!r || !_isAdmin()) return;
    if (approve) {
      const { error } = await _c().from(VOTES_TABLE).upsert({ field: r.field, value: r.value, voter_email: _me() }, { onConflict: 'field,value,voter_email' });
      if (error) { _toast('承認に失敗しました: ' + error.message, 'warn'); return; }
    }
    const { error: e2 } = await _c().from(REQ_TABLE).update({ status: approve ? 'approved' : 'rejected', decided_by: _me(), decided_at: new Date().toISOString() }).eq('id', id);
    if (e2) { _toast('更新に失敗しました: ' + e2.message, 'warn'); return; }
    await _loadCloudVotes();
    _rerenderMasters();
    _toast((approve ? '✅ 承認しました：' : '却下しました：') + r.value, approve ? 'success' : 'info');
  }
  window.statsApproveRequest = id => _decide(id, true);
  window.statsRejectRequest  = async function (id) {
    const r = _reqs.find(x => x.id === id);
    if (!r) return;
    const ok = await window.uiConfirm({
      title: '申請を却下しますか？',
      lines: [(_FIELD_LABEL[r.field] || r.field) + '「' + r.value + '」の申請（' + (r.requested_by || '').split('@')[0] + '）を却下します。', '却下しても、申請者があらためて申請することはできます。'],
      irreversible: '却下した記録は取り消せません。',
      okLabel: '却下する', danger: true,
    });
    if (ok) await _decide(id, false);
  };
  window.statsCancelRequest  = async function (id) {
    const { error } = await _c().from(REQ_TABLE).delete().eq('id', id);
    if (error) { _toast('取り消しに失敗しました: ' + error.message, 'warn'); return; }
    await _loadRequests();
    _rerenderMasters();
  };
  function _rerenderMasters() {
    try { _renderMaster(); } catch (e) {}
    if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
  }
  // マスター管理画面：申請の一覧（管理者は承認・却下、メンバーは自分の申請と状態）。状態は「記号＋文字」（○ 承認待ち／■ 承認済み／× 却下）
  function _requestsHtml() {
    if (!_approvalOn()) return '';
    const admin = _isAdmin(), me = _me();
    const pending = _reqs.filter(r => r.status === 'pending');
    const mine = _reqs.filter(r => r.requested_by === me).slice(0, 10);
    const list = admin ? pending : mine;
    const head = admin
      ? '📨 マスターの申請（承認待ち ' + pending.length + ' 件）'
      : '📨 あなたの申請（マスターへの登録は管理者が承認します）';
    if (!list.length) {
      return '<div class="stats-req-section"><p class="stats-master-info-title">' + head + '</p>' +
        '<p class="stats-empty">' + (admin ? '承認待ちの申請はありません。' : '申請はありません。入力候補にない名前は「☆ 登録」や「マスターに登録」から申請できます。') + '</p></div>';
    }
    const ST = { pending: ['is-wait', '承認待ち'], approved: ['is-ok', '承認済み'], rejected: ['is-no', '却下'] };
    const rows = list.map(r => {
      const who = (r.requested_by || '').split('@')[0];
      const ops = admin
        ? `<button class="stats-vote-btn btn-primary" onclick="statsApproveRequest('${_ea(r.id)}')">承認</button>` +
          `<button class="stats-demote-btn btn-secondary" onclick="statsRejectRequest('${_ea(r.id)}')">却下…</button>`
        : (r.status === 'pending' ? `<button class="stats-demote-btn btn-secondary" onclick="statsCancelRequest('${_ea(r.id)}')">取り消す</button>` : '');
      const st = ST[r.status] || ['', r.status];
      return `<tr><td>${_esc(_FIELD_LABEL[r.field] || r.field)}</td><td class="stats-val">${_esc(r.value)}</td>` +
             `<td>${admin ? _esc(who) : `<span class="req-state ${st[0]}">${st[1]}</span>`}</td><td class="ops">${ops}</td></tr>`;
    }).join('');
    return '<div class="stats-req-section"><p class="stats-master-info-title">' + head + '</p>' +
      '<table class="stats-table"><thead><tr><th>種別</th><th>名称</th><th>' + (admin ? '申請者' : '状態') + '</th><th></th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  // マスター管理の見出し：役割バッジ・件数ストリップ（管理者は承認待ちが最優先）・見積もりへ戻るボタン（Industry 用）
  function _masterHeadHtml(nMasters, nGroups) {
    const role = window._myRole;
    const badge = _cloud() && role
      ? `<span class="role-badge${role === 'admin' ? ' is-admin' : ''}" title="あなたの権限">${role === 'admin' ? '管理者' : role === 'viewer' ? '閲覧者' : 'メンバー'}</span>` : '';
    const kpi = (n, label, primary) => `<div class="kpi${primary ? ' is-primary' : ''}"><span class="n">${n}</span><span class="l">${label}</span></div>`;
    let kpis = '';
    if (_approvalOn()) {
      const me = _me();
      if (_isAdmin()) {
        kpis = kpi(_reqs.filter(r => r.status === 'pending').length, '承認待ち', true) + kpi(nMasters, 'マスター') + kpi(nGroups, '同義グループ');
      } else {
        const mine = _reqs.filter(r => r.requested_by === me);
        kpis = kpi(mine.filter(r => r.status === 'pending').length, '承認待ち', true) + kpi(mine.filter(r => r.status === 'approved').length, '承認済み') + kpi(mine.filter(r => r.status === 'rejected').length, '却下');
      }
    } else {
      kpis = kpi(nMasters, 'マスター', true) + kpi(nGroups, '同義グループ');
    }
    return '<div class="master-head"><h3 class="master-title">🗂 マスター管理' + badge + '</h3>' +
      '<button type="button" class="master-back" onclick="switchCategory(\'quote\', document.querySelector(\'.cat-btn\'))">← 見積もりに戻る</button></div>' +
      '<div class="master-kpis">' + kpis + '</div>';
  }

  function _voteInfo(field, value) {
    // マスターはクラウド必須（このブラウザの保存分 masterCandidates_v1 は移行にだけ使う）
    if (_cloud() && _cvMap !== null) return _cvMap.get(field + '\x00' + value) || { total: 0, isMine: false };
    return { total: 0, isMine: false };
  }

  // === データ取得 ===

  // 旧「ブラウザ保存」は廃止（案件はチーム共有＝クラウドのみ）。残っている分はダッシュボードの案内から移す。
  // 統計の集計経路（source: local/cloud/both）は残してあるが、ローカル側は常に空。
  function _getLocalPresets() { return []; }

  function _extractRows(preset) {
    const d = preset.data || {};
    if (!Array.isArray(d.rows)) return [];
    return d.rows
      .filter(r => r && r._type === 'data')
      .map(r => {
        const c = Array.isArray(r.cells) ? r.cells : [];
        return {
          cat: (c[CI.cat] || '').trim(),
          sv:  (c[CI.sv]  || '').trim(),
          nm:  (c[CI.nm]  || '').replace(/^\*+/, '').trim(),
          un:  (c[CI.un]  || '').trim(),
        };
      })
      .filter(r => r.sv || r.nm);
  }

  function _build(source) {
    const period = document.getElementById('statsPeriod')?.value || 'all';
    const now = Date.now();
    const CUTOFF = { all: 0, month: now - 30*86400000, q3: now - 91*86400000, year: now - 365*86400000 };
    const cutoff = CUTOFF[period] || 0;

    const presets = [];
    if (source !== 'cloud') {
      _getLocalPresets().forEach(p => {
        if (cutoff && p.updatedAt && new Date(p.updatedAt).getTime() < cutoff) return;
        const rows = _extractRows(p);
        if (rows.length) presets.push({ name: p.name || '（名称なし）', rows, src: 'local' });
      });
    }
    if (source !== 'local') {
      const cloud = typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : [];
      cloud.forEach(p => {
        if (cutoff && p.updated_at && new Date(p.updated_at).getTime() < cutoff) return;
        const rows = _extractRows(p);
        if (rows.length) presets.push({ name: p.name || '（名称なし）', rows, src: 'cloud' });
      });
    }
    const allRows     = presets.flatMap(p => p.rows);
    // サブコン: 明細行の「サブコン」欄すべて。キャリア: 幹線輸送（z2Carrier / 航路データ）から集計。
    const svRows      = allRows.filter(r => r.sv);
    const excl = typeof window.arGetExclusions === 'function' ? window.arGetExclusions() : [];
    const svExcl = new Set(excl.filter(e => e.field === 'sv').map(e => e.value));
    const nmExcl = new Set(excl.filter(e => e.field === 'nm').map(e => e.value));
    const unExcl = new Set(excl.filter(e => e.field === 'un').map(e => e.value));
    const portExcl = new Set(excl.filter(e => e.field === 'port').map(e => e.value));
    const carrierExcl = new Set(excl.filter(e => e.field === 'carrier').map(e => e.value));
    const customerExcl = new Set(excl.filter(e => e.field === 'customer').map(e => e.value));
    return {
      presets, totalPresets: presets.length, totalRows: allRows.length,
      svGroups:      _groupSimilar(svRows.map(r => r.sv), svExcl, 'sv'),
      carrierGroups: _groupSimilar(_gatherCarriers(source), carrierExcl, 'carrier'),
      nmGroups:      _groupSimilar(allRows.map(r => r.nm).filter(Boolean), nmExcl, 'nm'),
      unGroups:      _groupSimilar(allRows.map(r => r.un).filter(Boolean), unExcl, 'un'),
      portGroups:    _groupSimilar(_gatherPorts(source), portExcl, 'port'),
      customerGroups: _groupSimilar(_gatherCustomers(source), customerExcl, 'customer'),
    };
  }

  // 港名（POL/POD/Via）を全プリセットの条件フィールドから収集。
  // 複数航路（z2-routes-data）がある場合はそちらを優先（cloud.js の列昇格ロジックと同じ）。
  function _portValsFromFields(f) {
    let rts = [];
    try { rts = JSON.parse(f['z2-routes-data'] || '[]'); } catch (e) {}
    const out = [];
    if (Array.isArray(rts) && rts.length) {
      rts.forEach(r => ['pol', 'pod', 'via'].forEach(k => { const v = (r[k] || '').trim(); if (v) out.push(v); }));
    } else {
      ['z2Pol', 'z2Pod', 'z2Via'].forEach(k => { const v = (f[k] || '').trim(); if (v) out.push(v); });
    }
    return out;
  }
  function _gatherPorts(source) {
    const ports = [];
    const add = p => { ports.push(..._portValsFromFields((p.data || {}).fields || {})); };
    if (source !== 'cloud') _getLocalPresets().forEach(add);
    if (source !== 'local') (typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : []).forEach(add);
    return ports;
  }

  // 幹線輸送のキャリア（z2Carrier）を全プリセットの条件フィールドから収集。
  // 複数航路（z2-routes-data）がある場合はそちらの carrier を優先。
  function _carrierValsFromFields(f) {
    let rts = [];
    try { rts = JSON.parse(f['z2-routes-data'] || '[]'); } catch (e) {}
    const out = [];
    if (Array.isArray(rts) && rts.length) {
      rts.forEach(r => { const v = (r.carrier || '').trim(); if (v) out.push(v); });
    } else {
      const v = (f['z2Carrier'] || '').trim(); if (v) out.push(v);
    }
    return out;
  }
  // お客様名を全プリセットから収集（ゆらぎ件数の集計用。お客様タブ自体は別途集計）。
  function _gatherCustomers(source) {
    const out = [];
    if (source !== 'cloud') _getLocalPresets().forEach(p => { const v = (((p.data || {}).fields || {})['qf-customer'] || '').trim(); if (v) out.push(v); });
    if (source !== 'local') (typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : []).forEach(p => { const v = (p.customer || '').trim(); if (v) out.push(v); });
    return out;
  }
  function _gatherCarriers(source) {
    const carriers = [];
    const add = p => { carriers.push(..._carrierValsFromFields((p.data || {}).fields || {})); };
    if (source !== 'cloud') _getLocalPresets().forEach(add);
    if (source !== 'local') (typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : []).forEach(add);
    return carriers;
  }

  function _freq(arr) {
    const m = new Map();
    arr.forEach(v => m.set(v, (m.get(v) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  }

  // ゆらぎ判定用の正規化キー。NFKC で全角英数・半角カナ・㈱等の互換文字を統一し、
  // 記号・空白・長音等を除去、カタカナはひらがなへ寄せる。
  // field==='customer' のときは日本の法人格（株式会社／(株)／㈱／有限会社／合同会社…）を
  // 社名本体から切り離し、位置（前置・後置）の違いだけを吸収する（「株式会社ハブネット」＝「ハブネット(株)」）。
  // 法人格の種類（株／有／合同…）はキーに残すので、「有限会社ABC」と「株式会社ABC」は別扱い。
  // 英文の Co., Ltd / Inc / Corp は海外法人など別会社を取り違えやすいため、除去せず社名の一部として扱う。
  // （法人格の無い表記を、種類が一意な表記へ寄せるのは _groupSimilar の後段で行う）
  const _JP_FORMS = [['株式会社', '株'], ['(株)', '株'], ['有限会社', '有'], ['(有)', '有'],
                     ['合同会社', '合同'], ['(合)', '合同'], ['(同)', '合同'], ['合資会社', '合資']];
  const _FORM_SEP = '\x03';
  function _normalize(s, field) {
    let t = String(s == null ? '' : s)
      .normalize('NFKC')
      .replace(/^\*+/, '')                   // 課税マーク（品名先頭の *）を除去
      .replace(/【[^】]*】/g, '')
      .toLowerCase();
    let form = '';
    if (field === 'customer') {
      const forms = new Set();
      _JP_FORMS.forEach(([tok, kind]) => { if (t.includes(tok)) { forms.add(kind); t = t.split(tok).join(''); } });
      form = [...forms].sort().join('+');
    }
    t = t
      .replace(/[\s　・ー―\-\/\\.,，、。()「」『』"'“”]+/g, '')
      .replace(/[ァ-ン]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60));
    if (!t) return String(s == null ? '' : s).normalize('NFKC').toLowerCase();   // 全文が除去対象でも空キーにしない
    return form ? t + _FORM_SEP + form : t;
  }

  function _groupSimilar(names, excl, field) {
    const freq   = _freq(names);
    const groups = new Map();
    const abbrevPairs = (field && typeof window.arGetAbbrevPairs === 'function')
      ? window.arGetAbbrevPairs(field) : [];
    freq.forEach(({ value, count }) => {
      let key, isAbbrevGroup = false, canonical = null;
      if (excl && excl.has(value)) {
        key = '\x01' + value;
      } else {
        const pair = abbrevPairs.find(p => p.abbrev === value || p.full === value);
        if (pair) {
          key = '\x02' + pair.full;
          isAbbrevGroup = true;
          canonical = pair.full;
        } else {
          key = _normalize(value, field);
        }
      }
      if (!key) return;
      if (!groups.has(key)) groups.set(key, { variants: [], total: 0, isAbbrevGroup, canonical });
      const g = groups.get(key);
      g.variants.push({ value, count });
      g.total += count;
    });
    // お客様：法人格の無い表記は、同じ社名本体で法人格の種類が1つに決まるときだけそこへ寄せる。
    // （「ハブネット」→「株式会社ハブネット」。「株式会社ABC」「有限会社ABC」のように種類が複数なら寄せない）
    if (field === 'customer') {
      const byCore = new Map();   // 社名本体 → { forms: [key...], none: key|null }
      [...groups.keys()].forEach(k => {
        if (k.charCodeAt(0) < 4) return;   // 除外(\x01)・略称(\x02)キーは対象外
        const i = k.indexOf(_FORM_SEP);
        const core = i < 0 ? k : k.slice(0, i);
        if (!byCore.has(core)) byCore.set(core, { forms: [], none: null });
        if (i < 0) byCore.get(core).none = k; else byCore.get(core).forms.push(k);
      });
      byCore.forEach(v => {
        if (v.none && v.forms.length === 1) {
          const tgt = groups.get(v.forms[0]), src = groups.get(v.none);
          tgt.variants.push(...src.variants);
          tgt.total += src.total;
          groups.delete(v.none);
        }
      });
    }
    // 略称グループは正式名称を先頭に
    groups.forEach(g => {
      if (g.isAbbrevGroup && g.canonical) {
        g.variants.sort((a, b) => (a.value === g.canonical ? -1 : b.value === g.canonical ? 1 : b.count - a.count));
      }
    });
    return [...groups.values()].sort((a, b) => {
      const vd = (b.variants.length > 1 ? 1 : 0) - (a.variants.length > 1 ? 1 : 0);
      return vd || b.total - a.total;
    });
  }

  // === ローカルマスター候補（クラウド未使用時のフォールバック） ===

  // 品名/サブコン/キャリア/港/お客様の行・チップ単位で繰り返し呼ばれるため、
  // 保存時のみ無効化するキャッシュで同一レンダリング内の再パースを避ける。
  let _mastersCache = null;
  function _getMasters() {
    if (_mastersCache !== null) return _mastersCache;
    try { _mastersCache = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]'); }
    catch (e) { _mastersCache = []; }
    return _mastersCache;
  }
  function _saveMasters(arr) { _mastersCache = arr; localStorage.setItem(LOCAL_KEY, JSON.stringify(arr)); }

  // === 投票 ===

  async function _promote(field, value) {
    if (!_cloud()) { if (typeof window.masterNeedCloud === 'function') window.masterNeedCloud(); return; }
    if (_approvalOn() && !_isAdmin()) { await _request(field, value); return; }   // メンバーは申請
    const c = _c(), me = _me();
    await c.from(VOTES_TABLE).upsert({ field, value, voter_email: me }, { onConflict: 'field,value,voter_email' });
    await _loadCloudVotes();
  }

  async function _demote(field, value) {
    if (!_cloud()) { if (typeof window.masterNeedCloud === 'function') window.masterNeedCloud(); return; }
    const c = _c(), me = _me();
    if (_approvalOn()) {
      if (!_isAdmin()) { _toast('マスターの解除は管理者が行います', 'info'); return; }
      await c.from(VOTES_TABLE).delete().match({ field, value });   // 管理者：ほかの人の登録も含めて解除
    } else {
      await c.from(VOTES_TABLE).delete().match({ field, value, voter_email: me });
    }
    await _loadCloudVotes();
  }
  // 移行用：このブラウザにだけ残っている昇格（masterCandidates_v1）
  window.statsLocalMasters = function () { return _getMasters().filter(m => (m.votes || 0) >= 1).map(m => ({ field: m.field, value: m.value })); };
  window.statsResetLocalMastersCache = function () { _mastersCache = null; };   // バックアップから戻した後に読み直す
  window.statsClearLocalMasters = function () { _saveMasters([]); localStorage.removeItem(LOCAL_KEY); _mastersCache = null; };

  // === レンダリングヘルパー ===

  function _esc(s)  { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  // onclick 属性内のシングルクォート文字列リテラル用エスケープ。
  // HTML エンティティ（&#39;）はブラウザが JS 実行前に ' に戻してしまい構文エラーになるため、
  // JS の \' エスケープを使う（HTML は \ をデコードしない）。
  function _ea(s)   { return String(s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
  // HTML value="" 属性用
  function _eav(s)  { return String(s || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

  // マスター詳細情報の展開ボタン（MD_SCHEMA に定義のある種別のみ対象）
  function _mdDetailBtn(field, value) {
    if (!(window.MD_SCHEMA && window.MD_SCHEMA[field])) return '';
    const has = typeof window.mdGet === 'function' && window.mdGet(field, value);
    return `<button class="stats-master-detail-btn${has ? ' has-detail' : ''}" ` +
           `title="${has ? '詳細情報を見る・編集' : '詳細情報を登録'}" ` +
           `onclick="statsToggleMasterDetail('${_ea(field)}','${_ea(value)}',this)">${has ? '📇 詳細' : '＋ 詳細'}</button>`;
  }

  // 名称セルに添える「詳細情報」インライン表示（一覧を見ただけで入力済みの内容が分かるように）。
  // 各項目を短いチップで表示。長い値は途中で省略しツールチップに全文を出す。
  function _mdBadge(field, value) {
    const schema = window.MD_SCHEMA && window.MD_SCHEMA[field];
    if (!schema) return '';
    const rec = typeof window.mdGet === 'function' ? window.mdGet(field, value) : null;
    if (!rec) return '';
    const details = rec.details || {};
    const chips = [];
    schema.forEach(s => {
      const raw = details[s.key];
      if (s.contacts) {
        const list = typeof window.mdContactsOf === 'function' ? window.mdContactsOf(details) : (Array.isArray(raw) ? raw : []);
        if (!list.length) return;
        const names = list.map(c => c.name).filter(Boolean);
        const disp = names.length ? names.slice(0, 2).join('、') + (names.length > 2 ? ' 他' : '') : list.length + '名';
        chips.push(`<span class="stats-md-chip" title="${_eav(s.label + '：' + list.length + '名')}"><b>${_esc(s.label)}</b>${_esc(disp)}</span>`);
        return;
      }
      if (s.tags) {
        if (!Array.isArray(raw) || !raw.length) return;
        const joined = raw.join('、');
        const short = joined.length > 14 ? joined.slice(0, 14) + '…' : joined;
        chips.push(`<span class="stats-md-chip" title="${_eav(s.label + '：' + joined)}"><b>${_esc(s.label)}</b>${_esc(short)}</span>`);
        return;
      }
      const v = String(raw || '').trim();
      if (!v) return;
      const opt = s.options && s.options.find(o => o.value === v);
      const disp = opt ? opt.label : v;
      const short = disp.length > 14 ? disp.slice(0, 14) + '…' : disp;
      chips.push(`<span class="stats-md-chip" title="${_eav(s.label + '：' + disp)}"><b>${_esc(s.label)}</b>${_esc(short)}</span>`);
    });
    if (!chips.length) return '';
    return `<div class="stats-md-inline">${chips.join('')}</div>`;
  }

  // 同義グループ操作ボタン（⭐代表 / ⤵統合 / →代表ピル）。field は sv/nm/customer/port。
  function _synBtns(field, value, canons, aliasOf, cntMap) {
    const isCanon = canons.has(value);
    const canon   = aliasOf[value];
    let h = `<button class="stats-syn-star${isCanon ? ' on' : ''}" ` +
            `onclick="statsToggleSynCanonical('${_ea(field)}','${_ea(value)}')" ` +
            `title="${isCanon ? '代表を解除' : '同義グループの代表に設定'}">${isCanon ? '⭐代表' : '☆代表'}</button>`;
    if (isCanon) {
      const g = (typeof window.synGetGroups === 'function' ? window.synGetGroups(field) : []).find(x => x.canonical === value);
      const aliases = (g && g.aliases) || [];
      if (aliases.length) {
        const total = (cntMap[value] || 0) + aliases.reduce((s, a) => s + (cntMap[a] || 0), 0);
        h += `<span class="stats-syn-total" title="統合した表記の合計件数（${aliases.length}件統合）">計${total}</span>`;
      }
    } else if (canon) {
      h += `<span class="stats-syn-into" title="「${_eav(canon)}」に統合済み">→${_esc(canon)}</span>` +
           `<button class="stats-syn-unmerge" onclick="statsSynUnmerge('${_ea(field)}','${_ea(value)}')" title="統合を解除">✕</button>`;
    } else if (canons.size) {
      h += `<button class="stats-syn-merge" onclick="statsSynMergePicker('${_ea(field)}','${_ea(value)}',this)" title="既存の代表に統合">⤵統合</button>`;
    }
    return h;
  }

  // マスター管理タブに実際に表示される項目か（個別マスター票 or 同義グループの代表）。
  // ジャンプボタンを出すかどうかの判定に使う。
  // synCanonsOverride: 呼び出し元（_renderGrouped/_renderCustomer 等）が同じフィールドの
  // 同義グループ代表 Set を既に計算済みの場合に渡すと、行・チップ単位の呼び出しのたびに
  // synGetGroups() を再取得・再フィルタする無駄を避けられる（データ量が増えるほど効く）。
  function _masterRegistered(field, value, voteInfo, synCanonsOverride) {
    if ((voteInfo || _voteInfo(field, value)).total > 0) return true;
    if (synCanonsOverride) {
      if (synCanonsOverride.has(value)) return true;
    } else {
      const groups = typeof window.synGetGroups === 'function' ? window.synGetGroups(field) : [];
      if (groups.some(g => g.canonical === value)) return true;
    }
    if (field === 'un') {
      const ug = typeof window.uaGetGroups === 'function' ? window.uaGetGroups() : [];
      if (ug.some(g => g.canonical === value)) return true;
    }
    return false;
  }
  function _masterJumpBtn(field, value) {
    return `<button class="stats-master-jump-btn" title="🗂 マスター管理タブの該当行へジャンプ" ` +
           `onclick="statsJumpToMaster('${_ea(field)}','${_ea(value)}')">🗂↗</button>`;
  }

  // 表記名をクリックすると、その表記が使われている案件一覧をポップオーバー表示する。
  function _usageSpan(field, value) {
    if (!value) return '';
    return `<span class="stats-usage-link" onclick="statsShowUsage('${_ea(field)}','${_ea(value)}', event)" ` +
           `title="この表記が使われている案件を確認">${_esc(value)}</span>`;
  }

  // 明細行の該当フィールド値を取り出す（nm は課税マーク * を除去して比較）
  function _rowFieldValue(field, cells) {
    if (!Array.isArray(cells)) return null;
    if (field === 'sv') return (cells[CI.sv] || '').trim();
    if (field === 'nm') return (cells[CI.nm] || '').replace(/^\*+/, '').trim();
    if (field === 'un') return (cells[CI.un] || '').trim();
    return null;
  }

  // 表記（field/value）が使われている案件（ローカル＋クラウド）を検索。新しい順。
  function _casesUsing(field, value) {
    const source = document.getElementById('statsSource')?.value || 'both';
    const out = [];
    const check = (p, isCloud) => {
      const f = (p.data || {}).fields || {};
      let match;
      if (field === 'customer') {
        match = (isCloud ? (p.customer || '') : (f['qf-customer'] || '')).trim() === value;
      } else if (field === 'carrier') {
        match = _carrierValsFromFields(f).includes(value);
      } else if (field === 'port') {
        match = _portValsFromFields(f).includes(value);
      } else {
        const rows = (p.data || {}).rows;
        match = Array.isArray(rows) && rows.some(r => r && r._type === 'data' && _rowFieldValue(field, r.cells) === value);
      }
      if (!match) return;
      out.push({
        src: isCloud ? 'cloud' : 'local',
        id:  isCloud ? p.id : null,
        name:     p.name || '（名称なし）',
        customer: (isCloud ? (p.customer || '') : (f['qf-customer'] || '')).trim(),
        person:   (isCloud ? (p.person   || '') : (f['qf-person']   || '')).trim(),
        status:   (isCloud ? (p.status   || '') : (f['qf-status']   || '')).trim(),
        ts: isCloud ? (p.updated_at ? new Date(p.updated_at).getTime() : 0) : (p.ts ? new Date(p.ts).getTime() : 0),
      });
    };
    if (source !== 'cloud') _getLocalPresets().forEach(p => check(p, false));
    if (source !== 'local') (typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : []).forEach(p => check(p, true));
    out.sort((a, b) => b.ts - a.ts);
    return out;
  }

  // 「使用案件」ポップオーバー（body 直下に fixed 配置、既存 syn-suggest と同じ流儀）
  let _usagePop = null;
  function _usagePopOutsideClick(e) {
    if (_usagePop && !_usagePop.contains(e.target)) _dismissUsagePop();
  }
  function _dismissUsagePop() {
    if (_usagePop) { _usagePop.remove(); _usagePop = null; }
    document.removeEventListener('mousedown', _usagePopOutsideClick, true);
  }
  window.statsHideUsage = _dismissUsagePop;
  window.statsShowUsage = function (field, value, ev) {
    if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
    _dismissUsagePop();
    const cases = _casesUsing(field, value);
    const pop = document.createElement('div');
    pop.className = 'stats-usage-pop';
    let body;
    if (!cases.length) {
      body = '<p class="stats-usage-pop-empty">この表記を使用している案件が見つかりませんでした。</p>';
    } else {
      body = '<div class="stats-usage-pop-list">' + cases.map(c => {
        const meta = [
          c.status || '',
          c.customer ? '👤 ' + _esc(c.customer) : '',
          c.person   ? '🧑‍💼 ' + _esc(c.person) : '',
          c.ts ? '🕒 ' + new Date(c.ts).toLocaleDateString('ja-JP', { year: '2-digit', month: '2-digit', day: '2-digit' }) : '',
        ].filter(Boolean).join('・');
        const clickable = c.src === 'cloud';
        return `<div class="stats-usage-pop-item${clickable ? ' is-clickable' : ''}"` +
               (clickable ? ` onclick="cloudPreviewPreset('${_ea(String(c.id))}')"` : '') +
               ` title="${clickable ? 'クリックでプレビュー' : 'このブラウザのローカル保存案件（プレビュー非対応）'}">` +
               `<span class="stats-usage-pop-src">${c.src === 'cloud' ? '☁️' : '💾'}</span>` +
               `<span class="stats-usage-pop-name">${_esc(c.name)}</span>` +
               (meta ? `<span class="stats-usage-pop-meta">${meta}</span>` : '') +
               `</div>`;
      }).join('') + '</div>';
    }
    pop.innerHTML =
      `<div class="stats-usage-pop-head"><span>📂 「${_esc(value)}」を使用している案件（${cases.length}件）</span>` +
      `<button class="stats-usage-pop-close" onclick="statsHideUsage()">✕</button></div>` + body;
    pop.style.position = 'fixed';
    document.body.appendChild(pop);
    const target = (ev && (ev.currentTarget || ev.target));
    const r = target ? target.getBoundingClientRect() : { bottom: 60, left: 20 };
    pop.style.top  = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 8)) + 'px';
    pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    _usagePop = pop;
    setTimeout(() => document.addEventListener('mousedown', _usagePopOutsideClick, true), 0);
  };

  function _voteBtn(field, value, synCanonsOverride) {
    const v  = _voteInfo(field, value);
    const on = v.isMine;
    let h = `<button class="stats-vote-btn${on ? ' stats-voted' : ''}" ` +
           `onclick="statsToggleVote('${_ea(field)}','${_ea(value)}')" ` +
           `title="${on ? 'マスターを解除' : 'マスターに登録'}">` +
           (on ? '⭐ 登録済' : '☆ 登録') +
           '</button>';
    if (_masterRegistered(field, value, v, synCanonsOverride)) h += _masterJumpBtn(field, value);
    return h;
  }

  // ゆらぎグループ表示（nm/sv/carrier/port 共通）。
  // 手動の同義グループ（⭐代表→統合）は単位タブと同様に1行へ統合表示し、
  // それ以外は従来どおり自動ゆらぎ検出グループとして表示（併存）。
  // === 並べ替え（件数順／名前順）===
  // 名前順にすると似た表記が隣接し、代表登録（⭐代表→統合）作業がしやすくなる。
  let _statsSort = 'count';   // 'count' | 'name'
  // 行数の多いリストは先頭 LIST_PAGE 件だけ描画し「もっと見る」で追加する
  // （項目数に比例して DOM 生成・描画が重くなるため）。条件を変えたら先頭に戻す。
  const LIST_PAGE = 100;
  let _listLimit = {};   // paneId → 現在の表示上限
  function _limitOf(paneId) { return _listLimit[paneId] || LIST_PAGE; }
  function _moreHtml(paneId, total) {
    const lim = _limitOf(paneId);
    if (total <= lim) return '';
    return `<div class="stats-more-wrap"><button class="stats-more-btn" onclick="statsShowMore('${paneId}')">` +
           `▼ もっと見る（残り ${total - lim} 件 / 全 ${total} 件）</button></div>`;
  }
  window.statsShowMore = function (paneId) {
    _listLimit[paneId] = _limitOf(paneId) + LIST_PAGE;
    _renderActivePane();
  };
  window.statsSetSort = function (mode) {
    _statsSort = (mode === 'name') ? 'name' : 'count';
    _listLimit = {};
    _renderActivePane();
  };
  function _cmpName(a, b) { return String(a || '').localeCompare(String(b || ''), 'ja'); }

  // 「未整理のみ」表示フィルタ：同義グループ化済み・マスター登録済みの項目を隠し、
  // まだ手つかずの項目だけを表示する。件数が増えてきたリストから次にやるべきことを見つけやすくする。
  let _statsUnorganizedOnly = false;
  window.statsToggleUnorganized = function () {
    _statsUnorganizedOnly = !_statsUnorganizedOnly;
    _listLimit = {};
    _renderActivePane();
  };
  // 「ゆらぎありのみ」表示フィルタ：表記ゆれ（同じ読みで複数の表記）がある項目だけを表示する。
  let _statsFluctOnly = false;
  window.statsToggleFluct = function () {
    _statsFluctOnly = !_statsFluctOnly;
    _listLimit = {};
    _renderActivePane();
  };
  function _sortToolbar() {
    const by = _statsSort;
    return '<div class="stats-sort-toolbar"><span class="stats-sort-label">並び替え</span>' +
           `<button class="stats-sort-btn${by === 'count' ? ' is-active' : ''}" onclick="statsSetSort('count')">件数順</button>` +
           `<button class="stats-sort-btn${by === 'name' ? ' is-active' : ''}" onclick="statsSetSort('name')">名前順（あ→ん）</button>` +
           `<label class="stats-unorg-toggle" title="⭐同義グループ化済み・マスター登録済みの項目を隠し、未整理の項目だけ表示します">` +
           `<input type="checkbox" onchange="statsToggleUnorganized()"${_statsUnorganizedOnly ? ' checked' : ''}> 未整理のみ表示</label>` +
           `<label class="stats-unorg-toggle" title="表記ゆれ（同じ読みで複数の表記）がある項目だけ表示します">` +
           `<input type="checkbox" onchange="statsToggleFluct()"${_statsFluctOnly ? ' checked' : ''}> ゆらぎありのみ表示</label></div>`;
  }

  function _renderGrouped(groups, field, colLabel, paneId) {
    const e = document.getElementById(paneId);
    if (!e || !_data) return;
    // alias rule / 同義グループのフィールド（sv/carrier/nm/port をそのまま使用）
    const aliasField = field;
    const synGroups  = typeof window.synGetGroups === 'function' ? window.synGetGroups(aliasField) : [];
    const synCanons  = new Set(synGroups.map(g => g.canonical));
    const synAliasOf = {};
    synGroups.forEach(g => (g.aliases || []).forEach(a => { synAliasOf[a] = g.canonical; }));
    // 件数マップ（全バリアント横断）
    const cntMap = {};
    groups.forEach(g => g.variants.forEach(v => { cntMap[v.value] = (cntMap[v.value] || 0) + v.count; }));
    // 同義グループが消費する値（代表＋統合先すべて）
    const consumed = new Set();
    synGroups.forEach(g => { consumed.add(g.canonical); (g.aliases || []).forEach(a => consumed.add(a)); });
    // 同義グループ統合行（合計降順）
    const synRows = synGroups.map(g => {
      const own = cntMap[g.canonical] || 0;
      const aliasCnt = (g.aliases || []).reduce((s, a) => s + (cntMap[a] || 0), 0);
      return { g, own, aliasCnt, total: own + aliasCnt };
    });
    synRows.sort((a, b) => _statsSort === 'name' ? _cmpName(a.g.canonical, b.g.canonical) : b.total - a.total);
    // 残りの自動ゆらぎグループ（同義グループに取り込まれた値を除外）
    const restGroups = [];
    groups.forEach((g, gIdx) => {
      const variants = g.variants.filter(v => !consumed.has(v.value));
      if (!variants.length) return;
      restGroups.push({ variants, total: variants.reduce((s, v) => s + v.count, 0), isAbbrevGroup: g.isAbbrevGroup, origIdx: gIdx });
    });
    if (_statsSort === 'name') restGroups.sort((a, b) => _cmpName(a.variants[0].value, b.variants[0].value));

    // 「未整理のみ」フィルタ：同義グループ行（＝整理済み）を隠し、まだ手つかずの
    // 単独項目（個別マスター登録もされていないもの）だけ残す。ゆらぎ複数種の行は
    // まだ同義グループに統合されていない＝手つかずなので常に表示する。
    // 「ゆらぎありのみ」：同義グループ（整理済み）は隠し、複数表記のある自動ゆらぎグループだけ残す。
    const visSynRows  = (_statsUnorganizedOnly || _statsFluctOnly) ? [] : synRows;
    let visRestGroups = _statsUnorganizedOnly
      ? restGroups.filter(g => g.variants.length > 1 || !_masterRegistered(field, g.variants[0].value, null, synCanons))
      : restGroups;
    if (_statsFluctOnly) visRestGroups = visRestGroups.filter(g => g.variants.length > 1);

    if (!visSynRows.length && !visRestGroups.length) {
      e.innerHTML = _sortToolbar() + (synRows.length || restGroups.length
        ? (_statsFluctOnly
            ? '<p class="stats-empty">ゆらぎのある項目はありません。</p>'
            : '<p class="stats-empty">🎉 未整理の項目はありません。すべて同義グループ化・マスター登録済みです。</p>')
        : '<p class="stats-empty">データなし</p>');
      return;
    }

    // 件数バーのスケール（表示行の最大 total）
    const maxTotal = Math.max(1, visSynRows.reduce((m, r) => Math.max(m, r.total), 0), visRestGroups.reduce((m, g) => Math.max(m, g.total), 0));
    // 描画は先頭 N 行のみ（行数が多いほど重くなるため。残りは「もっと見る」で追加）
    const totalRows = visSynRows.length + visRestGroups.length;
    const pageLimit = _limitOf(paneId);
    const shownSyn  = visSynRows.slice(0, pageLimit);
    const shownRest = visRestGroups.slice(0, Math.max(0, pageLimit - shownSyn.length));

    let h = _sortToolbar() +
            '<p class="stats-syn-hint">☆代表 で同義グループの基準を決め、他の表記を ⤵統合 でまとめると、⭐行に集約され件数が合算されます（非破壊）。表記ゆれの一括置換は「ゆらぎ N種」バッジから。</p>' +
            `<table class="stats-table stats-nm-table"><thead><tr>` +
            `<th>${colLabel}</th><th class="stats-num-col">合計</th><th>同義グループ / バリアント</th>` +
            `</tr></thead><tbody>`;

    // --- 同義グループ（統合表示）---
    shownSyn.forEach(sr => {
      const g = sr.g;
      const members = (g.aliases || []).length + 1;
      let chips = `<span class="stats-chip stats-chip--canon">` +
                  `<span class="stats-chip-text">⭐ ${_usageSpan(field, g.canonical)}</span>` +
                  `<span class="stats-chip-cnt">×${sr.own}</span>` +
                  _voteBtn(field, g.canonical, synCanons) +
                  `</span>`;
      (g.aliases || []).forEach(a => {
        chips += `<span class="stats-chip">` +
                 `<span class="stats-chip-text">${_usageSpan(field, a)}</span>` +
                 `<span class="stats-chip-cnt">×${cntMap[a] || 0}</span>` +
                 `<button class="stats-syn-unmerge" onclick="statsSynUnmerge('${_ea(aliasField)}','${_ea(a)}')" title="統合を解除">✕</button>` +
                 `</span>`;
      });
      h += `<tr class="stats-syn-row">` +
           `<td class="stats-val"><span class="ua-star">⭐</span>${_usageSpan(field, g.canonical)} <span class="stats-syn-grp-badge" title="同義グループ（${members}種を集約）">同義 ${members}種</span></td>` +
           `<td class="stats-num-col"><div class="stats-bar-wrap"><div class="stats-bar" style="width:${Math.round(sr.total / maxTotal * 100)}%"></div><span class="stats-bar-label">${sr.total}</span></div>${sr.aliasCnt ? `<span class="ua-cnt-detail"> (${sr.own}+${sr.aliasCnt})</span>` : ''}</td>` +
           `<td class="stats-chips-cell">${chips}` +
             `<button class="stats-syn-merge-canon" onclick="statsSynMergePicker('${_ea(aliasField)}','${_ea(g.canonical)}',this)" title="この代表を別の代表に統合">⤵ 統合</button>` +
             `<button class="stats-syn-dissolve" onclick="statsToggleSynCanonical('${_ea(aliasField)}','${_ea(g.canonical)}')" title="同義グループを解除">グループ解除</button>` +
           `</td></tr>`;
    });

    // --- 残りの自動ゆらぎグループ ---
    shownRest.forEach(g => {
      const hasV = g.variants.length > 1;
      const gId  = paneId + '-' + g.origIdx;
      _renderedGroups[gId] = { aliasField, variants: g.variants };
      h += `<tr${hasV ? ' class="stats-has-variant"' : ''}>`;
      h += `<td class="stats-val">${_usageSpan(field, g.variants[0].value)}`;
      if (hasV) {
        if (g.isAbbrevGroup) {
          h += ` <span class="stats-variant-badge stats-variant-badge--abbrev" title="略称辞書で関連付けられた表記">略称 ${g.variants.length}種</span>`;
        } else {
          h += ` <button class="stats-variant-badge stats-variant-badge--link" onclick="statsJumpToAlias('${gId}')" title="エイリアス是正タブで一括登録">ゆらぎ ${g.variants.length}種</button>`;
        }
      }
      h += `</td>`;
      h += `<td class="stats-num-col">` +
           `<div class="stats-bar-wrap"><div class="stats-bar" style="width:${Math.round(g.total/maxTotal*100)}%"></div>` +
           `<span class="stats-bar-label">${g.total}</span></div>` +
           `</td>`;
      h += `<td class="stats-chips-cell">`;
      g.variants.forEach(v => {
        h += `<span class="stats-chip">` +
             `<span class="stats-chip-text">${_usageSpan(field, v.value)}</span>` +
             `<span class="stats-chip-cnt">×${v.count}</span>` +
             _voteBtn(field, v.value, synCanons) +
             (hasV ? `<button class="stats-excl-chip-btn" onclick="statsExcludeVariant('${_ea(aliasField)}','${_ea(v.value)}')" title="ゆらぎ判定から除外（別物として扱う）">≠</button>` : '') +
             _synBtns(aliasField, v.value, synCanons, synAliasOf, cntMap) +
             `</span>`;
      });
      h += '</td></tr>';
    });
    e.innerHTML = h + '</tbody></table>' + _moreHtml(paneId, totalRows);
  }

  window.statsExcludeVariant = async function (field, value) {
    if (typeof window.arAddExclusion === 'function') await window.arAddExclusion(field, value);
    // arAddExclusion calls statsRefresh internally
  };

  // === 同義グループ操作（⭐代表 / ⤵統合 / 解除）===
  window.statsToggleSynCanonical = async function (field, value) {
    const groups = typeof window.synGetGroups === 'function' ? window.synGetGroups(field) : [];
    const g = groups.find(x => x.canonical === value);
    if (g) {
      if ((g.aliases || []).length && !confirm(`「${value}」を代表から解除します。統合済み ${g.aliases.length} 件もグループ解除されます。よろしいですか？`)) return;
      await window.synRemoveGroup(field, value);
    } else if (typeof window.synSetCanonical === 'function') {
      await window.synSetCanonical(field, value);
    }
  };
  window.statsSynUnmerge = async function (field, value) {
    const map = typeof window.synGetNormalizeMap === 'function' ? window.synGetNormalizeMap(field) : {};
    const canon = map[value];
    if (canon && typeof window.synRemoveAlias === 'function') await window.synRemoveAlias(field, value, canon);
  };
  // 統合先（同一フィールドの他の代表）を選ぶピッカー。value が代表なら配下ごと統合される。
  // 単位(un)は ua* 機構の代表を対象にする。
  window.statsSynMergePicker = function (field, value, btn) {
    document.querySelectorAll('.stats-syn-picker').forEach(el => el.remove());
    const canons = (field === 'un'
      ? (typeof window.uaGetGroups === 'function' ? window.uaGetGroups() : []).map(g => g.canonical)
      : (typeof window.synGetGroups === 'function' ? window.synGetGroups(field) : []).map(g => g.canonical)
    ).filter(c => c && c !== value);
    if (!canons.length) {
      if (typeof window.quoteShowToast === 'function') window.quoteShowToast('⭐ 先に統合先の代表を設定してください', 'warn');
      return;
    }
    const wrap = document.createElement('span');
    wrap.className = 'stats-syn-picker';
    wrap.innerHTML =
      `<span class="stats-syn-pick-lead">${_esc(value)} →</span>` +
      `<select class="stats-syn-sel">` +
      canons.map(c => `<option value="${_eav(c)}">${_esc(c)}</option>`).join('') +
      `</select>` +
      `<button class="stats-syn-pick-ok" onclick="statsSynConfirmMerge('${_ea(field)}','${_ea(value)}',this)">統合</button>` +
      `<button class="stats-syn-pick-cancel" onclick="this.closest('.stats-syn-picker').remove()">✕</button>`;
    btn.after(wrap);
  };
  window.statsSynConfirmMerge = async function (field, value, btn) {
    const sel = btn.closest('.stats-syn-picker')?.querySelector('select');
    if (!sel) return;
    const target = sel.value;
    if (!target || target === value) return;
    if (field === 'un') {
      // value（代表）を target（代表）へ統合：配下を吸収し target を代表に
      if (typeof window.uaRenameCanonical === 'function') window.uaRenameCanonical(value, target);
      if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive();
    } else if (typeof window.synAddAlias === 'function') {
      await window.synAddAlias(field, value, target);
    }
  };

  // 軽量再描画（クラウドプリセット/投票の再取得を伴わない。同義グループ更新時に使用）
  window.statsRerenderActive = function () {
    try { _renderActivePane(); _renderMaster(); } catch (e) { console.error('[statsRerenderActive]', e); }
  };

  window.statsJumpToAlias = function (groupId) {
    const group = _renderedGroups[groupId];
    if (!group) return;
    if (typeof window.arSetQuickFill === 'function') {
      window.arSetQuickFill(
        group.aliasField,
        group.variants[0].value,
        group.variants.slice(1).map(function (v) { return v.value; })
      );
    }
    // エイリアス是正は独立した「🗂 マスター管理」タブへ移設済み。そちらへ遷移。
    const catBtn = document.querySelector('.cat-btn[aria-controls="tab-master"]');
    if (typeof window.switchCategory === 'function' && catBtn) window.switchCategory('master', catBtn);
    if (typeof window.masterSetPane === 'function') window.masterSetPane('alias');
  };

  // 統計タブのマスター登録済み／代表登録済み項目から、🗂 マスター管理タブの該当行へジャンプ。
  // openDetail=true の場合、該当行の「📇 詳細」を自動展開して編集フォームまで見せる
  // （見積タブの「マスター管理で編集」ボタンから来た場合など、編集が目的の遷移向け）。
  function _scrollToMasterRow(field, value, openDetail) {
    const rows = document.querySelectorAll('#statsPane-master tr[data-mfield]');
    let target = null;
    rows.forEach(r => { if (!target && r.dataset.mfield === field && r.dataset.mvalue === value) target = r; });
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('stats-master-jump-hl');
    setTimeout(() => target.classList.remove('stats-master-jump-hl'), 2200);
    if (openDetail) {
      const btn = target.querySelector('.stats-master-detail-btn');
      if (btn) window.statsToggleMasterDetail(field, value, btn);
    }
  }
  window.statsJumpToMaster = async function (field, value, openDetail) {
    const catBtn = document.querySelector('.cat-btn[aria-controls="tab-master"]');
    if (typeof window.switchCategory === 'function' && catBtn) window.switchCategory('master', catBtn);
    if (typeof window.masterSetPane === 'function') window.masterSetPane('master');
    // クラウド最新化してからフィルタ・スクロール（ローカルのみの場合は同期的に完了する）
    if (_cloud()) {
      _cvMap = null;
      await _loadCloudVotes();
      if (typeof window.synLoadCloud === 'function') await window.synLoadCloud();
      if (typeof window.mdLoadCloud === 'function') await window.mdLoadCloud();
      if (typeof window.arLoadCloud === 'function') await window.arLoadCloud();
      if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
    }
    if (typeof window.statsMasterSetFilter === 'function') window.statsMasterSetFilter(field);
    else _renderMaster();
    _scrollToMasterRow(field, value, openDetail);
  };

  // === ペイン描画 ===

  function _renderSv() { _renderGrouped(_data?.svGroups || [], 'sv', 'サブコン名', 'statsPane-sv'); }
  function _renderCarrier() { _renderGrouped(_data?.carrierGroups || [], 'carrier', 'キャリア名', 'statsPane-carrier'); }
  function _renderPort() { _renderGrouped(_data?.portGroups || [], 'port', '港名', 'statsPane-port'); }
  function _renderNm()      { _renderGrouped(_data?.nmGroups      || [], 'nm', '品名',       'statsPane-nm'); }

  // ===== 🔗 サブコン×港ペア =====
  // サブコンは明細行（cells[2]）、港は引き合い条件（z2Pol/z2Pod/z2Via・複数航路）にあるため、
  // 「案件単位で使われたサブコン × その案件の港」の共起を集計する。
  // 同義グループの代表に正規化してから数える（件数＝両方を含む案件数）。
  let _svPortBy = 'sv';   // 'sv' | 'port'
  function _buildSvPortPairs(source) {
    const svMap   = typeof window.synGetNormalizeMap === 'function' ? window.synGetNormalizeMap('sv')   : {};
    const portMap = typeof window.synGetNormalizeMap === 'function' ? window.synGetNormalizeMap('port') : {};
    const norm = (v, m) => (m && m[v]) || v;
    const pairs = new Map();   // `${sv} ${port}` → { sv, port, count }
    const add = p => {
      const d = p.data || {};
      const rows = Array.isArray(d.rows) ? d.rows : [];
      const subs = new Set();
      rows.forEach(r => {
        if (!r || r._type !== 'data') return;
        const sv = ((Array.isArray(r.cells) ? r.cells : [])[2] || '').trim();
        if (sv) subs.add(norm(sv, svMap));
      });
      const ports = new Set(_portValsFromFields(d.fields || {}).map(pt => norm(pt, portMap)));
      if (!subs.size || !ports.size) return;
      subs.forEach(sv => ports.forEach(pt => {
        const k = sv + ' ' + pt;
        if (!pairs.has(k)) pairs.set(k, { sv, port: pt, count: 0 });
        pairs.get(k).count++;
      }));
    };
    if (source !== 'cloud') _getLocalPresets().forEach(add);
    if (source !== 'local') (typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : []).forEach(add);
    return [...pairs.values()].sort((a, b) => b.count - a.count);
  }

  function _renderSvPort() {
    const e = document.getElementById('statsPane-svport');
    if (!e) return;
    const source = document.getElementById('statsSource')?.value || 'both';
    const pairs  = _buildSvPortPairs(source);
    if (!pairs.length) {
      e.innerHTML = '<p class="stats-empty">サブコンと港の組み合わせがありません。<br>' +
        '<small>明細の「サブコン」欄と、引き合い条件の POL / POD / Via を入力して案件を保存してください。</small></p>';
      return;
    }
    const by = _svPortBy;
    const keyField   = by === 'sv' ? 'sv'   : 'port';
    const otherField = by === 'sv' ? 'port' : 'sv';
    const keyLabel   = by === 'sv' ? 'サブコン' : '港';
    const otherLabel = by === 'sv' ? '港' : 'サブコン';
    const groups = new Map();
    pairs.forEach(p => {
      const k = p[keyField], o = p[otherField];
      if (!groups.has(k)) groups.set(k, { key: k, total: 0, items: [] });
      const g = groups.get(k); g.total += p.count; g.items.push({ other: o, count: p.count });
    });
    const list = [...groups.values()];
    list.sort((a, b) => _statsSort === 'name' ? _cmpName(a.key, b.key) : b.total - a.total);
    list.forEach(g => g.items.sort((a, b) => b.count - a.count));
    const maxTotal = Math.max(1, ...list.map(g => g.total));

    let h = '<div class="svp-toolbar"><span class="svp-by-label">グループ基準</span>' +
            `<button class="svp-by-btn${by === 'sv' ? ' is-active' : ''}" onclick="statsSvPortBy('sv')">🏢 サブコン別</button>` +
            `<button class="svp-by-btn${by === 'port' ? ' is-active' : ''}" onclick="statsSvPortBy('port')">🛳 港別</button></div>` +
            _sortToolbar() +
            '<p class="stats-syn-hint">案件単位で「使われたサブコン × その案件の港」を共起集計します。同義グループの代表に正規化し、件数＝両方を含む案件数です。</p>' +
            `<table class="stats-table"><thead><tr><th>${keyLabel}</th><th class="stats-num-col">件数</th><th>${otherLabel}（×件数）</th></tr></thead><tbody>`;
    list.slice(0, _limitOf('statsPane-svport')).forEach(g => {
      const chips = g.items.map(it =>
        `<span class="stats-chip"><span class="stats-chip-text">${_esc(it.other)}</span><span class="stats-chip-cnt">×${it.count}</span></span>`
      ).join('');
      h += `<tr><td class="stats-val">${_esc(g.key)}</td>` +
           `<td class="stats-num-col"><div class="stats-bar-wrap"><div class="stats-bar" style="width:${Math.round(g.total / maxTotal * 100)}%"></div><span class="stats-bar-label">${g.total}</span></div></td>` +
           `<td class="stats-chips-cell">${chips}</td></tr>`;
    });
    e.innerHTML = h + '</tbody></table>' + _moreHtml('statsPane-svport', list.length);
  }
  window.statsSvPortBy = function (by) { _svPortBy = (by === 'port') ? 'port' : 'sv'; _listLimit = {}; _renderSvPort(); };

  // ===== 🧾 お客様×品名 単価 =====
  // 「このお客様に・この品名を・いくらで仕入れ・いくらで売ったか」を明細行から集計する。
  // 品名は課税マーク * を除去して他タブと同じ正規化を適用。単価未入力の行は対象外。
  let _custItemBy = 'customer';   // 'customer' | 'nm'

  // 明細1行の（仕入, 売）を JPY 換算で返す。粗利率に使えるのは「両方が入力済みで換算できる行」だけ。
  // 片側だけ入力された行・為替レート未取得の行を混ぜると、売だけ／仕入だけが積まれて粗利率が
  // 歪むため {skip} を返し、呼び出し側で除外行として数えて画面に注記する。
  function _pairJ(c) {
    const pp = _num(c[CI.pp]), bp = _num(c[CI.bp]);
    if (pp == null || bp == null) return { skip: 'partial' };
    const pq = _num(c[5]) > 0 ? _num(c[5]) : 1;
    const bq = _num(c[CI.bq]) > 0 ? _num(c[CI.bq]) : 1;
    const pc = (c[CI.pc] || 'JPY').trim() || 'JPY';
    const bc = (c[CI.bc] || 'JPY').trim() || 'JPY';
    const cost = _toJ(minAmt(pp * pq, c[CI.ppmin]), pc);
    const bill = _toJ(minAmt(bp * bq, c[CI.bpmin]), bc);
    if (cost == null || bill == null || !isFinite(cost) || !isFinite(bill)) return { skip: 'fx' };
    return { cost, bill };
  }
  function _buildCustItemStats(source) {
    const map = new Map();   // customer + '\x00' + nm → 集計
    const add = (p, isCloud) => {
      const f = (p.data || {}).fields || {};
      const customer = (isCloud ? (p.customer || '') : (f['qf-customer'] || '')).trim() || '（未入力）';
      const rows = (p.data || {}).rows;
      if (!Array.isArray(rows)) return;
      const ts = isCloud ? (p.updated_at ? new Date(p.updated_at).getTime() : 0) : (p.ts ? new Date(p.ts).getTime() : 0);
      rows.forEach(r => {
        if (!r || r._type !== 'data' || !Array.isArray(r.cells)) return;
        const c  = r.cells;
        const nm = (c[CI.nm] || '').replace(/^\*+/, '').trim();
        const pp = _num(c[10]), bp = _num(c[11]);
        if (!nm || (pp == null && bp == null)) return;   // 品名・単価どちらも無ければ対象外
        const pc = (c[8] || 'JPY').trim() || 'JPY';
        const bc = (c[9] || 'JPY').trim() || 'JPY';
        const un = (c[6] || '').trim();
        const key = customer + '\x00' + nm;
        if (!map.has(key)) {
          map.set(key, { customer, nm, count: 0, lastTs: 0, lastPp: null, lastPc: 'JPY', lastBp: null, lastBc: 'JPY', lastUn: '', costSum: 0, billSum: 0, pairs: 0, skipped: 0 });
        }
        const g = map.get(key);
        g.count++;
        if (ts >= g.lastTs) { g.lastTs = ts; g.lastPp = pp; g.lastPc = pc; g.lastBp = bp; g.lastBc = bc; g.lastUn = un; }
        const pr = _pairJ(c);
        if (pr.skip) g.skipped++; else { g.costSum += pr.cost; g.billSum += pr.bill; g.pairs++; }
      });
    };
    if (source !== 'cloud') _getLocalPresets().forEach(p => add(p, false));
    if (source !== 'local') (typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : []).forEach(p => add(p, true));
    return [...map.values()];
  }

  function _renderCustItem() {
    const e = document.getElementById('statsPane-custitem');
    if (!e) return;
    const source = document.getElementById('statsSource')?.value || 'both';
    const rows = _buildCustItemStats(source);
    if (!rows.length) {
      e.innerHTML = '<p class="stats-empty">単価入力のある明細がありません。<br>' +
        '<small>明細行に仕入単価・売単価のどちらかを入れて案件を保存すると、ここに集計されます。</small></p>';
      return;
    }
    const by = _custItemBy;
    const keyField = by === 'customer' ? 'customer' : 'nm';
    const otherLabel = by === 'customer' ? '品名' : 'お客様';
    const otherField = by === 'customer' ? 'nm' : 'customer';
    const money = (n, cur) => {
      if (n == null) return '—';
      const c = (cur || 'JPY').trim() || 'JPY';
      return c === 'JPY' ? '¥' + Math.round(n).toLocaleString('ja-JP') : c + ' ' + n.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
    };
    const skippedRows = rows.reduce((n, r) => n + (r.skipped || 0), 0);
    const groups = new Map();
    rows.forEach(r => {
      const k = r[keyField];
      if (!groups.has(k)) groups.set(k, { key: k, items: [], bill: 0, cost: 0 });
      const g = groups.get(k);
      g.items.push(r); g.bill += r.billSum; g.cost += r.costSum;
    });
    const list = [...groups.values()].sort((a, b) => b.bill - a.bill);
    list.forEach(g => g.items.sort((a, b) => b.count - a.count));

    let h = '<div class="svp-toolbar"><span class="svp-by-label">グループ基準</span>' +
            `<button class="svp-by-btn${by === 'customer' ? ' is-active' : ''}" onclick="statsCustItemBy('customer')">👤 お客様別</button>` +
            `<button class="svp-by-btn${by === 'nm' ? ' is-active' : ''}" onclick="statsCustItemBy('nm')">📝 品名別</button></div>` +
            '<p class="stats-syn-hint">案件の明細行から、お客様ごと・品名ごとの仕入単価と売単価を集計します。単価は直近使用時の値（通貨そのまま）、粗利率は仕入・売の両方が入力済みの行だけをJPY換算して合計から算出します' +
            (skippedRows ? `（仕入・売の片方のみ、または為替未取得の ${skippedRows} 行は粗利率から除外）` : '') + '。</p>';

    list.slice(0, _limitOf('statsPane-custitem')).forEach(g => {
      const margin = (window.SharedCalc && g.bill > 0) ? SharedCalc.grossMarginPct(g.bill, g.cost) : null;
      const mCls = margin == null ? '' : (margin >= 0 ? 'sd-margin-pos' : 'sd-margin-neg');
      const rowsHtml = g.items.map(it => {
        const ppStr = money(it.lastPp, it.lastPc) + (it.lastPp != null && it.lastUn ? ' /' + _esc(it.lastUn) : '');
        const bpStr = money(it.lastBp, it.lastBc) + (it.lastBp != null && it.lastUn ? ' /' + _esc(it.lastUn) : '');
        const itMargin = (window.SharedCalc && it.billSum > 0) ? SharedCalc.grossMarginPct(it.billSum, it.costSum) : null;
        const itMCls = itMargin == null ? '' : (itMargin >= 0 ? 'sd-margin-pos' : 'sd-margin-neg');
        const label = it[otherField];
        return `<tr><td class="stats-val">${_usageSpan(otherField, label)}</td>` +
               `<td class="stats-num-col">${it.count}</td>` +
               `<td class="stats-sv-price">${ppStr}</td>` +
               `<td class="stats-sv-price">${bpStr}</td>` +
               `<td class="stats-num-col ${itMCls}">${itMargin == null ? '—' : itMargin.toFixed(1) + '%'}</td></tr>`;
      }).join('');
      h += `<details class="stats-sv-detail">` +
           `<summary><b>${_usageSpan(keyField, g.key)}</b>` +
           `<span class="stats-sv-detail-meta">${g.items.length}品目 · 売上 ${_jpy(g.bill)} · 粗利率 <span class="${mCls}">${margin == null ? '—' : margin.toFixed(1) + '%'}</span></span></summary>` +
           `<table class="stats-table sd-money-table stats-sv-charge-table"><thead><tr>` +
           `<th>${otherLabel}</th><th class="stats-num-col">回数</th><th>直近仕入単価</th><th>直近売単価</th><th class="stats-num-col">粗利率</th>` +
           `</tr></thead><tbody>${rowsHtml}</tbody></table></details>`;
    });
    e.innerHTML = '<div class="stats-sv-charges-wrap">' + h + '</div>' + _moreHtml('statsPane-custitem', list.length);
  }
  window.statsCustItemBy = function (by) { _custItemBy = (by === 'nm') ? 'nm' : 'customer'; _listLimit = {}; _renderCustItem(); };

  // ===== 🎯 マージンばらつき（作成者差）=====
  // 「同じお客様・同じ品名・同じ仕向地」なのに、見積作成者によって粗利率がどれだけ
  // 違うかを可視化する。感覚でマージンを乗せている箇所をチームで共有するための集計。
  // 作成者（created_by）はクラウド共有案件にしかないため、対象はクラウドデータのみ。
  function _podValFromFields(f) {
    let rts = [];
    try { rts = JSON.parse(f['z2-routes-data'] || '[]'); } catch (e) {}
    if (Array.isArray(rts) && rts.length) {
      const v = rts.map(r => (r.pod || '').trim()).filter(Boolean).join(', ');
      if (v) return v;
    }
    return (f['z2Pod'] || '').trim() || null;
  }
  // 「提示後」＝見積が客先へ出た状態。下書き中・保留・辞退などの試算は実際の乗せ幅ではないため既定で除く。
  const _SENT_STATUSES = ['提示済み', '提出済み', 'ヨコヨコ提示', '受注', '失注'];
  let _mdStatusMode = 'sent';   // 'sent'（提示後のみ）| 'all'
  let _mdMinCount   = 2;        // 作成者ごとの最小件数（これ未満は参考表示で、ばらつきの計算に使わない）
  function _buildMarginDiffStats() {
    const map = new Map();   // customer + '\x00' + nm + '\x00' + pod → { customer, nm, pod, creators: Map(email→集計) }
    let skipped = 0, statusExcluded = 0;
    const rowsSrc = typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : [];
    rowsSrc.forEach(p => {
      const creatorEmail = (p.created_by || '').trim();
      if (!creatorEmail) return;   // 作成者不明は比較対象外
      if (_mdStatusMode === 'sent' && !_SENT_STATUSES.includes((p.status || '').trim())) { statusExcluded++; return; }
      const f = (p.data || {}).fields || {};
      const customer = (p.customer || '').trim() || '（未入力）';
      const pod = _podValFromFields(f) || '（未入力）';
      const rows = (p.data || {}).rows;
      if (!Array.isArray(rows)) return;
      rows.forEach(r => {
        if (!r || r._type !== 'data' || !Array.isArray(r.cells)) return;
        const c  = r.cells;
        const nm = (c[CI.nm] || '').replace(/^\*+/, '').trim();
        if (!nm) return;
        const pr = _pairJ(c);
        if (pr.skip) { if (_num(c[CI.pp]) != null || _num(c[CI.bp]) != null) skipped++; return; }
        const key = customer + '\x00' + nm + '\x00' + pod;
        if (!map.has(key)) map.set(key, { customer, nm, pod, creators: new Map() });
        const g = map.get(key);
        if (!g.creators.has(creatorEmail)) g.creators.set(creatorEmail, { email: creatorEmail, count: 0, costSum: 0, billSum: 0 });
        const cg = g.creators.get(creatorEmail);
        cg.count++; cg.costSum += pr.cost; cg.billSum += pr.bill;
      });
    });
    return { groups: [...map.values()], skipped, statusExcluded };
  }

  function _creatorName(email) {
    return (typeof window.quoteDisplayName === 'function' ? window.quoteDisplayName(email) : null) || email;
  }

  window.statsMdSet = function (key, val) {
    if (key === 'status') _mdStatusMode = (val === 'all') ? 'all' : 'sent';
    if (key === 'min') _mdMinCount = Math.max(1, parseInt(val, 10) || 1);
    _listLimit = {};
    _renderMarginDiff();
  };

  function _renderMarginDiff() {
    const e = document.getElementById('statsPane-margindiff');
    if (!e) return;
    const built = _buildMarginDiffStats();
    let excluded = 0;
    const list = [];
    built.groups.forEach(g => {
      const creators = [...g.creators.values()].map(cg => ({
        ...cg,
        margin: (window.SharedCalc && cg.billSum > 0) ? SharedCalc.grossMarginPct(cg.billSum, cg.costSum) : null,
        enough: cg.count >= _mdMinCount,
      }));
      // ばらつきは「件数が足りている作成者」同士でだけ比べる（1件対1件の偶然を拾わない）
      const base = creators.filter(c => c.margin != null && c.enough);
      if (base.length < 2) { excluded++; return; }
      const spread = Math.max(...base.map(c => c.margin)) - Math.min(...base.map(c => c.margin));
      creators.sort((a, b) => (b.margin ?? -Infinity) - (a.margin ?? -Infinity));
      list.push({ customer: g.customer, nm: g.nm, pod: g.pod, creators, spread });
    });

    const btn = (on, onclick, label) => `<button class="svp-by-btn${on ? ' is-active' : ''}" onclick="${onclick}">${label}</button>`;
    const toolbar = '<div class="svp-toolbar"><span class="svp-by-label">対象の案件</span>' +
      btn(_mdStatusMode === 'sent', "statsMdSet('status','sent')", '提示後のみ（提示済み・受注・失注）') +
      btn(_mdStatusMode === 'all',  "statsMdSet('status','all')",  'すべて（下書き含む）') +
      '<span class="svp-by-label">作成者ごとの最小件数</span>' +
      [1, 2, 3].map(n => btn(_mdMinCount === n, `statsMdSet('min',${n})`, n + '件以上')).join('') + '</div>';

    const notes = [];
    if (built.statusExcluded) notes.push(`下書き中・保留・辞退などの案件 ${built.statusExcluded} 件は対象外`);
    if (built.skipped) notes.push(`仕入・売の片方のみ／為替未取得の ${built.skipped} 行は粗利率から除外`);
    if (excluded) notes.push(`比較できる作成者が2人未満の組み合わせ ${excluded} 件は非表示`);
    const noteHtml = notes.length ? `<p class="stats-syn-hint">除外：${notes.join('、')}。</p>` : '';

    if (!list.length) {
      e.innerHTML = toolbar + '<p class="stats-empty">作成者間で比較できるデータがまだありません。<br>' +
        `<small>同じお客様・品名・仕向地の案件を、${_mdMinCount}件以上ずつ2人以上の作成者がクラウドに保存すると、ここに集計されます。</small></p>` + noteHtml;
      return;
    }
    list.sort((a, b) => b.spread - a.spread);

    let h = toolbar +
            '<p class="stats-syn-hint">同じお客様・品名・仕向地の組み合わせについて、見積作成者ごとの平均粗利率（仕入・売の両方が入った行をJPY換算した合計）を比較します。' +
            '作成者情報があるクラウド共有案件のみが対象です。粗利率の差（ばらつき）が大きい順に表示し、件数が足りない作成者は「参考」としてばらつきの計算から外します。為替は現在のレートで換算しています。</p>' + noteHtml;

    list.slice(0, _limitOf('statsPane-margindiff')).forEach(g => {
      const rowsHtml = g.creators.map(cg => {
        const mCls = cg.margin == null ? '' : (cg.margin >= 0 ? 'sd-margin-pos' : 'sd-margin-neg');
        const avgBill = cg.count > 0 ? cg.billSum / cg.count : null;
        return `<tr${cg.enough ? '' : ' style="opacity:.55"'}><td class="stats-val">${_esc(_creatorName(cg.email))}${cg.enough ? '' : ' <small>（参考：件数不足）</small>'}</td>` +
               `<td class="stats-num-col">${cg.count}</td>` +
               `<td class="stats-num-col ${mCls}">${cg.margin == null ? '—' : cg.margin.toFixed(1) + '%'}</td>` +
               `<td class="stats-sv-price">${avgBill == null ? '—' : _jpy(avgBill)}</td></tr>`;
      }).join('');
      h += `<details class="stats-sv-detail">` +
           `<summary><b>${_usageSpan('customer', g.customer)} ・ ${_usageSpan('nm', g.nm)} ・ 仕向地 ${_esc(g.pod)}</b>` +
           `<span class="stats-sv-detail-meta">作成者 ${g.creators.length}名 · 粗利率の差 <span class="${g.spread >= 10 ? 'sd-margin-neg' : ''}">${g.spread.toFixed(1)}pt</span></span></summary>` +
           `<table class="stats-table sd-money-table stats-sv-charge-table"><thead><tr>` +
           `<th>作成者</th><th class="stats-num-col">件数</th><th class="stats-num-col">平均粗利率</th><th>平均売上/回</th>` +
           `</tr></thead><tbody>${rowsHtml}</tbody></table></details>`;
    });
    e.innerHTML = '<div class="stats-sv-charges-wrap">' + h + '</div>' + _moreHtml('statsPane-margindiff', list.length);
  }

  // ===== 📒 明細台帳 =====
  // 明細1行ずつを、案件の条件（お客様・航路・モード・輸出入）と並べて振り返る。
  // 「この条件で、どこから・いくらで買って、どの客に・いくらで売ったか」を絞り込んで確認できる。
  // 仕入・売の片方しか入っていない行も台帳には載せる（粗利率だけ「—」）。
  let _ledgerCache = null;   // 台帳の全行（タブ表示時に1回だけ構築。条件変更では再構築しない）
  const _ledgerF = { cust: '', sv: '', nm: '', route: '', mode: '', dir: '', status: 'all', sort: 'new' };
  const _DIR_LABEL = { export: '輸出', import: '輸入' };
  const _fold = s => String(s == null ? '' : s).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
  function _fmtMoney(n, cur) {
    if (n == null) return '—';
    const c = (cur || 'JPY').trim() || 'JPY';
    return c === 'JPY' ? '¥' + Math.round(n).toLocaleString('ja-JP') : c + ' ' + n.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  }

  function _ledgerBuild(source) {
    const period = document.getElementById('statsPeriod')?.value || 'all';
    const now = Date.now();
    const cutoff = { all: 0, month: now - 30 * 86400000, q3: now - 91 * 86400000, year: now - 365 * 86400000 }[period] || 0;
    const out = [];
    const add = (p, isCloud) => {
      const d = p.data || {}, f = d.fields || {};
      if (!Array.isArray(d.rows)) return;
      const tsRaw = isCloud ? p.updated_at : (p.ts || p.updatedAt);
      const ts = tsRaw ? new Date(tsRaw).getTime() : 0;
      if (cutoff && ts && ts < cutoff) return;
      const c0 = {
        caseId: isCloud ? p.id : null,
        caseName: p.name || '（名称なし）',
        customer: ((isCloud ? p.customer : f['qf-customer']) || '').trim(),
        status: ((isCloud ? p.status : f['qf-status']) || '').trim(),
        mode: ((isCloud ? p.transport_mode : f['cond-mode']) || '').trim(),
        dir: (f['cond-direction'] || '').trim(),
        pol: isCloud ? (p.pol || '').trim() : _routeFromFields(f, 'pol'),
        pod: isCloud ? (p.pod || '').trim() : _routeFromFields(f, 'pod'),
        creator: isCloud && p.created_by ? _creatorName(p.created_by) : '',
        ts,
      };
      d.rows.forEach(r => {
        if (!r || r._type !== 'data' || !Array.isArray(r.cells)) return;
        const c = r.cells;
        const nm = (c[CI.nm] || '').replace(/^\*+/, '').trim();
        const sv = (c[CI.sv] || '').trim();
        const pp = _num(c[CI.pp]), bp = _num(c[CI.bp]);
        if ((!nm && !sv) || (pp == null && bp == null)) return;
        const pr = _pairJ(c);
        out.push(Object.assign({}, c0, {
          cat: (c[CI.cat] || '').trim(), nm, sv, un: (c[CI.un] || '').trim(),
          bq: _num(c[CI.bq]), pp, pc: (c[CI.pc] || 'JPY').trim() || 'JPY', bp, bc: (c[CI.bc] || 'JPY').trim() || 'JPY',
          costJ: pr.skip ? null : pr.cost, billJ: pr.skip ? null : pr.bill,
          margin: (!pr.skip && pr.bill > 0 && window.SharedCalc) ? SharedCalc.grossMarginPct(pr.bill, pr.cost) : null,
        }));
      });
    };
    if (source !== 'cloud') _getLocalPresets().forEach(p => add(p, false));
    if (source !== 'local') (typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : []).forEach(p => add(p, true));
    return out;
  }

  window.statsLedgerSet = function (key, val) {
    _ledgerF[key] = val;
    if (key !== 'status' && key !== 'sort' && key !== 'mode' && key !== 'dir') {
      // 文字入力は打つたびに再描画しない（入力欄のフォーカスを保つため結果部分だけ更新）
      clearTimeout(window.__ldgT);
      window.__ldgT = setTimeout(() => { _listLimit = {}; _renderLedgerResult(); }, 160);
      return;
    }
    _listLimit = {};
    _renderLedgerResult();
  };
  window.statsLedgerClear = function () {
    Object.assign(_ledgerF, { cust: '', sv: '', nm: '', route: '', mode: '', dir: '', status: 'all', sort: 'new' });
    _listLimit = {};
    _renderLedger(true);
  };

  function _ledgerFiltered() {
    const f = _ledgerF;
    const q = { cust: _fold(f.cust), sv: _fold(f.sv), nm: _fold(f.nm), route: _fold(f.route) };
    let rows = (_ledgerCache || []).filter(r => {
      if (q.cust && !_fold(r.customer).includes(q.cust)) return false;
      if (q.sv && !_fold(r.sv).includes(q.sv)) return false;
      if (q.nm && !_fold(r.nm + ' ' + r.cat).includes(q.nm)) return false;
      if (q.route && !_fold([r.pol, r.pod].join(' ')).includes(q.route)) return false;
      if (f.mode && r.mode !== f.mode) return false;
      if (f.dir && r.dir !== f.dir) return false;
      if (f.status === 'sent' && !_SENT_STATUSES.includes(r.status)) return false;
      if (f.status === 'won' && r.status !== '受注') return false;
      return true;
    });
    if (f.sort === 'mhigh') rows = rows.slice().sort((a, b) => (b.margin ?? -Infinity) - (a.margin ?? -Infinity));
    else if (f.sort === 'mlow') rows = rows.slice().sort((a, b) => (a.margin ?? Infinity) - (b.margin ?? Infinity));
    else rows = rows.slice().sort((a, b) => b.ts - a.ts);
    return rows;
  }

  function _renderLedger(forceRebuild) {
    const e = document.getElementById('statsPane-ledger');
    if (!e) return;
    const source = document.getElementById('statsSource')?.value || 'both';
    if (_ledgerCache === null || forceRebuild === true) _ledgerCache = _ledgerBuild(source);
    if (!_ledgerCache.length) {
      e.innerHTML = '<p class="stats-empty">単価入力のある明細がありません。<br>' +
        '<small>明細行に仕入単価・売単価を入れて案件を保存すると、ここに並びます。</small></p>';
      return;
    }
    const uniq = fn => [...new Set(_ledgerCache.map(fn).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
    const dl = (id, arr) => `<datalist id="${id}">${arr.slice(0, 400).map(v => `<option value="${_eav(v)}">`).join('')}</datalist>`;
    const ports = [...new Set(_ledgerCache.flatMap(r => [r.pol, r.pod]).flatMap(v => String(v || '').split(',')).map(v => v.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
    const modes = uniq(r => r.mode);
    const inp = (key, ph, list) => `<input class="ldg-in" type="text" value="${_eav(_ledgerF[key])}" placeholder="${ph}" list="${list}" oninput="statsLedgerSet('${key}',this.value)">`;
    const sel = (key, opts) => `<select class="ldg-in" onchange="statsLedgerSet('${key}',this.value)">` +
      opts.map(([v, l]) => `<option value="${_eav(v)}"${_ledgerF[key] === v ? ' selected' : ''}>${_esc(l)}</option>`).join('') + '</select>';
    e.innerHTML =
      '<p class="stats-syn-hint">明細1行ずつを、案件の条件（お客様・航路・モード・輸出入）と並べて振り返ります。条件を入れて絞り込むと、「どの仕入先から・いくらで買って・どのお客様に・いくらで売ったか」を確認できます。仕入・売の片方しか入っていない行は粗利率が「—」です。</p>' +
      '<div class="ldg-filter">' +
        inp('cust', 'お客様', 'ldgCust') + inp('route', '航路（港名）', 'ldgPort') + inp('nm', '作業・品名', 'ldgNm') + inp('sv', '仕入先（サブコン）', 'ldgSv') +
        sel('mode', [['', 'モード：すべて'], ...modes.map(m => [m, _MODE_LABEL[m] || m])]) +
        sel('dir', [['', '輸出入：すべて'], ['export', '輸出'], ['import', '輸入']]) +
        sel('status', [['all', '案件：すべて'], ['sent', '提示後のみ'], ['won', '受注のみ']]) +
        sel('sort', [['new', '新しい順'], ['mhigh', '粗利率が高い順'], ['mlow', '粗利率が低い順']]) +
        '<button class="stats-sort-btn" onclick="statsLedgerClear()">条件をクリア</button>' +
      '</div>' +
      dl('ldgCust', uniq(r => r.customer)) + dl('ldgSv', uniq(r => r.sv)) + dl('ldgNm', uniq(r => r.nm)) + dl('ldgPort', ports) +
      '<div id="ldgResult"></div>';
    _renderLedgerResult();
  }

  function _renderLedgerResult() {
    const box = document.getElementById('ldgResult');
    if (!box) return;
    const rows = _ledgerFiltered();
    if (!rows.length) { box.innerHTML = '<p class="stats-empty">条件に合う明細がありません。条件をゆるめてください。</p>'; return; }
    const caseCount = new Set(rows.map(r => r.caseId || r.caseName)).size;

    // 仕入先別のまとめ（同じ仕入先・単位・通貨ごと）。「いくらで買えたか」の相場感を見るための集計。
    const sm = new Map();
    rows.forEach(r => {
      if (!r.sv || r.pp == null) return;
      const k = r.sv + '\x00' + r.un + '\x00' + r.pc;
      if (!sm.has(k)) sm.set(k, { sv: r.sv, un: r.un, pc: r.pc, n: 0, min: Infinity, max: -Infinity, lastTs: -1, last: null, lastBp: null, lastBc: 'JPY', cost: 0, bill: 0 });
      const g = sm.get(k);
      g.n++; g.min = Math.min(g.min, r.pp); g.max = Math.max(g.max, r.pp);
      if (r.ts >= g.lastTs) { g.lastTs = r.ts; g.last = r.pp; g.lastBp = r.bp; g.lastBc = r.bc; }
      if (r.costJ != null) { g.cost += r.costJ; g.bill += r.billJ; }
    });
    const smList = [...sm.values()].sort((a, b) => b.n - a.n).slice(0, 8);
    let h = `<p class="stats-syn-hint"><b>${rows.length}</b> 明細（${caseCount} 案件）</p>`;
    if (smList.length) {
      h += '<table class="stats-table ldg-sum"><thead><tr><th>仕入先（同じ単位・通貨ごと）</th><th class="stats-num-col">件数</th><th>仕入単価（最安〜最高）</th><th>直近の仕入</th><th>直近の売</th><th class="stats-num-col">平均粗利率</th></tr></thead><tbody>' +
        smList.map(g => {
          const m = (window.SharedCalc && g.bill > 0) ? SharedCalc.grossMarginPct(g.bill, g.cost) : null;
          const u = g.un ? ' /' + _esc(g.un) : '';
          return `<tr><td class="stats-val">${_usageSpan('sv', g.sv)}</td><td class="stats-num-col">${g.n}</td>` +
                 `<td>${_fmtMoney(g.min, g.pc)}${g.max !== g.min ? ' 〜 ' + _fmtMoney(g.max, g.pc) : ''}${u}</td>` +
                 `<td>${_fmtMoney(g.last, g.pc)}${u}</td><td>${_fmtMoney(g.lastBp, g.lastBc)}${g.lastBp != null ? u : ''}</td>` +
                 `<td class="stats-num-col ${m == null ? '' : (m >= 0 ? 'sd-margin-pos' : 'sd-margin-neg')}">${m == null ? '—' : m.toFixed(1) + '%'}</td></tr>`;
        }).join('') + '</tbody></table>';
    }

    const lim = _limitOf('statsPane-ledger');
    const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('ja-JP', { year: '2-digit', month: '2-digit', day: '2-digit' }) : '—';
    h += '<div class="ldg-scroll"><table class="stats-table ldg-table"><thead><tr>' +
         '<th>日付</th><th>お客様</th><th>航路</th><th>作業・品名</th><th>仕入先</th><th class="stats-num-col">数量</th><th>仕入単価</th><th>売単価</th><th class="stats-num-col">粗利率</th><th>案件</th>' +
         '</tr></thead><tbody>' +
      rows.slice(0, lim).map(r => {
        const u = r.un ? ' /' + _esc(r.un) : '';
        const route = [r.pol, r.pod].filter(Boolean).join(' → ') || '—';
        const modeTag = r.mode ? `<small class="ldg-sub">${_esc(_MODE_LABEL[r.mode] || r.mode)}${r.dir ? '・' + (_DIR_LABEL[r.dir] || r.dir) : ''}</small>` : '';
        const mCls = r.margin == null ? '' : (r.margin >= 0 ? 'sd-margin-pos' : 'sd-margin-neg');
        const link = r.caseId
          ? `<a href="#" class="ldg-link" onclick="cloudPreviewPreset('${_ea(String(r.caseId))}');return false" title="案件の中身をプレビュー">${_esc(r.caseName)}</a>`
          : `<span class="ldg-sub">${_esc(r.caseName)}（ローカル）</span>`;
        return `<tr><td>${fmtDate(r.ts)}</td>` +
               `<td class="stats-val">${_usageSpan('customer', r.customer) || '—'}</td>` +
               `<td>${_esc(route)}${modeTag ? '<br>' + modeTag : ''}</td>` +
               `<td class="stats-val">${r.cat ? `<small class="ldg-sub">${_esc(r.cat)}</small><br>` : ''}${_usageSpan('nm', r.nm) || '—'}</td>` +
               `<td class="stats-val">${_usageSpan('sv', r.sv) || '—'}</td>` +
               `<td class="stats-num-col">${r.bq != null ? r.bq : '—'}${u}</td>` +
               `<td>${_fmtMoney(r.pp, r.pc)}${r.pp != null ? u : ''}</td>` +
               `<td>${_fmtMoney(r.bp, r.bc)}${r.bp != null ? u : ''}</td>` +
               `<td class="stats-num-col ${mCls}">${r.margin == null ? '—' : r.margin.toFixed(1) + '%'}</td>` +
               `<td>${link}<br><small class="ldg-sub">${_esc(r.status || '')}${r.creator ? '・' + _esc(r.creator) : ''}</small></td></tr>`;
      }).join('') + '</tbody></table></div>' + _moreHtml('statsPane-ledger', rows.length);
    box.innerHTML = h;
  }

  function _renderUn() {
    const e = document.getElementById('statsPane-un');
    if (!e || !_data) return;
    const rawGroups = _data.unGroups || [];
    if (!rawGroups.length) { e.innerHTML = '<p class="stats-empty">データなし</p>'; return; }

    const uaGroups    = typeof window.uaGetGroups === 'function' ? window.uaGetGroups() : [];
    const canonicalSet = new Set(uaGroups.map(g => g.canonical));
    const aliasToCanon = {};
    const canonToAliases = {};
    uaGroups.forEach(g => {
      canonToAliases[g.canonical] = g.aliases || [];
      (g.aliases || []).forEach(a => { aliasToCanon[a] = g.canonical; });
    });

    // 各単位（表記ごと）の件数マップ
    const countMap = {};
    rawGroups.forEach(g => g.variants.forEach(v => { countMap[v.value] = (countMap[v.value] || 0) + v.count; }));

    // 表示リスト構築
    const displayList = [];
    uaGroups.forEach(g => {
      const ownCount   = countMap[g.canonical] || 0;
      const aliasCount = (g.aliases || []).reduce((s, a) => s + (countMap[a] || 0), 0);
      displayList.push({ type: 'canonical', canonical: g.canonical, ownCount, aliasCount, total: ownCount + aliasCount, aliases: g.aliases || [] });
    });
    // 代表・統合済みでない表記だけを未整理として並べる。正規化キーが同じ表記（ゆらぎ）は
    // 隣り合う行にまとめ、先頭行に「ゆらぎ N種」バッジを付ける。
    const ungroupedGroups = [];
    rawGroups.forEach(g => {
      const rest = g.variants.filter(v => !canonicalSet.has(v.value) && !aliasToCanon[v.value]);
      if (rest.length) ungroupedGroups.push({ variants: rest, total: rest.reduce((s, v) => s + v.count, 0), fluct: g.variants.length > 1 });
    });
    ungroupedGroups.sort((a, b) => _statsSort === 'name'
      ? _cmpName(a.variants[0].value, b.variants[0].value)
      : b.total - a.total);
    const _unName = it => it.type === 'canonical' ? it.canonical : it.value;
    displayList.sort((a, b) => _statsSort === 'name' ? _cmpName(_unName(a), _unName(b)) : b.total - a.total);
    ungroupedGroups.forEach(g => g.variants.forEach((v, i) => {
      displayList.push({ type: 'ungrouped', value: v.value, total: v.count, fluct: g.fluct, fluctN: g.variants.length, first: i === 0 });
    }));

    // 「未整理のみ」フィルタ：代表（⭐）に統合済みの単位グループを隠し、
    // まだ代表未設定の単位（ungrouped）だけ表示する。「ゆらぎありのみ」は複数表記のある未整理単位だけ。
    let visList = displayList;
    if (_statsUnorganizedOnly) visList = visList.filter(it => it.type !== 'canonical');
    if (_statsFluctOnly)       visList = visList.filter(it => it.type === 'ungrouped' && it.fluct);

    if (!visList.length) {
      e.innerHTML = _sortToolbar() + (_statsFluctOnly
        ? '<p class="stats-empty">ゆらぎのある単位はありません。</p>'
        : '<p class="stats-empty">🎉 未整理の単位はありません。すべて代表に統合済みです。</p>');
      return;
    }

    const shownList = visList.slice(0, _limitOf('statsPane-un'));
    let h = _sortToolbar() +
      '<div class="ua-pane-hint">⭐ 代表に設定 → グループの基準単位として登録　　→ 統合 → 代表に紐付け（件数が合算されます）</div>' +
      '<table class="stats-table stats-un-table"><thead><tr>' +
      '<th>単位</th><th class="stats-num-col">件数</th><th>同義グループ</th><th>操作</th>' +
      '</tr></thead><tbody>';

    shownList.forEach(item => {
      if (item.type === 'canonical') {
        const chips = item.aliases.map(a =>
          `<span class="ua-alias-chip">${_usageSpan('un', a)}<span class="ua-chip-cnt"> ×${countMap[a] || 0}</span>` +
          `<button class="ua-chip-del" onclick="uaRemoveAlias('${_ea(a)}','${_ea(item.canonical)}')" title="統合解除">✕</button></span>`
        ).join('');
        h += `<tr class="ua-canonical-row">` +
             `<td class="stats-val"><span class="ua-star">⭐</span>${_usageSpan('un', item.canonical)} ${_masterJumpBtn('un', item.canonical)}</td>` +
             `<td class="stats-num-col">${item.total}` +
             (item.aliasCount ? `<span class="ua-cnt-detail"> (${item.ownCount}+${item.aliasCount})</span>` : '') +
             `</td><td>${chips || '<span class="ua-no-alias">—</span>'}</td>` +
             `<td><button class="stats-syn-merge-canon" onclick="statsSynMergePicker('un','${_ea(item.canonical)}',this)" title="この代表を別の代表に統合">⤵ 統合</button>` +
             `<button class="ua-remove-canon" onclick="uaRemoveGroup('${_ea(item.canonical)}')" title="グループを解除">解除</button></td>` +
             `</tr>`;
      } else {
        const badge = (item.fluct && item.first)
          ? ` <span class="stats-variant-badge" title="読みが同じ表記が複数あります（${item.fluctN}種）。代表を決めて統合すると件数が合算されます">ゆらぎ ${item.fluctN}種</span>`
          : '';
        h += `<tr class="ua-ungrouped-row${item.fluct ? ' stats-has-variant' : ''}">` +
             `<td class="stats-val">${_usageSpan('un', item.value)}${badge}</td>` +
             `<td class="stats-num-col">${item.total}</td>` +
             `<td></td>` +
             `<td class="ua-ops">` +
             `<button class="ua-set-canon" onclick="uaSetCanonical('${_ea(item.value)}')" title="この単位を代表として登録">⭐ 代表に</button>` +
             `<button class="ua-merge-btn" onclick="uaShowMergePicker('${_ea(item.value)}',this)" title="既存代表に統合">→ 統合</button>` +
             `</td></tr>`;
      }
    });

    e.innerHTML = h + '</tbody></table>' + _moreHtml('statsPane-un', visList.length);
  }
  window.statsRefreshUnPane = _renderUn;

  // ===== チャージ詳細タブ =====

  async function _renderCharges() {
    const e = document.getElementById('statsPane-charges');
    if (!e) return;
    e.innerHTML = '<p class="stats-empty">💰 チャージ詳細を読み込み中…</p>';

    // _c() は stats.js 内の cloudGetClient フォールバック済みクライアントを使う
    // （subcon-insert の _user() に依存せず、ログイン状態を問わず取得可能）
    let subcons = [];
    const db = _c();
    if (db && typeof window.buildSubconData === 'function') {
      const { data } = await db.from('quote_presets')
        .select('id,name,customer,person,status,transport_mode,pol,pod,data,updated_at');
      subcons = window.buildSubconData(data || []);
    } else if (typeof window.getSubconData === 'function') {
      subcons = window.getSubconData();
    }
    // getSubconData が空 (モーダル未開封) の場合、ローカルプリセットから直接集計
    if (!subcons.length && typeof window.buildSubconData === 'function') {
      const localPresets = _getLocalPresets();
      if (localPresets.length) subcons = window.buildSubconData(localPresets);
    }

    if (!subcons.length) {
      e.innerHTML = '<p class="stats-empty">案件が保存されると自動で集計されます。<br><small>明細の「サブコン」欄に会社名を入れて案件を保存してください。</small></p>';
      return;
    }

    const _m = (n, cur) => {
      if (n == null) return '—';
      const c = (cur || 'JPY').trim() || 'JPY';
      return c === 'JPY' ? '¥' + Math.round(n).toLocaleString('ja-JP') : c + ' ' + n.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
    };
    const ROLE = { 'domestic':'国内作業','export-local':'輸出ローカル','ocean':'海上','air':'航空','surcharge':'サーチャージ','import-local':'輸入ローカル','overseas':'海外作業','customs-export':'通関(輸出)','customs-import':'通関(輸入)','insurance':'保険','other':'その他' };
    const CAT_CLASS = { 'domestic':'cat-domestic','export-local':'cat-export-local','ocean':'cat-ocean','air':'cat-air','surcharge':'cat-surcharge','import-local':'cat-import-local','overseas':'cat-overseas','customs-export':'cat-customs-export','customs-import':'cat-customs-import','insurance':'cat-insurance','other':'cat-other' };

    let h = '';
    subcons.forEach(sc => {
      // サーチャージを先頭に、以降は直近使用順
      const sortedItems = [...sc.items].sort((a, b) => {
        if (a.cat === 'surcharge' && b.cat !== 'surcharge') return -1;
        if (a.cat !== 'surcharge' && b.cat === 'surcharge') return 1;
        return b.lastUsed - a.lastUsed;
      });
      const rows = sortedItems.map(it => {
        const ppStr = it.pp != null ? _m(it.pp, it.pc) : '—';
        const bpNum = it.bp ? parseFloat(it.bp) : null;
        const bpStr = bpNum != null && isFinite(bpNum) ? _m(bpNum, it.bc || it.pc) : null;
        const avgStr = it.avgPp != null ? _m(it.avgPp, it.pc) : null;
        const priceCell = bpStr ? ppStr + ' → ' + bpStr : ppStr;
        const unit = it.un ? ' /' + _esc(it.un) : '';

        // 推移ミニタイムライン（前回と価格が変わったポイントのみ残す）
        let histHtml = '';
        if (it.history && it.history.length > 1) {
          const deduped = it.history.filter((h, i, arr) =>
            i === 0 || h.pp !== arr[i - 1].pp || h.bp !== arr[i - 1].bp || h.route !== arr[i - 1].route
          ).slice(-8);
          if (deduped.length > 1) {
            const pts = deduped.map(h => {
              const d = h.ts ? new Date(h.ts).toLocaleDateString('ja-JP', { year: '2-digit', month: '2-digit' }) : '?';
              const p = h.pp != null ? _m(h.pp, it.pc) : '—';
              const routeHtml = h.route ? `<span class="stats-hist-route">${_esc(h.route)}</span>` : '';
              return `<span class="stats-hist-pt"><span class="stats-hist-date">${_esc(d)}</span><b>${_esc(p)}</b>${routeHtml}</span>`;
            }).join('<span class="stats-hist-arr">›</span>');
            histHtml = `<details class="stats-hist-details"><summary>📈 推移 (${deduped.length})</summary><div class="stats-hist-trail">${pts}</div></details>`;
          }
        }
        const avgHtml = avgStr ? `<div class="stats-hist-avg">平均 ${_esc(avgStr)}</div>` : '';

        const ptHtml = it.pt ? `<span class="stats-pt-badge">${_esc(it.pt)}</span>` : '<span class="stats-empty-cell">—</span>';

        return `<tr>` +
               `<td><span class="rp-cat ${CAT_CLASS[it.cat]||'cat-other'}">${_esc(ROLE[it.cat]||it.cat||'—')}</span></td>` +
               `<td class="stats-val">${_esc(it.name)}</td>` +
               `<td>${ptHtml}</td>` +
               `<td class="stats-sv-price">${_esc(priceCell)}${_esc(unit)}${avgHtml}${histHtml}</td>` +
               `</tr>`;
      }).join('');
      const hasSurcharge = sc.items.some(it => it.cat === 'surcharge');
      h += `<details class="stats-sv-detail${hasSurcharge ? ' stats-sv-detail--surge' : ''}" ${hasSurcharge ? 'open' : ''}>` +
           `<summary><b>${_esc(sc.name)}</b>` +
           (hasSurcharge ? '<span class="stats-sv-surge-badge">⚡ サーチャージあり</span>' : '') +
           `<span class="stats-sv-detail-meta">使用 ${sc.uses}案件 · ${sc.items.length}項目</span></summary>` +
           `<table class="stats-table stats-sv-charge-table"><thead><tr>` +
           `<th>カテゴリ</th><th>品名</th><th>パターン</th><th>単価（仕入 → 売上）</th>` +
           `</tr></thead><tbody>${rows}</tbody></table>` +
           `</details>`;
    });
    e.innerHTML = '<div class="stats-sv-charges-wrap">' + h + '</div>';
  }

  // ===== お客様タブ =====
  const _stCls = st => ({ '下書き中':'draft','提出済み':'sent','提示済み':'sent','ヨコヨコ提示':'yoko','受注':'won','失注':'lost','辞退':'declined','保留':'hold' }[st] || 'draft');

  // ===== 📈 ダッシュボード（案件分析） =====

  // 案件（プリセット）1件を分析用に正規化。ローカル／クラウド両対応。
  function _num(v) { const n = parseFloat(String(v == null ? '' : v).replace(/[, ]/g, '')); return isFinite(n) ? n : null; }
  function _jpy(n)  { return '¥' + Math.round(n).toLocaleString('ja-JP'); }
  function _toJ(amount, cur) {
    const c = (cur || 'JPY').trim() || 'JPY';
    if (c === 'JPY') return amount;
    if (typeof toJPY !== 'function') return null;
    const v = toJPY(amount, c);
    return isFinite(v) ? v : null;
  }

  // 行配列（data.rows）から案件全体の仕入合計・売上合計（JPY換算）を算出。換算不能行は除外。
  function _caseFinancials(rows) {
    if (!Array.isArray(rows)) return null;
    let cost = 0, bill = 0, ok = false;
    rows.forEach(r => {
      if (!r || r._type !== 'data') return;
      const c  = Array.isArray(r.cells) ? r.cells : [];
      const pp = _num(c[10]), bp = _num(c[11]);
      const pq = _num(c[5]) > 0 ? _num(c[5]) : 1;
      const bq = _num(c[7]) > 0 ? _num(c[7]) : 1;
      const pc = c[8] || 'JPY', bc = c[9] || 'JPY';
      if (pp != null) { const cc = _toJ(minAmt(pp * pq, c[CI.ppmin]), pc); if (cc != null) { cost += cc; ok = true; } }
      if (bp != null) { const bb = _toJ(minAmt(bp * bq, c[CI.bpmin]), bc); if (bb != null) { bill += bb; ok = true; } }
    });
    return ok ? { cost, bill } : null;
  }

  // ローカル fields からの航路フォールバック（z2-routes-data）
  function _routeFromFields(f, key /* 'pol'|'pod'|'carrier' */) {
    const single = (f['z2Pol'] && key === 'pol') ? f['z2Pol']
                 : (f['z2Pod'] && key === 'pod') ? f['z2Pod']
                 : (f['z2Carrier'] && key === 'carrier') ? f['z2Carrier'] : '';
    if (single) return single.trim();
    try {
      const rts = JSON.parse(f['z2-routes-data'] || '[]');
      if (Array.isArray(rts) && rts.length) {
        return rts.map(r => r[key]).filter(Boolean).join(', ');
      }
    } catch (e) {}
    return '';
  }

  // 分析用の案件リストを構築（source: 'both'|'local'|'cloud'）
  function _caseList(source) {
    const cases = [];
    if (source !== 'cloud') {
      _getLocalPresets().forEach(p => {
        const f = (p.data || {}).fields || {};
        cases.push({
          name: p.name || '（名称なし）', src: 'local',
          status:   (f['qf-status']   || '').trim(),
          customer: (f['qf-customer'] || '').trim(),
          mode:     (f['cond-mode']   || '').trim(),
          pol:      _routeFromFields(f, 'pol'),
          pod:      _routeFromFields(f, 'pod'),
          carrier:  _routeFromFields(f, 'carrier'),
          ts:       p.ts || null,
          fin:      _caseFinancials((p.data || {}).rows),
        });
      });
    }
    if (source !== 'local') {
      const cloud = typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : [];
      cloud.forEach(p => {
        cases.push({
          name: p.name || '（名称なし）', src: 'cloud',
          status:   (p.status         || '').trim(),
          customer: (p.customer       || '').trim(),
          mode:     (p.transport_mode || '').trim(),
          pol:      (p.pol            || '').trim(),
          pod:      (p.pod            || '').trim(),
          carrier:  (p.carrier        || '').trim(),
          ts:       p.updated_at || null,
          fin:      _caseFinancials((p.data || {}).rows),
        });
      });
    }
    return cases;
  }

  const _MODE_LABEL = { 'sea-fcl':'海上 FCL', 'sea-lcl':'海上 LCL', 'fcl':'FCL', 'lcl':'LCL', 'air':'航空', 'sea':'海上', 'rail':'鉄道', 'truck':'トラック' };
  const _STATUS_ORDER = ['下書き中', '提出済み', '提示済み', 'ヨコヨコ提示', '受注', '失注', '辞退', '保留'];

  // 横棒ランキング HTML（[{label,count}] と最大値から生成）
  function _barRows(items, max, opt) {
    opt = opt || {};
    if (!items.length) return '<p class="stats-empty">データなし</p>';
    return '<div class="sd-bars">' + items.map(it => {
      const pct = max > 0 ? Math.max(2, Math.round(it.count / max * 100)) : 0;
      const cls = it.cls ? ' ' + it.cls : '';
      return `<div class="sd-bar-row">` +
             `<span class="sd-bar-label" title="${_esc(it.label)}">${_esc(it.label)}</span>` +
             `<span class="sd-bar-track"><span class="sd-bar-fill${cls}" style="width:${pct}%"></span></span>` +
             `<span class="sd-bar-val">${_esc(it.valText != null ? it.valText : String(it.count))}</span>` +
             `</div>`;
    }).join('') + '</div>';
  }

  function _kpi(value, label, cls) {
    return `<div class="sd-kpi${cls ? ' ' + cls : ''}"><div class="sd-kpi-val">${_esc(value)}</div><div class="sd-kpi-label">${_esc(label)}</div></div>`;
  }

  function _renderDashboard() {
    const e = document.getElementById('statsPane-dashboard');
    if (!e) return;
    const source = document.getElementById('statsSource')?.value || 'both';
    const cases  = _caseList(source);
    if (!cases.length) {
      e.innerHTML = '<p class="stats-empty">案件がありません。<br><small>見積を保存すると、ここに受注率・粗利・航路傾向が集計されます。</small></p>';
      return;
    }

    // --- A. 受注ステータス ---
    const stCount = {};
    cases.forEach(c => { const s = c.status || '（未設定）'; stCount[s] = (stCount[s] || 0) + 1; });
    const won  = stCount['受注'] || 0;
    const lost = stCount['失注'] || 0;
    const decided  = won + lost;
    const winRate  = decided > 0 ? Math.round(won / decided * 100) : null;
    const stItems = Object.keys(stCount)
      .sort((a, b) => {
        const ia = _STATUS_ORDER.indexOf(a), ib = _STATUS_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      })
      .map(s => ({ label: s, count: stCount[s], cls: 'sd-bar--st-' + _stCls(s) }));
    const stMax = Math.max(...stItems.map(i => i.count));
    const sectionA =
      '<section class="sd-section"><h3 class="sd-h">📊 受注ステータス</h3>' +
      '<div class="sd-kpis">' +
        _kpi(cases.length, '総案件') +
        _kpi(won,  '受注', 'sd-kpi--won') +
        _kpi(lost, '失注', 'sd-kpi--lost') +
        _kpi(winRate == null ? '—' : winRate + '%', '受注率（決着ベース）', 'sd-kpi--rate') +
      '</div>' + _barRows(stItems, stMax) + '</section>';

    // --- B. 金額・粗利 ---
    const finCases = cases.filter(c => c.fin);
    let totBill = 0, totCost = 0;
    finCases.forEach(c => { totBill += c.fin.bill; totCost += c.fin.cost; });
    const totMargin = (window.SharedCalc && totBill > 0) ? SharedCalc.grossMarginPct(totBill, totCost) : null;
    // お客様別集計
    const custMap = new Map();
    finCases.forEach(c => {
      const k = c.customer || '（未入力）';
      if (!custMap.has(k)) custMap.set(k, { customer: k, count: 0, bill: 0, cost: 0 });
      const g = custMap.get(k); g.count++; g.bill += c.fin.bill; g.cost += c.fin.cost;
    });
    const custRows = [...custMap.values()].sort((a, b) => b.bill - a.bill).slice(0, 15);
    let custTable;
    if (!finCases.length) {
      custTable = '<p class="stats-empty">単価が入力された案件がありません。<br><small>明細に仕入・売単価を入れて保存すると粗利が集計されます。</small></p>';
    } else {
      custTable = '<table class="stats-table sd-money-table"><thead><tr>' +
        '<th>お客様</th><th class="stats-num-col">件数</th><th class="stats-num-col">売上合計</th><th class="stats-num-col">粗利率</th>' +
        '</tr></thead><tbody>' +
        custRows.map(g => {
          const m = (window.SharedCalc && g.bill > 0) ? SharedCalc.grossMarginPct(g.bill, g.cost) : null;
          const mCls = m == null ? '' : (m >= 0 ? 'sd-margin-pos' : 'sd-margin-neg');
          return `<tr><td class="stats-val">${_esc(g.customer)}</td>` +
                 `<td class="stats-num-col">${g.count}</td>` +
                 `<td class="stats-num-col">${_jpy(g.bill)}</td>` +
                 `<td class="stats-num-col ${mCls}">${m == null ? '—' : m.toFixed(1) + '%'}</td></tr>`;
        }).join('') + '</tbody></table>';
    }
    const mTotCls = totMargin == null ? '' : (totMargin >= 0 ? 'sd-kpi--won' : 'sd-kpi--lost');
    const sectionB =
      '<section class="sd-section"><h3 class="sd-h">💴 金額・粗利 <small class="sd-note">JPY換算・単価入力ありの案件のみ</small></h3>' +
      '<div class="sd-kpis">' +
        _kpi(_jpy(totBill), '総売上') +
        _kpi(_jpy(totCost), '総仕入') +
        _kpi(totMargin == null ? '—' : totMargin.toFixed(1) + '%', '平均粗利率', mTotCls) +
      '</div>' + custTable + '</section>';

    // --- C. 月次推移 ---
    const monMap = new Map();
    cases.forEach(c => {
      if (!c.ts) return;
      const m = String(c.ts).slice(0, 7);   // YYYY-MM
      if (!/^\d{4}-\d{2}$/.test(m)) return;
      if (!monMap.has(m)) monMap.set(m, { month: m, total: 0, won: 0 });
      const g = monMap.get(m); g.total++; if (c.status === '受注') g.won++;
    });
    const months = [...monMap.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
    const monMax = months.length ? Math.max(...months.map(m => m.total)) : 0;
    let monHtml;
    if (!months.length) {
      monHtml = '<p class="stats-empty">日付情報のある案件がありません。</p>';
    } else {
      monHtml = '<div class="sd-bars sd-bars--month">' + months.map(m => {
        const pct = monMax > 0 ? Math.max(2, Math.round(m.total / monMax * 100)) : 0;
        const wpct = m.total > 0 ? Math.round(m.won / m.total * 100) : 0;
        const label = m.month.slice(2).replace('-', '/');   // YY/MM
        return `<div class="sd-bar-row">` +
               `<span class="sd-bar-label">${_esc(label)}</span>` +
               `<span class="sd-bar-track"><span class="sd-bar-fill sd-bar--month" style="width:${pct}%">` +
               `<span class="sd-bar-won" style="width:${wpct}%"></span></span></span>` +
               `<span class="sd-bar-val">${m.total}件${m.won ? ' / 受注' + m.won : ''}</span>` +
               `</div>`;
      }).join('') + '</div>';
    }
    const sectionC =
      '<section class="sd-section"><h3 class="sd-h">📅 月次推移 <small class="sd-note">直近12ヶ月・濃色＝受注</small></h3>' + monHtml + '</section>';

    // --- D. 貨物・航路傾向 ---
    const freq = (arr) => {
      const m = new Map();
      arr.filter(Boolean).forEach(v => m.set(v, (m.get(v) || 0) + 1));
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
    };
    const modeItems = freq(cases.map(c => c.mode))
      .map(i => ({ label: _MODE_LABEL[i.value] || i.value, count: i.count }));
    const routeItems = freq(cases.map(c => (c.pol || c.pod) ? `${c.pol || '?'} → ${c.pod || '?'}` : ''))
      .slice(0, 8).map(i => ({ label: i.value, count: i.count }));
    const carrierItems = freq(cases.map(c => c.carrier)).slice(0, 8)
      .map(i => ({ label: i.value, count: i.count }));
    const sectionD =
      '<section class="sd-section"><h3 class="sd-h">🚢 貨物・航路傾向</h3>' +
      '<div class="sd-trend-grid">' +
        `<div class="sd-trend-col"><h4 class="sd-h4">輸送モード</h4>${_barRows(modeItems, Math.max(...modeItems.map(i => i.count), 0))}</div>` +
        `<div class="sd-trend-col"><h4 class="sd-h4">航路 (POL→POD) 上位8</h4>${_barRows(routeItems, Math.max(...routeItems.map(i => i.count), 0))}</div>` +
        `<div class="sd-trend-col"><h4 class="sd-h4">キャリア 上位8</h4>${_barRows(carrierItems, Math.max(...carrierItems.map(i => i.count), 0))}</div>` +
      '</div></section>';

    e.innerHTML = '<div class="sd-wrap">' + sectionA + sectionB + sectionC + sectionD + '</div>';
  }
  window.statsRefreshDashboard = _renderDashboard;

  function _renderCustomer() {
    const e = document.getElementById('statsPane-customer');
    if (!e) return;
    const source = document.getElementById('statsSource')?.value || 'both';
    const metas = [];
    if (source !== 'cloud') {
      _getLocalPresets().forEach(p => {
        const f = (p.data || {}).fields || {};
        metas.push({
          customer: (f['qf-customer'] || '').trim(),
          person:   (f['qf-person']   || '').trim(),
          status:   (f['qf-status']   || '').trim(),
        });
      });
    }
    if (source !== 'local') {
      const cloud = typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : [];
      cloud.forEach(p => {
        metas.push({
          customer: (p.customer || '').trim(),
          person:   (p.person   || '').trim(),
          status:   (p.status   || '').trim(),
        });
      });
    }
    if (!metas.length) { e.innerHTML = '<p class="stats-empty">データなし</p>'; return; }

    const map = new Map();
    metas.forEach(m => {
      const key = m.customer || '';
      if (!map.has(key)) map.set(key, { customer: key, count: 0, persons: new Set(), statuses: [] });
      const g = map.get(key);
      g.count++;
      if (m.person) g.persons.add(m.person);
      if (m.status) g.statuses.push(m.status);
    });
    const groups = [...map.values()].sort((a, b) => b.count - a.count);

    // ゆらぎグループ化（表記ゆれを検出）
    const custExcl = new Set(
      (typeof window.arGetExclusions === 'function' ? window.arGetExclusions() : [])
        .filter(e => e.field === 'customer').map(e => e.value)
    );
    const custNames = groups.map(g => g.customer).filter(Boolean);
    const custGroups = _groupSimilar(custNames, custExcl, 'customer');
    // 正規化キー → グループ先頭名のマップ（ゆらぎバッジ用）
    const normToCanon = new Map();
    custGroups.forEach(cg => {
      if (cg.variants.length > 1) cg.variants.forEach(v => normToCanon.set(_normalize(v.value, 'customer'), cg));
    });

    // 同義グループ状態（手動・⭐代表／統合）
    const synGroups  = typeof window.synGetGroups === 'function' ? window.synGetGroups('customer') : [];
    const synCanons  = new Set(synGroups.map(g => g.canonical));
    const synAliasOf = {};
    synGroups.forEach(g => (g.aliases || []).forEach(a => { synAliasOf[a] = g.canonical; }));
    const synCntMap = {};
    groups.forEach(g => { if (g.customer) synCntMap[g.customer] = g.count; });

    // 同義グループに取り込まれた顧客名・顧客名→集計のルックアップ
    const custByName = new Map();
    groups.forEach(g => { if (g.customer) custByName.set(g.customer, g); });
    const consumed = new Set();
    synGroups.forEach(g => { consumed.add(g.canonical); (g.aliases || []).forEach(a => consumed.add(a)); });
    const _stHtml = (statuses) => {
      const stMap = {};
      statuses.forEach(s => { stMap[s] = (stMap[s] || 0) + 1; });
      return Object.entries(stMap).length
        ? Object.entries(stMap).sort((a, b) => b[1] - a[1])
            .map(([s, n]) => `<span class="stats-st-chip stats-st--${_stCls(s)}">${_esc(s)} ${n}</span>`).join('')
        : '—';
    };

    const _renderedCustGroups = {};
    let gIdx = 0;
    let h = _sortToolbar() +
            '<p class="stats-syn-hint">☆代表 で同義グループの基準を決め、他の表記を ⤵統合 でまとめると、⭐行に集約され件数・担当者・ステータスが合算されます（非破壊）。</p>' +
            '<table class="stats-table"><thead><tr>' +
            '<th>お客様名</th><th class="stats-num-col">件数</th><th>担当者</th><th>ステータス</th><th>操作</th>' +
            '</tr></thead><tbody>';

    // --- 同義グループ（統合表示・合計件数降順）---
    const synRows = synGroups.map(g => {
      const members = [g.canonical, ...(g.aliases || [])];
      let count = 0; const persons = new Set(); const statuses = []; const memberCounts = {};
      members.forEach(m => {
        const mg = custByName.get(m);
        memberCounts[m] = mg ? mg.count : 0;
        if (mg) { count += mg.count; mg.persons.forEach(p => persons.add(p)); statuses.push(...mg.statuses); }
      });
      return { g, members, count, persons, statuses, memberCounts };
    });
    synRows.sort((a, b) => _statsSort === 'name' ? _cmpName(a.g.canonical, b.g.canonical) : b.count - a.count);

    let shownRows = 0;   // 条件に合う全行数（描画は先頭 lim 行のみ）
    const lim = _limitOf('statsPane-customer');
    const visSynRows = (_statsUnorganizedOnly || _statsFluctOnly) ? [] : synRows;
    visSynRows.forEach(sr => {
      shownRows++;
      if (shownRows > lim) return;
      const memberChips = sr.members.map((m, i) =>
        `<span class="stats-chip${i === 0 ? ' stats-chip--canon' : ''}">` +
        `<span class="stats-chip-text">${i === 0 ? '⭐ ' : ''}${_usageSpan('customer', m)}</span>` +
        `<span class="stats-chip-cnt">×${sr.memberCounts[m] || 0}</span>` +
        (i === 0 ? _voteBtn('customer', m, synCanons)
                 : `<button class="stats-syn-unmerge" onclick="statsSynUnmerge('customer','${_ea(m)}')" title="統合を解除">✕</button>`) +
        `</span>`
      ).join('');
      h += `<tr class="stats-syn-row">` +
           `<td class="stats-val"><span class="ua-star">⭐</span>${_usageSpan('customer', sr.g.canonical)} <span class="stats-syn-grp-badge" title="同義グループ（${sr.members.length}種を集約）">同義 ${sr.members.length}種</span></td>` +
           `<td class="stats-num-col">${sr.count}</td>` +
           `<td>${[...sr.persons].join('、') || '—'}</td>` +
           `<td>${_stHtml(sr.statuses)}</td>` +
           `<td class="stats-chips-cell">${memberChips}` +
             `<button class="stats-syn-merge-canon" onclick="statsSynMergePicker('customer','${_ea(sr.g.canonical)}',this)" title="この代表を別の代表に統合">⤵ 統合</button>` +
             `<button class="stats-syn-dissolve" onclick="statsToggleSynCanonical('customer','${_ea(sr.g.canonical)}')" title="同義グループを解除">グループ解除</button></td>` +
           `</tr>`;
    });

    // --- 残りのお客様（自動ゆらぎ検出は従来表示）---
    // ゆらぎありのみ：同じゆらぎクラスタの表記が隣り合うよう正規化キー順に並べる
    const restCust = _statsFluctOnly
      ? [...groups].sort((a, b) => _cmpName(_normalize(a.customer, 'customer'), _normalize(b.customer, 'customer')) || b.count - a.count)
      : (_statsSort === 'name'
          ? [...groups].sort((a, b) => _cmpName(a.customer, b.customer))
          : groups);
    restCust.forEach(g => {
      if (g.customer && consumed.has(g.customer)) return;   // 同義グループに集約済み
      const cg0 = g.customer ? normToCanon.get(_normalize(g.customer, 'customer')) : null;
      const inFluctCluster = !!(cg0 && cg0.variants.length > 1);
      if (_statsFluctOnly && !inFluctCluster) return;
      if (_statsUnorganizedOnly && g.customer && !inFluctCluster && _masterRegistered('customer', g.customer, null, synCanons)) return;
      shownRows++;
      if (shownRows > lim) return;
      const persons = [...g.persons].join('、') || '—';
      const stHtml = _stHtml(g.statuses);

      // ゆらぎバッジ（同じ正規化キーに複数表記がある場合）
      const cg = cg0;
      let variantBadge = '';
      if (cg && cg.variants.length > 1 && cg.variants[0].value === g.customer) {
        const gId = 'statsPane-customer-' + gIdx;
        _renderedCustGroups[gId] = { aliasField: 'customer', variants: cg.variants };
        _renderedGroups[gId] = { aliasField: 'customer', variants: cg.variants };
        variantBadge = cg.isAbbrevGroup
          ? ` <span class="stats-variant-badge stats-variant-badge--abbrev" title="略称辞書で関連付けられた表記">略称 ${cg.variants.length}種</span>`
          : ` <button class="stats-variant-badge stats-variant-badge--link" onclick="statsJumpToAlias('${gId}')" title="エイリアス是正タブで一括登録">ゆらぎ ${cg.variants.length}種</button>`;
        gIdx++;
      }

      const nameCell = g.customer
        ? `${_usageSpan('customer', g.customer)}${variantBadge}`
        : '<span class="stats-empty-cell">（未入力）</span>';
      const opCell = g.customer
        ? _voteBtn('customer', g.customer, synCanons) + _synBtns('customer', g.customer, synCanons, synAliasOf, synCntMap)
        : '';
      h += `<tr>` +
           `<td class="stats-val">${nameCell}</td>` +
           `<td class="stats-num-col">${g.count}</td>` +
           `<td>${_esc(persons)}</td>` +
           `<td>${stHtml}</td>` +
           `<td class="stats-chips-cell">${opCell}</td>` +
           `</tr>`;
    });
    e.innerHTML = shownRows
      ? h + '</tbody></table>' + _moreHtml('statsPane-customer', shownRows)
      : _sortToolbar() + (_statsFluctOnly
          ? '<p class="stats-empty">ゆらぎのある項目はありません。</p>'
          : '<p class="stats-empty">🎉 未整理の項目はありません。すべて同義グループ化・マスター登録済みです。</p>');
  }

  // マスター一覧の種別絞り込み（'all' | sv/carrier/nm/customer/port/un）。再描画をまたいで保持。
  let _masterFieldFilter = 'all';
  window.statsMasterSetFilter = function (f) {
    _masterFieldFilter = f || 'all';
    _renderMaster();
  };

  let _regOpen = false;   // 「代表を新規登録」の開閉（Industry。再描画しても保つ）
  window.statsMasterToggleRegister = function () {
    _regOpen = !_regOpen;
    document.querySelector('#statsPane-master .master-register')?.classList.toggle('is-open', _regOpen);
    if (_regOpen) document.getElementById('masterNewValue')?.focus();
  };
  // 操作の「⋯」メニュー（解除など、取り消しにくい操作をここに置く）。本体は body へ出す（表の overflow に切られないように）
  function _closeOpsMenu() { document.querySelectorAll('.master-ops-menu').forEach(m => m.remove()); }
  window.statsOpsMenu = function (btn, kind, field, value) {
    const open = document.querySelector('.master-ops-menu');
    _closeOpsMenu();
    if (open && open._owner === btn) return;
    const m = document.createElement('div');
    m.className = 'master-ops-menu'; m.setAttribute('role', 'menu'); m._owner = btn;
    const it = document.createElement('button');
    it.type = 'button'; it.className = 'btn-remove'; it.setAttribute('role', 'menuitem');
    it.textContent = kind === 'group' ? 'グループを解除…' : 'マスターから解除…';
    it.addEventListener('click', () => {
      _closeOpsMenu();
      if (kind === 'group') window.statsConfirmRemoveGroup(field, value); else window.statsMasterRemove(field, value);
    });
    m.appendChild(it);
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    m.style.top = Math.round(r.bottom + window.scrollY + 4) + 'px';
    m.style.left = Math.max(8, Math.round(r.right + window.scrollX - m.offsetWidth)) + 'px';
    it.focus();
  };
  document.addEventListener('pointerdown', e => { if (!e.target.closest || (!e.target.closest('.master-ops-menu') && !e.target.closest('.master-ops-more'))) _closeOpsMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') _closeOpsMenu(); });
  // 個別マスターの解除（確認つき。入力候補から外れる）
  window.statsMasterRemove = async function (field, value) {
    const ok = await window.uiConfirm({
      title: 'マスターから解除しますか？',
      lines: [(_FIELD_LABEL[field] || field) + '「' + value + '」を、チーム共有のマスター（入力候補）から外します。', '見積データそのものは削除されません。'],
      irreversible: '解除すると、入力候補から消えます（再び使うには、あらためて登録・申請が必要です）。',
      okLabel: '解除する', danger: true,
    });
    if (ok) await window.statsToggleVote(field, value);
  };

  function _renderMaster() {
    const e = document.getElementById('statsPane-master');
    if (!e) return;

    const cloudOn = _cloud() && _cvMap !== null;
    let entries = [];
    if (cloudOn) {
      _cvMap.forEach(({ total, isMine }, key) => {
        if (total < 1) return;
        const sep = key.indexOf('\x00');
        const field = key.substring(0, sep);
        const value = key.substring(sep + 1);
        entries.push({ field, value, votes: total, isMine, promoted: true });
      });
    }
    const labels = { sv: 'サブコン', carrier: 'キャリア', nm: '品名', un: '単位', customer: 'お客様', port: '港' };

    // --- 代表を新規登録するフォーム（実データに無い名称も登録可）---
    const fieldOpts = [['sv', 'サブコン'], ['carrier', 'キャリア'], ['nm', '品名'], ['customer', 'お客様'], ['port', '港'], ['un', '単位']]
      .map(([v, l]) => `<option value="${v}"${v === _masterFieldFilter ? ' selected' : ''}>${l}</option>`).join('');
    const formH = '<div class="master-register-bar"><button type="button" class="master-register-toggle" onclick="statsMasterToggleRegister()">＋ 代表を新規登録</button></div>' +
      '<div class="master-new-form master-register' + (_regOpen ? ' is-open' : '') + '">' +
      '<span class="master-new-label">➕ 代表を新規登録</span>' +
      `<select id="masterNewField" class="ar-select">${fieldOpts}</select>` +
      '<input id="masterNewValue" class="ar-input" type="text" placeholder="代表名称（例: ABC Corporation Ltd.）" onkeydown="if(event.key===\'Enter\')statsMasterAddCanonical()" />' +
      '<button class="master-new-btn" onclick="statsMasterAddCanonical()">登録</button>' +
      '<span class="master-new-hint">実際の入力値に無い名称でも登録できます。登録後、集計タブの ⤵統合 で表記を束ねられます。</span>' +
      '</div>';

    // --- 同義グループ一覧（sv/nm/customer/port は syn*、un は ua* から集約）---
    const synGroups = (typeof window.synGetGroups === 'function' ? window.synGetGroups() : []).slice();
    const unitGroups = (typeof window.uaGetGroups === 'function' ? window.uaGetGroups() : [])
      .map(g => ({ field: 'un', canonical: g.canonical, aliases: g.aliases || [] }));
    const allSyn = [...synGroups, ...unitGroups]
      .sort((a, b) => (labels[a.field] || a.field).localeCompare(labels[b.field] || b.field) || (a.canonical || '').localeCompare(b.canonical || ''));
    // 統合（A案）: 代表(canonical)は自動的にマスター扱い。個別マスター表からは除外し、
    // 下の「同義グループ（代表＝マスター）」欄に集約表示する（二重表示を避ける）。
    const synCanonSet = new Set(allSyn.map(g => g.field + '\x00' + g.canonical));
    entries = entries.filter(m => !synCanonSet.has(m.field + '\x00' + m.value));

    // --- 種別絞り込みチップ（件数＝個別マスター＋同義グループの合算）---
    const fieldOrder = ['sv', 'carrier', 'nm', 'customer', 'port', 'un'];
    const counts = {};
    fieldOrder.forEach(f => { counts[f] = 0; });
    entries.forEach(m => { counts[m.field] = (counts[m.field] || 0) + 1; });
    allSyn.forEach(g => { counts[g.field] = (counts[g.field] || 0) + 1; });
    const totalCount = Object.values(counts).reduce((s, n) => s + n, 0);
    // 現在の絞り込み種別が0件になったら「すべて」に戻す（削除・解除で空になった場合）
    if (_masterFieldFilter !== 'all' && !counts[_masterFieldFilter]) _masterFieldFilter = 'all';
    const chip = (f, label, n) =>
      `<button class="master-filter-chip${_masterFieldFilter === f ? ' is-active' : ''}" ` +
      `onclick="statsMasterSetFilter('${f}')">${label}<span class="master-filter-count">${n}</span></button>`;
    let chipsH = '<div class="master-filter-chips">' +
      chip('all', 'すべて', totalCount) +
      fieldOrder.filter(f => counts[f] > 0).map(f => chip(f, labels[f], counts[f])).join('') +
      '</div>';

    // 絞り込みを適用
    if (_masterFieldFilter !== 'all') {
      entries = entries.filter(m => m.field === _masterFieldFilter);
    }
    const synFiltered = _masterFieldFilter === 'all' ? allSyn : allSyn.filter(g => g.field === _masterFieldFilter);

    let synH = '';
    if (synFiltered.length) {
      synH = '<div class="stats-syn-section"><p class="stats-master-info-title">⭐ 同義グループ（代表＝マスター）</p>' +
        `<p class="stats-master-info-note">⭐代表は自動的にマスター登録され、統合した別名はマスターから外れます。集計タブの ☆代表 / ⤵統合 で作成。件数は合算され入力補完にも反映されます。${cloudOn ? '（チーム共有）' : '（このブラウザに保存）'}</p>` +
        '<table class="stats-table master-table"><thead><tr><th>種別</th><th>代表</th><th>別名・略称</th><th class="ops">操作</th></tr></thead><tbody>';
      synFiltered.forEach(g => {
        const isUnit  = g.field === 'un';
        const aliases = g.aliases || [];
        const delAlias = (a) => isUnit
          ? `statsUnitRemoveAlias('${_ea(a)}','${_ea(g.canonical)}')`
          : `synRemoveAlias('${_ea(g.field)}','${_ea(a)}','${_ea(g.canonical)}')`;
        const delGroup = `statsConfirmRemoveGroup('${_ea(g.field)}','${_ea(g.canonical)}')`;
        const chips = aliases.length
          ? aliases.map(a => `<span class="stats-syn-member">${_esc(a)}<button class="ua-chip-del" title="統合解除" onclick="${delAlias(a)}">✕</button></span>`).join('')
          : '<span class="stats-empty-cell">—</span>';
        const addAliasHtml =
          `<span class="stats-syn-add-alias">` +
            `<input type="text" class="stats-syn-add-input" placeholder="別名を追加（例: OCEAN FREIGHT）" ` +
              `title="日本語・英語などどんな表記でも別名として追加できます。入力後 Enter か ＋ で確定。" ` +
              `onkeydown="if(event.key==='Enter'){event.preventDefault();statsSynAddAliasInline('${_ea(g.field)}','${_ea(g.canonical)}',this);}">` +
            `<button type="button" class="stats-syn-add-btn" title="別名として追加" ` +
              `onclick="statsSynAddAliasInline('${_ea(g.field)}','${_ea(g.canonical)}',this.previousElementSibling)">＋</button>` +
          `</span>`;
        synH += `<tr data-mfield="${_eav(g.field)}" data-mvalue="${_eav(g.canonical)}"><td>${labels[g.field] || g.field}</td>` +
                `<td class="stats-val"><span class="ua-star">⭐</span>${_esc(g.canonical)}${_mdBadge(g.field, g.canonical)}</td>` +
                `<td>${chips}${addAliasHtml}</td>` +
                `<td class="ops"><button class="stats-master-merge" title="この代表を別の代表に統合（配下の別名ごと移動）" onclick="statsSynMergePicker('${_ea(g.field)}','${_ea(g.canonical)}',this)">⤵ 統合</button>` +
                `<button class="stats-master-rename" title="代表名を変更（旧名称は別名として残ります）" onclick="statsMasterRename('${_ea(g.field)}','${_ea(g.canonical)}')">✏️ 名称変更</button>` +
                _mdDetailBtn(g.field, g.canonical) +
                `<button type="button" class="master-ops-more more" aria-haspopup="menu" title="その他の操作（グループの解除）" onclick="statsOpsMenu(this,'group','${_ea(g.field)}','${_ea(g.canonical)}')">⋯</button></td></tr>`;
      });
      synH += '</tbody></table></div>';
    }

    if (!entries.length) {
      const note = synFiltered.length
        ? '<p class="stats-empty">個別マスターはありません（同義グループの代表が下に「マスター」として表示されています）。</p>'
        : '<p class="stats-empty">マスター登録はまだありません。<br>各集計の ☆登録（個別）または ⭐代表（同義グループ）で追加できます。</p>';
      e.innerHTML = _masterHeadHtml(totalCount, allSyn.length) + (typeof window.masterTopNoticeHtml === 'function' ? window.masterTopNoticeHtml() : '') + _requestsHtml() + formH + chipsH + note + synH;
      return;
    }
    const usageDesc = {
      sv:       '見積行のサブコン欄で入力補完候補に表示されます。',
      carrier:  '幹線輸送（本船・航路）のキャリア欄で入力補完候補に表示されます。',
      nm:       '見積行の品名欄で入力補完候補に表示されます。',
      un:       '見積行の単位欄で入力補完候補に表示されます。',
      customer: 'お客様名欄で入力補完候補に表示されます。',
      port:     'POL / POD / Via 港欄で入力補完候補に表示されます。',
    };
    const sorted = entries.sort((a, b) => (labels[a.field] || a.field).localeCompare(labels[b.field] || b.field) || (a.value || '').localeCompare(b.value || ''));
    const _indHelp = document.documentElement.classList.contains('theme-industry') ? '' : ' open';   // Industry は畳む（現行は従来どおり開く）
    let h = '<details class="master-help"' + _indHelp + '><summary>✅ 個別マスター（同義グループに属さない表記）の活用方法</summary>' +
            '<div class="stats-master-info">' +
            '<ul class="stats-master-usage-list">' +
            Object.entries(usageDesc)
              .filter(([f]) => _masterFieldFilter === 'all' || f === _masterFieldFilter)
              .map(([f, desc]) => `<li><b>${labels[f] || f}</b>：${desc}</li>`).join('') +
            '<li><b>エイリアス是正</b>：表記ゆれを一括置換する際の「正規形」の候補として参照できます。</li>' +
            '</ul>' +
            `<p class="stats-master-info-note">☆ 登録 ボタンで即時マスターに追加。再クリックで解除できます。（チーム全員で共有）</p>` +
            '</div></details>' +
            '<table class="stats-table master-table"><thead><tr>' +
            '<th>種別</th><th>代表</th><th>別名・略称</th><th class="ops">操作</th>' +
            '</tr></thead><tbody>';
    sorted.forEach(m => {
      // 略称は同義グループ（正式名称が代表）として登録する。登録後は下の「同義グループ」に表示される
      const abbrevCell = `<button class="stats-master-abbrev-add" onclick="statsMasterAddAbbrev('${_ea(m.field)}','${_ea(m.value)}')">＋ 別名</button>`;
      h += `<tr data-mfield="${_eav(m.field)}" data-mvalue="${_eav(m.value)}">` +
           `<td>${labels[m.field] || m.field}</td>` +
           `<td class="stats-val">${_esc(m.value)}${_mdBadge(m.field, m.value)}</td>` +
           `<td class="stats-master-abbrev-cell">${abbrevCell}</td>` +
           `<td class="ops">${_mdDetailBtn(m.field, m.value)}${(_approvalOn() ? _isAdmin() : m.isMine) ? `<button type="button" class="master-ops-more more" aria-haspopup="menu" title="その他の操作（解除）" onclick="statsOpsMenu(this,'master','${_ea(m.field)}','${_ea(m.value)}')">⋯</button>` : ''}</td>` +
           `</tr>`;
    });
    e.innerHTML = _masterHeadHtml(totalCount, allSyn.length) + (typeof window.masterTopNoticeHtml === 'function' ? window.masterTopNoticeHtml() : '') + _requestsHtml() + formH + chipsH + h + '</tbody></table>' + synH;
  }

  // マスタータブから単位同義グループを操作した際、マスター画面も再描画する薄いラッパ
  window.statsUnitRemoveGroup = function (canonical) {
    if (typeof window.uaRemoveGroup === 'function') window.uaRemoveGroup(canonical);
    if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive();
  };
  window.statsUnitRemoveAlias = function (alias, canonical) {
    if (typeof window.uaRemoveAlias === 'function') window.uaRemoveAlias(alias, canonical);
    if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive();
  };

  // 同義グループの「解除」：誤クリック防止のため、影響内容を明示した確認ダイアログを挟む
  window.statsConfirmRemoveGroup = async function (field, canonical) {
    const isUnit = field === 'un';
    const g = isUnit
      ? (typeof window.uaGetGroups === 'function' ? window.uaGetGroups() : []).find(x => x.canonical === canonical)
      : (typeof window.synGetGroups === 'function' ? window.synGetGroups(field) : []).find(x => x.canonical === canonical);
    const aliases = (g && g.aliases) || [];
    const aliasInfo = aliases.length
      ? `統合されている ${aliases.length} 件の表記（${aliases.slice(0, 5).join('、')}${aliases.length > 5 ? ' ほか' : ''}）の統合が外れ、`
      : '';
    const ok = await window.uiConfirm({
      title: '同義グループを解除しますか？',
      lines: [`⭐「${canonical}」の同義グループを解除します。`,
              `${aliasInfo}件数の合算・入力補完への反映が無効になります。`,
              '見積データそのものは削除されません。'],
      irreversible: '解除したグループは元に戻りません（⭐代表 / ⤵統合 で作り直せます）。',
      okLabel: '解除する', danger: true,
    });
    if (!ok) return;
    if (isUnit) {
      if (typeof window.uaRemoveGroup === 'function') window.uaRemoveGroup(canonical);
      if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive();
    } else if (typeof window.synRemoveGroup === 'function') {
      await window.synRemoveGroup(field, canonical);
    }
  };

  // 同義グループへ任意の表記（日本語・英語など言語不問）を別名として直接追加。
  // 実データに存在しない値でも登録可（既存の ⤵統合 は実データ由来の値しか選べないため、その簡易版）。
  window.statsSynAddAliasInline = async function (field, canonical, inputEl) {
    if (!inputEl) return;
    const alias = (inputEl.value || '').trim();
    if (!alias) return;
    if (alias === canonical) {
      if (typeof window.quoteShowToast === 'function') window.quoteShowToast('代表名と同じ表記です', 'warn');
      return;
    }
    if (field === 'un') {
      if (typeof window.uaAddAlias === 'function') window.uaAddAlias(alias, canonical);
      if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive();
    } else if (typeof window.synAddAlias === 'function') {
      await window.synAddAlias(field, alias, canonical);
    }
  };

  // マスター管理: 代表を新規登録（実データに無い名称も可）
  window.statsMasterAddCanonical = async function () {
    const fSel = document.getElementById('masterNewField');
    const inp  = document.getElementById('masterNewValue');
    if (!fSel || !inp) return;
    const field = fSel.value;
    const value = (inp.value || '').trim();
    if (!value) { if (typeof window.quoteShowToast === 'function') window.quoteShowToast('代表名称を入力してください', 'warn'); return; }
    if (field === 'un') {
      if (typeof window.uaSetCanonical === 'function') window.uaSetCanonical(value);
    } else if (typeof window.synSetCanonical === 'function') {
      await window.synSetCanonical(field, value);
    }
    inp.value = '';
    if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive();
  };
  // マスター管理: 代表名を編集（リネーム）。旧名称は別名として残る
  window.statsMasterRename = async function (field, canonical) {
    const nv = window.prompt('新しい代表名を入力してください。\n（旧名称「' + canonical + '」は別名としてグループに残ります）', canonical);
    if (nv == null) return;
    const v = nv.trim();
    if (!v || v === canonical) return;
    if (field === 'un') {
      if (typeof window.uaRenameCanonical === 'function') window.uaRenameCanonical(canonical, v);
    } else if (typeof window.synRenameCanonical === 'function') {
      await window.synRenameCanonical(field, canonical, v);
    }
    if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive();
  };

  // マスター管理: 詳細情報フォームの開閉（customer/nm のみ）
  // 担当者1名分の入力行（氏名・電話番号・E-MAIL・その他連絡手段）
  function _mdContactRowHtml(c) {
    c = c || {};
    return `<div class="md-contact-row">` +
      `<input type="text" class="ar-input md-contact-name" placeholder="氏名" value="${_eav(c.name || '')}">` +
      `<input type="text" class="ar-input md-contact-furi" placeholder="ふりがな（読みで入力補完）" title="ふりがな：見積の「ご担当者」欄で、読みのひらがなを入力すると氏名の候補に出ます" value="${_eav(c.furigana || '')}">` +
      `<input type="text" class="ar-input md-contact-phone" placeholder="電話番号" value="${_eav(c.phone || '')}">` +
      `<input type="text" class="ar-input md-contact-email" placeholder="E-MAIL" value="${_eav(c.email || '')}">` +
      `<input type="text" class="ar-input md-contact-other" placeholder="その他連絡手段" value="${_eav(c.other || '')}">` +
      `<button type="button" class="md-contact-del" title="この担当者を削除" onclick="this.closest('.md-contact-row').remove()">✕</button>` +
      `</div>`;
  }
  window.statsAddContactRow = function (containerId) {
    const wrap = document.getElementById(containerId);
    if (!wrap) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = _mdContactRowHtml({});
    wrap.appendChild(tmp.firstElementChild);
  };
  window.statsAddTagChip = function (containerId) {
    const inputEl = document.getElementById(containerId + '_input');
    const wrap = document.getElementById(containerId);
    if (!inputEl || !wrap) return;
    const v = (inputEl.value || '').trim();
    if (!v) return;
    const exists = Array.from(wrap.querySelectorAll('.stats-md-tag-chip'))
      .some(c => (c.childNodes[0]?.textContent || '').trim() === v);
    if (!exists) {
      const span = document.createElement('span');
      span.className = 'stats-md-tag-chip';
      span.innerHTML = `${_esc(v)}<button type="button" onclick="this.parentElement.remove()">✕</button>`;
      wrap.appendChild(span);
    }
    inputEl.value = '';
    inputEl.focus();
  };

  window.statsToggleMasterDetail = function (field, value, btn) {
    const tr = btn.closest('tr');
    if (!tr) return;
    const next = tr.nextElementSibling;
    if (next && next.classList.contains('stats-detail-row')) { next.remove(); return; }
    document.querySelectorAll('.stats-detail-row').forEach(r => r.remove());
    const schema = (window.MD_SCHEMA && window.MD_SCHEMA[field]) || [];
    const existing = (typeof window.mdGet === 'function') ? window.mdGet(field, value) : null;
    const details = (existing && existing.details) || {};
    const fieldsHtml = schema.map(s => {
      const id = 'md_' + s.key;
      if (s.contacts) {
        // 旧・単一担当者フィールド（details.contact）からの非破壊移行：
        // まだ新形式のデータが無ければ、1件目として表示するだけ（保存時に新形式へ統一）
        let list = typeof window.mdContactsOf === 'function' ? window.mdContactsOf(details).slice() : (Array.isArray(details[s.key]) ? details[s.key].slice() : []);
        if (!list.length) list = [{}];
        return `<div class="master-detail-contacts">` +
          `<span class="master-detail-contacts-label">${s.label}</span>` +
          `<div id="${id}" class="master-contacts-editor">${list.map(_mdContactRowHtml).join('')}</div>` +
          `<button type="button" class="master-contact-add" onclick="statsAddContactRow('${id}')">＋ 担当者を追加</button>` +
          `</div>`;
      }
      if (s.tags) {
        const list = Array.isArray(details[s.key]) ? details[s.key] : [];
        const chips = list.map(t => `<span class="stats-md-tag-chip">${_esc(t)}<button type="button" onclick="this.parentElement.remove()">✕</button></span>`).join('');
        return `<div class="master-detail-tags">` +
          `<span class="master-detail-contacts-label">${s.label}</span>` +
          `<div id="${id}" class="master-tags-editor">${chips}</div>` +
          `<span class="stats-syn-add-alias">` +
            `<input type="text" class="stats-syn-add-input" id="${id}_input" placeholder="タグを追加" ` +
              `onkeydown="if(event.key==='Enter'){event.preventDefault();statsAddTagChip('${id}');}">` +
            `<button type="button" class="stats-syn-add-btn" onclick="statsAddTagChip('${id}')">＋</button>` +
          `</span></div>`;
      }
      if (s.options) {
        const cur = details[s.key] || '';
        const opts = s.options.map(o =>
          `<option value="${_eav(o.value)}"${o.value === cur ? ' selected' : ''}>${_esc(o.label)}</option>`).join('');
        return `<label class="master-detail-label">${s.label}<select id="${id}" class="ar-select">${opts}</select></label>`;
      }
      return s.textarea
        ? `<label class="master-detail-label">${s.label}<textarea id="${id}" class="ar-input master-detail-textarea" rows="2">${_esc(details[s.key] || '')}</textarea></label>`
        : `<label class="master-detail-label">${s.label}<input id="${id}" class="ar-input" type="text" value="${_eav(details[s.key] || '')}"${s.placeholder ? ` placeholder="${_eav(s.placeholder)}"` : ''} /></label>`;
    }).join('');
    const row = document.createElement('tr');
    row.className = 'stats-detail-row';
    row.innerHTML = `<td colspan="${tr.children.length}"><div class="master-detail-form">${fieldsHtml}` +
      `<div class="master-detail-actions">` +
      `<button class="master-detail-save" onclick="statsSaveMasterDetail('${_ea(field)}','${_ea(value)}')">💾 保存</button>` +
      (existing ? `<button class="master-detail-del" onclick="statsDeleteMasterDetail('${_ea(field)}','${_ea(value)}')">削除</button>` : '') +
      `</div></div>` +
      `<div class="master-attach-box">` +
        `<div class="master-attach-hdr"><span>📎 添付ファイル（保管期限なし）</span>` +
          `<label class="master-attach-upload-btn">＋ ファイルを追加` +
            `<input type="file" multiple hidden onchange="mdAttachUpload('${_ea(field)}','${_ea(value)}',this.files);this.value='';"></label>` +
        `</div>` +
        `<div class="master-attach-list" id="mdAttachList"><span class="master-attach-loading">読み込み中…</span></div>` +
      `</div></td>`;
    tr.after(row);
    window.statsRefreshMasterAttachments(field, value);
  };

  // 添付ファイル一覧を再取得して #mdAttachList を再描画（アップロード／削除後にも呼ぶ）
  window.statsRefreshMasterAttachments = async function (field, value) {
    const wrap = document.getElementById('mdAttachList');
    if (!wrap) return;
    if (typeof window.mdListAttachments !== 'function') { wrap.innerHTML = '<span class="master-attach-empty">添付機能は未設定です</span>'; return; }
    const items = await window.mdListAttachments(field, value);
    const cur = document.getElementById('mdAttachList');   // 取得中に閉じられていたら何もしない
    if (!cur) return;
    if (!items.length) { cur.innerHTML = '<span class="master-attach-empty">添付はまだありません</span>'; return; }
    cur.innerHTML = items.map(a => {
      const who = (typeof window.quoteDisplayName === 'function') ? window.quoteDisplayName(a.uploaded_by) : (a.uploaded_by || '—');
      const ts = a.created_at ? new Date(a.created_at).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '';
      const sz = a.file_size ? (a.file_size > 1048576 ? (a.file_size / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(a.file_size / 1024)) + 'KB') : '';
      const icon = /pdf/i.test(a.mime_type || '') ? '📄' : (/image/i.test(a.mime_type || '') ? '🖼️' : '📎');
      return '<div class="master-attach-item">' +
        `<button type="button" class="master-attach-open" onclick="mdAttachOpen('${encodeURIComponent(a.storage_path)}')" title="開く／ダウンロード">${icon} ${_esc(a.file_name)}</button>` +
        `<span class="master-attach-meta">${sz ? sz + ' · ' : ''}${_esc(who)} · ${ts}</span>` +
        `<button type="button" class="master-attach-del" onclick="mdAttachDelete('${a.id}','${encodeURIComponent(a.storage_path)}','${_ea(field)}','${_ea(value)}')" title="削除">✕</button>` +
      '</div>';
    }).join('');
  };

  window.statsSaveMasterDetail = async function (field, value) {
    const schema = (window.MD_SCHEMA && window.MD_SCHEMA[field]) || [];
    const details = {};
    schema.forEach(s => {
      const id = 'md_' + s.key;
      if (s.contacts) {
        const wrap = document.getElementById(id);
        if (!wrap) return;
        const rows = Array.from(wrap.querySelectorAll('.md-contact-row')).map(row => ({
          name:  row.querySelector('.md-contact-name') ?.value.trim() || '',
          furigana: row.querySelector('.md-contact-furi')?.value.trim() || '',
          phone: row.querySelector('.md-contact-phone')?.value.trim() || '',
          email: row.querySelector('.md-contact-email')?.value.trim() || '',
          other: row.querySelector('.md-contact-other')?.value.trim() || '',
        })).filter(c => c.name || c.furigana || c.phone || c.email || c.other);
        if (rows.length) details[s.key] = rows;
        return;
      }
      if (s.tags) {
        const wrap = document.getElementById(id);
        if (!wrap) return;
        const tags = Array.from(wrap.querySelectorAll('.stats-md-tag-chip'))
          .map(chip => (chip.childNodes[0]?.textContent || '').trim())
          .filter(Boolean);
        if (tags.length) details[s.key] = tags;
        return;
      }
      const el = document.getElementById(id);
      if (!el) return;
      const v = (el.value || '').trim();
      if (v) details[s.key] = v;
    });
    // 保存できなかったときは（理由は mdSave が画面に出す）入力中のフォームを残し、「保存しました」とは出さない
    const saved = typeof window.mdSave === 'function' ? await window.mdSave(field, value, details) : false;
    if (!saved) return;
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('📇 詳細情報を保存しました', 'success');
    if (typeof window.mdRefreshCustomerBtn === 'function') window.mdRefreshCustomerBtn();
    if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();  // ふりがなを入力補完へ即反映
    if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive(); else _renderMaster();
  };

  window.statsDeleteMasterDetail = async function (field, value) {
    if (!confirm('詳細情報を削除しますか？（マスター登録自体は解除されません）')) return;
    if (typeof window.mdDelete === 'function') await window.mdDelete(field, value);
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast('詳細情報を削除しました');
    if (typeof window.mdRefreshCustomerBtn === 'function') window.mdRefreshCustomerBtn();
    if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
    if (typeof window.statsRerenderActive === 'function') window.statsRerenderActive(); else _renderMaster();
  };

  function _renderAlias() {
    if (typeof window.arRenderPane === 'function') window.arRenderPane();
    else { const el = document.getElementById('statsPane-alias'); if (el) el.innerHTML = '<p class="stats-empty">alias-rules.js が読み込まれていません。</p>'; }
  }

  function _renderCloud() {
    const e = document.getElementById('statsCloudStatus');
    if (!e) return;
    if (_cloud()) {
      e.textContent = `☁️ クラウド投票: ${_me()} でログイン中`;
      e.className = 'stats-cloud-on';
    } else {
      e.textContent = '💾 ローカル投票（ログインするとチーム共有）';
      e.className = 'stats-cloud-off';
    }
  }

  function _updateSummary() {
    if (!_data) return;
    const set = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
    set('statsTotal',    _data.totalPresets);
    set('statsRows',     _data.totalRows);
    set('statsSvCount',  _data.svGroups.length + _data.carrierGroups.length);
    set('statsNmGroups', _data.nmGroups.length);
    // ゆらぎ件数 = バリアントが2種以上のグループ数の合計
    const blur = [..._data.svGroups, ..._data.carrierGroups, ..._data.nmGroups, ..._data.unGroups, ..._data.customerGroups]
      .filter(g => g.variants.length > 1).length;
    set('statsBlurCount', blur);
    // マスター候補数
    const masterCount = _cloud() && _cvMap ? _cvMap.size : 0;
    set('statsMasterCount', masterCount);
  }

  // ===== KPI ペイン =====

  function _extractRowsWithPrice(preset) {
    const d = preset.data || {};
    if (!Array.isArray(d.rows)) return [];
    return d.rows
      .filter(r => r && r._type === 'data')
      .map(r => {
        const c = Array.isArray(r.cells) ? r.cells : [];
        return {
          cat: (c[CI.cat] || '').trim(),
          sv:  (c[CI.sv]  || '').trim(),
          nm:  (c[CI.nm]  || '').replace(/^\*+/, '').trim(),
          un:  (c[CI.un]  || '').trim(),
          pp:  parseFloat(c[CI.pp]) || null,
          bp:  parseFloat(c[CI.bp]) || null,
          pc:  (c[CI.pc]  || 'JPY').trim(),
        };
      })
      .filter(r => r.sv || r.nm);
  }

  // 📊 データ：目標値を持たない実績の集計（案件数・受注率・作成者別成績）。
  function _renderData() {
    const e = document.getElementById('statsPane-data');
    if (!e) return;

    const metas = [];
    const source = document.getElementById('statsSource')?.value || 'both';
    // 「担当者」は社内の見積作成者（created_by）で集計する。qf-person/person はお客様側の
    // 宛先担当者名であり、社内メンバーとは別物のため使わない（登録メンバー名で表示するため）。
    if (source !== 'cloud') {
      _getLocalPresets().forEach(p => {
        const f = (p.data || {}).fields || {};
        metas.push({
          person:  '💾 ローカル保存（作成者不明）',
          status:  (f['qf-status']   || '').trim(),
          rows:    _extractRowsWithPrice(p),
        });
      });
    }
    if (source !== 'local') {
      const cloud = typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : [];
      cloud.forEach(p => {
        const createdBy = (p.created_by || '').trim();
        metas.push({
          person:  createdBy ? _creatorName(createdBy) : '（作成者不明）',
          status:  (p.status   || '').trim(),
          rows:    _extractRowsWithPrice(p),
        });
      });
    }

    if (!metas.length) { e.innerHTML = '<p class="stats-empty">案件データがありません。</p>'; return; }

    // 全体KPI
    const won    = metas.filter(m => m.status === '受注').length;
    const lost   = metas.filter(m => m.status === '失注').length;
    const sent   = metas.filter(m => ['提示済み','提出済み','受注','失注'].includes(m.status)).length;
    const winRate = sent ? Math.round(won / sent * 100) : null;

    // 担当者別KPI
    const personMap = {};
    metas.forEach(m => {
      const k = m.person || '（未入力）';
      if (!personMap[k]) personMap[k] = { total: 0, won: 0, lost: 0, sent: 0 };
      personMap[k].total++;
      if (['提示済み','提出済み','受注','失注'].includes(m.status)) personMap[k].sent++;
      if (m.status === '受注') personMap[k].won++;
      if (m.status === '失注') personMap[k].lost++;
    });
    const persons = Object.entries(personMap).sort((a, b) => b[1].total - a[1].total);

    const kpiCards = [
      { label: '総案件数',     value: metas.length },
      { label: '受注数',       value: won },
      { label: '失注数',       value: lost },
      { label: '受注率',       value: winRate !== null ? winRate + '%' : '—' },
    ];

    let h = '<div class="stats-kpi-cards">' +
      kpiCards.map(k => `<div class="stats-kpi-card"><div class="stats-kpi-value">${_esc(String(k.value))}</div><div class="stats-kpi-label">${_esc(k.label)}</div></div>`).join('') +
      '</div>';

    h += '<h3 class="stats-kpi-section-title">見積作成者別成績</h3>';
    h += '<table class="stats-table"><thead><tr><th>作成者</th><th class="stats-num-col">総件数</th><th class="stats-num-col">提示済</th><th class="stats-num-col">受注</th><th class="stats-num-col">失注</th><th class="stats-num-col">受注率</th></tr></thead><tbody>';
    persons.forEach(([person, d]) => {
      const wr = d.sent ? Math.round(d.won / d.sent * 100) + '%' : '—';
      const barW = d.sent ? Math.round(d.won / d.sent * 100) : 0;
      h += `<tr>` +
        `<td class="stats-val">${_esc(person)}</td>` +
        `<td class="stats-num-col">${d.total}</td>` +
        `<td class="stats-num-col">${d.sent}</td>` +
        `<td class="stats-num-col">${d.won}</td>` +
        `<td class="stats-num-col">${d.lost}</td>` +
        `<td class="stats-num-col"><div class="stats-bar-wrap"><div class="stats-bar" style="width:${barW}%"></div><span class="stats-bar-label">${_esc(wr)}</span></div></td>` +
        `</tr>`;
    });
    h += '</tbody></table>';
    e.innerHTML = h;
  }

  // 🎯 KPI：目標値を定めた指標だけを扱う。目標値の設定方法は未定のため、現時点では
  // 準備中の案内のみ表示する（実績の集計は「📊 データ」タブ）。
  function _renderKpi() {
    const e = document.getElementById('statsPane-kpi');
    if (!e) return;
    e.innerHTML =
      '<p class="stats-empty">🎯 KPI（目標値を定めた指標）は準備中です。<br>' +
      '<small>目標値の設定方法を決めたうえで、ここに目標に対する達成状況を表示します。' +
      '目標値を持たない実績の集計（案件数・受注率・作成者別成績）は「📊 データ」タブで確認できます。</small></p>';
  }

  // === 🔖 パターン別：受注率・粗利率 ===
  // パターンは明細行の属性（cells[CI.pt]）。案件ステータスを各パターンに紐付けて集計する。
  //   受注率＝受注 ÷（提示済み/提出済み/受注/失注）… KPI と同じ「提示ベース」
  //   粗利率＝そのパターンの全行の (売上−仕入) ÷ 売上（JPY換算・加重平均）
  function _renderPattern() {
    const e = document.getElementById('statsPane-pattern');
    if (!e) return;
    const source = document.getElementById('statsSource')?.value || 'both';
    const cases = [];
    const pushCase = (status, preset) => {
      const d = preset.data || {};
      if (!Array.isArray(d.rows)) return;
      cases.push({ status: (status || '').trim(), rows: d.rows.filter(r => r && r._type === 'data') });
    };
    if (source !== 'cloud') _getLocalPresets().forEach(p => pushCase(((p.data || {}).fields || {})['qf-status'], p));
    if (source !== 'local') (typeof window.cloudGetAllRows === 'function' ? window.cloudGetAllRows() : []).forEach(p => pushCase(p.status, p));

    const SENT = ['提示済み', '提出済み', '受注', '失注'];
    let skippedRows = 0;
    // 正規化キー → { label, cases:Set index, won, lost, sent, sell, cost }
    const map = new Map();
    cases.forEach((c, ci) => {
      const perPat = new Map();   // この案件内：normKey → { label, sell, cost }
      c.rows.forEach(r => {
        const cells = Array.isArray(r.cells) ? r.cells : [];
        const pt = (cells[CI.pt] || '').trim();
        if (!pt) return;          // パターン未設定行はスキップ
        const k = _normalize(pt) || pt;
        if (!perPat.has(k)) perPat.set(k, { label: pt, sell: 0, cost: 0 });
        // 仕入・売の両方が入力済みで換算できる行だけを粗利率に使う（ミニマムは _pairJ 内で反映）
        const pr = _pairJ(cells);
        if (pr.skip) { skippedRows++; return; }
        const o = perPat.get(k);
        o.sell += pr.bill;
        o.cost += pr.cost;
      });
      perPat.forEach((v, k) => {
        if (!map.has(k)) map.set(k, { label: v.label, cases: 0, won: 0, lost: 0, sent: 0, sell: 0, cost: 0 });
        const g = map.get(k);
        g.cases++;
        if (SENT.includes(c.status)) g.sent++;
        if (c.status === '受注') g.won++;
        if (c.status === '失注') g.lost++;
        g.sell += v.sell; g.cost += v.cost;
      });
    });

    if (!map.size) {
      e.innerHTML = '<p class="stats-empty">パターン別データがありません。<br>' +
        '<small>明細の「パターン」欄に名前（航路など）を入れて案件を保存してください。受注率・粗利率を集計します。</small></p>';
      return;
    }
    const rows = Array.from(map.values()).sort((a, b) => b.cases - a.cases);
    let h = '<p class="stats-syn-hint">明細の「パターン」を案件ステータスと紐付けて集計します。受注率＝受注 ÷（提示済み＋受注＋失注）、粗利率＝(売上−仕入)÷売上（仕入・売の両方が入力済みの行をJPY換算）。' +
      (skippedRows ? `仕入・売の片方のみ／為替未取得の ${skippedRows} 行は粗利率から除外しています。` : '') + '</p>';
    h += '<table class="stats-table"><thead><tr><th>パターン</th><th class="stats-num-col">案件数</th><th class="stats-num-col">提示</th><th class="stats-num-col">受注</th><th class="stats-num-col">失注</th><th class="stats-num-col">受注率</th><th class="stats-num-col">平均粗利率</th></tr></thead><tbody>';
    rows.forEach(g => {
      const wr = g.sent ? Math.round(g.won / g.sent * 100) : null;
      const barW = wr == null ? 0 : wr;
      const margin = g.sell > 0 ? ((g.sell - g.cost) / g.sell * 100) : null;
      const mCls = margin == null ? '' : (margin < 0 ? ' stats-neg' : '');
      h += '<tr>' +
        `<td class="stats-val">🔖 ${_esc(g.label)}</td>` +
        `<td class="stats-num-col">${g.cases}</td>` +
        `<td class="stats-num-col">${g.sent}</td>` +
        `<td class="stats-num-col">${g.won}</td>` +
        `<td class="stats-num-col">${g.lost}</td>` +
        `<td class="stats-num-col"><div class="stats-bar-wrap"><div class="stats-bar" style="width:${barW}%"></div><span class="stats-bar-label">${wr == null ? '—' : wr + '%'}</span></div></td>` +
        `<td class="stats-num-col${mCls}">${margin == null ? '—' : margin.toFixed(1) + '%'}</td>` +
        '</tr>';
    });
    h += '</tbody></table>';
    e.innerHTML = h;
  }

  function _renderActivePane() {
    const active = document.querySelector('#tab-stats .stats-pane.is-active');
    if (!active) return;
    const id = active.id.replace('statsPane-', '');
    if (id === 'pattern') { _renderPattern(); return; }
    if      (id === 'dashboard') _renderDashboard();
    else if (id === 'sv')       _renderSv();
    else if (id === 'carrier')  _renderCarrier();
    else if (id === 'port')     _renderPort();
    else if (id === 'customer') _renderCustomer();
    else if (id === 'nm')       _renderNm();
    else if (id === 'un')       _renderUn();
    else if (id === 'svport')   _renderSvPort();
    else if (id === 'custitem') _renderCustItem();
    else if (id === 'margindiff') _renderMarginDiff();
    else if (id === 'ledger')   _renderLedger();
    else if (id === 'charges')  _renderCharges();
    else if (id === 'master')   _renderMaster();
    else if (id === 'alias')    _renderAlias();
    else if (id === 'data')     _renderData();
    else if (id === 'kpi')      _renderKpi();
  }

  // === サブタブ切替 ===

  function statsSetPane(paneId) {
    // 存在しないタブ ID（廃止したダッシュボード等）が渡されても、本文が空白になりタブが
    // どれも選択されない状態にならないよう、先頭のサブタブへ退避する。
    if (!document.getElementById('statsTabBtn-' + paneId) && !document.getElementById('statsPane-' + paneId)) paneId = 'sv';
    _listLimit = {};
    document.querySelectorAll('#tab-stats .stats-tab-btn').forEach(b => {
      b.classList.remove('is-active');
      b.setAttribute('aria-selected', 'false');
    });
    // 非表示になるタブの中身は破棄する。statsSetPane は毎回対象タブを全面的に再構築する
    // ので保持する意味がなく、放置すると（display:none で隠れているだけで）DOM に残り
    // 続け、タブを渡り歩くほどページ全体が重くなっていく（データが増えるほど顕著）。
    document.querySelectorAll('#tab-stats .stats-pane').forEach(p => { p.classList.remove('is-active'); p.innerHTML = ''; });
    const activeBtn = document.getElementById('statsTabBtn-' + paneId);
    if (activeBtn) { activeBtn.classList.add('is-active'); activeBtn.setAttribute('aria-selected', 'true'); }
    document.getElementById('statsPane-'   + paneId)?.classList.add('is-active');
    if (!_data) { _data = _build(document.getElementById('statsSource')?.value || 'both'); _updateSummary(); }
    if      (paneId === 'dashboard') _renderDashboard();
    else if (paneId === 'sv')       _renderSv();
    else if (paneId === 'carrier')  _renderCarrier();
    else if (paneId === 'port')     _renderPort();
    else if (paneId === 'customer') _renderCustomer();
    else if (paneId === 'nm')       _renderNm();
    else if (paneId === 'un')       _renderUn();
    else if (paneId === 'svport')   _renderSvPort();
    else if (paneId === 'custitem') _renderCustItem();
    else if (paneId === 'margindiff') _renderMarginDiff();
    else if (paneId === 'ledger')   _renderLedger(true);
    else if (paneId === 'pattern')  _renderPattern();
    else if (paneId === 'charges')  _renderCharges();
    else if (paneId === 'master')   _renderMaster();
    else if (paneId === 'alias')    _renderAlias();
    else if (paneId === 'data')     _renderData();
    else if (paneId === 'kpi')      _renderKpi();
  }

  // === パブリック API ===

  // ログイン後に、クラウドのマスター（投票）・同義グループ・マスター詳細を読み込み、入力補完（datalist）へ反映する。
  // これをしないと、マスター管理／統計タブを開くまで、クラウド登録済みの項目が見積テーブルの候補に出ない
  // （ローカルに登録した分しか出ない）。
  let _mcLoading = null;
  window.statsLoadMasterCache = function () {
    if (!_cloud()) return Promise.resolve();
    if (_mcLoading) return _mcLoading;
    _mcLoading = (async () => {
      try {
        await _loadCloudVotes();
        if (typeof window.synLoadCloud === 'function') await window.synLoadCloud();
        if (typeof window.mdLoadCloud === 'function') await window.mdLoadCloud();
        if (typeof window.arLoadCloud === 'function') await window.arLoadCloud();
        if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
      } catch (err) { console.warn('[statsLoadMasterCache]', err); }
      finally { _mcLoading = null; }
    })();
    return _mcLoading;
  };

  window.initStatsTab = async function () {
    _data  = null;
    _cvMap = null;
    const source = document.getElementById('statsSource')?.value || 'both';
    if (source !== 'local' && _cloud() && typeof window.cloudListPresets === 'function') {
      await window.cloudListPresets(true);
    }
    _data  = _build(source);
    _updateSummary();
    _renderCloud();
    statsSetPane('sv');
    if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
    if (_cloud()) {
      await _loadCloudVotes();
      if (typeof window.synLoadCloud === 'function') await window.synLoadCloud();
      if (typeof window.mdLoadCloud === 'function') await window.mdLoadCloud();
      if (typeof window.arLoadCloud === 'function') await window.arLoadCloud();
      if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();   // 読み込んだクラウドのマスターを入力補完へ
      _renderCloud();
      _renderActivePane();
    }
  };

  window.statsSetPane = statsSetPane;

  // === 🗂 マスター管理タブ（統計から独立したトップレベルタブ）===
  // マスター管理・エイリアス是正のサブタブ切替。パネル(#statsPane-master/-alias)は
  // #tab-master へ移設済み。ID 据え置きのため _renderMaster/_renderAlias はそのまま動く。
  function masterSetPane(paneId) {
    document.querySelectorAll('#tab-master .stats-tab-btn').forEach(b => {
      b.classList.remove('is-active'); b.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('#tab-master .stats-pane').forEach(p => p.classList.remove('is-active'));
    const btn = document.getElementById('masterTabBtn-' + paneId);
    if (btn) { btn.classList.add('is-active'); btn.setAttribute('aria-selected', 'true'); }
    document.getElementById('statsPane-' + paneId)?.classList.add('is-active');
    if      (paneId === 'master') _renderMaster();
    else if (paneId === 'alias')  _renderAlias();
  }
  window.masterSetPane = masterSetPane;

  window.initMasterTab = async function () {
    masterSetPane('master');
    if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
    if (_cloud()) {
      _cvMap = null;
      await _loadCloudVotes();
      if (typeof window.synLoadCloud === 'function') await window.synLoadCloud();
      if (typeof window.mdLoadCloud === 'function') await window.mdLoadCloud();
      if (typeof window.arLoadCloud === 'function') await window.arLoadCloud();
      if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();   // 読み込んだクラウドのマスターを入力補完へ
      // アクティブなマスタータブのペインを再描画
      const active = document.querySelector('#tab-master .stats-pane.is-active');
      if (active && active.id === 'statsPane-alias') _renderAlias(); else _renderMaster();
    }
  };

  // 昇格済みマスターを全フィールド分まとめて返す（alias-rules.js の datalist 補完用）
  window.statsGetMasters = function () {
    const cloudOn = _cloud() && _cvMap !== null;
    if (cloudOn) {
      const res = [];
      _cvMap.forEach(({ total }, key) => {
        if (total >= 1) {
          const sep = key.indexOf('\x00');
          const field = key.substring(0, sep);
          const value = key.substring(sep + 1);
          res.push({ field, value });
        }
      });
      return res;
    }
    return [];   // マスターはクラウド必須（未ログイン・読込前は空）
  };

  window.statsRefresh = async function () {
    const btn = document.querySelector('.stats-refresh-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⌛ 更新中…'; }
    try {
      _data  = null;
      _ledgerCache = null;
      _cvMap = null;
      const source = document.getElementById('statsSource')?.value || 'both';
      if (source !== 'local' && _cloud() && typeof window.cloudListPresets === 'function') {
        await window.cloudListPresets(true);
      }
      _data  = _build(source);
      _updateSummary();
      _renderCloud();
      if (_cloud()) {
        await _loadCloudVotes();
        if (typeof window.synLoadCloud === 'function') await window.synLoadCloud();
        if (typeof window.mdLoadCloud === 'function') await window.mdLoadCloud();
        if (typeof window.arLoadCloud === 'function') await window.arLoadCloud();
      }
      _renderCloud();
      _renderActivePane();
      if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '🔄 集計'; }
    }
  };

  // 入力欄の横の印用：この名称のマスター状態。'master'（登録済み）／'pending'（申請中・承認待ち）／'none'（未登録）／
  // 'unknown'（ログインしていない・読込前・その項目のマスターが 1 件も無い＝判定しない）
  window.statsMasterState = function (field, value) {
    if (!_cloud() || _cvMap === null || !(_cvFieldCount[field] > 0)) return 'unknown';
    if ((_cvMap.get(field + '\x00' + value) || { total: 0 }).total >= 1) return 'master';
    return _pendingReq(field, value) ? 'pending' : 'none';
  };
  window.statsIsApprovalOn = () => _approvalOn() && !_isAdmin();   // メンバーの登録が「申請」になるか（確認画面の文言用）
  window.statsToggleVote = async function (field, value) {
    // 承認制では「マスターかどうか」で切り替える（管理者は解除、メンバーは申請）
    const wasVoted = _approvalOn() ? _voteInfo(field, value).total > 0 : _voteInfo(field, value).isMine;
    try {
      if (wasVoted) await _demote(field, value);
      else          await _promote(field, value);
    } catch (err) {
      console.error('[statsToggleVote] promote/demote failed:', err);
      if (typeof window.quoteShowToast === 'function') window.quoteShowToast('マスター登録に失敗しました: ' + err.message);
      return;
    }
    try {
      _renderActivePane();
      _renderMaster();
      if (typeof window.arRefreshDatalist === 'function') window.arRefreshDatalist();
    } catch (err) {
      console.error('[statsToggleVote] render failed:', err);
    }
    const isCloud = _cloud();
    const actionMsg = wasVoted ? '⭐ マスター登録を解除しました' : `⭐ マスターに登録しました（${isCloud ? 'クラウド' : 'ローカル'}）`;
    if (typeof window.quoteShowToast === 'function') window.quoteShowToast(actionMsg);
  };

  // 後方互換
  window.statsPromote = async function (f, v) { await _promote(f, v); _renderActivePane(); };
  window.statsDemote  = async function (f, v) { await _demote(f, v);  _renderMaster(); };

  // 統合（A案）: 同義グループの代表設定/統合から呼ぶ冪等ヘルパー。
  // 代表は自動マスター化、別名はマスター解除（自分の票のみ操作）。
  window.statsEnsureMaster = async function (field, value) {
    try {
      const v = _voteInfo(field, value);
      if (_approvalOn() ? v.total === 0 : !v.isMine) await _promote(field, value);
    }
    catch (err) { console.error('[statsEnsureMaster]', err); }
  };
  window.statsEnsureNotMaster = async function (field, value) {
    try {
      if (_approvalOn()) { if (_isAdmin() && _voteInfo(field, value).total > 0) await _demote(field, value); }   // メンバーは何もしない（解除は管理者）
      else if (_voteInfo(field, value).isMine) await _demote(field, value);
    }
    catch (err) { console.error('[statsEnsureNotMaster]', err); }
  };

  window.statsMasterAddAbbrev = function (field, value) {
    const labels = { sv: 'サブコン', carrier: 'キャリア', nm: '品名', un: '単位', customer: 'お客様', port: '港' };
    const safeId = 'abbrev-inline-' + Math.random().toString(36).slice(2, 7);
    // 既存の「＋ 略称」ボタンを入力フォームに置換
    const btn = document.querySelector(`.stats-master-abbrev-add[onclick*="${_ea(value)}"]`);
    if (!btn) return;
    const cell = btn.parentElement;
    cell.innerHTML = `<span class="stats-abbrev-inline-form">` +
      `<input id="${safeId}" class="stats-abbrev-input" type="text" placeholder="略称を入力（${labels[field] || field}）" maxlength="30" autofocus>` +
      `<button class="stats-abbrev-ok" onclick="statsMasterAddAbbrevCommit('${_ea(field)}','${_ea(value)}','${safeId}')">追加</button>` +
      `<button class="stats-abbrev-cancel" onclick="_renderMaster()">取消</button>` +
      `</span>`;
    document.getElementById(safeId)?.focus();
    document.getElementById(safeId)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') window.statsMasterAddAbbrevCommit(field, value, safeId);
      if (e.key === 'Escape') _renderMaster();
    });
  };

  window.statsMasterAddAbbrevCommit = async function (field, value, inputId) {
    const input = document.getElementById(inputId);
    const abbrev = input ? input.value.trim() : '';
    if (!abbrev) { _renderMaster(); return; }
    if (typeof window.arAddAbbrevPair === 'function') {
      await window.arAddAbbrevPair(field, abbrev, value);
    }
    _renderMaster();
  };

  window.statsToggleHelp = function () {
    const p = document.getElementById('statsHelpPanel');
    if (!p) return;
    p.hidden = !p.hidden;
  };

  // === CSV エクスポート ===

  window.statsExportCsv = function (paneId) {
    if (!_data) return;
    let csv = '';
    const esc = v => '"' + String(v||'').replace(/"/g, '""') + '"';
    if (paneId === 'sv' || paneId === 'carrier') {
      const groups = paneId === 'sv' ? _data.svGroups : _data.carrierGroups;
      csv = 'サブコン/キャリア名,件数,バリアント数\n' +
        groups.map(g => [esc(g.variants[0].value), g.total, g.variants.length].join(',')).join('\n');
    } else if (paneId === 'nm') {
      csv = '品名,件数,バリアント数\n' +
        _data.nmGroups.map(g => [esc(g.variants[0].value), g.total, g.variants.length].join(',')).join('\n');
    } else if (paneId === 'un') {
      csv = '単位,件数\n' +
        _data.unGroups.map(g => [esc(g.variants[0].value), g.total].join(',')).join('\n');
    }
    if (!csv) return;
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'stats-' + paneId + '-' + new Date().toISOString().slice(0,10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  };

})();
