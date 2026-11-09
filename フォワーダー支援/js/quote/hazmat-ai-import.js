// ========== 危険品：資料（SDS 等）を外部 AI に読ませて取り込む ==========
// 流れ（メール取り込みの「🤖 AI整形用プロンプト」と同じ方式。アプリから外部へは通信しない）：
//   1. 「プロンプトをコピー」→ Gemini の NotebookLM（SDS 等を入れたノートブック）や ChatGPT / Claude などに貼り付けて実行
//   2. AI の回答（JSON）を、危険品パネルの貼り付け欄へ貼って「取り込む」
//   3. 危険品の登録チップとして追加される（🤖要確認の印つき。SDS・IMDG と照合して「照合済み」にする）
// 回答の解析は寛容に作ってある（コードブロック・前置き・NotebookLM の出典番号［1］などが混じっていても読む）。
// 選択式の項目（クラス／PG／消防法）は、画面の選択肢の文言へそろえる。登録は conditions.js の importHazEntries。
(function () {
  'use strict';

  const PROMPT_BASE =
`あなたは危険品（危険物）の輸送書類を作るアシスタントです。ソースとして登録されている資料（SDS／安全データシート、製品の仕様書など）を読み取り、**資料ごと（製品ごと）に1件**、次の JSON 配列だけを出力してください。

## 出力フォーマット（JSON 配列。キーは必ずこの名前）
[
  {
    "name": "製品名（SDS 1項の製品名）",
    "un": "UN番号の数字4桁（例：1263）",
    "class": "危険物クラス（例：3 ／ 2.1 ／ 6.1 ／ 8）",
    "pg": "容器等級（I ／ II ／ III。該当なしは空）",
    "pi": "梱包方法 PI 番号（分かれば。例：Y341 ／ 954。不明なら空）",
    "fireLaw": "国内消防法の類別（例：第4類。非該当は「非該当」。不明なら空）",
    "psn": "正式品名 Proper Shipping Name（IMDG／IATA の表記。英語）",
    "flash": "引火点（単位つき。例：23℃ 未満 ／ 61℃（c.c.）。不明なら空）",
    "source": "読み取った資料の名前"
  }
]

## 読み取りのルール
・UN番号・クラス・容器等級・正式品名は、SDS の「14. 輸送上の注意」（国連番号／国連分類／容器等級／正式品名）を最優先で読み取る。引火点は「9. 物理的及び化学的性質」。
・資料に書かれていない項目は、推測せず空文字 "" にする（特に UN番号・クラス・容器等級は、書かれていなければ空）。
・海上（IMDG）と航空（IATA）で値が異なる場合は海上（IMDG）の値を採用する。
・1つの資料に複数の製品が載っている場合は、製品ごとに1件ずつ出力する。
・危険物に該当しない（非危険物）と書かれている製品も、un と class は空にして1件出力し、psn に「Not regulated」と入れる。

## 厳守事項
出力は JSON 配列のみ。前置き・説明文・注意書き・出典番号（［1］など）・コードブロックの\`\`\` は付けないでください。そのままシステムへ貼り付けます。
`;

  const $ = id => document.getElementById(id);
  const toast = (m, k, ms) => { if (typeof window.quoteShowToast === 'function') window.quoteShowToast(m, k || 'info', ms || 3500); };

  // ---- プロンプト（製品名が入力済みなら、対象を絞る一文を添える） ----
  function buildPrompt() {
    const name = ($('hz-name')?.value || '').trim();
    return PROMPT_BASE + (name ? '\n## 対象\nソースのうち、製品名「' + name + '」に該当する資料だけを対象にしてください。\n' : '');
  }
  window.hzAiCopyPrompt = function () {
    const text = buildPrompt();
    const done = () => toast('🤖 危険品の読み取り用プロンプトをコピーしました。NotebookLM（SDS を入れたノートブックのチャット）や ChatGPT などに貼り付けて実行してください', 'success', 5000);
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('⚠️ コピーに失敗しました', 'warn'); }
      finally { document.body.removeChild(ta); }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done).catch(fallback);
    else fallback();
  };

  // ---- 回答の解析 ----
  // 回答テキストから JSON を取り出す（コードブロック・前置き・出典番号［1］／【1】が混じっていても可）
  function _extractJson(text) {
    let t = String(text || '');
    t = t.replace(/```[a-zA-Z]*\s*/g, '').replace(/```/g, '');
    t = t.replace(/[\s　]*[\[［【]\s*\d+(?:\s*[,，\-–~〜]\s*\d+)*\s*[\]］】]/g, '');   // 出典番号（［1］［2,3］【4】）を除く
    const a = t.indexOf('['), b = t.lastIndexOf(']');
    const o1 = t.indexOf('{'), o2 = t.lastIndexOf('}');
    const tries = [];
    if (a >= 0 && b > a && (o1 < 0 || a < o1)) tries.push(t.slice(a, b + 1));
    if (o1 >= 0 && o2 > o1) tries.push(t.slice(o1, o2 + 1));
    for (const c of tries) { try { return JSON.parse(c); } catch (e) { /* 次の候補へ */ } }
    return null;
  }

  const KEYS = {
    name:    ['name', 'productname', 'product_name', 'product', '製品名', '商品名'],
    un:      ['un', 'un_number', 'unnumber', 'un番号', '国連番号'],
    cls:     ['class', 'cls', 'hazard_class', 'hazardclass', 'クラス', '等級', '国連分類'],
    pg:      ['pg', 'packing_group', 'packinggroup', '容器等級'],
    pi:      ['pi', 'packing_instruction', 'packinginstruction', '梱包方法'],
    fireLaw: ['firelaw', 'fire_law', '消防法', '国内消防法'],
    psn:     ['psn', 'proper_shipping_name', 'propershippingname', '正式品名', '品名'],
    flash:   ['flash', 'flash_point', 'flashpoint', '引火点'],
    src:     ['source', 'src', '出典', '資料'],
  };
  function _pick(rec, names) {
    const low = {};
    Object.keys(rec || {}).forEach(k => { low[String(k).toLowerCase().replace(/\s+/g, '')] = rec[k]; });
    for (const n of names) { const v = low[n]; if (v != null && String(v).trim() !== '') return String(v).trim(); }
    return '';
  }
  // 画面の選択肢（select の option の文言）。取得できなければ空配列＝そのまま通す
  function _opts(id) {
    const el = $(id);
    return el ? Array.from(el.options || []).map(o => o.text).filter(t => t && !/^[—-]/.test(t)) : [];
  }
  function _normUn(v) {
    const m = String(v).replace(/\s+/g, '').match(/(\d{4})/);
    return m ? 'UN' + m[1] : (/^(n\/?a|none|なし|-)$/i.test(v) ? '' : String(v).slice(0, 10));
  }
  function _normClass(v, opts) {
    const m = String(v).match(/(\d(?:\.\d)?)/);
    if (!m) return String(v);
    const hit = opts.find(o => o.indexOf('クラス' + m[1] + '（') === 0);
    return hit || String(v);
  }
  function _normPg(v, opts) {
    const s = String(v).trim();
    if (!s || /^(n\/?a|none|なし|-|―|該当なし)$/i.test(s)) return s ? (opts.find(o => o === '該当なし') || '') : '';
    const m = s.match(/\b(III|II|I)\b/i) || s.match(/PG\s*([123])/i) || s.match(/([123])\s*$/);
    let g = m ? m[1].toUpperCase() : '';
    if (g === '1') g = 'I'; else if (g === '2') g = 'II'; else if (g === '3') g = 'III';
    const hit = g && opts.find(o => o.replace(/（.*$/, '').trim() === 'PG ' + g);
    return hit || s;
  }
  function _normFireLaw(v, opts) {
    const s = String(v).trim();
    if (!s) return '';
    if (/非該当|該当しない|対象外|not\s*applicable|n\/a/i.test(s)) return opts.find(o => o === '非該当') || s;
    const m = s.match(/第?\s*([1-6１-６])\s*類/);
    if (m) {
      const n = String.fromCharCode(m[1].charCodeAt(0) >= 0xFF10 ? m[1].charCodeAt(0) - 0xFEE0 : m[1].charCodeAt(0));
      const hit = opts.find(o => o.indexOf('第' + n + '類') === 0);
      if (hit) return hit;
    }
    return s;
  }

  // 回答テキスト → 危険品エントリの配列（{name,un,cls,pg,pi,fireLaw,psn,flash,src}）。取り出せなければ null
  function parseHazmatAiReply(text) {
    const data = _extractJson(text);
    if (data == null) return null;
    let list = Array.isArray(data) ? data : null;
    if (!list && typeof data === 'object') {
      const k = Object.keys(data).find(x => Array.isArray(data[x]));
      list = k ? data[k] : [data];
    }
    const oc = _opts('hz-class'), op = _opts('hz-pg'), of = _opts('hz-fire-law');
    const seen = new Set(), out = [];
    list.forEach(rec => {
      if (!rec || typeof rec !== 'object') return;
      const e = {
        name:    _pick(rec, KEYS.name).slice(0, 80),
        un:      _normUn(_pick(rec, KEYS.un)),
        cls:     _normClass(_pick(rec, KEYS.cls), oc),
        pg:      _normPg(_pick(rec, KEYS.pg), op),
        pi:      _pick(rec, KEYS.pi).replace(/^PI\s*/i, '').slice(0, 20),
        fireLaw: _normFireLaw(_pick(rec, KEYS.fireLaw), of),
        psn:     _pick(rec, KEYS.psn).slice(0, 80),
        flash:   _pick(rec, KEYS.flash).slice(0, 30),
      };
      const src = _pick(rec, KEYS.src).slice(0, 60);
      if (src) e.src = src;
      if (!e.name && !e.un && !e.psn) return;           // 中身のない件は除く
      const key = [e.un, e.psn.toLowerCase(), e.name].join('|');
      if (seen.has(key)) return;                         // 同じ内容の重複は 1 件に
      seen.add(key); out.push(e);
    });
    return out;
  }
  window.parseHazmatAiReply = parseHazmatAiReply;

  // 「取り込む」ボタン
  window.hzAiImport = function () {
    const ta = $('hzAiReply');
    const msg = $('hzAiMsg');
    const text = (ta?.value || '').trim();
    const say = (t, bad) => { if (msg) { msg.textContent = t; msg.classList.toggle('is-bad', !!bad); } };
    if (!text) { say('AI の回答を貼り付けてください', true); return; }
    const list = parseHazmatAiReply(text);
    if (list == null) { say('回答から JSON を読み取れませんでした。プロンプトのとおり「JSON 配列のみ」で回答させてください', true); return; }
    if (!list.length) { say('取り込める危険品が見つかりませんでした（UN番号・正式品名・製品名がありません）', true); return; }
    const n = typeof window.importHazEntries === 'function' ? window.importHazEntries(list) : 0;
    if (!n) { say('取り込みに失敗しました', true); return; }
    if (ta) ta.value = '';
    say('✅ ' + n + ' 件を取り込みました。🤖要確認の印を、SDS・IMDG と照合してから押して「照合済み」にしてください');
    toast('🤖 危険品を ' + n + ' 件取り込みました（要確認）', 'success', 4000);
  };
})();
