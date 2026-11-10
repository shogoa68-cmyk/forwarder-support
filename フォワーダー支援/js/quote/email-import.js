// ================================================================
//  📩 メール取込（フェーズ1：貼り付け＋ルールベース解析）
//  メール本文で提示した見積（自由文含む）を解析して行データ化し、
//  レビュー後に「現在の見積へ挿入」or「新規案件として展開」する。
//  ・自アプリ形式（quote-email.js の明細行）は高精度で逆変換
//  ・一般の自由文は金額・数量×単価パターンで抽出（低確度マーク付き）
//  ・原文は qf-import-src（hidden）に保存され案件データと一緒に永続化
//  ・「📝 原文のまま保管」：自由入力で提示した見積の原文を、新しい案件にも既存の案件にも複数件保管し、
//    あとで「📩 未取込」の一覧から 1 件ずつ取り込める（案件データ fields['qf-free-entries']・1 件ごとに未取込／取込済み）
//  依存（window 経由）：appendQuoteRows, _applyQuoteData, qpNewQuote,
//                       getAllCategories, quoteShowToast, qpShowEditor
// ================================================================
(function () {
  'use strict';

  // conditions.js の ROW_CELL_FIELDS と同順（cells[0]=選択チェック）。変更時は要同期
  const CELL_FIELDS = ['cat','sv','tx','nm','pq','un','bq','pc','bc','pp','bp','cd','mk','nt','zc','vf','vt','ac','pt','ps','co','lu','ppmode','pprate','ppbase','uid','ppref','ri','es','ppmin','bpmin','ic','cn','bphi'];

  const CCY_LIST = ['USD','EUR','CNY','KRW','THB','SGD','GBP','AUD','HKD','TWD','VND','IDR','MYR','PHP','INR','JPY'];
  const CCY_RE = CCY_LIST.join('|');

  // 品名キーワード → カテゴリ推定辞書（前方一致ではなく包含・大文字小文字無視）
  const CAT_HINTS = [
    { re: /海上運賃|OCEAN\s*FREIGHT|O\/F|SEA\s*FREIGHT/i,                        cat: 'ocean' },
    { re: /航空運賃|AIR\s*FREIGHT|A\/F/i,                                         cat: 'air' },
    { re: /EBS|LSS|BAF|CAF|EFS|EES|GRI|PSS|NBAF|EBAF|NBF|OWS|CIC|SURCHARGE|サーチャージ|燃料|燃油/i, cat: 'surcharge' },
    { re: /輸出通関|EXPORT\s*CUSTOMS/i,                                            cat: 'customs-export' },
    { re: /輸入通関|IMPORT\s*CUSTOMS/i,                                            cat: 'customs-import' },
    { re: /通関|CUSTOMS|取扱料|保税/i,                                             cat: 'customs-export' },
    { re: /保険|INSURANCE/i,                                                       cat: 'insurance' },
    { re: /THC|CFS|DOC|D\/O|DRS|SEAL|CML|WHARFAGE|HANDLING|B\/L\s*FEE|AMS|AFR|MANIFEST|ローカル|LOCAL/i, cat: 'export-local' },
  ];

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }
  function _num(s) {
    const n = parseFloat(String(s == null ? '' : s).replace(/[, ]/g, ''));
    return isFinite(n) ? n : null;
  }

  // 金額文字列 → {v, ccy}。'¥1,234' / '1,234.00 USD' / 'USD 1,234' / '(¥1,234)' に対応
  function parseMoney(str) {
    if (!str) return null;
    const s = String(str).replace(/[()（）]/g, '').trim();
    let m = s.match(/[¥￥]\s?([\d,]+(?:\.\d+)?)/);
    if (m) return { v: _num(m[1]), ccy: 'JPY' };
    m = s.match(new RegExp('([\\d,]+(?:\\.\\d+)?)\\s*(' + CCY_RE + ')\\b', 'i'));
    if (m) return { v: _num(m[1]), ccy: m[2].toUpperCase() };
    m = s.match(new RegExp('\\b(' + CCY_RE + ')\\s*([\\d,]+(?:\\.\\d+)?)', 'i'));
    if (m) return { v: _num(m[2]), ccy: m[1].toUpperCase() };
    m = s.match(/([\d,]+(?:\.\d+)?)\s*円/);
    if (m) return { v: _num(m[1]), ccy: 'JPY' };
    return null;
  }

  // 課税・非課税の判定（本文の語から）。戻り値 'on'＝課税／'off'＝非課税／null＝判定できない。
  //  非課税：非課税・免税・不課税・課税対象外
  //  課税  ：[課税]・（課税）・課税対象・空白で区切られた「課税」・税別・消費税別・別途消費税
  // 「課税価格」「保税」など別の語の一部は拾わない。非課税の語を優先する。
  const _TAX_OFF_RE = /非課税|免税|不課税|課税対象外/;
  const _TAX_ON_RE  = /課税対象|[［\[（(]\s*課税\s*[］\]）)]|(^|[\s　])課税(?=[\s　]|$)|税別|消費税別|別途消費税/;
  function _taxOf(text) {
    const t = String(text || '');
    if (_TAX_OFF_RE.test(t)) return 'off';
    if (_TAX_ON_RE.test(t)) return 'on';
    return null;
  }
  // 品名に混ざった課税区分の目印（括弧書き・空白区切りの語）を取り除く
  const _TAX_PAREN_RE = /[［\[（(]\s*(非課税|免税|不課税|課税対象外|課税対象|課税|税別|消費税別|別途消費税)\s*[］\]）)]/g;
  const _TAX_BARE_RE  = /(^|[\s　])(非課税|免税|不課税|課税対象外|課税対象|課税|税別|消費税別)(?=[\s　]|$)/g;
  function _stripTaxMarks(body) {
    return body.replace(_TAX_PAREN_RE, ' ').replace(_TAX_BARE_RE, ' ');
  }

  function inferCat(name) {
    for (const h of CAT_HINTS) if (h.re.test(name)) return h.cat;
    return '';
  }

  // ====== 本文パーサー ======
  // 戻り値：{ fields: {customer, ref, validUntil}, entries: [{_kind:'group'|'item', ...}] }
  function parseQuoteEmail(text) {
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const fields = {};
    const entries = [];
    let inScope = false;   // 【作業範囲】以降は明細抽出しない
    // リマーク候補：{ text, itemIdx }（itemIdx＝付ける明細の番号（明細だけ数えた 0 始まり）。null＝全体リマーク）
    //  ・【リマーク】（【備考】【注記】）の見出し以降の行（次の【見出し】か罫線まで）＝全体リマーク（「品名：注記」なら該当の明細へ）
    //  ・行頭が「※」の行＝直前の行が明細ならその明細へ、そうでなければ全体リマーク
    //  ・行末の「※備考」は従来どおり、その明細行の備考（remarks には入れない）
    const remarks = [];
    let inRemarks = false;
    let itemCount = 0;
    let lastItemIdx = -1;   // 直前の行が明細だったとき、その明細の番号
    const pushItem = o => { entries.push(o); lastItemIdx = itemCount; itemCount++; };
    const _AUTO_NOTE_RE = /為替レートにより請求金額が変動|「〜」で幅を示した項目を含むため/;   // 本アプリが自動で付ける注記は、取り込まない
    const pushRemark = (raw, itemIdx) => {
      const text = String(raw || '').replace(/^[・･\-\*●○※\s　]+/, '').trim();
      if (!text || _AUTO_NOTE_RE.test(text)) return;
      if (remarks.some(r => r.text === text && r.itemIdx === itemIdx)) return;
      remarks.push({ text, itemIdx: itemIdx == null ? null : itemIdx });
    };

    // 冒頭の宛先（「〇〇 様 / 御中」）を顧客名として拾う
    for (let i = 0; i < Math.min(lines.length, 6); i++) {
      const t = lines[i].trim();
      if (!t) continue;
      const m = t.match(/^(.{1,40}?)[　\s]*(様|御中|殿)$/);
      if (m) { fields.customer = m[1].trim(); }
      break;
    }

    lines.forEach(raw => {
      const line = raw.replace(/\s+$/, '');
      const t = line.trim();
      if (!t) { lastItemIdx = -1; return; }   // 空行をはさんだ「※」は、直前の明細の注記にしない（全体リマーク）
      const prevItem = lastItemIdx; lastItemIdx = -1;   // 明細の直後だけ「※…」をその明細の注記として扱う

      // ヘッダー項目
      let m = t.match(/^【見積番号】\s*(.+)$/);            if (m) { fields.ref = m[1].trim(); return; }
      m = t.match(/^【有効期限】\s*([\d/\-年月日\.]+)/);   if (m) { fields.validUntil = m[1].trim().replace(/\//g, '-').replace(/年|月/g, '-').replace(/日/, '').replace(/--/g, '-'); return; }
      m = t.match(/^【(?:全体)?(?:リマーク|備考|注記)】\s*(.*)$/);
      if (m) { inRemarks = true; inScope = false; if (m[1]) pushRemark(m[1], null); return; }
      if (/^【作業範囲】/.test(t)) { inScope = true; inRemarks = false; return; }
      if (/^【/.test(t)) { inScope = false; inRemarks = false; return; }
      if (inScope) return;
      if (inRemarks) {
        if (/^[─═―_\-=]{4,}/.test(t)) { inRemarks = false; return; }   // 罫線でブロックを終える
        pushRemark(t, null); return;
      }

      // グループ見出し 《…》
      m = t.match(/^《(.+)》$/);
      if (m) { entries.push({ _kind: 'group', label: m[1].trim() }); return; }

      // スキップ：罫線・サマリ・署名・注記
      if (/^[─═―_\-=]{4,}/.test(t)) return;
      if (/^(　)?(小計|課税対象小計|御見積額|消費税|仕入合計|売値合計|合計)/.test(t)) return;
      if (/^※/.test(t)) { pushRemark(t, prevItem >= 0 ? prevItem : null); lastItemIdx = prevItem; return; }   // 続く「※」も同じ明細へ
      if (/^(■(?!.*[×＝])|TEL|FAX|Mail|E-?mail)/i.test(t)) return;
      // サマリの区間行（ラベル＋空白＋¥金額のみ）は明細と重複するためスキップ
      if (/^　.+\s{2,}[¥￥][\d,]+$/.test(line)) return;

      // 実費行（自形式）：・NAME …… 実費
      const isBullet = /^[・･\-\*●○]/.test(t);
      let body = t.replace(/^[・･\-\*●○]\s*/, '');

      // 備考（※…）を分離
      let note = '';
      m = body.match(/※\s*(.+)$/);
      if (m) { note = m[1].trim(); body = body.slice(0, m.index).trim(); }

      // フラグ抽出
      // 課税／非課税：行の語（[課税]・課税対象・税別・非課税・免税 等）→ 無ければ備考の語から判定
      let tax = _taxOf(body);
      if (tax === null) tax = _taxOf(note);
      const taxed  = tax === 'on';
      const cond   = /（発生時\/必要時のみ）/.test(body);
      const refFlg = /（参考情報）/.test(body);
      body = _stripTaxMarks(body).replace(/（発生時\/必要時のみ）|（参考情報）/g, ' ').replace(/\s+/g, ' ').trim();

      // パターンA（自形式・高確度）：NAME  qty [unit] × price ＝ amount
      m = body.match(new RegExp(
        '^(.+?)\\s+([\\d,]+(?:\\.\\d+)?)\\s*([^\\s×xX]*)\\s*[×xX]\\s*(.+?)\\s*[＝=]\\s*(.+)$'
      ));
      if (m) {
        const price = parseMoney(m[4]);
        const amt   = parseMoney(m[5]);
        if (price || amt) {
          pushItem({
            _kind: 'item', conf: 'high',
            name: m[1].trim(), qty: _num(m[2]) ?? 1, unit: (m[3] || '').trim(),
            ccy: (price || amt).ccy, price: price ? price.v : (amt ? amt.v / (_num(m[2]) || 1) : null),
            taxed, taxSrc: tax, cond, ref: refFlg, note,
          });
          return;
        }
      }

      // パターンB（自形式・実費）
      if (/(^|\s)実費(\s|$)/.test(body)) {
        const nm2 = body.replace(/(^|\s)実費(\s|$)/, ' ').replace(/\s+/g, ' ').trim();
        if (nm2) {
          pushItem({ _kind: 'item', conf: 'high', name: nm2, qty: '', unit: '', ccy: 'JPY', price: null, actual: true, taxed, taxSrc: tax, cond, ref: refFlg, note });
          return;
        }
      }

      // パターンC（一般自由文・低確度）：行内の最後の金額を採用
      const money = parseMoney(body);
      if (money && money.v != null) {
        // 金額部分と数量・単位らしき断片を除いた残りを品名に
        let nm3 = body
          .replace(new RegExp('[¥￥]\\s?[\\d,]+(?:\\.\\d+)?', 'g'), ' ')
          .replace(new RegExp('([\\d,]+(?:\\.\\d+)?)\\s*(' + CCY_RE + ')\\b', 'gi'), ' ')
          .replace(new RegExp('\\b(' + CCY_RE + ')\\s*[\\d,]+(?:\\.\\d+)?', 'gi'), ' ')
          .replace(/([\d,]+(?:\.\d+)?)\s*円/g, ' ')
          .replace(/[：:／/]+\s*$/, '')
          .replace(/\s+/g, ' ').trim();
        // 数量 単位（例 "2 R/T" / "1 B/L"）が残っていれば拾う
        let qty = 1, unit = '';
        const qm = nm3.match(/\s([\d.,]+)\s*(R\/T|RT|CBM|M3|KGS?|CNTR|B\/L|BL|SHPT|VAN|件|台|本|枚|式|梱|才|20'?\S*|40'?\S*)$/i);
        if (qm) { qty = _num(qm[1]) ?? 1; unit = qm[2]; nm3 = nm3.slice(0, qm.index).trim(); }
        if (nm3 && !/^(以上|宜しく|よろしく|お願い|下記|毎度|拝啓|敬具)/.test(nm3)) {
          pushItem({
            _kind: 'item', conf: isBullet ? 'mid' : 'low',
            name: nm3, qty, unit, ccy: money.ccy, price: money.v / (qty || 1),
            taxed, taxSrc: tax, cond, ref: refFlg, note,
          });
        }
      }
    });

    // 「品名：注記」の形のリマークは、その品名の明細へ付ける（品名は大文字小文字・空白の違いを無視して、含む・含まれるで照合）
    const items = entries.filter(e => e._kind === 'item');
    const nz = v => String(v || '').toLowerCase().replace(/[\s　]+/g, '');
    remarks.forEach(r => {
      if (r.itemIdx != null) return;
      const mm = r.text.match(/^[［\[【]?\s*(.{2,40}?)\s*[］\]】]?\s*[:：]\s*(.+)$/);
      if (!mm) return;
      const key = nz(mm[1]);
      if (key.length < 2) return;
      const idx = items.findIndex(it => { const n = nz(it.name); return n && (n === key || n.includes(key) || key.includes(n)); });
      if (idx >= 0) { r.itemIdx = idx; r.text = mm[2].trim(); }
    });

    return { fields, entries, remarks };
  }

  // ====== レビュー UI ======
  let _parsed = null;   // { fields, entries }

  function openEmailImport() {
    _setStoreOnly(false);
    _curEntryId = null;
    _fromEntry(false);
    document.getElementById('emailImportModal')?.classList.add('open');
    setTimeout(() => document.getElementById('eiText')?.focus(), 60);
  }
  function closeEmailImport() {
    document.getElementById('emailImportModal')?.classList.remove('open');
    _setStoreOnly(false);
    _curEntryId = null;
    _fromEntry(false);
  }

  // ====== 📝 保管した自由入力（案件ごとに複数件）／📩 未取込 ======
  // 案件データの fields['qf-free-entries']（hidden #qf-free-entries・JSON 配列）に持つ（列追加・SQL 不要）。
  //   1 件 = { id, text, label, at(ISO), by(email), status:'pending'|'done' }
  // 旧形式（#qf-import-src の原文のみ・明細なしの案件）は、読むときに 1 件の未取込として扱う（id:'legacy'）。
  const _NM_IDX = CELL_FIELDS.indexOf('nm') + 1;   // 品名のある明細行の列位置（cells[0] は選択チェック）

  function _rowsHaveName(rows) {
    return (Array.isArray(rows) ? rows : []).some(r => Array.isArray(r) ||
      (r && r._type === 'data' && Array.isArray(r.cells) && String(r.cells[_NM_IDX] ?? '').trim() !== ''));
  }
  function _parseEntries(json) {
    try {
      const a = JSON.parse(json || '[]');
      return Array.isArray(a) ? a.filter(e => e && String(e.text || '').trim()) : [];
    } catch (e) { return []; }
  }
  // 旧形式の原文（明細が無いときだけ）
  function _legacyEntry(src, hasRows) {
    try {
      if (!src || hasRows) return null;
      const o = JSON.parse(src);
      if (!o || !String(o.rawText || '').trim()) return null;
      return { id: 'legacy', text: String(o.rawText), label: '', at: o.importedAt || '', by: '', status: 'pending' };
    } catch (e) { return null; }
  }

  // 案件データ（保存形式）の保管済み自由入力すべて
  function eiFreeEntriesOf(data) {
    const f = (data && data.fields) || {};
    const list = _parseEntries(f['qf-free-entries']);
    if (!list.length) {
      const lg = _legacyEntry(f['qf-import-src'], _rowsHaveName(data && data.rows));
      if (lg) list.push(lg);
    }
    return list;
  }
  // 未取込のもの（無ければ null）。ダッシュボードの印・タイル・絞り込みが使う
  function eiPendingOf(data) {
    const p = eiFreeEntriesOf(data).filter(e => e.status !== 'done');
    return p.length ? p : null;
  }

  function _liveEntryEl() { return document.getElementById('qf-free-entries'); }
  function _liveRowsHaveName() {
    return Array.from(document.querySelectorAll('#tableBody tr:not([data-virtual]):not([data-type]) [data-field="nm"]'))
      .some(i => String(i.value || '').trim() !== '');
  }
  // いま画面に開いている見積の保管済み自由入力。旧形式は 1 件へ移して持たせる（変更扱いにはしない）
  function _liveEntries() {
    const el = _liveEntryEl();
    if (!el) return [];
    let list = _parseEntries(el.value);
    if (!list.length) {
      const lg = _legacyEntry(document.getElementById('qf-import-src')?.value, _liveRowsHaveName());
      if (lg) { list = [lg]; el.value = JSON.stringify(list); }
    }
    return list;
  }
  function _saveLiveEntries(list) {
    const el = _liveEntryEl();
    if (el) el.value = JSON.stringify(list);
    _markDirty();
    eiRefreshPendingBanner();
  }
  function eiMakeEntry(o) {
    return {
      id: 'fe' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      text: String(o.text || '').slice(0, 20000),
      label: String(o.label || '').trim().slice(0, 80),
      at: new Date().toISOString(),
      by: (typeof window.cloudCurrentEmail === 'function' && window.cloudCurrentEmail()) || '',
      status: 'pending',
    };
  }

  function _isViewMode() {
    return !!document.getElementById('tab-quote-make')?.classList.contains('qmode-view');
  }
  // 閲覧モードで開いた案件なら、先に編集を開始（ロック取得）する。編集できる状態なら true
  async function _ensureEdit() {
    if (_isViewMode() && typeof window.quoteModeEdit === 'function') await window.quoteModeEdit();
    return !_isViewMode();
  }

  const _fmtAt = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  };
  const _whoName = em => (em && typeof window.cloudNameFor === 'function') ? window.cloudNameFor(em) : (em || '');
  const _firstLine = t => {
    const l = String(t || '').split(/\r?\n/).map(x => x.trim()).find(Boolean) || '';
    return l.length > 40 ? l.slice(0, 40) + '…' : l;
  };

  // 編集画面の「📝 保管した自由入力」欄（.quote-main の外＝閲覧モードでも押せる）
  function eiRefreshPendingBanner() {
    const box = document.getElementById('eiFreePanel');
    if (!box) return;
    const list = _liveEntries();
    box.hidden = !list.length;
    if (!list.length) return;
    const pend = list.filter(e => e.status !== 'done').length;
    const keepOpen = box.open;
    const sum = box.querySelector('.ei-fp-sum');
    if (sum) sum.innerHTML = '📝 保管した自由入力 <b>' + list.length + '件</b>' +
      (pend ? ' <span class="ei-fp-pend">📩 未取込 ' + pend + '件</span>' : ' <span class="ei-fp-alldone">✅ すべて取込済み</span>');
    const body = box.querySelector('.ei-fp-list');
    if (body) body.innerHTML = list.map(e => {
      const done = e.status === 'done';
      const id = _esc(e.id);
      return '<div class="ei-fe-row' + (done ? ' is-done' : '') + '" data-id="' + id + '">' +
        '<span class="ei-fe-chip ' + (done ? 'done' : 'pending') + '">' + (done ? '✅ 取込済み' : '📩 未取込') + '</span>' +
        '<span class="ei-fe-label">' + _esc(e.label || _firstLine(e.text)) + '</span>' +
        '<span class="ei-fe-meta">' + _esc([_whoName(e.by), _fmtAt(e.at)].filter(Boolean).join('・')) + '</span>' +
        '<span class="ei-fe-btns">' +
          '<button type="button" class="ei-fe-btn ei-fe-import" onclick="eiFeImport(\'' + id + '\')" title="この原文を解析して、表に取り込みます">取り込む</button>' +
          '<button type="button" class="ei-fe-btn" onclick="eiFeView(\'' + id + '\')">原文</button>' +
          '<button type="button" class="ei-fe-btn" onclick="eiFeToggle(\'' + id + '\')">' + (done ? '未取込に戻す' : '取込済みにする') + '</button>' +
          '<button type="button" class="ei-fe-btn ei-fe-del" onclick="eiFeDelete(\'' + id + '\')">削除</button>' +
        '</span>' +
        '<pre class="ei-fe-text" hidden>' + _esc(e.text) + '</pre>' +
      '</div>';
    }).join('');
    // 未取込があれば開いておく（開閉は利用者の操作を優先して、再描画では変えない）
    if (!keepOpen && pend && !box.dataset.touched) box.open = true;
  }

  async function eiFeImport(id) {
    const e = _liveEntries().find(x => x.id === id);
    if (!e) return;
    if (!(await _ensureEdit())) return;   // 他メンバーが作業中など、編集できなければ中止
    _setStoreOnly(false);
    _curEntryId = id;
    _fromEntry(true);
    document.getElementById('eiText').value = e.text;
    document.getElementById('emailImportModal')?.classList.add('open');
    eiParse();
  }
  function eiFeView(id) {
    const pre = document.querySelector('#eiFreePanel .ei-fe-row[data-id="' + id + '"] .ei-fe-text');
    if (pre) pre.hidden = !pre.hidden;
  }
  async function eiFeToggle(id) {
    if (!(await _ensureEdit())) return;
    _saveLiveEntries(_liveEntries().map(e => e.id === id ? Object.assign({}, e, { status: e.status === 'done' ? 'pending' : 'done' }) : e));
  }
  async function eiFeDelete(id) {
    const e = _liveEntries().find(x => x.id === id);
    if (!e) return;
    const ask = (typeof window.uiConfirm === 'function')
      ? window.uiConfirm({ title: '保管した自由入力を削除しますか？', lines: ['「' + (e.label || _firstLine(e.text)) + '」を削除します。'], irreversible: '保存すると元に戻せません。', okLabel: '削除する', danger: true })
      : Promise.resolve(confirm('保管した自由入力を削除しますか？'));
    if (!(await ask)) return;
    if (!(await _ensureEdit())) return;
    _saveLiveEntries(_liveEntries().filter(x => x.id !== id));
  }
  // 未取込が 1 件ならそのまま取り込みを始め、複数なら一覧を開いて選んでもらう（ダッシュボードのカードから）
  async function eiOpenStored() {
    const pend = _liveEntries().filter(e => e.status !== 'done');
    if (!pend.length) { if (window.quoteShowToast) quoteShowToast('ℹ️ 取り込める保管済みの原文がありません', 'info'); return; }
    if (pend.length === 1) { await eiFeImport(pend[0].id); return; }
    const box = document.getElementById('eiFreePanel');
    if (box) { box.open = true; box.scrollIntoView({ block: 'center' }); }
  }

  // 取り込み元の表示（保管した原文から取り込むときは「新規案件として展開」を隠す）
  let _curEntryId = null;
  function _fromEntry(on) {
    document.getElementById('emailImportBox')?.classList.toggle('ei-from-entry', !!on);
  }

  // 保管専用表示（解析・挿入まわりを隠す）。mode：'new'＝新しい案件（お客様・件名）／'case'＝既存の案件（メモだけ）
  let _storeTarget = null;   // { kind:'new' } | { kind:'current' } | { kind:'card', id }
  function _setStoreOnly(on, target) {
    const box = document.getElementById('emailImportBox');
    if (box) {
      box.classList.toggle('ei-store-only', !!on);
      box.classList.toggle('ei-store-case', !!on && !!target && target.kind !== 'new');
    }
    _storeTarget = on ? (target || { kind: 'new' }) : null;
    const h = document.getElementById('eiTitle');
    if (h) h.textContent = on ? '📝 自由入力で保管（あとで取り込む）' : '📩 メール取込（見積データ化）';
    const d = document.getElementById('eiDesc');
    if (d) d.textContent = on
      ? ((target && target.kind !== 'new')
          ? '提示した見積の内容（メール本文・メモ・金額など、書式は自由）をそのまま貼り付けて、この案件に保管します。案件を開くと一覧に出て、あとで表に取り込めます。'
          : '提示した見積の内容（メール本文・メモ・金額など、書式は自由）をそのまま貼り付けて保管します。保管した案件は「📩 未取込」として一覧に出るので、あとで開いて表に取り込めます。')
      : 'メールで提示した見積の本文を貼り付けて「解析」を押してください。自アプリのメール形式は高精度で復元でき、自由文も金額を含む行から明細候補を抽出します。';
  }
  function _openStoreModal(target) {
    const t = document.getElementById('eiText'); if (t) t.value = '';
    ['eiS-customer', 'eiS-memo', 'eiS-label'].forEach(id => { const e = document.getElementById(id); if (e) e.value = ''; });
    _parsed = null; _curEntryId = null; _fromEntry(false);
    const w = document.getElementById('eiReviewWrap'); if (w) w.innerHTML = '';
    const a = document.getElementById('eiActions'); if (a) a.hidden = true;
    _setStoreOnly(true, target);
    document.getElementById('emailImportModal')?.classList.add('open');
    setTimeout(() => document.getElementById('eiText')?.focus(), 60);
  }

  // ダッシュボードの「📝 自由入力で保管」：新しい案件として保管
  async function eiOpenStoreFromDashboard() {
    if (typeof window.cloudIsLoggedIn === 'function' && !window.cloudIsLoggedIn()) {
      if (window.quoteShowToast) quoteShowToast('⚠️ 保管するには先に Google でログインしてください', 'warn');
      return;
    }
    // 保管は新しい案件として保存する。編集画面に未保存の変更が残っていれば、先に保存／破棄を選んでもらう
    if (typeof window.cloudConfirmLeaveUnsaved === 'function' && !(await window.cloudConfirmLeaveUnsaved('自由入力の見積を保管する'))) return;
    _openStoreModal({ kind: 'new' });
  }
  // ダッシュボードのカードの「⋯」→「📝 自由入力を追加」：案件を開かずに、既存の案件へ保管
  function eiOpenStoreForCard(rawId) {
    if (typeof window.cloudIsLoggedIn === 'function' && !window.cloudIsLoggedIn()) {
      if (window.quoteShowToast) quoteShowToast('⚠️ 保管するには先に Google でログインしてください', 'warn');
      return;
    }
    _openStoreModal({ kind: 'card', id: rawId });
  }
  // 編集画面（⋯ メニュー・保管欄の「＋ 追加」）：開いている案件へ保管
  async function eiOpenStoreForCurrent() {
    if (!(await _ensureEdit())) return;
    _openStoreModal({ kind: 'current' });
  }

  // 案件に変更があったことを知らせる（モーダルの入力欄は未保存の数に入れないため、取り込み・保管の確定時に伝える）
  function _markDirty() {
    (_liveEntryEl() || document.getElementById('qf-import-src'))?.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // 「📝 原文のまま保管」
  //  ・新しい案件（ダッシュボード）：お客様名・件名つきで保存してダッシュボードへ戻る
  //  ・既存の案件のカード（ダッシュボード）：案件を開かずに保管を 1 件足す
  //  ・開いている案件（編集画面・メール取込の画面から）：保管を 1 件足して保存する
  async function eiStoreRaw() {
    const text = (document.getElementById('eiText')?.value || '').trim();
    if (!text) { if (window.quoteShowToast) quoteShowToast('⚠️ 保管する内容を貼り付けてください', 'warn'); return; }
    const tg = _storeTarget || { kind: 'current' };
    const val = id => document.getElementById(id)?.value.trim() || '';
    if (tg.kind === 'new') {
      if (typeof window.cloudStoreRawQuote !== 'function') return;
      const ok = await window.cloudStoreRawQuote({ customer: val('eiS-customer'), memo: val('eiS-memo'), rawText: text });
      if (ok) closeEmailImport();
      return;
    }
    if (tg.kind === 'card') {
      if (typeof window.cloudAddFreeEntry !== 'function') return;
      const ok = await window.cloudAddFreeEntry(tg.id, eiMakeEntry({ text, label: val('eiS-label') }));
      if (ok) closeEmailImport();
      return;
    }
    if (!(await _ensureEdit())) return;
    _saveLiveEntries(_liveEntries().concat(eiMakeEntry({ text, label: val('eiS-label') })));
    closeEmailImport();
    if (typeof window.cloudSaveCurrent === 'function') await window.cloudSaveCurrent({ stay: true });
  }

  function eiParse() {
    const text = document.getElementById('eiText')?.value || '';
    if (!text.trim()) { if (window.quoteShowToast) quoteShowToast('⚠️ メール本文を貼り付けてください', 'warn'); return; }
    _parsed = parseQuoteEmail(text);
    renderEiReview();
  }

  function _catOptions(sel) {
    const cats = (typeof getAllCategories === 'function') ? getAllCategories() : [];
    return '<option value="">—</option>' + cats.map(c =>
      `<option value="${_esc(c.value)}"${c.value === sel ? ' selected' : ''}>${_esc(c.label || c.value)}</option>`).join('');
  }

  function renderEiReview() {
    const wrap = document.getElementById('eiReviewWrap');
    if (!wrap || !_parsed) return;
    const { fields, entries } = _parsed;
    const items = entries.filter(e => e._kind === 'item');
    const rems = _parsed.remarks || [];
    if (!items.length && !rems.length) {
      wrap.innerHTML = '<div class="preset-empty">明細行を抽出できませんでした。<br><small>金額（¥1,234 / 100 USD 等）を含む行が対象です。書式を確認してください。</small></div>';
      document.getElementById('eiActions').hidden = true;
      return;
    }
    const confBadge = c => c === 'high' ? '<span class="ei-conf ei-conf-high" title="自アプリ形式として解析">高</span>'
                        : c === 'mid'  ? '<span class="ei-conf ei-conf-mid" title="箇条書き＋金額から推定">中</span>'
                                       : '<span class="ei-conf ei-conf-low" title="金額のみから推定。内容を確認してください">要確認</span>';
    let html = '';
    // ヘッダー項目
    html += '<div class="ei-fields">' +
      '<label>お客様 <input type="text" id="eiF-customer" value="' + _esc(fields.customer || '') + '"></label>' +
      '<label>REF# <input type="text" id="eiF-ref" value="' + _esc(fields.ref || '') + '"></label>' +
      '<label>有効期限 <input type="date" id="eiF-valid" value="' + _esc(fields.validUntil || '') + '"></label>' +
      '<label>サブコン一括設定 <input type="text" id="eiBulkSv" list="svSuggestions" placeholder="例）〇〇物流">' +
        '<button type="button" class="ei-bulk-sv-btn" onclick="eiApplyBulkSv()" title="入力したサブコン名を全行に反映します（個別に直したい行は挿入前に上書き可能）">全行に設定</button></label>' +
      '<label class="ei-sellmode-label" title="既存システムからの移植等、取り込む単価が「売値」しか分からない場合向け。チェックすると、取り込んだ単価は売単価として登録され、仕入単価は空欄になります。挿入後に見積テーブルで行ごとに「仕入単価」を入力すると、乗せ幅が自動で算出されます（売単価－仕入単価）。">' +
        '<input type="checkbox" id="eiSellMode"> 💰 単価を売値として取り込む（仕入を後で入力→乗せ幅を自動算出）</label>' +
      '</div>';
    if (!items.length) html += '<div class="ei-rem-only">💡 明細行は抽出できませんでした。リマークだけを取り込めます（下のリマーク候補）。</div>';
    if (items.length) html += '<table class="ei-table"><thead><tr>' +
      '<th><input type="checkbox" id="eiChkAll" checked onchange="eiToggleAll(this.checked)"></th>' +
      '<th>グループ</th><th>カテゴリ</th><th>サブコン</th><th>品名</th><th>数量</th><th>単位</th><th>通貨</th><th>単価</th><th class="ei-tax-th" title="課税対象の行にチェック。見出しのチェックで全行を一括切替">課税 <input type="checkbox" id="eiTaxAll" onchange="eiToggleAllTax(this.checked)"></th><th>フラグ</th><th>備考</th><th>確度</th>' +
      '</tr></thead><tbody>';
    let curGroup = '';
    let gi = -1;
    entries.forEach(e => {
      if (e._kind === 'group') { curGroup = e.label; return; }
      gi++;
      const cat = inferCat(e.name);
      const flags = (e.cond ? '都度 ' : '') + (e.ref ? '参考 ' : '') + (e.actual ? '実費' : '');
      html += `<tr data-gi="${gi}" class="ei-row ei-${e.conf}">` +
        `<td><input type="checkbox" class="ei-chk" checked></td>` +
        `<td class="ei-group-cell"><input type="text" class="ei-in ei-group" value="${_esc(curGroup)}" title="挿入時：小計行のラベル、かつ各行の「パターン（任意）」に登録されます（空欄可）">` +
        `<button type="button" class="ei-group-pattern-btn" title="同じグループのチェック済み行を「行パターン」として登録" onclick="eiSaveGroupAsPattern(this)">🔖</button></td>` +
        `<td><select class="ei-in ei-cat">${_catOptions(cat)}</select></td>` +
        `<td><input type="text" class="ei-in ei-sv" value="" list="svSuggestions" placeholder="任意"></td>` +
        `<td><input type="text" class="ei-in ei-name" value="${_esc(e.name)}"></td>` +
        `<td><input type="number" class="ei-in ei-qty" value="${e.qty ?? ''}" step="any"></td>` +
        `<td><input type="text" class="ei-in ei-unit" value="${_esc(e.unit || '')}"></td>` +
        `<td><input type="text" class="ei-in ei-ccy" value="${_esc(e.ccy || 'JPY')}" list="eiCcyList"></td>` +
        `<td><input type="number" class="ei-in ei-price" value="${e.price != null ? Math.round(e.price * 100) / 100 : ''}" step="any"></td>` +
        `<td class="ei-tax-cell"><input type="checkbox" class="ei-tax"${e.taxed ? ' checked' : ''} title="${e.taxSrc === 'on' ? '本文の語（[課税]・課税対象・税別 等）から課税と判定' : e.taxSrc === 'off' ? '本文の語（非課税・免税 等）から非課税と判定' : '判定できなかったため非課税（必要ならチェック）'}"></td>` +
        `<td class="ei-flags" title="解析されたフラグ（都度/参考/実費）">${_esc(flags.trim() || '—')}</td>` +
        `<td><input type="text" class="ei-in ei-note" value="${_esc(e.note || '')}"></td>` +
        `<td>${confBadge(e.conf)}</td>` +
        `</tr>`;
    });
    if (items.length) html += '</tbody></table>';
    html += _remarksHtml(items, rems);
    html += '<datalist id="eiCcyList">' + CCY_LIST.map(c => `<option value="${c}">`).join('') + '</datalist>';
    html += '<p class="ei-hint">💡 通常は単価が仕入・売の両方に入ります（粗利0）。仕入額が分かる場合は挿入後に修正してください。「💰 単価を売値として取り込む」をONにすると、単価は売値としてのみ登録され、挿入後に仕入単価を入力すれば乗せ幅が自動算出されます。「課税」列は本文の語（[課税]・課税対象・税別・非課税・免税 等）から判定した結果です。違う行はチェックで直してください。「要確認」行は品名・金額を必ず確認。</p>';
    wrap.innerHTML = html;
    document.getElementById('eiActions').hidden = false;
    _updateInsertTarget();
  }

  // 📝 リマーク候補（チェック・付ける先・文を直してから挿入）
  //  付ける先：「全体リマーク」（見積全体の条件・リマーク欄へ追記）／「明細：品名」（その明細行の備考へ追記）
  function _remarksHtml(items, rems) {
    if (!rems.length) return '';
    const opts = sel => '<option value="g"' + (sel == null ? ' selected' : '') + '>全体リマーク</option>' +
      items.map((it, gi) => '<option value="' + gi + '"' + (sel === gi ? ' selected' : '') + '>明細' + (gi + 1) + '：' + _esc(String(it.name || '').slice(0, 30)) + '</option>').join('');
    let h = '<div class="ei-remarks"><div class="ei-rem-head"><b>📝 リマーク候補</b>' +
      '<span class="ei-rem-hint">チェックしたものを挿入します。「付ける先」で、見積全体のリマーク欄／特定の明細の備考を選べます（文は直せます）。</span></div>' +
      '<table class="ei-rem-table"><thead><tr><th><input type="checkbox" id="eiRemAll" checked onchange="document.querySelectorAll(\'#eiReviewWrap .ei-rem-chk\').forEach(c=>{c.checked=this.checked})"></th><th>付ける先</th><th>内容</th></tr></thead><tbody>';
    rems.forEach((r, i) => {
      h += '<tr data-ri="' + i + '"><td><input type="checkbox" class="ei-rem-chk" checked></td>' +
        '<td><select class="ei-in ei-rem-to">' + opts(r.itemIdx) + '</select></td>' +
        '<td><input type="text" class="ei-in ei-rem-text" value="' + _esc(r.text) + '"></td></tr>';
    });
    return h + '</tbody></table></div>';
  }
  // チェックされたリマーク → { global: [文], perItem: { gi: [文] }, count }。付け先の明細が外されていれば全体へ（品名つき）
  function _gatherRemarks(checkedGi) {
    const items = (_parsed?.entries || []).filter(e => e._kind === 'item');
    const out = { global: [], perItem: {}, count: 0 };
    document.querySelectorAll('#eiReviewWrap .ei-remarks tbody tr').forEach(tr => {
      if (!tr.querySelector('.ei-rem-chk')?.checked) return;
      const text = (tr.querySelector('.ei-rem-text')?.value || '').trim();
      if (!text) return;
      const to = tr.querySelector('.ei-rem-to')?.value || 'g';
      out.count++;
      if (to === 'g') { out.global.push(text); return; }
      const gi = parseInt(to, 10);
      if (checkedGi.has(gi)) (out.perItem[gi] = out.perItem[gi] || []).push(text);
      else out.global.push((items[gi] && items[gi].name ? items[gi].name + '：' : '') + text);
    });
    return out;
  }
  // 全体リマーク欄（#remarkTextarea）へ追記。すでにある同じ文は重ねない（「※」・空白の違いは無視）。追記した件数を返す
  function _applyGlobalRemarks(lines) {
    const ta = document.getElementById('remarkTextarea');
    if (!ta || !lines.length) return 0;
    const norm = t => String(t || '').replace(/^[\s　]*※[\s　]*/, '').replace(/[\s　]+/g, '').toLowerCase();
    const have = new Set(ta.value.split('\n').map(norm).filter(Boolean));
    const add = [];
    lines.forEach(l => { const k = norm(l); if (k && !have.has(k)) { have.add(k); add.push(l.trim()); } });
    if (!add.length) return 0;
    const cur = ta.value.replace(/\s+$/, '');
    ta.value = (cur ? cur + '\n' : '') + add.join('\n');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof window.syncRemarkChips === 'function') window.syncRemarkChips();
    return add.length;
  }

  // 「この見積へ挿入」の挿入先（＝今エディタで開いている見積名）を明示
  function _updateInsertTarget() {
    const el = document.getElementById('eiInsertTarget');
    if (!el) return;
    const nameEl = document.getElementById('currentQuoteName');
    // currentQuoteName は hidden 属性で「新規見積」を表す。表示名があればそれを使う
    const label = (nameEl && !nameEl.hidden && nameEl.textContent.trim())
      ? nameEl.textContent.trim()
      : '📝 新規見積（未保存）';
    el.textContent = '挿入先 → ' + label;
  }

  function eiToggleAllTax(on) {
    document.querySelectorAll('#eiReviewWrap .ei-tax').forEach(c => { c.checked = on; });
  }
  function eiToggleAll(on) {
    document.querySelectorAll('#eiReviewWrap .ei-chk').forEach(c => { c.checked = on; });
  }

  // 「サブコン一括設定」：入力したサブコン名を表の全行へ反映（個別に違う行は挿入前に直接編集可）
  function eiApplyBulkSv() {
    const v = (document.getElementById('eiBulkSv')?.value || '').trim();
    if (!v) return;
    document.querySelectorAll('#eiReviewWrap .ei-sv').forEach(el => { el.value = v; });
  }

  // ====== 🤖 AI整形用プロンプト ======
  // 業者から受け取った見積（メール本文・PDFのテキスト・表など）を、Gemini/Copilot/
  // Claude/ChatGPT 等の汎用AIに渡して parseQuoteEmail() が高確度（ei-high）で読み取れる
  // 書式へ変換させるためのプロンプト。書式を変えたら _AI_PROMPT_EXAMPLE も含めて
  // parseQuoteEmail() の実際の挙動とズレないよう見直すこと。
  const AI_IMPORT_PROMPT =
`あなたはフォワーディング業務の見積書を整形するアシスタントです。以下に貼り付ける見積書（メール本文・PDFのテキスト・表など）を読み取り、次のフォーマット規則に厳密に従ってテキストに変換してください。

## 出力フォーマット

### 1. 明細行（1行1項目）
品名 数量 単位 × 単価 通貨 ＝ 金額 通貨

例：
海上運賃 1 40'GP × 1,680 USD ＝ 1,680 USD
THC 1 40FT × 20,000 JPY ＝ 20,000 JPY

・数量が不明／「一式」の場合は 1 としてください。
・単位は 20FT・40FT・KG・CBM・R/T・式 など分かる範囲で構いません（空欄でも可）。単位にスペースを含めないでください。
・単価と金額は必ず両方書いてください（数量×単価＝金額で計算が合うように）。
・× と ＝ は全角でも半角（x, =）でも構いません。

### 2. 金額未定の項目（実費）
品名 実費
例：ドレージ 実費
（数量・単価・金額は書かない。「実費」の前後は必ずスペースを空ける）

### 3. フラグ（分かる場合のみ、行末に付ける）
・課税対象 → [課税]
・都度発生（発生時のみ請求） → （発生時/必要時のみ）
・参考情報（合計に含めない） → （参考情報）

### 4. 備考
行末に ※備考の内容 の形式で追加してください。
例：通関手数料 1 式 × 12,000 JPY ＝ 12,000 JPY ※輸出通関一式

### 5. リマーク（注記）
・特定の明細だけに当てはまる注記は、上の「4. 備考」のとおり、その明細行の末尾に ※注記 を付けてください。
・見積全体に当てはまる注記（有効期限・為替の扱い・免責・支払条件・運賃やサーチャージの変動・別途費用・フリータイム など）は、明細行の下に【リマーク】という見出しだけの行を 1 つ作り、その下に 1 行 1 件で書いてください（行頭の ・ は付けても構いません）。
・全体の注記でも、特定の品名について書かれたものは「品名：注記」の形で書いてください（取り込み時にその明細へ付きます）。
・注記は原文の意味を変えず、1 件 1 行に簡潔にまとめてください。挨拶・署名・連絡先は注記に入れないでください。

例：
海上運賃 1 40'GP × 1,680 USD ＝ 1,680 USD ※Zero Freight
THC 1 40FT × 20,000 JPY ＝ 20,000 JPY

【リマーク】
・本見積の有効期限は発行から 14 日間です
・運賃・サーチャージは船社の改定により変動する場合があります
・THC：3 日間のフリータイムを含みます

### 6. グループ分け（コンテナサイズ等で内訳が分かれる場合）
区切りの直前に 《グループ名》 という行だけの見出しを入れてください。
例：
《20FTの場合》
（20FT分の明細行…）
《40FTの場合》
（40FT分の明細行…）

### 7. 除外するもの
小計・消費税・合計・御見積額などの集計行、挨拶・署名・連絡先（TEL/FAX/メールアドレス等）は出力しないでください。ただし注記は捨てず、「5. リマーク」のとおり出力してください。

### 8. 任意（分かれば先頭に1行ずつ）
【見積番号】見積書に記載の番号
【有効期限】YYYY-MM-DD

## 厳守事項
出力は上記フォーマットの行のみとしてください。前置き・説明文・見出し（「以下が変換結果です」等）・番号付け・コードブロックの\`\`\`は付けないでください。そのままシステムへ貼り付けます。

---
（ここから下に、変換したい見積書の本文を貼り付けてください）
`;

  function eiCopyAiPrompt() {
    const done = () => { if (window.quoteShowToast) quoteShowToast('🤖 AI整形用プロンプトをコピーしました。Gemini/Copilot/Claude/ChatGPT等に見積本文と一緒に貼り付けてください', 'success', 4500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(AI_IMPORT_PROMPT).then(done).catch(() => _eiCopyFallback(done));
    } else {
      _eiCopyFallback(done);
    }
  }
  function _eiCopyFallback(done) {
    const ta = document.createElement('textarea');
    ta.value = AI_IMPORT_PROMPT; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); done(); }
    catch (e) { if (window.quoteShowToast) quoteShowToast('⚠️ コピーに失敗しました', 'warn'); }
    finally { document.body.removeChild(ta); }
  }

  // レビュー表 → 行データ（cells 形式）へ変換。
  // グループは各行の pt（パターン。サブコン内の入れ子キー・row.js の _rowInnerKey）へ
  // そのまま登録する。これにより挿入後の編集画面で「20'コンテナの場合」等のグループが
  // 自動的にパターン単位の小計（仕入合計・売値合計・粗利率）としてまとまるため、
  // 別途グループ変更のたびに小計行（_type:'subtotal'）を差し込む必要はない。
  // 明細（チェックの入った行）の番号の集合
  function _checkedItemSet() {
    const s = new Set();
    document.querySelectorAll('#eiReviewWrap .ei-table tbody tr').forEach(tr => {
      if (tr.querySelector('.ei-chk')?.checked) s.add(parseInt(tr.dataset.gi, 10));
    });
    return s;
  }
  function _gatherReviewRows() {
    const items = (_parsed?.entries || []).filter(e => e._kind === 'item');
    // 売値として取り込む（既存システムからの移植等、売値しか分からない場合向け）：
    // 取り込んだ単価を売単価(bp)のみに入れ、仕入単価(pp)は空欄のまま「売値ベースモード」
    // （ppmode='sell'、row.js の _setSellModeUI/_calcFromSell）にしておく。
    // 挿入後に見積テーブルで仕入単価(pp)を入力すると、乗せ幅(mk)が自動算出される
    const sellMode = document.getElementById('eiSellMode')?.checked;
    const out = [];
    const rem = _gatherRemarks(_checkedItemSet());
    document.querySelectorAll('#eiReviewWrap .ei-table tbody tr').forEach(tr => {
      if (!tr.querySelector('.ei-chk')?.checked) return;
      const gi = parseInt(tr.dataset.gi, 10);
      const src = items[gi] || {};
      const v = cls => tr.querySelector('.' + cls)?.value ?? '';
      const group = v('ei-group').trim();
      const cells = [false];
      const price = v('ei-price');
      const useSell = sellMode && !src.actual;
      const f = {
        cat: v('ei-cat'), sv: v('ei-sv').trim(), tx: !!tr.querySelector('.ei-tax')?.checked, nm: v('ei-name').trim(),
        pq: v('ei-qty'), un: v('ei-unit').trim(), bq: v('ei-qty'),
        pc: (v('ei-ccy').trim().toUpperCase() || 'JPY'), bc: (v('ei-ccy').trim().toUpperCase() || 'JPY'),
        pp: src.actual ? '' : (useSell ? '' : price), bp: src.actual ? '' : price,
        cd: '', mk: '', nt: [v('ei-note').trim()].concat(rem.perItem[gi] || []).filter(Boolean).join(' / '),
        zc: '', vf: '', vt: '', ac: src.actual ? '1' : '', pt: group,
        ps: '', co: src.cond ? '1' : '', lu: '', ppmode: useSell ? 'sell' : '', pprate: '', ppbase: '', uid: '', ppref: '',
        ri: src.ref ? '1' : '',
      };
      CELL_FIELDS.forEach(k => cells.push(f[k]));
      if (!f.nm) return;
      out.push({ _type: 'data', cells });
    });
    return out;
  }

  // レビュー表の1行 → 「行パターン」保存用のフラット形式（row_patterns.rows の要素）へ変換
  function _reviewRowToPatternObj(tr, src) {
    const v = cls => tr.querySelector('.' + cls)?.value ?? '';
    const ccy = (v('ei-ccy').trim().toUpperCase() || 'JPY');
    const price = src.actual ? '' : v('ei-price');
    return {
      _type: 'data',
      cat: v('ei-cat'), name: v('ei-name').trim(), taxed: !!tr.querySelector('.ei-tax')?.checked,
      pq: v('ei-qty'), un: v('ei-unit').trim(), pc: ccy, pp: price,
      bq: v('ei-qty'), bc: ccy, bp: price, mk: '', note: v('ei-note').trim(), sv: v('ei-sv').trim(),
    };
  }

  // グループの🔖ボタン：同じグループ名（現在の入力値）で、チェック済みの行だけを
  // 「行パターン」として登録するモーダルへ渡す（保存自体は ui.js 側の共通フロー）
  function eiSaveGroupAsPattern(btn) {
    const tr = btn.closest('tr');
    if (!tr) return;
    const group = (tr.querySelector('.ei-group')?.value || '').trim();
    if (!group) { if (window.quoteShowToast) quoteShowToast('⚠️ グループ名を入力してから登録してください', 'warn'); return; }
    const items = (_parsed?.entries || []).filter(e => e._kind === 'item');
    const rows = [];
    document.querySelectorAll('#eiReviewWrap .ei-table tbody tr').forEach(r => {
      if ((r.querySelector('.ei-group')?.value || '').trim() !== group) return;
      if (!r.querySelector('.ei-chk')?.checked) return;
      const gi = parseInt(r.dataset.gi, 10);
      const obj = _reviewRowToPatternObj(r, items[gi] || {});
      if (obj.name) rows.push(obj);
    });
    if (!rows.length) { if (window.quoteShowToast) quoteShowToast('⚠️ 「' + group + '」にチェック済みの行がありません', 'warn'); return; }
    if (typeof window.openRowPatternMgrWithRows === 'function') {
      window.openRowPatternMgrWithRows(rows, group);
    }
  }

  function _reviewFields() {
    return {
      customer: document.getElementById('eiF-customer')?.value.trim() || '',
      ref:      document.getElementById('eiF-ref')?.value.trim() || '',
      valid:    document.getElementById('eiF-valid')?.value || '',
    };
  }

  function _stampImportSource(stored) {
    const el = document.getElementById('qf-import-src');
    if (el) {
      el.value = JSON.stringify({
        type: 'email-paste',
        importedAt: new Date().toISOString(),
        ...(stored ? { stored: true } : {}),
        rawText: (document.getElementById('eiText')?.value || '').slice(0, 20000),
      });
    }
  }

  // 現在の見積へ行を挿入
  function eiInsertRows() {
    const rows = _gatherReviewRows();
    const rem = _gatherRemarks(_checkedItemSet());
    if (!rows.length && !rem.count) { if (window.quoteShowToast) quoteShowToast('⚠️ 挿入する行（またはリマーク）にチェックを入れてください', 'warn'); return; }
    if (typeof window.appendQuoteRows !== 'function') return;
    if (_isViewMode()) { if (window.quoteShowToast) quoteShowToast('🔒 閲覧モードです。「✏️ 編集」を押してから挿入してください', 'warn'); return; }
    const n = rows.length ? window.appendQuoteRows(rows) : 0;
    const remN = _applyGlobalRemarks(rem.global);
    // 保管した自由入力から取り込んだときは、その 1 件を取込済みにする（原文は案件に残る）。
    // それ以外（貼り付けから直接）は、原文を案件の取込元メモ（#qf-import-src）に残す
    const doneId = _curEntryId;
    if (doneId) _saveLiveEntries(_liveEntries().map(e => e.id === doneId ? Object.assign({}, e, { status: 'done' }) : e));
    else _stampImportSource();
    _markDirty();
    // appendQuoteRows() 自体はサブコン／パターンの入れ子グループ（見出し・小計の仮想行）を
    // 再描画しないため、ここで明示的に呼ぶ。呼ばないと pt（パターン）へ登録したグループが
    // 画面上には反映されず、他の操作で偶然再描画されるまで見えないままになる。
    if (typeof renderSubconGroups === 'function') renderSubconGroups();
    closeEmailImport();
    eiRefreshPendingBanner();
    if (typeof window.qpShowEditor === 'function') window.qpShowEditor();
    if (window.quoteShowToast) quoteShowToast('📩 メールから ' + n + ' 行を挿入しました' + (rem.count ? '（リマーク ' + rem.count + ' 件：全体 ' + remN + ' 件・明細の備考 ' + Object.keys(rem.perItem).reduce((a, k) => a + rem.perItem[k].length, 0) + ' 件）' : ''), 'success');
  }

  // 新規案件として展開（入力中の内容はクリア）
  function eiApplyAsNew() {
    const rows = _gatherReviewRows();
    if (!rows.length) { if (window.quoteShowToast) quoteShowToast('⚠️ 展開する行にチェックを入れてください', 'warn'); return; }
    if (!confirm('入力中の内容を破棄して、取込内容を新規案件として展開しますか？')) return;
    if (typeof window.qpNewQuote === 'function') window.qpNewQuote();
    const hf = _reviewFields();
    const fields = {};
    if (hf.customer) fields['qf-customer'] = hf.customer;
    if (hf.ref)      fields['qf-ref'] = hf.ref;
    if (hf.valid)    fields['qf-valid-until'] = hf.valid;
    if (typeof window._applyQuoteData === 'function') {
      window._applyQuoteData({ fields, rows, _rowFormat: 'v3-mixed-rows' });
    } else if (typeof window.appendQuoteRows === 'function') {
      window.appendQuoteRows(rows);
    }
    _applyGlobalRemarks(_gatherRemarks(_checkedItemSet()).global);   // 全体リマークは新しい案件の全体リマーク欄へ（明細の備考は rows に入っている）
    _stampImportSource();
    _markDirty();
    // 内部メモに取込記録を残す
    const memo = document.getElementById('qf-memo');
    if (memo) {
      const stamp = '📩 メール取込（' + new Date().toLocaleString('ja-JP') + '）';
      memo.value = memo.value ? memo.value + '\n' + stamp : stamp;
    }
    closeEmailImport();
    eiRefreshPendingBanner();
    if (typeof window.qpShowEditor === 'function') window.qpShowEditor();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    if (window.quoteShowToast) quoteShowToast('📩 取込内容を新規案件として展開しました。内容を確認して保存してください', 'success', 4000);
  }

  Object.assign(window, {
    eiPendingOf, eiFreeEntriesOf, eiMakeEntry, eiRefreshPendingBanner, eiOpenStoreFromDashboard, eiOpenStoreForCard, eiOpenStoreForCurrent,
    eiOpenStored, eiStoreRaw, eiFeImport, eiFeView, eiFeToggle, eiFeDelete,
    openEmailImport, closeEmailImport, eiParse, eiToggleAll, eiToggleAllTax, eiInsertRows, eiApplyAsNew,
    eiSaveGroupAsPattern, eiApplyBulkSv, eiCopyAiPrompt,
    parseQuoteEmail,   // テスト・将来の AI パーサー差し替え用に公開
  });
})();
