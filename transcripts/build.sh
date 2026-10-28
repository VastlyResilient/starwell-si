#!/usr/bin/env bash
# Builds app/index.html (the page published as the claude.ai artifact) from the parts in src/.
set -euo pipefail
cd "$(dirname "$0")"
cat src/head.html src/pipeline.js src/views.js src/reader.js src/accounts.js src/tail.js > app/index.html
# syntax-check the page script
sed -n '/<script type="module">/,/<\/script>/p' app/index.html | sed '1d;$d' > /tmp/starwell-check.mjs
node --check /tmp/starwell-check.mjs
echo "Built app/index.html ($(wc -c < app/index.html) bytes)"
