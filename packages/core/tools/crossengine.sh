#!/usr/bin/env sh
# Compare the simulation hash between Bun (JavaScriptCore) and Node (V8).
set -e
OUT="${1:-./.crossengine}"
mkdir -p "$OUT"
bun packages/core/tools/hashrun.ts > "$OUT/bun.json"
bun build packages/core/tools/hashrun.ts --target=node --outfile="$OUT/hashrun.mjs" > /dev/null
node "$OUT/hashrun.mjs" > "$OUT/node.json"
if cmp -s "$OUT/bun.json" "$OUT/node.json"; then echo "IGUAL: $(cat "$OUT/bun.json")"; else echo "DISTINTO"; cat "$OUT/bun.json" "$OUT/node.json"; exit 1; fi
