#!/usr/bin/env node
/**
 * Supabase 適用台帳（SQL と Edge Function を Supabase に「渡した／未渡し」を管理する）
 *
 * - Edge Function は supabase/functions/<名前>/ と貼り付け用 supabase/<名前>-single/ をひとまとめ（1 関数＝1 件）にして、
 *   全ファイルの指紋で「渡した版から変わったか」を見る。印のキーは fn:<名前>（例：fn:cp-proxy）
 *   ※ Secrets（鍵）・Verify JWT の設定はコードではないので、この台帳では追えない（--note にメモする）
 *
 * - 全ブランチ（origin/*）と作業ツリーの docs/sql/*.sql・docs/supabase-*.sql を自動で集める
 *   → 別セッション（別ブランチ）で作った SQL も拾える（まだ push されていないものは拾えない）
 * - 「渡し済み」の印は docs/sql-ledger.json に持つ（ファイルごとに、渡した時点の内容の指紋つき）
 *   → 渡したあとに SQL を書き換えると「変更あり」になり、再実行が必要か気づける
 * - docs/Supabase適用台帳.md は、このスクリプトが作る（手で直さない）
 *
 * 使い方:
 *   node scripts/sql-ledger.js                  台帳（md）を作り直して要約を表示（--fetch で先に git fetch）
 *   node scripts/sql-ledger.js --pending        未渡し・変更ありの SQL を 1 つにまとめて出力（貼り付け用）
 *   node scripts/sql-ledger.js --mark a.sql cp-proxy [--date 2026-11-12] [--note メモ]
 *                                               「渡し済み」にする（SQL は docs/sql/ 以降だけでも可。関数は名前だけ）
 *   node scripts/sql-ledger.js --mark-unknown   「不明（過去分）」をまとめて「渡し済み」にする
 *   node scripts/sql-ledger.js --unmark a.sql   印を外す（未渡しに戻す）
 *   node scripts/sql-ledger.js --json           状態を JSON で出力（別のツール用）
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const MARKS_FILE = path.join(ROOT, 'docs', 'sql-ledger.json');
const MD_FILE = path.join(ROOT, 'docs', 'Supabase適用台帳.md');
const MAIN = 'origin/main';
const PATH_RE = /^docs\/(sql\/[^/]+|supabase-[^/]+)\.sql$/;

function git(args, opts) {
  return execFileSync('git', args, Object.assign({ cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }, opts || {}));
}
function gitTry(args) { try { return git(args); } catch (e) { return ''; } }
const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function today() {
  const d = new Date(Date.now() + 9 * 3600 * 1000); // 日本時間
  return d.toISOString().slice(0, 10);
}
function normPath(p) {
  p = p.replace(/\\/g, '/').replace(/^\.\//, '');
  if (PATH_RE.test(p)) return p;
  if (PATH_RE.test('docs/sql/' + p)) return 'docs/sql/' + p;
  if (PATH_RE.test('docs/' + p)) return 'docs/' + p;
  return p;
}

// ---- 集める ----
function collect() {
  /** path -> { path, blob, source, sourceKind, ts, onMain, branches:Set } */
  const found = new Map();
  const mainBlobs = new Map();
  const mainOk = !!gitTry(['rev-parse', '--verify', '-q', MAIN]).trim();
  if (mainOk) {
    for (const l of lines(gitTry(['ls-tree', '-r', MAIN, '--', 'docs']))) {
      const m = l.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/);
      if (m && PATH_RE.test(m[2])) mainBlobs.set(m[2], m[1]);
    }
  }
  function consider(p, blob, source, kind, ts) {
    const cur = found.get(p);
    const entry = { path: p, blob, source, kind, ts, branches: new Set([source]) };
    if (!cur) { found.set(p, entry); return; }
    cur.branches.add(source);
    // 作業ツリー > 新しいコミット > main
    const rank = (e) => (e.kind === 'worktree' ? 3e12 : e.kind === 'main' ? 0 : e.ts);
    if (rank(entry) > rank(cur)) { entry.branches = cur.branches; found.set(p, entry); }
  }
  // main
  for (const [p, b] of mainBlobs) consider(p, b, MAIN, 'main', 0);
  // 他のブランチ（main との分岐点以降に追加・変更されたもの）
  const refs = lines(gitTry(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'])).filter((r) => r !== 'origin' && r !== 'origin/HEAD' && r !== MAIN);
  const heads = lines(gitTry(['for-each-ref', '--format=%(refname:short)', 'refs/heads']));
  for (const ref of refs.concat(heads)) {
    const changed = lines(mainOk ? gitTry(['diff', '--name-only', '--diff-filter=AM', MAIN + '...' + ref, '--', 'docs']) : gitTry(['ls-tree', '-r', '--name-only', ref, '--', 'docs']));
    for (const p of changed) {
      if (!PATH_RE.test(p)) continue;
      const blob = gitTry(['rev-parse', ref + ':' + p]).trim();
      if (!blob) continue;
      if (mainBlobs.get(p) === blob) continue; // main と同じ内容（取り込み済み）は数えない
      const ts = parseInt(gitTry(['log', '-1', '--format=%ct', ref, '--', p]).trim() || '0', 10);
      consider(p, blob, ref, 'branch', ts);
    }
  }
  // 作業ツリー（まだコミットしていないものも拾う）
  const dirs = [path.join(ROOT, 'docs', 'sql'), path.join(ROOT, 'docs')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const p = 'docs/' + (dir.endsWith('sql') ? 'sql/' : '') + f;
      if (!PATH_RE.test(p) || !fs.existsSync(path.join(ROOT, p))) continue;
      const blob = git(['hash-object', p]).trim();
      if (mainBlobs.get(p) === blob) continue;
      consider(p, blob, '作業ツリー', 'worktree', 0);
    }
  }
  return { found, mainBlobs };
}

