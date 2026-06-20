#!/bin/bash
# SessionStart hook: 作業ブランチを origin の既定ブランチ(main)へ安全に自動同期する。
# 目的: 古いブランチのまま改修を進めて「巨大マージのコンフリクト解消でコードが欠落」する
#       事故（例: 添付フィールド消失）を防ぐ。
# 方針(ハイブリッド):
#   - クリーンにマージできる場合のみ自動同期
#   - コンフリクトする場合は自動マージを中止し、警告のみ（手動解消を促す）
#   - 未コミットの変更がある場合も自動マージしない
# リモート(Claude Code on the web)セッションでのみ動作。ローカル(Mac/iCloud)では何もしない。
set -uo pipefail

# リモート環境以外（ローカルの手元作業）では何もしない
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# 既定ブランチを検出（取れなければ main）
DEFAULT_BRANCH="$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')"
[ -z "$DEFAULT_BRANCH" ] && DEFAULT_BRANCH="main"

CUR_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"

# 既定ブランチ上 or 取得失敗時は何もしない
if [ -z "$CUR_BRANCH" ] || [ "$CUR_BRANCH" = "$DEFAULT_BRANCH" ] || [ "$CUR_BRANCH" = "HEAD" ]; then
  exit 0
fi

# 最新の既定ブランチを取得
if ! git fetch origin "$DEFAULT_BRANCH" --quiet 2>/dev/null; then
  echo "⚠️ origin/$DEFAULT_BRANCH の取得に失敗しました（ネットワーク？）。作業前に手動同期を検討してください。"
  exit 0
fi

BEHIND="$(git rev-list --count "HEAD..origin/$DEFAULT_BRANCH" 2>/dev/null || echo 0)"

if [ "${BEHIND:-0}" -eq 0 ] 2>/dev/null; then
  echo "✅ ブランチ '$CUR_BRANCH' は origin/$DEFAULT_BRANCH に追随済みです（同期不要）。"
  exit 0
fi

# 未コミットの変更があれば自動マージしない
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "⚠️ '$CUR_BRANCH' は origin/$DEFAULT_BRANCH より $BEHIND コミット遅れていますが、未コミットの変更があるため自動同期を見送りました。"
  echo "   → コミット/退避後に 'git merge origin/$DEFAULT_BRANCH' を実行してください。"
  exit 0
fi

# クリーンにマージできるか試す。コンフリクト時は中止して警告のみ。
if git merge --no-edit --no-ff origin/"$DEFAULT_BRANCH" --quiet 2>/dev/null; then
  echo "🔄 '$CUR_BRANCH' を origin/$DEFAULT_BRANCH に自動同期しました（$BEHIND コミット取り込み・コンフリクトなし）。"
  echo "   ※ このマージはローカルのみ。push は通常の作業時にまとめて行ってください。"
else
  git merge --abort 2>/dev/null || true
  echo "‼️ '$CUR_BRANCH' は origin/$DEFAULT_BRANCH より $BEHIND コミット遅れており、自動マージするとコンフリクトします。自動マージは中止しました。"
  echo "‼️ 作業を始める前に手動で 'git merge origin/$DEFAULT_BRANCH' を実行し、コンフリクトを慎重に解消してください。"
  echo "   特に index.html / css/quote.css / js/quote/*.js のブロックが意図せず欠落していないか、マージ後の差分を必ず目視確認してください。"
fi

exit 0
