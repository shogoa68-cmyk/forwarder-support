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

  // 全角の英数字・＄・，・．・／・＋ を半角へ（品名・金額の解析用。全角のカッコ・コロン等は他の判定が使うので触らない）
  function _fw(s) {
    return String(s == null ? '' : s)
      .replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/＄/g, '$').replace(/，/g, ',').replace(/．/g, '.').replace(/／/g, '/').replace(/＋/g, '+')
      .replace(/\\(?=\s?\d)/g, '¥');   // 円記号がバックスラッシュ（\850）で届くメール（日本語環境の ¥ は \ と同じ文字コード）
  }

  // ---- 金額の見つけ方（通貨記号・通貨コード・円／元、範囲「1,000〜1,200」に対応）----
  const _NUM = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)';
  const _CCY_ALL = CCY_RE + '|RMB';
  const _SYM_MAP = { 'US$': 'USD', '$': 'USD', 'HK$': 'HKD', 'NT$': 'TWD', 'SG$': 'SGD', 'S$': 'SGD', 'AU$': 'AUD', 'A$': 'AUD', '€': 'EUR', '£': 'GBP' };
  const _MONEY_SRC =
    '(?:(?<s1>[¥￥])\\s?(?<n1>' + _NUM.slice(1, -1) + '))' +
    '|(?:(?<s2>HK\\$|NT\\$|SG\\$|AU\\$|US\\$|S\\$|A\\$|\\$|€|£)\\s?(?<n2>' + _NUM.slice(1, -1) + '))' +
    '|(?:\\b(?<c3>' + _CCY_ALL + ')(?![A-Za-z])\\s?(?<n3>' + _NUM.slice(1, -1) + '))' +
    '|(?:(?<n4>' + _NUM.slice(1, -1) + ')\\s?(?<c4>' + _CCY_ALL + ')\\b)' +
    '|(?:(?<n5>' + _NUM.slice(1, -1) + ')\\s?(?<c5>円|元))';
  // 金額のすぐ後ろの「〜上限」（〜 ~ ～ - – to）。単位（20GP など）を範囲と取り違えないよう、直後に英数字が続くものは範囲にしない
  const _RANGE_RE = new RegExp('^\\s*(?:[〜~～]|[–—-]|\\bto\\b)\\s*(?:[¥￥$€£]|\\b(?:' + _CCY_ALL + ')\\b)?\\s?' + _NUM + '(?:\\s?(?:' + _CCY_ALL + '|円|元)\\b)?(?![A-Za-z0-9\'’])', 'i');
  const _MIN_PRE_RE = /[（(]?\s*(?:minimum|min\.?|最低料金|最低|ミニマム)\s*[:：]?\s*$/i;

  // 文字列の中の金額を前から順にすべて返す：[{v, hi, ccy, start, end}]（hi＝範囲の上限・無ければ null）
  function _findMoneyAll(s) {
    const out = [];
    const re = new RegExp(_MONEY_SRC, 'gi');
    let m;
    while ((m = re.exec(s))) {
      const g = m.groups;
      let ccy, num;
      if (g.n1) { ccy = 'JPY'; num = g.n1; }
      else if (g.n2) { ccy = _SYM_MAP[g.s2.toUpperCase()] || 'USD'; num = g.n2; }
      else if (g.n3) { ccy = g.c3.toUpperCase(); num = g.n3; }
      else if (g.n4) { ccy = g.c4.toUpperCase(); num = g.n4; }
      else { ccy = 'JPY'; num = g.n5; if (g.c5 === '元') ccy = 'CNY'; }
      if (ccy === 'RMB') ccy = 'CNY';
      const v = _num(num);
      let end = m.index + m[0].length, hi = null;
      const rm = _RANGE_RE.exec(s.slice(end));
      if (rm) { const h = _num(rm[1]); if (h != null && v != null && h > v) { hi = h; end += rm[0].length; } }
      out.push({ v, hi, ccy, start: m.index, end });
      re.lastIndex = end;
    }
    return out;
  }

  // 金額文字列 → {v, ccy}。'¥1,234' / '1,234.00 USD' / 'USD 1,234' / '$1,234' / '(¥1,234)' / '１，２３４円' に対応
  function parseMoney(str) {
    if (!str) return null;
    // カッコは空白に置き換える（消すと「1,200（20GP）」が「1,20020GP」とくっついて金額が壊れるため）
    const s = _fw(String(str).replace(/[()（）]/g, ' ')).trim();
    const t = _findMoneyAll(s)[0];
    return t ? { v: t.v, ccy: t.ccy } : null;
  }

  // ---- 単位・数量の見つけ方（「/20GP」「per 40HC」「(20GP)」「× 3台」「2×40'HC」）----
  // 20・40・45 は「'」かサイズ記号（GP/HC…）が付くときだけ単位（日付の「/20」などを単位と取り違えない）
  const _UNIT_SRC = "(?:(?:20|40|45)(?:\\s*['’]\\s*(?:GP|HC|HQ|DC|DV|ST|RF|RH|OT|FR|FT|TEU|FEU)?|\\s*(?:GP|HC|HQ|DC|DV|ST|RF|RH|OT|FR|FT|TEU|FEU))|R\\/T|RT|CBM|M3|M³|㎥|KGS?|MT|CNTR|CTR|CNT|CONTAINER|B\\/L|BL|SHPT|SHIPMENT|SHP|VAN|JOB|PKG|PLT|PALLET|CTN|PCS?|SET|BOX|TEU|FEU|件|台|本|枚|式|梱|才|個|便|回|コンテナ|ロット|口|パレット|トン|立米|DAY|WEEK|MONTH|YEAR|日|週|月|年|期)";
  const _UNIT_END = '(?![A-Za-z0-9])';
  const _PER_RE        = new RegExp('(?:\\/|\\bper\\b|あたり|につき|毎|@)\\s*(?:1\\s*)?(' + _UNIT_SRC + ')' + _UNIT_END, 'i');
  const _PERIOD_RE     = new RegExp('(?:^|\\s)\\/\\s*(DAY|WEEK|MONTH|YEAR|日|週|月|年|期)' + _UNIT_END, 'i');
  const _PAREN_UNIT_RE = new RegExp('[（(]\\s*(' + _UNIT_SRC + ')\\s*[）)]', 'i');
  const _LEAD_X_RE     = new RegExp('^\\s*(\\d+(?:\\.\\d+)?)\\s*[×xX]\\s*(' + _UNIT_SRC + ')' + _UNIT_END + '\\s*', 'i');
  const _TRAIL_X_RE    = new RegExp('(?:×|(?:^|[\\s)）])x)\\s*(\\d+(?:\\.\\d+)?)\\s*(' + _UNIT_SRC + ')?' + _UNIT_END + '\\s*$', 'i');
  const _CNTR_TAIL_RE  = /(?:^|\s)((?:20|40|45)\s*['’]?\s*(?:GP|HC|HQ|DC|DV|ST|RF|RH|OT|FR|FT))\s*$/i;
  const _fmtMoney = t => (t.ccy === 'JPY' ? '¥' : '') + t.v.toLocaleString('en-US') + (t.ccy === 'JPY' ? '' : ' ' + t.ccy);

  // 自由文 1 区切り（1 項目ぶん）→ { name, qty, unit, ccy, price, priceHi, minNote } ／ 金額が無ければ null
  //  ・「/20GP」「per 40HC」「(20GP)」「× 3台」「2×40'HC」があるときは、金額を“単価”として扱う（数量で割らない）
  //  ・単位の表記が無く「品名 2 R/T ¥10,000」のように数量だけあるときは、従来どおり金額を“合計”として数量で割る
  //  ・「Min USD 345」「(Min ¥3,000)」は最低料金として品名から外し、備考にだけ残す
  function _parseFreeSeg(body, popts) {
    popts = popts || {};
    const toks = _findMoneyAll(body);
    if (!toks.length) return null;
    let main = null, minNote = '';
    const cut = [];
    toks.forEach(tk => {
      const mm = body.slice(0, tk.start).match(_MIN_PRE_RE);
      if (mm) { if (!minNote) minNote = 'Min ' + _fmtMoney(tk); cut.push([tk.start - mm[0].length, tk.end]); }
      else { if (!main) main = tk; cut.push([tk.start, tk.end]); }
    });
    if (!main) { main = toks[0]; minNote = ''; cut.length = 0; cut.push([main.start, main.end]); }
    let rest = body;
    cut.sort((a, b) => b[0] - a[0]).forEach(([a, b]) => { rest = rest.slice(0, a) + ' ' + rest.slice(b); });

    let qty = null, unit = '', perUnit = false, m;
    if ((m = rest.match(_LEAD_X_RE))) { qty = _num(m[1]); unit = m[2]; rest = rest.slice(m[0].length); perUnit = true; }
    else if ((m = rest.match(_TRAIL_X_RE))) { qty = _num(m[1]); if (m[2]) unit = m[2]; rest = rest.slice(0, m.index); perUnit = true; }
    if ((m = rest.match(_PER_RE)) || (m = rest.match(_PAREN_UNIT_RE))) {
      if (!unit) unit = m[1];
      rest = rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length);
      perUnit = true;
      // 「/M3/期」「/CBM/月」のように、続けて期間の単位が付くときはつなげる（保管料など）
      const pm = rest.match(_PERIOD_RE);
      if (pm && unit === m[1]) { unit = unit + '/' + pm[1]; rest = rest.slice(0, pm.index) + ' ' + rest.slice(pm.index + pm[0].length); }
    } else if (!unit && (m = rest.match(_CNTR_TAIL_RE))) {
      unit = m[1]; rest = rest.slice(0, m.index); perUnit = true;
    }

    if (minNote) rest = rest.replace(/\b(or|または)\b/gi, ' ');
    let name = rest.replace(/[（(]\s*[）)]/g, ' ');
    if (!/[（(]/.test(name)) name = name.replace(/[)）]\s*$/, '');
    name = name.replace(/\s+/g, ' ').replace(/^[\s:：/／,，、\-–]+|[\s:：/／,，、\-–×]+$/g, '').trim();

    if (!perUnit) {   // 従来の読み方：「品名 数量 単位 … 金額（合計）」
      const qm = name.match(/\s([\d.,]+)\s*(R\/T|RT|CBM|M3|KGS?|CNTR|B\/L|BL|SHPT|VAN|件|台|本|枚|式|梱|才|20'?\S*|40'?\S*)$/i);
      if (qm) { qty = _num(qm[1]) ?? 1; unit = qm[2]; name = name.slice(0, qm.index).trim(); }
    }
    const div = (perUnit || popts.qtyAsUnit) ? 1 : (qty || 1);   // 数量付きの金額を単価として書くサブコン（qtyAsUnit）は割らない
    return {
      name, qty: qty ?? 1, unit, ccy: main.ccy,
      price: main.v / div, priceHi: main.hi != null ? main.hi / div : null, minNote,
    };
  }


  // 通貨の書かれていない行の「金額らしい数字」の前に、既定の通貨を補う（見つからなければ null）。
  //  日付（2026/11/20）・電話・住所（2-11-5）・「3日」「5階」・数量（10 未満）・「× 2」は金額にしない。品名（文字 2 つ以上）が先にある行だけ
  function _injectCcy(body, ccy) {
    const re = /\d[\d,]*(?:\.\d+)?/g;
    let m;
    while ((m = re.exec(body))) {
      const before = body.slice(0, m.index), after = body.slice(m.index + m[0].length);
      const v = _num(m[0]);
      if (v == null || v < 10) continue;
      if (before && !/[\s:：=]$/.test(before)) continue;
      if (/[×xX]\s*$/.test(before) || /(?:^|\s)(?:per|@)\s*$/i.test(before) || /\/\s*$/.test(before)) continue;
      if (/^[A-Za-z0-9\/\-:.'’%％月日年時分号階F]/.test(after)) continue;
      if ((before.match(/[A-Za-z぀-ヿ一-鿿]/g) || []).length < 2) continue;
      return before + ccy + ' ' + m[0] + after;
    }
    return null;
  }

  // ---- 表（タブ区切り／「|」区切り）の読み取り ----
  const _ROLE_TESTS = [
    ['ccy',    /^(通貨|currency|ccy|cur\.?)$/i],
    ['qty',    /数量|^q'?ty|quantity|^数$/i],
    ['price',  /単価|unit\s*price|^rate|price|料金/i],
    ['amount', /金額|amount|total|合計|^計$/i],
    ['unit',   /^(単位|unit|uom)$/i],
    ['note',   /備考|note|remark|comment|摘要/i],
    ['name',   /項目|品名|品目|内訳|費目|名称|item|description|charge|particular|^name$/i],
  ];
  function _splitCells(t) {
    const s = _fw(t);
    if (/\t/.test(s)) return s.split('\t').map(c => c.trim());
    return s.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
  }
  function _tableHeader(cells) {
    if (cells.some(c => _findMoneyAll(c).length)) return null;
    const cols = {};
    cells.forEach((c, i) => {
      if (!c) return;
      const r = _ROLE_TESTS.find(([k, re]) => cols[k] == null && re.test(c));
      if (r) cols[r[0]] = i;
    });
    const n = Object.keys(cols).length;
    if (n < 2 || !(cols.name != null || cols.price != null || cols.amount != null)) return null;
    cols._hdr = cells;
    return cols;
  }
  // 見出しの文字に通貨コードがあれば拾う（例：「Unit Price (USD)」「単価（JPY）」）
  function _ccyInText(s) {
    const m = String(s || '').match(new RegExp('\\b(' + _CCY_ALL + ')\\b', 'i'));
    return m ? (m[1].toUpperCase() === 'RMB' ? 'CNY' : m[1].toUpperCase()) : '';
  }
  function _tableRow(cells, cols) {
    const plain = s => /^[\d,]+(?:\.\d+)?$/.test(s) ? _num(s) : null;
    let name = '', qty = null, unit = '', note = '', price = null, ccy = '', amt = null;
    if (cols) {
      const c = k => cols[k] != null ? (cells[cols[k]] || '') : '';
      name = c('name'); unit = c('unit'); note = c('note'); qty = plain(c('qty'));
      const pm = _findMoneyAll(c('price'))[0], am = _findMoneyAll(c('amount'))[0];
      ccy = (pm && pm.ccy) || (am && am.ccy) || c('ccy').toUpperCase() || _ccyInText(cols._hdr[cols.price]) || _ccyInText(cols._hdr[cols.amount]);
      price = pm ? pm.v : plain(c('price'));
      amt = am ? am.v : plain(c('amount'));
      if (price == null && amt != null) price = amt / (qty || 1);
    } else {
      const moneyCells = [], numCells = [];
      cells.forEach(c => {
        if (!c) return;
        const mm = _findMoneyAll(c)[0];
        if (mm) moneyCells.push(mm);
        else if (plain(c) != null && !name) numCells.push(plain(c));
        else if (plain(c) != null) numCells.push(plain(c));
        else if (!name) name = c;
        else if (!unit && c.length <= 8) unit = c;
        else if (!note) note = c;
      });
      if (!moneyCells.length) return null;
      price = moneyCells[0].v; ccy = moneyCells[0].ccy;
      if (numCells.length) qty = numCells[0];
    }
    name = String(name || '').trim();
    if (!name || price == null) return null;
    return { name, qty: qty ?? 1, unit, ccy: ccy || 'JPY', price, note, _noCcy: !ccy };
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
  function parseQuoteEmail(text, opts) {
    opts = opts || {};
    const defCcy = CCY_LIST.includes(String(opts.defaultCcy || '').toUpperCase()) ? String(opts.defaultCcy).toUpperCase() : '';
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const fields = {};
    const entries = [];
    let inScope = false;   // 【作業範囲】以降は明細抽出しない
    // リマーク候補：{ text, itemIdx }（itemIdx＝付ける明細の番号（明細だけ数えた 0 始まり）。null＝全体リマーク）
    //  ・【リマーク】（【備考】【注記】）の見出し以降の行（次の【見出し】か罫線まで）＝全体リマーク（「品名：注記」なら該当の明細へ）
    //  ・行頭が「※」の行＝直前の行が明細ならその明細へ、そうでなければ全体リマーク
    //  ・行末の「※備考」は従来どおり、その明細行の備考（remarks には入れない）
    const remarks = [];
    const unread = [];   // 金額らしい数字を含むのに明細にできなかった行（画面で見せる）
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

    let tableCols = null;   // 表（タブ／| 区切り）の見出しから決めた列の役割。空行で解除
    lines.forEach(raw => {
      // メールの引用記号（「> 」）は外す（返信メールの引用部分に見積が入っていることが多い）
      const line = raw.replace(/^(?:[ \t]*>)+[ \t]?/, '').replace(/\s+$/, '');
      const t = line.trim();
      if (!t) { lastItemIdx = -1; tableCols = null; return; }   // 空行をはさんだ「※」は、直前の明細の注記にしない（全体リマーク）
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
      if (/^(　)?(小計|課税対象小計|御見積額|消費税|仕入合計|売値合計|合計|総合計|総額|ご?請求(合計|金額)|(grand\s*|sub\s*-?\s*)?total\b|ttl\b)/i.test(t)) return;
      if (/^※/.test(t)) { pushRemark(t, prevItem >= 0 ? prevItem : null); lastItemIdx = prevItem; return; }   // 続く「※」も同じ明細へ
      if (/^(■(?!.*[×＝])|TEL|FAX|Mail|E-?mail)/i.test(t)) return;
      // サマリの区間行（ラベル＋空白＋¥金額のみ）は明細と重複するためスキップ
      if (/^　.+\s{2,}[¥￥][\d,]+$/.test(line)) return;

      // 表（Excel／メール内の表を貼ったタブ区切り、または「|」区切り）。見出し行があれば列の役割を使う
      if (/\t/.test(t) || /^\|.*\|$/.test(t)) {
        const cells = _splitCells(t);
        if (cells.length >= 2) {
          if (cells.every(c => /^:?-{2,}:?$/.test(c) || !c)) return;   // 「|---|---|」の区切り行
          const hdr = _tableHeader(cells);
          if (hdr) { tableCols = hdr; return; }
          const row = _tableRow(cells, tableCols);
          if (row) {
            const tx = _taxOf(row.name + ' ' + row.note);
            const nm = _stripTaxMarks(row.name).replace(/\s+/g, ' ').trim();
            pushItem({ _kind: 'item', conf: row._noCcy ? 'low' : 'mid', name: nm, qty: row.qty, unit: row.unit, ccy: row.ccy, price: row.price,
              taxed: tx === 'on', taxSrc: tx, cond: false, ref: false, note: row.note });
            return;
          }
        }
      }

      // 実費行（自形式）：・NAME …… 実費
      const isBullet = /^[・･\-\*●○]/.test(t);
      let body = _fw(t.replace(/^[・･\-\*●○]\s*/, ''));

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

      // パターンC（一般自由文・低確度）：金額・単位（/20GP・per 40HC）・数量（× 3台）・範囲（〜）・Min を読み取る。
      //  「海上運賃 USD 1,200 + BAF USD 300 + THC ¥48,000」のように「 + 」でつないだ 1 行は、項目ごとに分ける
      let assumed = false;
      if (defCcy && !_findMoneyAll(body).length) {   // サブコンの既定の通貨があるときだけ、通貨の書かれていない数字も金額として読む
        const inj = _injectCcy(body, defCcy);
        if (inj) { body = inj; assumed = true; }
      }
      const segs = (_findMoneyAll(body).length >= 2 && /\s\+\s/.test(body)) ? body.split(/\s\+\s/) : [body];
      let produced = 0;
      segs.forEach((seg, si) => {
        const r = _parseFreeSeg(seg, { qtyAsUnit: !!opts.qtyAsUnit });
        if (!r || !r.name || r.price == null) return;
        if (!/[A-Za-z぀-ヿ一-鿿]/.test(r.name)) return;   // 数字・記号だけの名前（日付・番号など）は項目にしない
        if (/^(以上|宜しく|よろしく|お願い|下記|毎度|拝啓|敬具)/.test(r.name)) return;
        produced++;
        pushItem({
          _kind: 'item', conf: (isBullet && !assumed) ? 'mid' : 'low',
          name: r.name, qty: r.qty, unit: r.unit, ccy: r.ccy, price: r.price, priceHi: r.priceHi, ccyAssumed: assumed,
          taxed, taxSrc: tax, cond, ref: refFlg,
          note: [si === segs.length - 1 ? note : '', r.minNote].filter(Boolean).join(' / '),
        });
      });
      // 数字（2 桁以上）を含むのに読めなかった行を控える（日付・電話・住所らしい行は除く）
      if (!produced && /\d{2,}/.test(body) && body.length <= 120
          && !/\d{4}[\/\-.年]\s?\d{1,2}|\d{2,5}-\d{2,4}-\d{3,4}|\d{3}-\d{4}|〒|^(tel|fax|http)/i.test(body.trim())) unread.push(t);
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

    return { fields, entries, remarks, unread };
  }

  // ====== レビュー UI ======
  let _parsed = null;   // { fields, entries }

  // ====== 🧠 サブコン別の読み取りルール（マスター詳細 details.importRules に保存＝チーム共有）======
  //  rules = { aliases: [{from, to, cat}], ccy: '既定の通貨', unit: '既定の単位', by, at }
  //  ・aliases：相手の呼び名（from）→ 自社の品名（to）・カテゴリ（cat・任意）。品名は大文字小文字・空白を無視して照合（完全一致、または 3 文字以上で含む）
  //  ・ccy：通貨の書かれていない数字も、この通貨の金額として読む（確度は「要確認」）
  //  ・unit：単位が読み取れなかった行の単位
  let _svCtx = null;   // { canon } サブコン見出しから開いたとき
  const _nzs = v => String(v || '').toLowerCase().replace(/[\s　]+/g, '');
  function _rulesOf(canon) {
    const rec = (typeof window.mdGet === 'function' && canon) ? window.mdGet('sv', canon) : null;
    const r = rec && rec.details && rec.details.importRules;
    // aliases の各要素は { from, to, cat, unit, n(使った回数), last(最後に使った日), by, at(登録日時) }。知らない項目もそのまま持ち回る
    return { aliases: Array.isArray(r && r.aliases) ? r.aliases.filter(a => a && a.from).map(a => Object.assign({}, a)) : [], ccy: (r && r.ccy) || '', unit: (r && r.unit) || '', qtyAsUnit: !!(r && r.qtyAsUnit), by: (r && r.by) || '', at: (r && r.at) || '' };
  }
  const _STALE_DAYS = 180;   // これだけ使われていない（登録後も使われていない）ルールは「古い」として整理の候補にする
  const _todayIso = () => new Date().toISOString().slice(0, 10);
  const _daysSince = iso => { const t = Date.parse(String(iso || '').slice(0, 10)); return isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : null; };
  function _ruleIdleDays(a) { return _daysSince(a.last || a.at); }   // 最後に使った日（無ければ登録日）からの日数。日付が無いルールは null（古いとはみなさない）
  function _isStaleRule(a) { const d = _ruleIdleDays(a); return d != null && d >= _STALE_DAYS; }
  // 同じ呼び名のルールは 1 つにまとめ、使った回数・登録日は引き継ぐ（直しても履歴が消えない）
  function _upsertAlias(list, a) {
    const k = _nzs(a.from);
    const i = list.findIndex(x => _nzs(x.from) === k);
    if (i >= 0) { list[i] = Object.assign({}, list[i], a); return list; }
    list.push(Object.assign({ n: 0 }, a));
    return list;
  }
  async function _saveRules(canon, rules) {
    if (typeof window.mdGet !== 'function' || typeof window.mdSave !== 'function') return false;
    const prev = (window.mdGet('sv', canon) || {}).details || {};
    const me = (typeof window.cloudCurrentUser === 'function' && window.cloudCurrentUser()) || {};
    const now = new Date().toISOString();
    const aliases = (rules.aliases || []).map(a => Object.assign({}, a, { at: a.at || now, by: a.by || me.email || '' }));   // 登録日・登録者は最初の保存で記録
    const next = Object.assign({}, prev, { importRules: { v: 2, aliases, ccy: rules.ccy || '', unit: rules.unit || '', qtyAsUnit: !!rules.qtyAsUnit, by: me.email || '', at: now } });
    return await window.mdSave('sv', canon, next);
  }
  // 解析結果（entries）へルールを当てる。当たった行は ruleHit（呼び名の置き換え）・unitFilled を立てる
  function _applyRules(parsed, rules) {
    if (!parsed || !rules) return parsed;
    const al = (rules.aliases || []).map(a => ({ k: _nzs(a.from), to: a.to || a.from, cat: a.cat || '', unit: a.unit || '' })).filter(a => a.k);
    parsed.entries.forEach(e => {
      if (e._kind !== 'item') return;
      const key = _nzs(e.name);
      let hit = al.find(a => a.k === key);
      if (!hit) hit = al.filter(a => a.k.length >= 3 && key.includes(a.k)).sort((x, y) => y.k.length - x.k.length)[0];
      if (hit) { e.origName = e.name; e.name = hit.to; e.ruleHit = true; e.ruleKey = hit.k; if (hit.cat) e.ruleCat = hit.cat; if (!e.unit && hit.unit) { e.unit = hit.unit; e.unitFilled = true; } }
      if (!e.unit && rules.unit) { e.unit = rules.unit; e.unitFilled = true; }
    });
    return parsed;
  }

  // ====== 📥 取り込みの入口（テキスト／PDF／荷姿を選ぶ） ======
  let _chooserCanon = '';
  function openImportChooser(canon) {
    canon = String(canon || '').trim();
    if (_isViewMode()) { if (window.quoteShowToast) quoteShowToast('🔒 閲覧モードです。「✏️ 編集」を押してから取り込んでください', 'warn'); return; }
    _chooserCanon = canon;
    const m = document.getElementById('importChooser'); if (!m) return;
    const sub = document.getElementById('icSub');
    if (sub) sub.textContent = canon ? '「' + canon + '」の明細グループに取り込みます（読み取りルールが自動で使われます）' : '取り込み方を選んでください';
    const pk = document.getElementById('icPacking'); if (pk) pk.hidden = !!canon;
    m.classList.add('open');
  }
  function closeImportChooser() { document.getElementById('importChooser')?.classList.remove('open'); }
  function icChoose(kind) {
    const canon = _chooserCanon;
    if (kind === 'pdf') { document.getElementById('icPdfFile')?.click(); return; }   // 選択画面は、ファイルを選んだあとに閉じる
    closeImportChooser();
    if (kind === 'text') { if (canon) eiOpenForSubcon(canon); else openEmailImport(); }
    else if (kind === 'packing' && typeof window.openPackingImport === 'function') window.openPackingImport();
  }
  async function icPdfSelected(input) {
    const file = input && input.files && input.files[0];
    if (!file) return;
    const canon = _chooserCanon;
    try {
      const fn = window.pkiExtractPdfLines;
      const r = typeof fn === 'function' ? await fn(file) : { error: 'PDFの取り込み機能が読み込まれていません' };
      if (r.error) { if (window.quoteShowToast) quoteShowToast('⚠️ ' + r.error, 'warn', 7000); return; }
      closeImportChooser();
      if (canon) eiOpenForSubcon(canon); else openEmailImport();
      const t = document.getElementById('eiText'); if (!t) return;
      // 表の列は Tab でつなぐ（表として読む解析にそのまま渡せる）
      t.value = r.lines.map(cells => cells.join('\t')).join('\n');
      eiParse();
      if (window.quoteShowToast) quoteShowToast('📄 PDFの文字を取り出して解析しました。内容を確認してから挿入してください（表の崩れは文字を直すか、AI整形用プロンプトをお使いください）', 'success', 6000);
    } finally { input.value = ''; }
  }

  function openEmailImport() {
    _svCtx = null; _renderSvCtx();
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
    const rest = _liveEntries().filter(x => x.id !== id);
    // 保管が 0 件になったとき、旧形式の取込元メモ（#qf-import-src）が残っていると、
    // 読み込みのたびに「旧形式の 1 件」として復活し、削除したはずの原文が消えない。メモも空にする。
    if (!rest.length) { const src = document.getElementById('qf-import-src'); if (src) src.value = ''; }
    _saveLiveEntries(rest);
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
    const rules = _svCtx ? _rulesOf(_svCtx.canon) : null;
    _parsed = parseQuoteEmail(text, { defaultCcy: rules && rules.ccy, qtyAsUnit: rules && rules.qtyAsUnit });
    if (rules) _applyRules(_parsed, rules);
    renderEiReview();
    _recordUnread(_parsed.unread);   // 読めなかった行（数字を伏せた形）を、改善用に自動で記録する（待たない）
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
    const unread = _parsed.unread || [];
    const unreadHtml = n => unread.length
      ? '<details class="ei-unread"' + (n ? '' : ' open') + '><summary>⚠ 金額らしい数字を含むのに読み取れなかった行（' + unread.length + ' 件）</summary><ul>' +
        unread.slice(0, 12).map(l => '<li>' + _esc(l) + '</li>').join('') + (unread.length > 12 ? '<li>ほか ' + (unread.length - 12) + ' 件</li>' : '') +
        '</ul><p>通貨記号（¥・$・USD）や単位（/VAN など）の書き方が読み取れていない可能性があります。ログイン中は、<b>数字を 9 に伏せた形</b>が読み取りの改善用に自動で記録されます（金額・社名・メールアドレスは残りません）。</p><button type="button" class="ei-unread-copy" onclick="eiCopyUnread()">📋 改善用にコピー</button></details>' : '';
    if (!items.length && !rems.length) {
      wrap.innerHTML = '<div class="preset-empty">明細行を抽出できませんでした。<br><small>金額（¥1,234 / 100 USD 等）を含む行が対象です。書式を確認してください。</small></div>' + unreadHtml(0);
      document.getElementById('eiActions').hidden = true;
      return;
    }
    const confBadge = c => c === 'high' ? '<span class="ei-conf ei-conf-high" title="自アプリ形式として解析">高</span>'
                        : c === 'mid'  ? '<span class="ei-conf ei-conf-mid" title="箇条書き＋金額から推定">中</span>'
                                       : '<span class="ei-conf ei-conf-low" title="金額のみから推定。内容を確認してください">要確認</span>';
    let html = '';
    // ヘッダー項目
    html += '<div class="ei-fields">' +
      '<label class="ei-f-meta">お客様 <input type="text" id="eiF-customer" value="' + _esc(fields.customer || '') + '"></label>' +
      '<label class="ei-f-meta">REF# <input type="text" id="eiF-ref" value="' + _esc(fields.ref || '') + '"></label>' +
      '<label class="ei-f-meta">有効期限 <input type="date" id="eiF-valid" value="' + _esc(fields.validUntil || '') + '"></label>' +
      '<label>サブコン一括設定 <input type="text" id="eiBulkSv" list="svSuggestions" value="' + _esc(_svCtx ? _svCtx.canon : '') + '" placeholder="例）〇〇物流">' +
        '<button type="button" class="ei-bulk-sv-btn" onclick="eiApplyBulkSv()" title="入力したサブコン名を全行に反映します（個別に直したい行は挿入前に上書き可能）">全行に設定</button></label>' +
      '<label class="ei-sellmode-label" title="既存システムからの移植等、取り込む単価が「売値」しか分からない場合向け。チェックすると、取り込んだ単価は売単価として登録され、仕入単価は空欄になります。挿入後に見積テーブルで行ごとに「仕入単価」を入力すると、乗せ幅が自動で算出されます（売単価－仕入単価）。">' +
        '<input type="checkbox" id="eiSellMode"> 💰 単価を売値として取り込む（仕入を後で入力→乗せ幅を自動算出）</label>' +
      '</div>';
    html += unreadHtml(items.length);
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
      const cat = e.ruleCat || inferCat(e.name);
      const flags = (e.cond ? '都度 ' : '') + (e.ref ? '参考 ' : '') + (e.actual ? '実費 ' : '') + (e.priceHi != null ? '幅〜' + Math.round(e.priceHi * 100) / 100 : '') + (e.ccyAssumed ? ' 通貨は既定' : '') + (e.ruleHit ? ' 🧠置換' : '') + (e.unitFilled ? ' 単位は既定' : '');
      html += `<tr data-gi="${gi}" data-orig-name="${_esc(e.origName || e.name)}" data-orig-cat="${_esc(cat)}" data-orig-unit="${_esc(e.unit || '')}" class="ei-row ei-${e.conf}">` +
        `<td><input type="checkbox" class="ei-chk" checked></td>` +
        `<td class="ei-group-cell"><input type="text" class="ei-in ei-group" value="${_esc(curGroup)}" title="挿入時：小計行のラベル、かつ各行の「パターン（任意）」に登録されます（空欄可）">` +
        `<button type="button" class="ei-group-pattern-btn" title="同じグループのチェック済み行を「行パターン」として登録" onclick="eiSaveGroupAsPattern(this)">🔖</button></td>` +
        `<td><select class="ei-in ei-cat">${_catOptions(cat)}</select></td>` +
        `<td><input type="text" class="ei-in ei-sv" value="${_esc(_svCtx ? _svCtx.canon : '')}" list="svSuggestions" placeholder="任意"></td>` +
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
    if (_svCtx && items.length) html += '<div class="ei-learn"><button type="button" class="ei-learn-btn" onclick="eiLearnFromCorrections()" title="品名・カテゴリ・単位を直した行を、このサブコンの「呼び名の置き換え」ルールに追加します（チーム共有）">🧠 修正をこのサブコンのルールとして覚える</button><span>品名・カテゴリ・単位を直した行が、次回から自動で直ります</span></div>';
    // 「単価を売値として取り込む」はサブコン専用の取込では出さないので、その説明もそのときは外す
    html += '<p class="ei-hint">💡 通常は単価が仕入・売の両方に入ります（粗利0）。仕入額が分かる場合は挿入後に修正してください。' +
      (_svCtx ? '' : '「💰 単価を売値として取り込む」をONにすると、単価は売値としてのみ登録され、挿入後に仕入単価を入力すれば乗せ幅が自動算出されます。') +
      '「課税」列は本文の語（[課税]・課税対象・税別・非課税・免税 等）から判定した結果です。違う行はチェックで直してください。「要確認」行は品名・金額を必ず確認。</p>';
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

  // 挿入する行のうち、ルール（呼び名の置き換え）が当たった行の呼び名キー（同じルールが複数行に当たれば重ねて返す）
  function _usedRuleKeys() {
    const items = (_parsed && _parsed.entries || []).filter(e => e._kind === 'item');
    return [..._checkedItemSet()].map(gi => items[gi] && items[gi].ruleKey).filter(Boolean);
  }
  // 使ったルールの回数・最後に使った日を記録する。ほかの人の保存と食い違わないよう、保存の直前に最新を読み直す。失敗しても何も出さない
  async function _bumpRuleUse(canon, keys) {
    try {
      if (!canon || !keys.length) return;
      const r = _rulesOf(canon), today = _todayIso();
      let hit = 0;
      keys.forEach(k => { const a = r.aliases.find(x => _nzs(x.from) === k); if (a) { a.n = (a.n || 0) + 1; a.last = today; hit++; } });
      if (hit) await _saveRules(canon, r);
    } catch (e) { /* 記録できなくても取込は成功のまま */ }
  }

  // ====== サブコン見出しから開く（そのサブコン専用の取込）======
  function eiOpenForSubcon(canon) {
    canon = String(canon || '').trim();
    if (!canon) return;
    if (_isViewMode()) { if (window.quoteShowToast) quoteShowToast('🔒 閲覧モードです。「✏️ 編集」を押してから取り込んでください', 'warn'); return; }
    openEmailImport();
    _svCtx = { canon };
    document.getElementById('emailImportBox')?.classList.add('ei-sv-ctx');
    const t = document.getElementById('eiTitle'); if (t) t.textContent = '📩 メール取込 — 📦 ' + canon;
    const d = document.getElementById('eiDesc');
    if (d) d.textContent = '「' + canon + '」からのメール（見積）を貼り付けて「解析」を押してください。取り込んだ行は、このサブコンの明細グループに入ります。直した内容は「🧠 修正をこのサブコンのルールとして覚える」で、次回から自動で直ります（チーム共有）。';
    _renderSvCtx();
  }
  function _renderSvCtx() {
    const box = document.getElementById('emailImportBox'); if (box && !_svCtx) box.classList.remove('ei-sv-ctx');
    const wrap = document.getElementById('eiSvCtx'); if (!wrap) return;
    if (!_svCtx) { wrap.hidden = true; wrap.innerHTML = ''; return; }
    const r = _rulesOf(_svCtx.canon);
    const ccyOpts = '<option value="">（なし）</option>' + CCY_LIST.map(c => '<option' + (r.ccy === c ? ' selected' : '') + '>' + c + '</option>').join('');
    const list = r.aliases.length
      ? '<ul class="ei-rule-list">' + r.aliases.map((a, i) => '<li><span>' + _esc(a.from) + ' → <b>' + _esc(a.to) + '</b>' + (a.cat ? ' <i>[' + _esc(a.cat) + ']</i>' : '') + '</span><button type="button" onclick="eiRuleDel(' + i + ')" title="このルールを外す">✕</button></li>').join('') + '</ul>'
      : '<div class="ei-rule-none">呼び名の置き換えルールはまだありません（確認画面で直して「覚える」を押すと増えます）</div>';
    wrap.hidden = false;
    wrap.innerHTML = '<details class="ei-rules"' + (r.aliases.length || r.ccy || r.unit ? '' : '') + '><summary>🧠 「' + _esc(_svCtx.canon) + '」の読み取りルール（置き換え ' + r.aliases.length + ' 件' + (r.ccy ? '・既定の通貨 ' + _esc(r.ccy) : '') + (r.unit ? '・既定の単位 ' + _esc(r.unit) : '') + (r.qtyAsUnit ? '・数量付きの金額は単価' : '') + '）</summary>' +
      '<div class="ei-rule-row"><label>既定の通貨 <select id="eiRuleCcy">' + ccyOpts + '</select></label>' +
      '<label>既定の単位 <input type="text" id="eiRuleUnit" value="' + _esc(r.unit) + '" placeholder="例）20\'GP"></label>' +
      '<button type="button" class="ei-rule-save" onclick="eiRuleSaveDefaults()">保存</button></div>' +
      '<p class="ei-rule-help">既定の通貨を決めると、通貨が書かれていない数字（例：<code>海上運賃 1200 /20GP</code>）も、その通貨の金額として読みます（確度は「要確認」）。</p>' +
      list + (r.at ? '<div class="ei-rule-meta">最終更新 ' + _esc(String(r.at).slice(0, 10)) + (r.by ? '・' + _esc((typeof window.cloudNameFor === 'function' && window.cloudNameFor(r.by)) || r.by) : '') + '</div>' : '') +
      '</details>';
  }
  async function eiRuleSaveDefaults() {
    if (!_svCtx) return;
    const r = _rulesOf(_svCtx.canon);
    r.ccy = document.getElementById('eiRuleCcy')?.value || '';
    r.unit = (document.getElementById('eiRuleUnit')?.value || '').trim();
    if (await _saveRules(_svCtx.canon, r)) { if (window.quoteShowToast) quoteShowToast('🧠 既定の通貨・単位を保存しました（チーム共有）。「解析する」を押し直すと反映されます', 'success'); _renderSvCtx(); }
  }
  async function eiRuleDel(i) {
    if (!_svCtx) return;
    const r = _rulesOf(_svCtx.canon);
    const a = r.aliases[i]; if (!a) return;
    r.aliases.splice(i, 1);
    if (await _saveRules(_svCtx.canon, r)) { if (window.quoteShowToast) quoteShowToast('🧠 ルール「' + a.from + ' → ' + a.to + '」を外しました', 'info'); _renderSvCtx(); }
  }
  // 確認画面で直した内容（品名・カテゴリ）を、このサブコンのルールとして覚える
  async function eiLearnFromCorrections() {
    if (!_svCtx) return;
    const r = _rulesOf(_svCtx.canon);
    let added = 0;
    document.querySelectorAll('#eiReviewWrap .ei-table tbody tr').forEach(tr => {
      const orig = (tr.dataset.origName || '').trim();
      const cur = (tr.querySelector('.ei-name')?.value || '').trim();
      const cat = tr.querySelector('.ei-cat')?.value || '';
      if (!orig || !cur) return;
      const unit = (tr.querySelector('.ei-unit')?.value || '').trim();
      const nameChanged = cur !== orig;
      const catChanged = cat && cat !== (tr.dataset.origCat || '');
      const unitChanged = unit && unit !== (tr.dataset.origUnit || '');   // 単位を直した行は、その単位も覚える
      if (!nameChanged && !catChanged && !unitChanged) return;
      const na = { from: orig, to: cur, cat: cat || '' };
      if (unitChanged) na.unit = unit;   // 単位は、直した行だけ覚える（直していない行の単位で上書きしない）
      _upsertAlias(r.aliases, na);   // 同じ呼び名は更新（使った回数は引き継ぐ）
      added++;
    });
    if (!added) { if (window.quoteShowToast) quoteShowToast('ℹ️ 覚えさせる修正がありません（品名・カテゴリ・単位を直してから押してください）', 'info'); return; }
    if (await _saveRules(_svCtx.canon, r)) {
      if (window.quoteShowToast) quoteShowToast('🧠 ' + added + ' 件を「' + _svCtx.canon + '」のルールとして覚えました（チーム共有・次回から自動で直ります）', 'success');
      _renderSvCtx();
    }
  }

  // ====== マスター管理（サブコン詳細）の「メール取込ルール」欄：ルールの確認・追加・直し・削除 ======
  //  取込ダイアログと同じ details.importRules を読み書きする（どちらから直しても同じ。チーム共有）
  function eiMountRulesPanel(el, canon) {
    if (!el) return;
    canon = String(canon || '').trim();
    const r = _rulesOf(canon);
    const useText = a => {
      if (a.n == null && !a.last && !a.at) return '';
      const idle = _ruleIdleDays(a), stale = _isStaleRule(a);
      const t = (a.n ? '使用 ' + a.n + '回' + (a.last ? '・最終 ' + String(a.last).slice(5).replace('-', '/') : '') : '未使用' + (a.at ? '（' + String(a.at).slice(0, 10).replace(/-/g, '/') + ' 登録）' : ''));
      return '<span class="ir-use' + (stale ? ' is-stale' : '') + '" title="' + (stale ? idle + '日間使われていません（整理の候補）' : '登録した人：' + _esc((typeof window.cloudNameFor === 'function' && window.cloudNameFor(a.by)) || a.by || '')) + '">' + (stale ? '⏳ ' : '') + t + '</span>';
    };
    const rowHtml = a => '<div class="ir-row" data-key="' + _esc(_nzs(a.from)) + '"><input type="text" class="ir-from" value="' + _esc(a.from) + '" placeholder="相手の呼び名（例：ドキュメント料）">' +
      '<span class="ir-arrow">→</span><input type="text" class="ir-to" value="' + _esc(a.to) + '" placeholder="自社の品名（例：DOC FEE）">' +
      '<select class="ir-cat" title="カテゴリ（任意）">' + _catOptions(a.cat || '') + '</select>' +
      '<input type="text" class="ir-aunit" value="' + _esc(a.unit || '') + '" placeholder="単位" title="この品名の単位（任意・読み取れなかったときだけ入る）">' +
      '<button type="button" class="ir-del" title="このルールを外す">✕</button>' + useText(a) + '</div>';
    const staleN = r.aliases.filter(_isStaleRule).length;
    const ccyOpts = '<option value="">（なし）</option>' + CCY_LIST.map(c => '<option' + (r.ccy === c ? ' selected' : '') + '>' + c + '</option>').join('');
    el.innerHTML =
      '<div class="ir-defaults"><label>既定の通貨 <select class="ir-ccy">' + ccyOpts + '</select></label>' +
      '<label>既定の単位 <input type="text" class="ir-unit" value="' + _esc(r.unit) + '" placeholder="例）20\'GP"></label>' +
      '<label class="ir-qau"><input type="checkbox" class="ir-qtyunit"' + (r.qtyAsUnit ? ' checked' : '') + '> 数量が書いてある行の金額は「単価」として読む</label></div>' +
      '<p class="ir-help">既定の通貨を決めると、通貨の書かれていない数字（例：<code>海上運賃 1200 /20GP</code>）もその通貨の金額として読みます（確度は「要確認」）。既定の単位は、単位が読み取れなかった行にだけ入ります。</p>' +
      '<div class="ir-list">' + r.aliases.map(rowHtml).join('') + '</div>' +
      '<div class="ir-empty"' + (r.aliases.length ? ' hidden' : '') + '>呼び名の置き換えルールはまだありません。「＋ ルールを追加」か、サブコンの見出しの「📩 メール取込」で品名を直して「🧠 覚える」を押すと増えます。</div>' +
      '<div class="ir-bar"><button type="button" class="ir-add">＋ ルールを追加</button><button type="button" class="ir-save">💾 ルールを保存</button>' +
      '<button type="button" class="ir-clean"' + (staleN ? '' : ' hidden') + ' title="' + _STALE_DAYS + '日以上使われていないルールをまとめて外します">⏳ 長く使っていないルール ' + staleN + ' 件を外す</button>' +
      '<span class="ir-meta">' + (r.at ? '最終更新 ' + _esc(String(r.at).slice(0, 10)) + (r.by ? '・' + _esc((typeof window.cloudNameFor === 'function' && window.cloudNameFor(r.by)) || r.by) : '') : '') + '</span></div>';
    const list = el.querySelector('.ir-list'), empty = el.querySelector('.ir-empty');
    const syncEmpty = () => { empty.hidden = !!list.querySelector('.ir-row'); };
    el.querySelector('.ir-add').addEventListener('click', () => {
      list.insertAdjacentHTML('beforeend', rowHtml({ from: '', to: '', cat: '' })); syncEmpty();
      list.lastElementChild.querySelector('.ir-from').focus();
    });
    el.addEventListener('click', e => { const d = e.target.closest('.ir-del'); if (d) { d.closest('.ir-row').remove(); syncEmpty(); } });
    el.querySelector('.ir-clean').addEventListener('click', async () => {
      const cur = _rulesOf(canon), stale = cur.aliases.filter(_isStaleRule);
      if (!stale.length) return;
      const ask = (typeof window.uiConfirm === 'function')
        ? window.uiConfirm({ title: '長く使っていないルールを外しますか？', lines: [stale.length + ' 件（' + _STALE_DAYS + '日以上使われていないルール）を外します。', stale.slice(0, 5).map(a => a.from + ' → ' + a.to).join('、') + (stale.length > 5 ? ' ほか' : '')], irreversible: '外すと元に戻せません（必要なら、もう一度覚えさせてください）。', okLabel: '外す', danger: true })
        : Promise.resolve(confirm(stale.length + ' 件の古いルールを外しますか？'));
      if (!(await ask)) return;
      cur.aliases = cur.aliases.filter(a => !_isStaleRule(a));
      if (await _saveRules(canon, cur)) {
        if (window.quoteShowToast) quoteShowToast('⏳ 古いルール ' + stale.length + ' 件を外しました', 'info');
        eiMountRulesPanel(el, canon);
        if (_svCtx && _svCtx.canon === canon) _renderSvCtx();
      }
    });
    el.querySelector('.ir-save').addEventListener('click', async () => {
      const next = _rulesOf(canon);
      const seen = new Map();
      list.querySelectorAll('.ir-row').forEach(row => {
        const from = row.querySelector('.ir-from').value.trim(), to = row.querySelector('.ir-to').value.trim();
        if (!from || !to) return;
        seen.set(_nzs(from), { from, to, cat: row.querySelector('.ir-cat').value || '', unit: (row.querySelector('.ir-aunit')?.value || '').trim() });   // 同じ呼び名は後の行を採用
      });
      // 使った回数・登録日などは、保存済みのルールから引き継ぐ（画面で直しても履歴が消えない）
      const old = new Map(next.aliases.map(a => [_nzs(a.from), a]));
      next.aliases = [...seen.entries()].map(([k, a]) => Object.assign({}, old.get(k) || { n: 0 }, a));
      next.qtyAsUnit = !!el.querySelector('.ir-qtyunit').checked;
      next.ccy = el.querySelector('.ir-ccy').value || '';
      next.unit = el.querySelector('.ir-unit').value.trim();
      if (await _saveRules(canon, next)) {
        if (window.quoteShowToast) quoteShowToast('🧠 「' + canon + '」のメール取込ルールを保存しました（チーム共有）', 'success');
        eiMountRulesPanel(el, canon);
        if (_svCtx && _svCtx.canon === canon) _renderSvCtx();
      }
    });
  }

  // ====== 読み取れなかった行の記録（解析パターンを増やすための材料）======
  //  数字をすべて 9 に伏せた形だけを、チーム共有の表（email_import_unread・docs/sql/email-import-unread.sql）へ自動で記録する。
  //  金額・社名・メールアドレス・URL・案件の情報は送らない。ログインしていないとき・SQL が未実行のときは何もしない
  function eiMaskLine(line) {
    return String(line == null ? '' : line).trim().replace(/\s+/g, ' ')
      .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '<mail>')
      .replace(/https?:\/\/\S+/gi, '<url>')
      .replace(/[0-9０-９]/g, '9')
      .slice(0, 160);
  }
  const _unreadSent = new Set();   // このページで送った形（同じ形を何度も送らない）
  let _unreadOff = false;          // 表（関数）が無い環境では以後送らない
  async function _recordUnread(lines) {
    try {
      if (_unreadOff || !lines || !lines.length) return;
      const c = typeof window.cloudGetClient === 'function' ? window.cloudGetClient() : null;
      const me = typeof window.cloudCurrentUser === 'function' ? window.cloudCurrentUser() : null;
      if (!c || !me || !me.email) return;
      const shapes = [...new Set(lines.map(eiMaskLine).filter(Boolean))].filter(x => !_unreadSent.has(x)).slice(0, 20);
      if (!shapes.length) return;
      shapes.forEach(x => _unreadSent.add(x));
      const { error } = await c.rpc('email_unread_record', { shapes });
      if (error && /PGRST202|42883|42P01|does not exist|could not find/i.test(String(error.code || '') + ' ' + String(error.message || ''))) _unreadOff = true;
    } catch (e) { /* 記録できなくても取込は止めない */ }
  }
  function _copyText(text, done) {
    const fb = () => { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} ta.remove(); done(); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(fb); else fb();
  }
  // 「📋 改善用にコピー」：読めなかった行を、数字を 9 に伏せた形でコピーする（そのまま開発側へ貼れる）
  function eiCopyUnread() {
    const lines = [...new Set(((_parsed && _parsed.unread) || []).map(eiMaskLine).filter(Boolean))];
    if (!lines.length) return;
    _copyText('メール取込：読み取れなかった行（数字は 9 に伏せています）\n' + lines.map(l => '・' + l).join('\n'),
      () => { if (window.quoteShowToast) quoteShowToast('📋 読み取れなかった ' + lines.length + ' 行をコピーしました（数字は 9 に伏せてあります）', 'success'); });
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
        bphi: (!src.actual && src.priceHi != null) ? String(Math.round(src.priceHi * 100) / 100) : '',   // 「1,000〜1,200」の上限（売単価〜上限の「幅」）
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
    const usedKeys = _svCtx ? _usedRuleKeys() : [];
    const n = rows.length ? window.appendQuoteRows(rows) : 0;
    if (_svCtx && usedKeys.length) _bumpRuleUse(_svCtx.canon, usedKeys);   // 待たない（取込の動作を遅くしない）
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
    openImportChooser, closeImportChooser, icChoose, icPdfSelected, openEmailImport, closeEmailImport, eiParse, eiToggleAll, eiToggleAllTax, eiInsertRows, eiApplyAsNew,
    eiSaveGroupAsPattern, eiApplyBulkSv, eiCopyAiPrompt,
    eiCopyUnread, eiMaskLine, eiOpenForSubcon, eiRuleSaveDefaults, eiRuleDel, eiLearnFromCorrections, eiMountRulesPanel,
    eiApplyRules: _applyRules,   // テスト用
    parseQuoteEmail,   // テスト・将来の AI パーサー差し替え用に公開
  });
})();
