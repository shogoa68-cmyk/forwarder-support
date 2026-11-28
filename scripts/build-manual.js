#!/usr/bin/env node
/**
 * build-manual.js — マニュアルの原稿 → アプリの「📖 マニュアル」のデータ ＋ 機能の改修の見張り
 *
 * 原稿：docs/マニュアル/*.md（README.md は除く）  出力：フォワーダー支援/data/manual.js（手で直さない）
 *
 *   node scripts/build-manual.js            作り直す（見直しが要る章は画面に「見直し待ち」と出る）
 *   node scripts/build-manual.js --check    見張りの結果だけ表示（出力は変えない）。問題があれば終了コード 1
 *   node scripts/build-manual.js --check --json   同じ結果を JSON で（AI の更新作業が読む）
 *   node scripts/build-manual.js --verify   data/manual.js が原稿と食い違っていないか（CI 用）
 *
 * 見張るもの：
 *   ① まだ説明の無い画面（index.html の上段・メニューのボタン＝.cat-btn[aria-controls] のうち、どの章の covers にも無いもの）
 *   ② 見直しが要る章（章の watch に書いたプログラムが、章の updated より後に変更された＝git の記録で判断）
 *   ③ 原稿の誤り（id の重なり・日付の形・存在しない watch・存在しない章へのリンク）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const M = require('./lib/manual-md.js');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'docs', 'マニュアル');
const APP = path.join(ROOT, 'フォワーダー支援');
const OUT = path.join(APP, 'data', 'manual.js');
const args = process.argv.slice(2);
const CHECK = args.includes('--check'), JSON_OUT = args.includes('--json'), VERIFY = args.includes('--verify');

function readSources() {
  const files = fs.readdirSync(SRC).filter(f => /\.md$/.test(f) && f !== 'README.md').sort();
  const raw = files.map(f => ({ f, src: fs.readFileSync(path.join(SRC, f), 'utf8') }));
  const hash = crypto.createHash('sha256').update(raw.map(x => x.f + '\n' + x.src).join('\n\0')).digest('hex').slice(0, 16);
  const chapters = raw.map(x => M.parseChapter(x.src, x.f)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return { chapters, hash };
}

let _shallow = null;
function isShallow() {
  if (_shallow == null) { try { _shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: ROOT }).toString().trim() === 'true'; } catch (e) { _shallow = false; } }
  return _shallow;
}
// updated の日より後に、watch のファイルを変えたコミット（マージは除く）
function changesSince(watch, updated) {
  const paths = watch.map(w => path.join('フォワーダー支援', w));
  try {
    const out = execFileSync('git', ['log', '--no-merges', '--format=%cs%x09%h%x09%s', '--since=' + updated + ' 23:59:59', '--', ...paths], { cwd: ROOT }).toString().trim();
    return out ? out.split('\n').map(l => { const [date, hash, ...s] = l.split('\t'); return { date, hash, subject: s.join('\t') }; }) : [];
  } catch (e) { return []; }
}

function run() {
  const { chapters, hash } = readSources();
  const indexHtml = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  const inventory = M.featureInventory(indexHtml);
  const res = M.checkChapters(chapters, inventory, changesSince, APP, w => fs.existsSync(path.join(APP, w)));

  if (VERIFY) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    const m = /"srcHash":"([0-9a-f]+)"/.exec(cur);
    if (!m || m[1] !== hash) { console.error('❌ data/manual.js が原稿と食い違っています。node scripts/build-manual.js を実行してください'); process.exit(1); }
    console.log('✅ data/manual.js は原稿と一致しています');
    return;
  }

  if (CHECK) {
    if (JSON_OUT) { console.log(JSON.stringify({ shallow: isShallow(), ...res, chapters: chapters.map(c => ({ id: c.id, file: c.file, updated: c.updated, watch: c.watch, covers: c.covers })) }, null, 2)); }
    else {
      if (isShallow()) console.log('⚠ git の履歴が浅い（shallow）ため、見直しの判定が正しくない場合があります（git fetch --unshallow）');
      console.log('📘 マニュアルの見張り（章 ' + chapters.length + ' ／ 画面 ' + inventory.length + '）');
      console.log('\n① まだ説明の無い画面：' + (res.missing.length ? '' : 'なし'));
      res.missing.forEach(f => console.log('  - ' + f.label + '（' + f.tab + '）' + (f.desc ? '：' + f.desc : '')));
      console.log('\n② 見直しが要る章：' + (res.stale.length ? '' : 'なし'));
      res.stale.forEach(s => { console.log('  - ' + s.title + '（' + s.id + '・見直し ' + s.updated + '）変更 ' + s.changes.length + ' 件'); s.changes.slice(0, 8).forEach(c => console.log('      ' + c.date + ' ' + c.hash + ' ' + c.subject)); if (s.changes.length > 8) console.log('      …ほか ' + (s.changes.length - 8) + ' 件'); });
      console.log('\n③ 原稿の誤り：' + (res.problems.length ? '' : 'なし'));
      res.problems.forEach(p => console.log('  - ' + p));
    }
    process.exit(res.missing.length || res.stale.length || res.problems.length ? 1 : 0);
  }

  if (res.problems.length) { console.error('❌ 原稿に誤りがあります：\n  - ' + res.problems.join('\n  - ')); process.exit(1); }
  const staleMap = {};
  res.stale.forEach(s => { staleMap[s.id] = s.changes.length; });
  const latest = chapters.map(c => c.updated).sort().pop() || '';
  const data = {
    srcHash: hash, updated: latest,
    chapters: chapters.map(c => ({ id: c.id, title: c.title, group: c.group, level: c.level, open: c.open, covers: c.covers, updated: c.updated, review: staleMap[c.id] || 0, html: c.html, text: c.text, lessons: c.lessons })),
    missing: res.missing.map(f => ({ tab: f.tab, label: f.label })),
  };
  const js = '// ※ 自動生成（scripts/build-manual.js）。手で直さず docs/マニュアル/*.md を直してから作り直す。\n' +
    'window.MANUAL = ' + JSON.stringify(data) + ';\n';
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, js);
  console.log('✅ ' + path.relative(ROOT, OUT) + ' を作りました（章 ' + chapters.length + '・練習 ' + chapters.reduce((n, c) => n + c.lessons.length, 0) + '・見直し待ち ' + res.stale.length + '・未記載の画面 ' + res.missing.length + '）');
}
run();
