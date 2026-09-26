#!/usr/bin/env bash
#
# Faunterra Data Station — one-command install for macOS.
#
#   ./desktop/install.sh
#
# Builds the app and the command-line tools, sets up the API key, optionally
# installs the daily pull as a launchd agent, and opens the app.
#
# Three things here change your machine beyond this repository: installing a
# Rust toolchain, copying the app into /Applications, and scheduling a daily
# background job. Each one asks first. Everything else is confined to this
# directory. Pass --yes to accept all three without prompting.

set -euo pipefail

DESKTOP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="Faunterra Data Station"

# Where the installed app keeps its key, its archive and its logs.
#
# Not the checkout. A bundled .app launched from /Applications has no useful
# working directory, and a binary must never depend on where it was compiled.
# Every tool here resolves this the same way (ebird_core::resolve_root), so
# there is one place to put the key rather than one per program.
FAUNTERRA_HOME="${FAUNTERRA_ROOT:-$HOME/.faunterra}"
ASSUME_YES=0
[[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]] && ASSUME_YES=1

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
step()  { printf '\n\033[1;32m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
info()  { printf '    %s\n' "$*"; }
warn()  { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
die()   { printf '\n\033[1;31m  x %s\033[0m\n\n' "$*" >&2; exit 1; }

ask() {   # ask "question" -> 0 for yes
  [[ $ASSUME_YES -eq 1 ]] && return 0
  local reply
  read -r -p "    $1 [y/N] " reply </dev/tty || return 1
  [[ "$reply" =~ ^[Yy]$ ]]
}

# ── 0. Platform ───────────────────────────────────────────────
# The app builds on macOS; the schedule installer is launchd-only. Failing
# here with a reason beats failing three minutes in with a linker error.
[[ "$(uname -s)" == "Darwin" ]] || die \
  "This installer is macOS-only (found $(uname -s)).
     The tools themselves build anywhere — see desktop/README.md — but the
     .app bundle and the launchd agent are macOS."

bold ""
bold "  Faunterra Data Station"
info "  source : $DESKTOP_DIR"
info "  data   : $FAUNTERRA_HOME"

# ── 1. Toolchains ─────────────────────────────────────────────
step "Checking prerequisites"

if ! command -v cargo >/dev/null 2>&1; then
  # Try the standard rustup location before concluding it is missing — a fresh
  # rustup install does not affect a shell that was already open.
  # shellcheck source=/dev/null
  [[ -f "$HOME/.cargo/env" ]] && . "$HOME/.cargo/env"
fi

if command -v cargo >/dev/null 2>&1; then
  info "rust    $(rustc --version 2>/dev/null || echo present)"
else
  warn "Rust is not installed. It builds the app and every tool here."
  if ask "Install it now via rustup (the official installer)?"; then
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path
    # shellcheck source=/dev/null
    . "$HOME/.cargo/env"
    info "rust    $(rustc --version)"
  else
    die "Install Rust from https://rustup.rs and run this again."
  fi
fi

command -v node >/dev/null 2>&1 || die \
  "Node is not installed — the Tauri CLI needs it to bundle the .app.
     Install it from https://nodejs.org or with: brew install node"
info "node    $(node --version)"

xcode-select -p >/dev/null 2>&1 || die \
  "Xcode Command Line Tools are missing — macOS needs them to link.
     Install them with: xcode-select --install"
info "xcode   command line tools present"

# ── 2. The API key ────────────────────────────────────────────
step "API key"

mkdir -p "$FAUNTERRA_HOME"
chmod 700 "$FAUNTERRA_HOME"

ENV_FILE="$FAUNTERRA_HOME/.env.local"
if [[ -f "$ENV_FILE" ]] && grep -qE '^[[:space:]]*EBIRD_API_TOKEN[[:space:]]*=[[:space:]]*[^[:space:]]' "$ENV_FILE"; then
  info "already set in $ENV_FILE"
else
  info "Get a free key at https://ebird.org/api/keygen"
  warn "Use a DEDICATED Faunterra eBird account, not your personal one."
  info "eBird suspends API abuse at the account level, so a runaway job on a"
  info "personal account can cost you your own checklist history."
  echo
  # -s so the key is never echoed to the terminal and never lands in
  # scrollback or a screen share.
  read -r -s -p "    Paste the eBird API key (leave blank to skip): " TOKEN </dev/tty || TOKEN=""
  echo
  if [[ -n "$TOKEN" ]]; then
    touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
    if grep -q '^[[:space:]]*EBIRD_API_TOKEN' "$ENV_FILE" 2>/dev/null; then
      # BSD sed needs the empty -i argument; this script is macOS-only.
      sed -i '' "s|^[[:space:]]*EBIRD_API_TOKEN.*|EBIRD_API_TOKEN=$TOKEN|" "$ENV_FILE"
    else
      printf 'EBIRD_API_TOKEN=%s\n' "$TOKEN" >> "$ENV_FILE"
    fi
    grep -q '^[[:space:]]*EBIRD_REGIONS' "$ENV_FILE" 2>/dev/null || \
      printf 'EBIRD_REGIONS=IN\n' >> "$ENV_FILE"
    info "written to $ENV_FILE (chmod 600)"
  else
    warn "Skipped. The app will open and say the key is missing."
    warn "Add it to $ENV_FILE later and reopen."
  fi
fi

# ── 3. Build ──────────────────────────────────────────────────
step "Building the command-line tools"
info "First run compiles ~200 crates; later runs are seconds."
( cd "$DESKTOP_DIR" && cargo build --release -p ebird-core --bins )
info "pull · signals · analyze · schedule · fixture → target/release/"

step "Building the app"
( cd "$DESKTOP_DIR" && npm install --silent && npm run build )

APP_PATH="$(find "$DESKTOP_DIR/target" -maxdepth 5 -name "$APP_NAME.app" -type d 2>/dev/null | head -1)"
[[ -n "$APP_PATH" ]] || die "The build finished but no $APP_NAME.app was produced."
info "$APP_PATH"

# ── 4. Install ────────────────────────────────────────────────
step "Installing"
INSTALLED="/Applications/$APP_NAME.app"
if ask "Copy it to /Applications?"; then
  rm -rf "$INSTALLED"
  cp -R "$APP_PATH" "$INSTALLED"
  info "$INSTALLED"
  APP_PATH="$INSTALLED"
else
  info "Left in place. It runs fine from there."
fi

# ── 5. The daily pull ─────────────────────────────────────────
# Offered, never assumed. This is the part that matters most — the API serves
# a rolling 30-day window and a day not archived is not recoverable — but a
# background job the owner did not agree to is still a background job the
# owner did not agree to.
step "Daily pull"
info "The eBird API serves a rolling ~30-day window. A day that is not"
info "archived before it falls out cannot be retrieved later, at any price."
echo
SCHEDULE=( env "FAUNTERRA_ROOT=$FAUNTERRA_HOME" "$DESKTOP_DIR/target/release/schedule" )
if "${SCHEDULE[@]}" --check >/dev/null 2>&1; then
  if ask "Install the daily pull (launchd, 09:15 local)?"; then
    "${SCHEDULE[@]}" --install
  else
    info "Skipped. Install it later with:"
    info "  FAUNTERRA_ROOT=$FAUNTERRA_HOME $DESKTOP_DIR/target/release/schedule --install"
  fi
else
  warn "Preflight did not pass, so the agent was not offered. Details:"
  "${SCHEDULE[@]}" --check || true
fi

# ── 6. Open ───────────────────────────────────────────────────
step "Opening $APP_NAME"
open "$APP_PATH" || die \
  "Could not open it. If macOS says the developer cannot be verified,
     right-click the app and choose Open, or run:
       xattr -dr com.apple.quarantine \"$APP_PATH\""

echo
bold "  Done."
info "Press Pull now in the window to build your first archive days."
info "Before any 30-day backfill, run this once — it spends a single request"
info "and tells you what the endpoint actually returns:"
info "  $DESKTOP_DIR/target/release/pull --probe"
echo
info "Key and archive live in $FAUNTERRA_HOME — not in the checkout, so"
info "pulling new code never touches your data."
echo
