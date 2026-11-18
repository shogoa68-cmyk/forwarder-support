// 荷姿の取り込み：合計行（TOTAL・合計 など）は梱包として取り込まない。ブラウザ不要：
//   node scripts/design-tests/packing-import-total-test.js
const fs = require('fs'), vm = require('vm'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../フォワーダー支援/js/quote/packing-import.js'), 'utf8');
const noop = () => {};
const text = { value: '' };
const win = { addEventListener: noop, quoteShowToast: noop };
let got = null;
win.addPackingRowsBulk = rows => { got = rows; return rows.length; };
const doc = { getElementById: id => (id === 'pkiText' ? text : null), querySelector: () => null };
win.document = doc;
vm.runInContext(src, vm.createContext({ window: win, document: doc, console, setTimeout, quoteShowToast: noop }));
let fail = 0;
const chk = (n, c, d) => { console.log((c ? 'OK   ' : 'NG   ') + n + (c ? '' : ' → ' + JSON.stringify(d))); if (!c) fail++; };

text.value = ['P/Style\tQty\tL\tW\tH\tG/W', 'Carton\t10\t50\t40\t30\t12.5', 'Pallet\t1\t120\t100\t110\t300', 'TOTAL\t11\t\t\t\t312.5', '合計\t11\t\t\t\t312.5'].join('\n');
win.pkiParse();
win.pkiInsertRows();
chk('合計行（TOTAL・合計）は取り込まず、梱包の 2 行だけになる', got && got.length === 2 && got[0].pkg === 'Carton' && got[1].pkg === 'Pallet', got);
chk('個数・寸法・重量は表のとおり', got && got[0].qty === 10 && got[0].l === 50 && got[0].kg === 12.5, got);
process.exit(fail ? 1 : 0);
