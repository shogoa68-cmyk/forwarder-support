// cp-proxy を「1 枚のファイル」にまとめる（Supabase ダッシュボードの編集画面に貼り付けて置くため）。
// 元：supabase/functions/cp-proxy/{logic.ts, index.ts}   出力：supabase/cp-proxy-single/index.ts
// 使い方：node scripts/cp-tests/build-cp-proxy-single.mjs
//   ※ 出力ファイルは手で直さない（元の 2 ファイルを直したら、このスクリプトで作り直す）。
//   ※ supabase/functions/ の外に置くのは、CLI の deploy が別の関数として拾わないようにするため。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = path.join(root, 'supabase/functions/cp-proxy');
const out = path.join(root, 'supabase/cp-proxy-single/index.ts');

const logic = readFileSync(path.join(src, 'logic.ts'), 'utf8');
const index = readFileSync(path.join(src, 'index.ts'), 'utf8');

// logic.ts：export を外す（同じファイルの中で使うため）
const logicBody = logic.replace(/^export (const|function|type) /gm, '$1 ');
if (/^export /m.test(logicBody)) throw new Error('logic.ts に未対応の export があります');

// index.ts：logic.ts の import だけ外す（Supabase の import は残す）
const importRe = /^import \{[^}]*\} from '\.\/logic\.ts';\n/m;
if (!importRe.test(index)) throw new Error("index.ts に './logic.ts' の import が見つかりません");
const indexBody = index.replace(importRe, '');

// 先頭のコメントと Supabase の import は index.ts のものを使い、その直後に logic.ts を差し込む
const marker = "import { createClient } from 'npm:@supabase/supabase-js@2';\n";
if (!indexBody.includes(marker)) throw new Error('index.ts の createClient の import が見つかりません');
const header = '// ※ このファイルは scripts/cp-tests/build-cp-proxy-single.mjs が自動で作った「貼り付け用の 1 枚版」です。\n' +
  '//    元は supabase/functions/cp-proxy/{index.ts, logic.ts}。手で直さず、元を直してから作り直してください。\n';
const combined = header + indexBody.replace(marker, () => marker + '\n// ======== logic.ts（判断の部分）ここから ========\n' + logicBody.trimEnd() + '\n// ======== logic.ts ここまで ========\n'); // 関数で渡す：コード中の $ が置換の特殊記号として扱われないように

mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, combined);
console.log('作成:', path.relative(root, out), `(${combined.split('\n').length} 行)`);
