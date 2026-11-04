#!/bin/sh
set -eu
MYSQL_RECOVERY_DATA_DIR="${MYSQL_RECOVERY_DATA_DIR:-/var/lib/mysql}"
echo '[mysql recovery] inspecting persistent volume'
df -h "$MYSQL_RECOVERY_DATA_DIR" || true
find "$MYSQL_RECOVERY_DATA_DIR" -maxdepth 1 -type f -name 'binlog.*' -exec ls -lh {} \; 2>/dev/null || true
archive_old_binlog() {
  src="$1"
  [ -f "$src" ] || return 0
  tmp="$(mktemp /tmp/consecom-binlog.XXXXXXXX.gz)"
  if ! gzip -c "$src" > "$tmp" || ! gzip -t "$tmp"; then
    echo "[mysql recovery] failed compress/verify $(basename "$src"); leaving original intact"
    rm -f "$tmp"
    return 0
  fi
  before="$(wc -c < "$src")"
  after="$(wc -c < "$tmp")"
  if [ "$after" -ge "$before" ]; then
    echo "[mysql recovery] archive offers no savings: $(basename "$src"); leaving original intact"
    rm -f "$tmp"
    return 0
  fi
  backup="${tmp}.original"
  if ! mv "$src" "$backup"; then
    echo "[mysql recovery] failed to back up $(basename "$src"); leaving original intact"
    rm -f "$tmp" "$backup"
    return 0
  fi
  if cp "$tmp" "${src}.gz" && gzip -t "${src}.gz"; then
    echo "[mysql recovery] archived $(basename "$src"): original=$before compressed=$after bytes"
    rm -f "$backup" "$tmp"
  else
    echo "[mysql recovery] compressed copy failed; restoring original $(basename "$src")"
    rm -f "${src}.gz"
    mv "$backup" "$src"
    rm -f "$tmp"
  fi
}
if [ "${MYSQL_RECOVERY_ARCHIVE_OLD_BINLOGS:-0}" = '1' ]; then
  archive_old_binlog "$MYSQL_RECOVERY_DATA_DIR/binlog.000001"
  archive_old_binlog "$MYSQL_RECOVERY_DATA_DIR/binlog.000002"
  if [ ! -e "$MYSQL_RECOVERY_DATA_DIR/binlog.000001" ] && [ ! -e "$MYSQL_RECOVERY_DATA_DIR/binlog.000002" ] && [ -f "$MYSQL_RECOVERY_DATA_DIR/binlog.000003" ]; then
    printf './binlog.000003\n' > "$MYSQL_RECOVERY_DATA_DIR/binlog.index"
    chown mysql:mysql "$MYSQL_RECOVERY_DATA_DIR/binlog.index" 2>/dev/null || true
    echo '[mysql recovery] binlog index now points only to retained latest log'
  fi
  df -h "$MYSQL_RECOVERY_DATA_DIR" || true
fi
if [ "${MYSQL_RECOVERY_TEST_ONLY:-0}" = '1' ]; then
  echo '[mysql recovery] test only; no server started'
  exit 0
fi
echo '[mysql recovery] starting official MySQL entrypoint with binary logging disabled'
exec docker-entrypoint.sh mysqld --skip-log-bin
