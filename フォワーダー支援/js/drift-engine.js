/* ===================================================================
 * ゆらぎ（表記ゆれ）チェックの判定エンジン（純粋関数・ブラウザと Node 共用／2026-11）
 *
 * 画面（js/drift-check.js）が集めた「同じ読みでまとまった表記のグループ」と、いまのマスター・別名の状態を受け取り、
 * 次の 3 つに仕分けして返す。**データには触らない**（登録・書き換えは drift-check.js が行う）。
 *
 *   auto   ① 自動対応：グループの中に決まった代表（マスター／すでに登録済みの別名の代表）が 1 つだけあり、
 *            まだ別名になっていない表記がある → その代表の別名にしてよい（正規化すると完全に同じ読みなので安全）
 *   pick   ② 要確認：同じ読みの表記が複数あるが代表（マスター）が無い → 人が代表を選ぶ（提案は件数の多いもの）
 *   near   ② 要確認：読みは違うが似ている別々の名前（綴りの違い・社名の一部＝略称） → 人が「同じ／別物」を決める
 *   human  ③ 人間が判断：代表が複数ある（どちらに寄せるか）・単位（意味が変わりうる）など、自動では扱わない
 *
 * 数字だけが違う名前（20GP と 40GP など）は、似ていても別物として扱う。
 * =================================================================== */
