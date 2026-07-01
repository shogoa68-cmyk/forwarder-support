#!/bin/bash
# SessionStart hook: 作業ブランチが origin の既定ブランチ(main)から遅れていないか確認し、
# 遅れていれば「警告のみ」を出す（自動マージはしない）。
# 目的: 古いブランチのまま改修を進めて「巨大マージのコンフリクト解消でコードが欠落」する
#       事故（例: 添付フィールド消失）を防ぐ。
# 方針: 自動マージは行わない。
#   - 自動マージはマージコミット＋main側のGitHub squashコミット(noreply@github.com)を
#     未pushコミットとして持ち込み、コミット署名/著者検証ポリシーと衝突するため。
#   - 代わりに「何コミット遅れているか」を明示し、作業前の手動同期を促す。
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

# 遅れている → 警告のみ（自動マージはしない）
echo "‼️ 注意：ブランチ '$CUR_BRANCH' は origin/$DEFAULT_BRANCH より $BEHIND コミット遅れています。"
echo "   改修を始める前に、最新 main へ同期してください："
echo "       git merge origin/$DEFAULT_BRANCH      （または git rebase origin/$DEFAULT_BRANCH）"
echo "   ※ 同期後はマージ差分を必ず目視確認し、index.html / css/quote.css / js/quote/*.js の"
echo "     ブロックが意図せず欠落していないか確認してください（巨大マージでの欠落事故防止）。"
echo "   ※ 古いブランチのまま大きく改修すると、後で巨大マージのコンフリクト解消でコードを"
echo "     失う恐れがあります。"

exit 0
