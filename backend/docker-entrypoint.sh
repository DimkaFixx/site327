#!/bin/sh
set -e

chown -R app:app /app/data
exec su app -s /bin/sh -c "$*"
