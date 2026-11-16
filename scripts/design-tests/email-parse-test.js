// メール取込（文章からの読み取り）の解析精度の試験。ブラウザ不要：
//   node scripts/design-tests/email-parse-test.js
// 実際のフォワーダーのメールに近い書き方 20 通りを parseQuoteEmail に流し、品名・数量・単位・通貨・単価が合うかを見る。
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../フォワーダー支援/js/quote/email-import.js'), 'utf8');
const noop = () => {};
const el = () => new Proxy(function () {}, { get: (t, k) => (k === 'style' || k === 'dataset' || k === 'classList') ? new Proxy({}, { get: () => noop }) : noop, set: () => true });
const win = { addEventListener: noop, document: null };
const doc = { addEventListener: noop, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], createElement: () => el(), body: el(), readyState: 'complete' };
win.document = doc;
vm.runInContext(src, vm.createContext({ window: win, document: doc, console, localStorage: { getItem: () => null, setItem: noop }, setTimeout, navigator: {} }));
const p = win.parseQuoteEmail;
const C=[
['A 単価×数量（日本語）',"海上運賃 USD 1,200 / 40'HC\nTHC ¥48,000 / 40'",[{name:'海上運賃',ccy:'USD',price:1200,unit:"40'HC"},{name:'THC',ccy:'JPY',price:48000}]],
['B スラッシュ単位',"O/F USD1,500/20GP x 2\nBAF USD 300/20GP",[{name:'O/F',ccy:'USD',price:1500,qty:2},{name:'BAF',ccy:'USD',price:300}]],
['C 英語 per',"Ocean Freight: USD 1,850 per 40HC\nTHC: JPY 48,000 per 40ft\nDOC FEE: JPY 8,000 per B/L",[{name:'Ocean Freight',ccy:'USD',price:1850},{name:'THC',ccy:'JPY',price:48000},{name:'DOC FEE',ccy:'JPY',price:8000}]],
['D 表形式（タブ）',"項目\t単価\t数量\t金額\n海上運賃\tUSD 1,200\t2\tUSD 2,400\nTHC\t¥48,000\t2\t¥96,000",[{name:'海上運賃',ccy:'USD',price:1200,qty:2},{name:'THC',ccy:'JPY',price:48000,qty:2}]],
['E 数量が先',"2×40'HC 海上運賃 USD 1,200",[{name:'海上運賃',ccy:'USD',price:1200,qty:2}]],
['F 範囲',"海上運賃 USD 1,000〜1,200 /20GP",[{name:'海上運賃',ccy:'USD',price:1000}]],
['G 全角数字・全角ドル',"海上運賃　＄１，２００／２０ＧＰ",[{name:'海上運賃',ccy:'USD',price:1200}]],
['H ＄記号・US$',"海上運賃 $1,200 /20GP\nBAF US$300 /20GP",[{name:'海上運賃',ccy:'USD',price:1200},{name:'BAF',ccy:'USD',price:300}]],
['I 円・万円・税込',"通関料 10,000円(税別)\n配送費 35,000円",[{name:'通関料',ccy:'JPY',price:10000},{name:'配送費',ccy:'JPY',price:35000}]],
['J 引用符 >',"> 海上運賃 USD 1,200 /20GP\n> THC ¥48,000 /20GP",[{name:'海上運賃',ccy:'USD',price:1200},{name:'THC',ccy:'JPY',price:48000}]],
['K 日付・電話の誤検出',"2026/11/20 までご回答ください\nTEL 03-1234-5678\n海上運賃 USD 1,200",[{name:'海上運賃',ccy:'USD',price:1200}]],
['L 挨拶・署名の誤検出',"お世話になっております。\n下記の通りご案内いたします。\n海上運賃 USD 1,200\nよろしくお願いいたします。\n山田 太郎\n株式会社ABC 港区芝浦2-11-5",[{name:'海上運賃',ccy:'USD',price:1200}]],
['M 通貨のない数字は取り込まない（何の通貨か分からないため・意図的）',"海上運賃 1200 /20GP\nTHC 48000",[]],
['N R/T 通貨後ろ',"LCL 運賃 JPY 8,500 /RT (Min JPY 3,000)",[{name:'LCL 運賃',ccy:'JPY',price:8500}]],
['O コロン区切り日本語',"海上運賃：USD 1,200（20GP）\nサーチャージ：USD 150（20GP）",[{name:'海上運賃',ccy:'USD',price:1200},{name:'サーチャージ',ccy:'USD',price:150}]],
['P 1行に複数項目',"海上運賃 USD 1,200 + BAF USD 300 + THC ¥48,000",[{name:'海上運賃',ccy:'USD',price:1200},{name:'BAF',ccy:'USD',price:300},{name:'THC',ccy:'JPY',price:48000}]],
['Q 合計行を拾わない',"海上運賃 USD 1,200\nTHC USD 300\nTotal USD 1,500\nご請求合計 ¥200,000",[{name:'海上運賃',ccy:'USD',price:1200},{name:'THC',ccy:'USD',price:300}]],
['R 実費・別途',"通関料 ¥10,000\n関税・消費税 実費\n保管料 別途お見積り",[{name:'通関料',ccy:'JPY',price:10000},{name:'関税・消費税'}]],
['S 通貨コード小文字/円記号JPY後置',"thc jpy 48,000/cntr",[{name:'thc',ccy:'JPY',price:48000}]],
['T 数量単位 台/本',"陸送費 ¥25,000 × 3台",[{name:'陸送費',ccy:'JPY',price:25000,qty:3}]],
];
let ok=0;
for(const [t,body,exp] of C){
  const r=p(body); const items=r.entries.filter(e=>e._kind==='item');
  const bad=[];
  if(items.length!==exp.length) bad.push(`件数 期待${exp.length}/実際${items.length}`);
  exp.forEach((e,i)=>{const a=items[i]; if(!a){return;}
    for(const k of Object.keys(e)){ const av=k==='name'?(a.name||'').trim():a[k]; const ev=e[k];
      if(k==='name'? av!==ev : av!==ev) bad.push(`#${i+1}.${k} 期待[${ev}]/実際[${av}]`);}});
  if(!bad.length){ok++;console.log('OK  ',t);} else {console.log('NG  ',t,'\n      ',bad.join(' | '),'\n       実際:',items.map(i=>`${i.name}|${i.qty}|${i.unit}|${i.ccy}|${i.price}`).join('  //  '));}
}
console.log(`\n${ok}/${C.length} 件が期待どおり`);

