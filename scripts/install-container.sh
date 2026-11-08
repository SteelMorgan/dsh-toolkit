#!/usr/bin/env bash
# Install the dsh-TUI loader into a Docker container.
# Usage: install-container.sh <container> [user]
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
container="${1:?usage: $0 <container> [user]}"
user="${2:-vscode}"

docker cp "$root/patches/dsh-tui" "$container:/tmp/dsh-tui-patch"
docker exec -u "$user" "$container" sh -lc '
set -e
src=/tmp/dsh-tui-patch
bin="$HOME/.local/rowcap-bin"
install -d "$bin"
install -m 755 "$src/dsh" "$bin/dsh"
install -m 644 "$src/loader.mjs" "$src/hooks.mjs" "$bin/"
add_path() {
  file="$1"
  [ -f "$file" ] || touch "$file"
  if ! grep -q "dsh-rowcap" "$file"; then
    cp "$file" "$file.bak-rowcap-$(date +%Y%m%dT%H%M%S)"
    printf "\n# dsh-rowcap: raise dsh-TUI rendered-row cap to 600\nexport PATH=\"\$HOME/.local/rowcap-bin:\$PATH\"\n" >> "$file"
  fi
}
add_path "$HOME/.bashrc"
add_path "$HOME/.profile"
"$bin/dsh" --version
bash -lc "command -v dsh; dsh --version"
'
printf 'installed in %s\n' "$container"
