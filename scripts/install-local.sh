#!/usr/bin/env bash
# Install the local dsh-tUI rowcap + model/effort env loader for the current user.
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
bin="$HOME/.local/rowcap-bin"
src="$root/patches/dsh-tui"

install -d "$bin"
install -m 755 "$src/dsh" "$bin/dsh"
install -m 644 "$src/loader.mjs" "$src/hooks.mjs" "$bin/"

add_path() {
  local file="$1"
  [[ -f "$file" ]] || touch "$file"
  if ! grep -q 'dsh-rowcap' "$file"; then
    cp "$file" "$file.bak-rowcap-$(date +%Y%m%dT%H%M%S)"
    printf '\n# dsh-rowcap: raise dsh-TUI rendered-row cap to 600\n# remove this block and ~/.local/rowcap-bin to revert\nexport PATH="$HOME/.local/rowcap-bin:$PATH"\n' >> "$file"
  fi
}

# Login shells reset PATH in .profile after .bashrc, so the line must be last in both.
add_path "$HOME/.bashrc"
add_path "$HOME/.profile"

printf 'installed: %s\n' "$bin"
printf 'check:     command -v dsh  ->  %s/dsh\n' "$bin"
printf 'next:      open a new shell and run: dsh --version\n'
printf 'plugin:    dsh plugin --profile tui add %s/dist/dsh-tui-compact-tech-0.4.0.tgz\n' "$root"
