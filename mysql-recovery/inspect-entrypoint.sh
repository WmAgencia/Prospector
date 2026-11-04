#!/bin/sh
set -eu
printf '%s\n' '[mysql recovery] inspecting existing persistent volume; no database files will be deleted'
df -h /var/lib/mysql || true
df -i /var/lib/mysql || true
find /var/lib/mysql -maxdepth 1 -type f -name 'binlog.*' -exec ls -lh {} \; 2>/dev/null || true
printf '%s\n' '[mysql recovery] starting MySQL with binary logging disabled to prevent new binlog growth'
exec docker-entrypoint.sh mysqld --skip-log-bin