// ---- Edge Function ----
const FN_RE = /^supabase\/(?:functions\/([a-z0-9-]+)\/.+|([a-z0-9-]+)-single\/.+)$/;
const fnNameOf = (p) => { const m = p.match(FN_RE); return m ? (m[1] || m[2]) : null; };
const sha1 = (x) => require('crypto').createHash('sha1').update(x).digest('hex');
const fpOf = (files) => sha1([...files.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([p, b]) => p + ' ' + b).join('\n'));
function fnFilesAt(ref) {
  const out = new Map();
  for (const l of lines(gitTry(['ls-tree', '-r', ref, '--', 'supabase']))) {
    const m = l.match(/^\d+ blob ([0-9a-f]+)\t(.+)$/);
    if (!m) continue;
    const n = fnNameOf(m[2]);
    if (!n) continue;
    if (!out.has(n)) out.set(n, new Map());
    out.get(n).set(m[2], m[1]);
  }
  return out;
}
function listRefs(mainOk) {
  const refs = lines(gitTry(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'])).filter((r) => r !== 'origin' && r !== 'origin/HEAD' && r !== MAIN);
  return refs.concat(lines(gitTry(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])));
}
function collectFn() {
  const found = new Map();
  const mainOk = !!gitTry(['rev-parse', '--verify', '-q', MAIN]).trim();
  const mainFns = mainOk ? fnFilesAt(MAIN) : new Map();
  const mainFp = new Map();
  function consider(name, files, source, kind, ts) {
    const entry = { name, files, fp: fpOf(files), source, kind, ts, branches: new Set([source]) };
    const cur = found.get(name);
    if (!cur) { found.set(name, entry); return; }
    cur.branches.add(source);
    const rank = (e) => (e.kind === 'worktree' ? 3e12 : e.kind === 'main' ? 0 : e.ts);
    if (rank(entry) > rank(cur)) { entry.branches = cur.branches; found.set(name, entry); }
  }
  for (const [n, f] of mainFns) { mainFp.set(n, fpOf(f)); consider(n, f, MAIN, 'main', 0); }
  for (const ref of listRefs(mainOk)) {
    const touched = new Set(lines(mainOk ? gitTry(['diff', '--name-only', '--diff-filter=AM', MAIN + '...' + ref, '--', 'supabase']) : gitTry(['ls-tree', '-r', '--name-only', ref, '--', 'supabase'])).map(fnNameOf).filter(Boolean));
    if (!touched.size) continue;
    const at = fnFilesAt(ref);
    for (const n of touched) {
      const files = at.get(n);
      if (!files) continue;
      if (mainFp.get(n) === fpOf(files)) continue;
      const ts = parseInt(gitTry(['log', '-1', '--format=%ct', ref, '--', 'supabase/functions/' + n, 'supabase/' + n + '-single']).trim() || '0', 10);
      consider(n, files, ref, 'branch', ts);
    }
  }
  // 作業ツリー
  const wt = new Map();
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) { walk(full); continue; }
      const rel = path.relative(ROOT, full).replace(/\\/g, '/');
      const n = fnNameOf(rel);
      if (!n) continue;
      if (!wt.has(n)) wt.set(n, new Map());
      wt.get(n).set(rel, git(['hash-object', rel]).trim());
    }
  })(path.join(ROOT, 'supabase'));
  for (const [n, f] of wt) { if (mainFp.get(n) !== fpOf(f)) consider(n, f, '作業ツリー', 'worktree', 0); }
  return { found, mainFp };
}
function fnPurpose(e) {
  const p = 'supabase/functions/' + e.name + '/index.ts';
  const b = e.files.get(p);
  let text = '';
  try { text = e.kind === 'worktree' ? fs.readFileSync(path.join(ROOT, p), 'utf8') : (b ? git(['cat-file', 'blob', b]) : ''); } catch (x) { /* 読めなくてもよい */ }
  for (const l of text.split('\n').slice(0, 15)) {
    const t = l.trim();
    if (t.startsWith('//') && /[^\/=\s\-]/.test(t.slice(2))) return t.replace(/^\/+/, '').trim().replace(/\|/g, '/').slice(0, 70);
  }
  return '';
}