(function (root) {
  'use strict';

  const FORM_SEP = '\x03';
  const core = k => { const i = k.indexOf(FORM_SEP); return i < 0 ? k : k.slice(0, i); };
  const formOf = k => { const i = k.indexOf(FORM_SEP); return i < 0 ? '' : k.slice(i + 1); };
  const digits = s => (s.match(/\d+/g) || []).join(',');
  const isCjk = s => /[぀-ヿ㐀-鿿]/.test(s);

  // 編集距離（隣り合う 2 文字の入れ替えも 1 回と数える：Maersk ⇄ Maesrk）。max を超えたら途中で打ち切る
  function levenshtein(a, b, max) {
    if (a === b) return 0;
    const n = a.length, m = b.length;
    if (Math.abs(n - m) > max) return max + 1;
    let prev2 = null, prev = new Array(m + 1), cur = new Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++) {
      cur[0] = i;
      let rowMin = cur[0];
      for (let j = 1; j <= m; j++) {
        const c = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
        if (prev2 && i > 1 && j > 1 && a.charCodeAt(i - 1) === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === b.charCodeAt(j - 1)) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      const t = prev2; prev2 = prev; prev = cur; cur = t || new Array(m + 1);
    }
    return prev[m];
  }

  // 2 つの正規化キーが「似ているが別の名前」かどうか。似ていれば {score, reason}、そうでなければ null
  const pre = k => ({ form: formOf(k), core: core(k), dg: digits(core(k)) });
  function similar(field, ka, kb) { return similarPre(field, pre(ka), pre(kb)); }
  function similarPre(field, A, B) {
    if (A.form && B.form && A.form !== B.form) return null;   // 法人格の種類が違う（株式会社／有限会社…）は別の会社
    const a = A.core, b = B.core;
    if (!a || !b || a === b) return null;
    if (A.dg !== B.dg) return null;                            // 数字が違う名前（20GP／40GP・便番号など）は別物
    const [s, l] = a.length <= b.length ? [a, b] : [b, a];
    // 社名の一部（略称）：お客様・サブコンだけ。品名・港・単位は短い語が多く誤検出になるため見ない
    if ((field === 'customer' || field === 'sv') && s.length >= (isCjk(s) ? 3 : 4) && l.includes(s) && s.length / l.length >= 0.5) {
      return { score: s.length / l.length, reason: '一方がもう一方を含みます（略称・社名の一部かもしれません）' };
    }
    // 綴りの違い：1 文字違い（5 文字以上）か、全体の 15% 以内の違い（7 文字以上）
    const len = Math.max(a.length, b.length);
    if (len >= 5) {
      const maxD = len >= 7 ? Math.max(1, Math.floor(len * 0.15)) : 1;
      const d = levenshtein(a, b, maxD);
      if (d <= maxD) return { score: 1 - d / len, reason: '綴りがよく似ています（' + d + ' 文字違い）' };
    }
    return null;
  }

  // 末尾の括弧書き（例：SHANGHAI HAOHUAN(COSCO)）→ {base:括弧の前, inner:括弧の中}。括弧書きが無ければ null
  function parenOf(v) {
    const m = String(v).match(/^(.*?)\s*[(（]\s*([^()（）]*?)\s*[)）]\s*$/);
    return m && m[1].trim() && m[2].trim() ? { base: m[1].trim(), inner: m[2].trim().toLowerCase() } : null;
  }
  const pairKey = (field, a, b) => field + '\x00' + (a < b ? a + '\x00' + b : b + '\x00' + a);

  /**
   * opts: {
   *   field, normalize(value)->key,
   *   groups: [{variants:[{value,count}]}],          // 同じ読みでまとまった表記（stats.js の _groupSimilar の結果）
   *   masters: Set|Array  代表（マスター／別名グループの代表）の名前,
   *   aliasMap: {別名: 代表}                          // すでに登録された別名
   *   dismissed: Set 「別物」と決めた組（pairKey）,
   *   humanOnly: true なら自動・提案をせず ③ にだけ出す（単位）
   * }
   */
  function analyze(opts) {
    const field = opts.field, norm = opts.normalize;
    const masters = new Set(opts.masters || []);
    const aliasMap = opts.aliasMap || {};
    const dismissed = opts.dismissed || new Set();
    const excluded = new Set(opts.excluded || []);   // 統計で「≠（別物として扱う）」にした表記は、近似の候補にも出さない
    const out = { auto: [], pick: [], near: [], human: [] };

    const reps = [];   // 近似比較の代表：{value, key, count, canonical}
    (opts.groups || []).forEach(g => {
      const vs = (g.variants || []).filter(v => v && v.value);
      if (!vs.length) return;
      const live = vs.filter(v => !aliasMap[v.value]);                    // まだ別名になっていない表記
      const targets = new Set();                                            // この読みの代表候補
      vs.forEach(v => { if (masters.has(v.value)) targets.add(v.value); else if (aliasMap[v.value]) targets.add(aliasMap[v.value]); });
      const liveMasters = live.filter(v => masters.has(v.value));
      const toAlias = live.filter(v => !masters.has(v.value));

      if (opts.humanOnly) {
        if (vs.length > 1) out.human.push({ kind: 'unit', variants: vs, note: '単位は意味が変わりうる（/CBM と /RT など）ため、自動では統合しません' });
      } else if (targets.size === 1 && toAlias.length) {
        const canonical = [...targets][0];
        toAlias.forEach(v => { if (!dismissed.has(pairKey(field, v.value, canonical))) out.auto.push({ canonical, alias: v.value, count: v.count }); });   // 「元に戻した」「別物」と決めた組は自動にしない
      } else if (targets.size >= 2) {
        out.human.push({ kind: 'multi-master', variants: vs, masters: [...targets], note: '代表（マスター）が複数あります。どれに寄せるかは人が決めます' });
      } else if (targets.size === 0 && live.length >= 2) {
        const sorted = live.slice().sort((a, b) => b.count - a.count);
        out.pick.push({ variants: sorted, suggested: sorted[0].value });
      }
      // 近似の比較に使う代表（グループごとに 1 つ：代表があればその名前、なければ件数の多い表記）
      const best = (targets.size === 1 ? vs.find(v => v.value === [...targets][0]) : null) || vs.slice().sort((a, b) => b.count - a.count)[0];
      reps.push({ value: best.value, key: norm(best.value), count: vs.reduce((s, v) => s + v.count, 0), isMaster: masters.has(best.value) || targets.size === 1, canonical: targets.size === 1 ? [...targets][0] : best.value });
    });

    if (!opts.humanOnly) {
      // 似ている別々の名前。長さの近いものだけ比べて、組み合わせの数を抑える
      const items = reps.filter(r => !excluded.has(r.value)).map(r => Object.assign(r, pre(r.key))).filter(r => r.core.length >= 3);
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const A = items[i], B = items[j];
          // 括弧の中だけが違う（SHANGHAI HAOHUAN(COSCO)／(ONTO) など）：括弧の中は「どの取引先向けか」を表すことが多く、綴りの間違いではない。
          // 同じ会社の別の表記なのか別の取引先なのかは、人が決める
          const pa = parenOf(A.value), pb = parenOf(B.value);
          if (pa && pb && pa.inner !== pb.inner && norm(pa.base) === norm(pb.base)) {
            const kp = pairKey(field, A.value, B.value);
            if (!dismissed.has(kp) && A.canonical !== B.canonical) out.human.push({ kind: 'paren', pair: [A.value, B.value], variants: [{ value: A.value, count: A.count }, { value: B.value, count: B.count }], note: '括弧の中だけが違います。同じ会社の別の表記なのか、別の取引先なのかは人が決めます' });
            continue;
          }
          const sim = similarPre(field, A, B);
          if (!sim) continue;
          const k = pairKey(field, A.value, B.value);
          if (dismissed.has(k)) continue;
          // すでに同じ代表にまとまっている組は出さない
          if (A.canonical === B.canonical) continue;
          // 提案：代表（マスター）があればそちらへ、なければ件数の多い方へ
          let keep = A, move = B;
          if (B.isMaster && !A.isMaster) { keep = B; move = A; }
          else if (A.isMaster === B.isMaster && B.count > A.count) { keep = B; move = A; }
          out.near.push({ a: A.value, b: B.value, aCount: A.count, bCount: B.count, score: sim.score, reason: sim.reason, suggest: { canonical: keep.canonical, alias: move.value } });
        }
      }
      out.near.sort((x, y) => y.score - x.score || (y.aCount + y.bCount) - (x.aCount + x.bCount));
    }
    return out;
  }

  const api = { analyze, similar, levenshtein, pairKey, parenOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DriftEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
