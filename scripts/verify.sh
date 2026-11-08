#!/usr/bin/env bash
# Verify the local loader, its source markers, and the env override on a real dsh-TUI module.
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
bin="$HOME/.local/rowcap-bin"
profile="${DSH_HOME:-$HOME/.dsh}/profiles/tui"
types="$profile/node_modules/@deepseek-harness-tui/dsh-tui/lib/types"

echo "dsh on PATH: $(command -v dsh || echo '<missing>')"
[[ -x "$bin/dsh" ]] || { echo "missing $bin/dsh; run scripts/install-local.sh" >&2; exit 1; }

echo "loader tests:"
node --test "$root/patches/dsh-tui/test/"*.test.mjs

if [[ -f "$types/modelPrefs.js" ]]; then
  echo "markers:"
  grep -n "RENDERED_ROW_CAP" "$types/components/MessageList.js" | head -1 || true
  grep -n "DSH_TUI_MODEL_ROUTE" "$types/modelPrefs.js" | head -1 || true
  grep -n "DSH_TUI_EFFORT" "$types/effortPrefs.js" | head -1 || true

  echo "model env:"
  NODE_OPTIONS="--import=$bin/loader.mjs" \
  DSH_TUI_MODEL_ROUTE='alibaba-token/deepseek-v4.1-flash-1017' \
  node --input-type=module -e "import('file://$types/modelPrefs.js').then(m=>console.log(m.readModelPref()))"

  echo "effort env:"
  NODE_OPTIONS="--import=$bin/loader.mjs" \
  DSH_TUI_EFFORT='max' \
  node --input-type=module -e "import('file://$types/effortPrefs.js').then(m=>console.log(m.resolveEffortDefault('low','high','medium')))"
else
  echo "profile not found: $profile (skipping module probes)" >&2
fi
