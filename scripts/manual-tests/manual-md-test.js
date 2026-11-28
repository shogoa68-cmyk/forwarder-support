// マニュアルの原稿の読み取り（scripts/lib/manual-md.js）と見張りの判定の試験。ブラウザ不要。
//   node scripts/manual-tests/manual-md-test.js
'use strict';
const M = require('../lib/manual-md.js');
let pass = 0, fail = 0;
const ok = (c, n, x) => { if (c) pass++; else { fail++; console.log('✗ NG:', n, x === undefined ? '' : JSON.stringify(x)); } };

const src = [
  '---', 'id: demo', 'title: デモ', 'group: はじめに', 'order: 5', 'level: 初級', 'open: tab-x', 'covers: tab-x, tab-y', 'watch: js/a.js,  js/b.js', 'updated: 2026-11-01', '---',
  'はじめの段落で **太字** と `保存` と [別の章](#manual:other)。', '', '## 見出し', '- いち', '- に', '', '1. 一', '2. 二', '', '> 💡 ひとこと',
  '<script>alert(1)</script>', '',
  '```lesson', 'id: les', 'title: 練習', 'open: tab-x', 'step: - | 説明だけ', 'click: .btn | 押す', 'else: .alt | 代わり', 'step: #z | 最後', '```',
].join('\n');
const c = M.parseChapter(src, 'demo.md');
ok(c.id === 'demo' && c.order === 5 && c.covers.join() === 'tab-x,tab-y' && c.watch.join() === 'js/a.js,js/b.js', '設定：一覧はカンマで分ける', c);
ok(/<b>太字<\/b>/.test(c.html) && /<code>保存<\/code>/.test(c.html) && /data-man="other"/.test(c.html), '本文：太字・ボタン名・章へのリンク');
ok(/<h3>見出し<\/h3>/.test(c.html) && /<ul><li>いち<\/li><li>に<\/li><\/ul>/.test(c.html) && /<ol><li>一<\/li>/.test(c.html) && /man-note/.test(c.html), '本文：見出し・箇条書き・番号・囲み');
ok(!/<script>/.test(c.html) && /&lt;script&gt;/.test(c.html), '本文：HTML は文字として出す（スクリプトを埋め込めない）');
ok(c.lessons.length === 1 && c.lessons[0].steps.length === 3, '練習：手順を読む（else は直前の手順の代わり）', c.lessons);
const st = c.lessons[0].steps;
ok(st[0].sel === '' && !st[0].wait && st[1].sel === '.btn' && st[1].wait && st[1].alt && st[1].alt.sel === '.alt' && st[1].alt.text === '代わり', '練習：- は場所なし・click は押すと進む・else の中身', st);
ok(/data-lesson="les"/.test(c.html), '本文：練習の置き場所');
ok(!/\*\*|`/.test(c.text) && /別の章/.test(c.text), '検索用の文字：書式の記号は外す');

const inv = M.featureInventory('<button class="cat-btn" aria-controls="tab-x" data-desc="説明X">✨ X</button><button class="cat-btn cat-more-btn" aria-controls="panel">p</button><button class="cat-btn foo" role="tab" aria-controls="tab-z" title="Z の説明">Z <span>▾</span></button><button class="cat-btn" aria-controls="tab-x">重複</button>');
ok(inv.length === 2 && inv[0].tab === 'tab-x' && inv[0].desc === '説明X' && inv[1].label === 'Z ▾' && inv[1].desc === 'Z の説明', '画面の一覧：.cat-btn の tab- だけ・重複なし', inv);

const other = M.parseChapter('---\nid: other\ntitle: 他\nupdated: 2026-11-20\nwatch: js/c.js\ncovers: tab-z\n---\n本文', 'o.md');
const bad = M.parseChapter('---\nid: demo\ntitle: 同じ id\nupdated: きのう\n---\n[x](#manual:nope)', 'bad.md');
const r = M.checkChapters([c, other], inv.concat([{ tab: 'tab-new', label: '新しい画面' }]), (w, d) => (w.includes('js/a.js') ? [{ date: '2026-11-05', hash: 'abc', subject: '改修' }] : []), '', (w) => w !== 'js/b.js');
ok(r.missing.length === 1 && r.missing[0].tab === 'tab-new', '見張り①：どの章にも無い画面を見つける', r.missing);
ok(r.stale.length === 1 && r.stale[0].id === 'demo' && r.stale[0].changes[0].subject === '改修', '見張り②：見直し後にプログラムが変わった章', r.stale);
ok(r.problems.some(p => /js\/b\.js/.test(p)), '見張り③：無い watch のファイル', r.problems);
const r2 = M.checkChapters([c, bad], [], () => [], '', () => true);
ok(r2.problems.some(p => /重なって/.test(p)) && r2.problems.some(p => /日付/.test(p)) && r2.problems.some(p => /nope/.test(p)), '見張り③：id の重なり・日付の形・無い章へのリンク', r2.problems);

// 本物の原稿：誤りが無いこと
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '../../docs/マニュアル');
const all = fs.readdirSync(dir).filter(f => /\.md$/.test(f) && f !== 'README.md').map(f => M.parseChapter(fs.readFileSync(path.join(dir, f), 'utf8'), f));
const app = path.join(__dirname, '../../フォワーダー支援');
const real = M.checkChapters(all, M.featureInventory(fs.readFileSync(path.join(app, 'index.html'), 'utf8')), () => [], app, (w) => fs.existsSync(path.join(app, w)));
ok(real.problems.length === 0, '本物の原稿：誤りなし', real.problems);
ok(real.missing.length === 0, '本物の原稿：説明の無い画面なし', real.missing.map(m => m.label));
ok(all.every(ch => ch.title && ch.updated), '本物の原稿：全章に題名と見直し日');

console.log(`manual-md: PASS=${pass} FAIL=${fail}`);
process.exit(fail ? 1 : 0);