// ===== サブコン別ルール（既定の通貨・呼び名の置き換え・既定の単位）=====
let ng = 0;
const chk = (n, c, x) => { console.log((c ? 'OK   ' : 'NG   ') + n + (c ? '' : ' → ' + JSON.stringify(x))); if (!c) ng++; };
const its = r => r.entries.filter(e => e._kind === 'item');
let r = p("海上運賃 1200 /20GP\nTHC 48000", { defaultCcy: 'USD' });
chk('既定の通貨 USD があれば、通貨のない数字も取り込む（要確認・通貨は既定と表示）', its(r).length === 2 && its(r)[0].ccy === 'USD' && its(r)[0].price === 1200 && its(r)[0].unit === '20GP' && its(r)[0].conf === 'low' && its(r)[0].ccyAssumed, its(r));
chk('既定の通貨が無ければ従来どおり取り込まない', its(p("海上運賃 1200 /20GP")).length === 0);
r = p("2026/11/20 までご回答ください\nお問い合わせ 03-1234-5678\n住所 港区芝浦2-11-5 5階\n有効期限 30日間\n数量 5 本\n海上運賃 1200", { defaultCcy: 'USD' });
chk('日付・電話・住所・日数・数量は金額にしない（海上運賃だけ）', its(r).length === 1 && its(r)[0].name === '海上運賃', its(r));
r = p("海上運賃 JPY 1200", { defaultCcy: 'USD' });
chk('通貨が書かれていればそちらを優先（既定で上書きしない）', its(r)[0].ccy === 'JPY', its(r));
r = p("ドキュメント料 USD 50\nTHC USD 300\nターミナル代 USD 80", {});
win.eiApplyRules(r, { aliases: [{ from: 'ドキュメント料', to: 'DOC FEE', cat: 'export-local' }, { from: 'ターミナル', to: 'THC', cat: '' }], unit: 'B/L' });
chk('呼び名の置き換え（完全一致・含む）と既定の単位', its(r)[0].name === 'DOC FEE' && its(r)[0].ruleCat === 'export-local' && its(r)[0].origName === 'ドキュメント料' && its(r)[0].unit === 'B/L' && its(r)[2].name === 'THC' && its(r)[1].ruleHit === undefined, its(r));
r = p("海上運賃 USD 1,200 /20GP");
win.eiApplyRules(r, { aliases: [], unit: 'B/L' });
chk('読み取れた単位は既定の単位で上書きしない', its(r)[0].unit === '20GP', its(r));
process.exit(ok === C.length && ng === 0 ? 0 : 1);
