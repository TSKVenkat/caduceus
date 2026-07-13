#!/bin/sh
set -e

UID=${CADUCEUS_UID:-10000}
GID=${CADUCEUS_GID:-10000}

sed -i "s/^caduceus:x:10000:/caduceus:x:$UID:/" /etc/passwd
sed -i "s/^caduceus:x:10000:/caduceus:x:$GID:/" /etc/group

mkdir -p /opt/data/sessions /opt/data/whatsapp/session /opt/data/cache/slack /opt/data/cache/whatsapp
chown -R caduceus:caduceus /opt/data 2>/dev/null || true

exec su-exec caduceus "$@"
