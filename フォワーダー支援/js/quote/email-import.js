// ================================================================
//  📩 メール取込（フェーズ1：貼り付け＋ルールベース解析）
//  メール本文で提示した見積（自由文含む）を解析して行データ化し、
//  レビュー後に「現在の見積へ挿入」or「新規案件として展開」する。
//  ・自アプリ形式（quote-email.js の明細行）は高精度で逆変換
//  ・一般の自由文は金額・数量×単価パターンで抽出（低確度マーク付き）
//  ・原文は qf-import-src（hidden）に保存され案件データと一緒に永続化
//  依存（window 経由）：appendQuoteRows, _applyQuoteData, qpNewQuote,
//                       getAllCategories, quoteShowToast, qpShowEditor
// ================================================================
(function () {
  'use strict';

  // conditions.js の ROW_CELL_FIELDS と同順（cells[0]=選択チェック）。変更時は要同期
  const CELL_FIELDS = ['cat','sv','tx','nm','pq','un','bq','pc','bc','pp','bp','cd','mk','nt','zc','vf','vt','ac','pt','ps','co','lu','ppmode','pprate','ppbase','uid','ppref','ri'];

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
    { re: /配送|配達|DELIVERY|DRAYAGE|TRUCK|横持|陸送|チャーター/i,                cat: 'domestic-transport' },
    { re: /倉庫|保管|WAREHOUSE|STORAGE/i,                                          cat: 'warehouse' },
    { re: /梱包|PACKING|バンニング|VANNING/i,                                      cat: 'packing-cost' },
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
      if (!t) return;

      // ヘッダー項目
      let m = t.match(/^【見積番号】\s*(.+)$/);            if (m) { fields.ref = m[1].trim(); return; }
      m = t.match(/^【有効期限】\s*([\d/\-年月日\.]+)/);   if (m) { fields.validUntil = m[1].trim().replace(/\//g, '-').replace(/年|月/g, '-').replace(/日/, '').replace(/--/g, '-'); return; }
      if (/^【作業範囲】/.test(t)) { inScope = true; return; }
      if (/^【/.test(t)) { inScope = false; return; }
      if (inScope) return;

      // グループ見出し 《…》
      m = t.match(/^《(.+)》$/);
      if (m) { entries.push({ _kind: 'group', label: m[1].trim() }); return; }

      // スキップ：罫線・サマリ・署名・注記
      if (/^[─═―_\-=]{4,}/.test(t)) return;
      if (/^(　)?(小計|課税対象小計|御見積額|消費税|仕入合計|売値合計|合計)/.test(t)) return;
      if (/^(※|■(?!.*[×＝])|TEL|FAX|Mail|E-?mail)/i.test(t)) return;
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
      const taxed  = /［課税］|\[課税\]/.test(body);
      const cond   = /（発生時\/必要時のみ）/.test(body);
      const refFlg = /（参考情報）/.test(body);
      body = body.replace(/［課税］|\[課税\]|（発生時\/必要時のみ）|（参考情報）/g, ' ').replace(/\s+/g, ' ').trim();

      // パターンA（自形式・高確度）：NAME  qty [unit] × price ＝ amount
      m = body.match(new RegExp(
        '^(.+?)\\s+([\\d,]+(?:\\.\\d+)?)\\s*([^\\s×xX]*)\\s*[×xX]\\s*(.+?)\\s*[＝=]\\s*(.+)$'
      ));
      if (m) {
        const price = parseMoney(m[4]);
        const amt   = parseMoney(m[5]);
        if (price || amt) {
          entries.push({
            _kind: 'item', conf: 'high',
            name: m[1].trim(), qty: _num(m[2]) ?? 1, unit: (m[3] || '').trim(),
            ccy: (price || amt).ccy, price: price ? price.v : (amt ? amt.v / (_num(m[2]) || 1) : null),
            taxed, cond, ref: refFlg, note,
          });
          return;
        }
      }

      // パターンB（自形式・実費）
      if (/(^|\s)実費(\s|$)/.test(body)) {
        const nm2 = body.replace(/(^|\s)実費(\s|$)/, ' ').replace(/\s+/g, ' ').trim();
        if (nm2) {
          entries.push({ _kind: 'item', conf: 'high', name: nm2, qty: '', unit: '', ccy: 'JPY', price: null, actual: true, taxed, cond, ref: refFlg, note });
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
          entries.push({
            _kind: 'item', conf: isBullet ? 'mid' : 'low',
            name: nm3, qty, unit, ccy: money.ccy, price: money.v / (qty || 1),
            taxed, cond, ref: refFlg, note,
          });
        }
      }
    });

    return { fields, entries };
  }

  // ====== レビュー UI ======
  let _parsed = null;   // { fields, entries }

  function openEmailImport() {
    document.getElementById('emailImportModal')?.classList.add('open');
    setTimeout(() => document.getElementById('eiText')?.focus(), 60);
  }
  function closeEmailImport() {
    document.getElementById('emailImportModal')?.classList.remove('open');
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
    if (!items.length) {
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
      '</div>';
    html += '<table class="ei-table"><thead><tr>' +
      '<th><input type="checkbox" id="eiChkAll" checked onchange="eiToggleAll(this.checked)"></th>' +
      '<th>グループ</th><th>カテゴリ</th><th>品名</th><th>数量</th><th>単位</th><th>通貨</th><th>単価</th><th>フラグ</th><th>備考</th><th>確度</th>' +
      '</tr></thead><tbody>';
    let curGroup = '';
    let gi = -1;
    entries.forEach(e => {
      if (e._kind === 'group') { curGroup = e.label; return; }
      gi++;
      const cat = inferCat(e.name);
      const flags = (e.taxed ? '課税 ' : '') + (e.cond ? '都度 ' : '') + (e.ref ? '参考 ' : '') + (e.actual ? '実費' : '');
      html += `<tr data-gi="${gi}" class="ei-row ei-${e.conf}">` +
        `<td><input type="checkbox" class="ei-chk" checked></td>` +
        `<td><input type="text" class="ei-in ei-group" value="${_esc(curGroup)}" title="小計行のラベルとして挿入（空欄可）"></td>` +
        `<td><select class="ei-in ei-cat">${_catOptions(cat)}</select></td>` +
        `<td><input type="text" class="ei-in ei-name" value="${_esc(e.name)}"></td>` +
        `<td><input type="number" class="ei-in ei-qty" value="${e.qty ?? ''}" step="any"></td>` +
        `<td><input type="text" class="ei-in ei-unit" value="${_esc(e.unit || '')}"></td>` +
        `<td><input type="text" class="ei-in ei-ccy" value="${_esc(e.ccy || 'JPY')}" list="eiCcyList"></td>` +
        `<td><input type="number" class="ei-in ei-price" value="${e.price != null ? Math.round(e.price * 100) / 100 : ''}" step="any"></td>` +
        `<td class="ei-flags" title="解析されたフラグ（課税/都度/参考/実費）">${_esc(flags.trim() || '—')}</td>` +
        `<td><input type="text" class="ei-in ei-note" value="${_esc(e.note || '')}"></td>` +
        `<td>${confBadge(e.conf)}</td>` +
        `</tr>`;
    });
    html += '</tbody></table>';
    html += '<datalist id="eiCcyList">' + CCY_LIST.map(c => `<option value="${c}">`).join('') + '</datalist>';
    html += '<p class="ei-hint">💡 単価は仕入・売の両方に入ります（粗利0）。仕入額が分かる場合は挿入後に修正してください。「要確認」行は品名・金額を必ず確認。</p>';
    wrap.innerHTML = html;
    document.getElementById('eiActions').hidden = false;
  }

  function eiToggleAll(on) {
    document.querySelectorAll('#eiReviewWrap .ei-chk').forEach(c => { c.checked = on; });
  }

  // レビュー表 → 行データ（cells 形式 + 小計行）へ変換
  function _gatherReviewRows() {
    const items = (_parsed?.entries || []).filter(e => e._kind === 'item');
    const out = [];
    let lastGroup = null;
    const flushGroup = () => { if (lastGroup) { out.push({ _type: 'subtotal', label: lastGroup }); lastGroup = null; } };
    document.querySelectorAll('#eiReviewWrap tbody tr').forEach(tr => {
      if (!tr.querySelector('.ei-chk')?.checked) return;
      const gi = parseInt(tr.dataset.gi, 10);
      const src = items[gi] || {};
      const v = cls => tr.querySelector('.' + cls)?.value ?? '';
      const group = v('ei-group').trim();
      // グループが変わったら直前グループの小計行を差し込む
      if (lastGroup !== null && group !== lastGroup) flushGroup();
      const cells = [false];
      const f = {
        cat: v('ei-cat'), sv: '', tx: !!src.taxed, nm: v('ei-name').trim(),
        pq: v('ei-qty'), un: v('ei-unit').trim(), bq: v('ei-qty'),
        pc: (v('ei-ccy').trim().toUpperCase() || 'JPY'), bc: (v('ei-ccy').trim().toUpperCase() || 'JPY'),
        pp: src.actual ? '' : v('ei-price'), bp: src.actual ? '' : v('ei-price'),
        cd: '', mk: '', nt: v('ei-note').trim(),
        zc: '', vf: '', vt: '', ac: src.actual ? '1' : '', pt: '',
        ps: '', co: src.cond ? '1' : '', lu: '', ppmode: '', pprate: '', ppbase: '', uid: '', ppref: '',
        ri: src.ref ? '1' : '',
      };
      CELL_FIELDS.forEach(k => cells.push(f[k]));
      if (!f.nm) return;
      out.push({ _type: 'data', cells });
      lastGroup = group || null;
    });
    flushGroup();
    return out;
  }

  function _reviewFields() {
    return {
      customer: document.getElementById('eiF-customer')?.value.trim() || '',
      ref:      document.getElementById('eiF-ref')?.value.trim() || '',
      valid:    document.getElementById('eiF-valid')?.value || '',
    };
  }

  function _stampImportSource() {
    const el = document.getElementById('qf-import-src');
    if (el) {
      el.value = JSON.stringify({
        type: 'email-paste',
        importedAt: new Date().toISOString(),
        rawText: (document.getElementById('eiText')?.value || '').slice(0, 20000),
      });
    }
  }

  // 現在の見積へ行を挿入
  function eiInsertRows() {
    const rows = _gatherReviewRows();
    if (!rows.length) { if (window.quoteShowToast) quoteShowToast('⚠️ 挿入する行にチェックを入れてください', 'warn'); return; }
    if (typeof window.appendQuoteRows !== 'function') return;
    const n = window.appendQuoteRows(rows);
    closeEmailImport();
    if (typeof window.qpShowEditor === 'function') window.qpShowEditor();
    if (window.quoteShowToast) quoteShowToast('📩 メールから ' + n + ' 行を挿入しました', 'success');
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
    _stampImportSource();
    // 内部メモに取込記録を残す
    const memo = document.getElementById('qf-memo');
    if (memo) {
      const stamp = '📩 メール取込（' + new Date().toLocaleString('ja-JP') + '）';
      memo.value = memo.value ? memo.value + '\n' + stamp : stamp;
    }
    closeEmailImport();
    if (typeof window.qpShowEditor === 'function') window.qpShowEditor();
    if (typeof scheduleAutoSave === 'function') scheduleAutoSave();
    if (window.quoteShowToast) quoteShowToast('📩 取込内容を新規案件として展開しました。内容を確認して保存してください', 'success', 4000);
  }

  Object.assign(window, {
    openEmailImport, closeEmailImport, eiParse, eiToggleAll, eiInsertRows, eiApplyAsNew,
    parseQuoteEmail,   // テスト・将来の AI パーサー差し替え用に公開
  });
})();
