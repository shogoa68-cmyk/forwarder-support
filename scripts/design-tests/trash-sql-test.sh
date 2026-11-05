#!/usr/bin/env bash
# ゴミ箱（段階 1）SQL を、使い捨ての本物の Postgres で試す。
#   使い方: bash scripts/design-tests/trash-sql-test.sh
#   前提  : Postgres 16 が入っていること（/usr/lib/postgresql/16/bin）。pg_cron は無くても通る。
#   後始末: 使い捨てのデータベースは終了時に自動で消す。
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PORT="${PGPORT:-54329}"
# postgres は root で動かせないので、postgres ユーザーが入れる場所に作る
WORK="$(mktemp -d /var/tmp/trash-pg.XXXXXX)"
chmod 755 "$WORK"
cp "$REPO/docs/sql/trash-quote-presets.sql" "$WORK/target.sql"
cp "$REPO/scripts/design-tests/trash-sql-test.sql" "$WORK/test.sql"
chmod 644 "$WORK"/*.sql

if [ "$(id -u)" = "0" ]; then
  RUN() { su postgres -s /bin/bash -c "$*"; }
  chown postgres "$WORK"
else
  RUN() { bash -c "$*"; }
fi

cleanup() {
  RUN "$PGBIN/pg_ctl -D $WORK/data stop -m immediate >/dev/null 2>&1" || true
  rm -rf "$WORK"
}
trap cleanup EXIT

RUN "$PGBIN/initdb -D $WORK/data -A trust >/dev/null"
RUN "$PGBIN/pg_ctl -D $WORK/data -o \"-p $PORT -k $WORK -c listen_addresses=''\" -l $WORK/log -w start >/dev/null"
RUN "$PGBIN/psql -h $WORK -p $PORT -d postgres -v target=$WORK/target.sql -f $WORK/test.sql" 2>&1 \
  | sed -e 's/^psql:[^ ]* //' -e 's/^WARNING:  //'
