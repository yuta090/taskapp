#!/bin/bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="taskapp_backup_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"
echo "Starting backup at $(date)..."

pg_dump "$SUPABASE_DB_URL" \
  --no-owner --no-privileges --clean --if-exists \
  | gzip > "${BACKUP_DIR}/${FILENAME}"

echo "Backup completed: ${FILENAME}"
find "$BACKUP_DIR" -name "taskapp_backup_*.sql.gz" -mtime +30 -delete
echo "Old backups cleaned up."
