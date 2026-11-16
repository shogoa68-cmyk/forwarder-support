// サイバーポート画面の操作手順書(PDF)を作る。
// 使い方: node scripts/screenshots/make-cyberport-manual.js <cyberport-samples.js の出力先> <出力PDF>
// 画像は cyberport-samples.js が作る marked/ を使う（データはすべて架空）。
const path = require('path'), fs = require('fs');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const dir = path.resolve(process.argv[2]), out = path.resolve(process.argv[3] || 'サイバーポート操作手順.pdf');
const img = (f) => 'file://' + path.join(dir, 'marked', f);
const steps = [
 ['1. 画面を開いて、つながっているか確かめる', '01_接続を確認.png', [
  '上の段の「🚢 サイバーポート」をクリックします。','画面の右上に、つながっているかの札が出ます（未確認＝灰色／つながっている＝緑）。','「接続を確認」を押すと、サイバーポートに問い合わせて確かめます。','画面には「取引」「本船の動静」「コンテナの状況」の3つのタブがあります。'],
  '※ この画面は「読み取りのみ」です。ここから何かを書き換えたり、送信したりすることはありません。'],
 ['2. 取引を調べる', '02_取引を検索.png', [
  '検索欄に取引番号・B/L番号・ブッキング番号・社内管理番号を入れます（空のままなら、直近30日に更新された取引が出ます）。','「取引を検索」を押します。','左に結果の一覧が出ます。並び順は一覧の上で変えられます。','一覧の1件をクリックすると、右にくわしい内容が出ます。']],
 ['3. 本船の動静を調べる', '03_本船の動静.png', [
  '「輸入」か「輸出」を選びます（コンテナの状況と共通です）。','港を一覧から選びます。','必要なら本船名を入れて「本船の動静を調べる」を押します。','並び順を変えられます（入港が早い順・カットが近い順・要注意が先、など）。','左の一覧から本船を選びます。色の丸は、緑＝順調／黄＝カットが間近／赤＝カットを過ぎた／灰＝情報なし。','右に「本船の流れ」が縦に出ます（入港→荷役→搬入→CYオープン→CFSカット→CYカット→出港）。「いまここ」が今の段階です。'],
  '※ 動静は、調べた日の前後2週間のものだけを表示します。'],
 ['4. 一覧にない港を調べるとき', '04_港の選び方（一覧に無い港）.png', [
  '港の選択で「その他（港コードを入力）」を選びます。','出てきた欄に、5文字の港コード（UN/LOCODE）を入れます。例：JPTYO＝東京、JPSDJ＝仙台。'],
  '※ 港の一覧は、サイバーポートの登録に合わせて自動で更新されます。'],
 ['5. コンテナの状況を調べる（輸入）', '05_コンテナの状況（輸入・期限の色）.png', [
  '「輸入」を選びます。','コンテナ番号か B/L番号を入れます。','「コンテナの状況を調べる」を押します。','注意が必要な数が、タブの横に「要注意 n」と出ます。','一覧の上の「超過」「48時間以内」を押すと、その色のものだけに絞れます。','期限の色：赤＝搬出期限・返却期限を過ぎた／黄＝あと48時間以内／緑＝順調／灰＝情報なし。','右の「いまの流れ」で、CY搬入→通関→DO入手→搬出可否→搬出期限→返却期限のどこまで進んだか分かります。']],
 ['6. すべての項目を見る', '06_すべての項目を見る.png', [
  '流れの下の「すべての項目を見る」を押すと、ターミナル・通関・フリータイム・返却場所など、取れた情報が全部出ます。もう一度押す（「閉じる」）と元に戻ります。'],
  '※ サイバーポートに情報が無い項目は、空欄ではなく「COLINSに情報なし」と書かれます。'],
 ['7. コンテナの状況を調べる（輸出）', '07_コンテナの状況（輸出）.png', [
  '「輸出」を選びます。','ブッキング番号を入れて調べます。','一覧から選びます。黄色は「止まっている・予定を過ぎている」ものです。','右に輸出の流れが出ます（空コン搬出→実入り搬入→ゲートイン→通関→船積可否→荷役→船積）。「情報なし」の点線の丸は、COLINSにまだ情報が無い段階です。']],
];
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const sec = steps.map(([t, f, items, note]) => `<section><h2>${esc(t)}</h2><img src="${img(f)}">
<ol>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ol>${note ? `<p class=note>${esc(note)}</p>` : ''}</section>`).join('');
const html = `<!doctype html><meta charset=utf-8><style>
body{font-family:"IPAGothic","Noto Sans JP",sans-serif;color:#222;font-size:11pt;line-height:1.7}
h1{font-size:22pt;margin:0 0 4mm;border-bottom:3px solid #1e3a5f;padding-bottom:3mm}
h2{font-size:14pt;margin:0 0 3mm;color:#1e3a5f;border-left:6px solid #1e3a5f;padding-left:3mm}
section{break-inside:avoid;margin-bottom:9mm}
img{width:100%;border:1px solid #ccc;border-radius:2mm;display:block;margin-bottom:3mm}
ol{margin:0;padding-left:0;list-style:none;counter-reset:n}
li{counter-increment:n;margin-bottom:1.2mm;padding-left:8mm;position:relative}
ol li::before{content:counter(n);position:absolute;left:0;top:1mm;width:5.5mm;height:5.5mm;border-radius:50%;background:#d6336c;color:#fff;font-size:9pt;text-align:center;line-height:5.5mm}
ul li{padding-left:0;list-style:disc;margin-left:5mm}
.note{background:#fff7e0;border-left:4px solid #e0a020;padding:2mm 3mm;margin:2mm 0 0}
.lead{background:#eef3f8;padding:3mm 4mm;border-radius:2mm}
.mob{display:flex;gap:6mm;justify-content:center}.mob figure{margin:0;width:48%}.mob img{margin:0}
.mob ol{margin-top:3mm}
.small{font-size:9pt;color:#666}
</style>
<h1>サイバーポート画面 操作手順</h1>
<p class=lead>サイバーポートにある取引・本船・コンテナの情報を、フォワーダー支援の中で見るための画面です。<b>読み取り専用</b>で、情報を書き換えることはできません。<br>画像のピンクの丸の番号は、各手順の番号に対応しています。</p>
<div style="height:6mm"></div>
${sec}
<section><h2>8. スマホで使う</h2><div class=mob>
<figure><img src="${img('08_スマホ_一覧.png')}"><ol><li>港を選びます。</li><li>「本船の動静を調べる」を押します。</li><li>一覧から本船をタップします。</li></ol></figure>
<figure><img src="${img('09_スマホ_詳細.png')}"><ol><li>「← 一覧へ戻る」で一覧に戻ります。</li><li>本船の流れが縦に出ます。</li></ol></figure></div>
<p class=note>スマホでは「一覧→詳細」の順に画面が切り替わります。</p></section>
<section><h2>困ったとき</h2><ul>
<li>「接続できません」と出る：しばらくしてから「接続を確認」をもう一度押してください。続くときは管理者に連絡します。</li>
<li>結果が0件：番号の入力ミス、または調べる範囲（輸入／輸出）の選び間違いがないか確認してください。</li>
<li>「COLINSに情報なし」：サイバーポート側にまだ情報が無い状態です。時間をおいて調べ直してください。</li>
<li>画面の下の「開発者向け情報」は、不具合の調査用です。普段は閉じたままで大丈夫です。</li></ul>
<p class=small>※ 画像のデータはすべて架空のものです（本船名・番号・取引先は実在しません）。</p></section>`;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const f = path.join(dir, '_manual.html'); fs.writeFileSync(f, html);
  await p.goto('file://' + f); await p.waitForTimeout(500);
  await p.pdf({ path: out, format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '14mm', left: '14mm', right: '14mm' } });
  await b.close(); fs.unlinkSync(f); console.log('OK', out);
})();