function readFileVersion(e) {
  if (e.kind === 'worktree') return fs.readFileSync(path.join(ROOT, e.path), 'utf8');
  return git(['cat-file', 'blob', e.blob]);
}
function purposeOf(text) {
  for (const l of text.split('\n')) {
    const s = l.trim();
    if (s.startsWith('--') && /[^\-=\s]/.test(s.slice(2))) return s.replace(/^-+/, '').replace(/[=\s]+$/, '').trim().replace(/\|/g, '/').slice(0, 70);
  }
  return '';
}

function loadMarks() {
  try { return JSON.parse(fs.readFileSync(MARKS_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveMarks(marks) {
  const sorted = {};
  Object.keys(marks).sort().forEach((k) => { sorted[k] = marks[k]; });
  fs.writeFileSync(MARKS_FILE, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

const STATUS = {
  pending: '未渡し',
  changed: '変更あり',
  unknown: '不明',
  applied: '渡し済み',
};

function build() {
  const { found, mainBlobs } = collect();
  const marks = loadMarks();
  const rows = [];
  for (const e of found.values()) {
    const m = marks[e.path];
    const onMain = mainBlobs.has(e.path);
    let status;
    if (m && m.status === 'skip') status = 'applied';
    else if (m && m.hash === e.blob) status = 'applied';
    else if (m) status = 'changed';
    else status = onMain ? 'unknown' : 'pending';
    const text = readFileVersion(e);
    rows.push({
      path: e.path, blob: e.blob, status, onMain,
      source: e.kind === 'main' ? 'main' : e.source.replace(/^origin\//, ''),
      branches: [...e.branches].map((b) => b.replace(/^origin\//, '')).filter((b) => b !== 'origin/main'),
      purpose: purposeOf(text),
      mark: m || null,
      text,
    });
  }
  rows.forEach((r) => { r.kind = 'sql'; r.label = r.path; });
  const fnc = collectFn();
  for (const e of fnc.found.values()) {
    const key = 'fn:' + e.name;
    const m = marks[key];
    const onMain = fnc.mainFp.has(e.name);
    let status;
    if (m && m.status === 'skip') status = 'applied';
    else if (m && m.hash === e.fp) status = 'applied';
    else if (m) status = 'changed';
    else status = onMain ? 'unknown' : 'pending';
    const single = 'supabase/' + e.name + '-single/index.ts';
    rows.push({
      kind: 'fn', path: key, label: e.name, blob: e.fp, status, onMain,
      source: e.kind === 'main' ? 'main' : e.source.replace(/^origin\//, ''),
      branches: [...e.branches].map((b) => b.replace(/^origin\//, '')).filter((b) => b !== 'origin/main'),
      purpose: fnPurpose(e), mark: m || null, text: '',
      files: [...e.files.keys()].sort(), single: e.files.has(single) ? single : '',
    });
  }
  rows.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'sql' ? -1 : 1));
  return { rows, marks };
}

function renderMd(rows) {
  const by = (s) => rows.filter((r) => r.status === s);
  const cnt = (s) => by(s).length;
  const esc = (s) => String(s || '').replace(/\|/g, '/');
  let o = '';
  o += '# Supabase 適用台帳（SQL を Supabase に渡したか／まだか）\n\n';
  o += '> ⚙️ **この表は `node scripts/sql-ledger.js` が自動で作ります。手で直さないでください**（印は `docs/sql-ledger.json` に入ります）。\n\n';
  o += '全ブランチ（別セッションで作った分も）と作業ツリーの **SQL**（`docs/sql/*.sql`・`docs/supabase-*.sql`）と **Edge Function**（`supabase/functions/<名前>/`＋貼り付け用 `supabase/<名前>-single/`）を自動で集めて、「渡した／まだ」を表にしています。\n\n';
  o += '> Edge Function は **1 関数＝1 件**。関数のファイルのどれかが変わると「変更あり」。「渡した」は Supabase にデプロイ（またはダッシュボードに貼り付け）したこと。**Secrets（鍵）と Verify JWT の設定はコードではないので追えません**（必要なら `--note` にメモ）。\n\n';
  o += '| 状態 | 件数 | 意味 |\n|---|---|---|\n';
  o += `| 🔴 未渡し | ${cnt('pending')} | 新しい SQL／関数。まだ Supabase で実行（デプロイ）していない（main にも入っていない分を含む） |\n`;
  o += `| 🟠 変更あり | ${cnt('changed')} | 渡し済みの SQL／関数を、そのあと書き換えた。再実行（再デプロイ）が必要か確認する |\n`;
  o += `| ⚪ 不明 | ${cnt('unknown')} | 過去に作った SQL／関数で、渡したか記録がない（確認待ち） |\n`;
  o += `| 🟢 渡し済み | ${cnt('applied')} | 実行・デプロイ済み（日付つき） |\n\n`;
  o += '## 使い方\n\n';
  o += '1. SQL を新しく作る → 台帳には何もしなくてよい（`node scripts/sql-ledger.js` で自動的に「未渡し」に出る）。\n';
  o += '2. 渡していない SQL をまとめて出す：`node scripts/sql-ledger.js --pending`（Supabase の SQL Editor に貼る）。関数は一覧と貼り付け用ファイルの場所が出る。\n';
  o += '3. 実行・デプロイしたら：`node scripts/sql-ledger.js --mark <名前>`（例：`--mark master-news.sql`／`--mark cp-proxy`）。Claude に「○○ を渡した」と伝えても同じ。\n';
  o += '4. 過去分で実行済みのものは `--mark-unknown`（不明をまとめて渡し済みに）か、1 本ずつ `--mark`。\n';
  o += '5. 台帳（このファイル）は `node scripts/sql-ledger.js` で作り直す。**別セッションの分を見るには先に `--fetch`**（全ブランチの最新を取り込む）。\n\n';
  o += '※ まだ push していないブランチの SQL は、その作業ツリーでしか見えません。別セッションの SQL は、そのセッションが push した時点で拾えます。\n';
  o += '※ 台帳ファイルを別ブランチと同時に編集して競合したら、どちらかを採用してから `node scripts/sql-ledger.js` を実行すれば作り直せます（印は json 側。json が競合したら両方の行を残す）。\n\n';

  function table(title, list, withDate) {
    o += `## ${title}（${list.length}）\n\n`;
    if (!list.length) { o += '（なし）\n\n'; return; }
    o += withDate ? '| ファイル | 何のための SQL か | 渡した日 | メモ |\n|---|---|---|---|\n' : '| ファイル | 何のための SQL か | どこにある | メモ |\n|---|---|---|---|\n';
    for (const r of list) {
      const nm = r.kind === 'fn' ? `🧩 関数 \`${r.label}\`` : `\`${r.path}\``;
      if (withDate) o += `| ${nm} | ${esc(r.purpose)} | ${esc(r.mark && r.mark.date)} | ${esc(r.mark && r.mark.note)} |\n`;
      else {
        const where = r.onMain && !r.branches.length ? 'main' : (r.branches.length ? r.branches.join(', ') : 'main');
        const extra = r.status === 'changed' ? `（${esc(r.mark.date)} に渡した版から変更）` : '';
        o += `| ${nm} | ${esc(r.purpose)} | ${esc(where)} | ${extra} |\n`;
      }
    }
    o += '\n';
  }
  table('🔴 未渡し', by('pending'), false);
  table('🟠 変更あり（渡したあとに書き換えた）', by('changed'), false);
  table('⚪ 不明（過去分・実行したか記録なし）', by('unknown'), false);
  table('🟢 渡し済み', by('applied'), true);
  return o;
}

// ---- 実行 ----
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
function opt(name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; }
function positional(after) {
  const out = [];
  for (let i = argv.indexOf(after) + 1; i < argv.length; i++) { if (argv[i].startsWith('--')) { if (['--date', '--note'].includes(argv[i])) i++; continue; } out.push(argv[i]); }
  return out;
}

if (has('--fetch')) { try { execFileSync('git', ['fetch', '-q', '--all'], { cwd: ROOT, stdio: 'ignore' }); } catch (e) { console.error('（git fetch に失敗。いまある情報で続けます）'); } }

const { rows, marks } = build();

if (has('--mark') || has('--mark-unknown')) {
  const date = opt('--date') || today();
  const note = opt('--note') || '';
  let targets;
  if (has('--mark-unknown')) targets = rows.filter((r) => r.status === 'unknown').map((r) => r.path);
  else targets = positional('--mark').map((x) => {
    const n = x.replace(/^fn:/, '');
    return rows.some((r) => r.kind === 'fn' && r.label === n) ? 'fn:' + n : normPath(x);
  });
  if (!targets.length) { console.error('対象のファイルを指定してください（例：--mark master-news.sql）'); process.exit(1); }
  let n = 0;
  for (const p of targets) {
    const r = rows.find((x) => x.path === p);
    if (!r) { console.error('見つかりません（先に --fetch？）: ' + p); continue; }
    marks[p] = { status: 'applied', date, hash: r.blob };
    if (note) marks[p].note = note;
    n++;
  }
  saveMarks(marks);
  console.error(`✅ ${n} 件を「渡し済み（${date}）」にしました`);
} else if (has('--unmark')) {
  for (const p of positional('--unmark').map((x) => { const n = x.replace(/^fn:/, ''); return rows.some((r) => r.kind === 'fn' && r.label === n) ? 'fn:' + n : normPath(x); })) { if (marks[p]) { delete marks[p]; console.error('印を外しました: ' + p); } else console.error('印はありません: ' + p); }
  saveMarks(marks);
}

const final = (has('--mark') || has('--mark-unknown') || has('--unmark')) ? build().rows : rows;

if (has('--pending')) {
  const list = final.filter((r) => r.kind === 'sql' && (r.status === 'pending' || r.status === 'changed'));
  const fns = final.filter((r) => r.kind === 'fn' && (r.status === 'pending' || r.status === 'changed'));
  if (!list.length && !fns.length) { console.error('渡していない SQL・関数はありません 🎉'); process.exit(0); }
  if (list.length) {
    console.log(`-- Supabase の SQL Editor に貼り付けて Run してください（${list.length} 本・何度実行しても安全な書き方のものが大半です）`);
    console.log('-- 実行したら: node scripts/sql-ledger.js --mark <ファイル名>\n');
    for (const r of list) {
      console.log(`-- ============================================================`);
      console.log(`-- FILE: ${r.path}  [${STATUS[r.status]}]  (${r.source})`);
      console.log(`-- ============================================================`);
      console.log(r.text.replace(/\s+$/, '') + '\n');
    }
  }
  if (fns.length) {
    console.error('\n🧩 デプロイが必要な Edge Function（Supabase → Edge Functions。貼り付け用の 1 枚版があればそれを貼る）:');
    for (const r of fns) console.error(`  - [${STATUS[r.status]}] ${r.label}  (${r.source})  貼り付け用: ${r.single || '（なし・supabase CLI でデプロイ）'}\n      実行後: node scripts/sql-ledger.js --mark ${r.label}`);
  }
  process.exit(0);
}
if (has('--json')) {
  console.log(JSON.stringify(final.map((r) => ({ kind: r.kind, path: r.path, status: r.status, source: r.source, purpose: r.purpose, date: r.mark && r.mark.date })), null, 2));
  process.exit(0);
}

fs.writeFileSync(MD_FILE, renderMd(final), 'utf8');
const c = (s) => final.filter((r) => r.status === s).length;
console.log(`台帳を作り直しました: ${path.relative(ROOT, MD_FILE)}`);
console.log(`  🔴 未渡し ${c('pending')} ／ 🟠 変更あり ${c('changed')} ／ ⚪ 不明 ${c('unknown')} ／ 🟢 渡し済み ${c('applied')}`);
for (const r of final.filter((x) => x.status === 'pending' || x.status === 'changed')) console.log(`  - [${STATUS[r.status]}] ${r.kind === 'fn' ? '🧩 関数 ' + r.label : r.path}  (${r.source})`);
