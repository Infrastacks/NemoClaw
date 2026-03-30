#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 Infrastacks Inc. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { echo -e "${GREEN}[prepare-build]${NC} $1"; }
warn() { echo -e "${YELLOW}[prepare-build]${NC} $1"; }
fail() { echo -e "${RED}[prepare-build]${NC} $1"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_CODICERA_ROOT="$(cd "$REPO_DIR/../../Commercial/codicera" && pwd)"
DEFAULT_OPENSHELL_ROOT="$(cd "$REPO_DIR/../OpenShell" && pwd)"

CODICERA_ROOT="${CODICERA_ROOT:-$DEFAULT_CODICERA_ROOT}"
OPENSHELL_ROOT="${OPENSHELL_ROOT:-$DEFAULT_OPENSHELL_ROOT}"
OPENSHELL_REPO="${NEMOCLAW_OPEN_SHELL_REPO:-Infrastacks/OpenShell}"
OPENSHELL_ASSET="${OPENSHELL_ASSET:-openshell-x86_64-unknown-linux-musl.tar.gz}"
OPENSHELL_TARGET_TRIPLE="${OPENSHELL_TARGET_TRIPLE:-x86_64-unknown-linux-musl}"
OPENSHELL_BINARY_SOURCE="${OPENSHELL_BINARY_SOURCE:-}"
OPENSHELL_CARGO_PACKAGE="${OPENSHELL_CARGO_PACKAGE:-openshell-cli}"

CAR_SOURCE_DIR="$CODICERA_ROOT/car"
CAR_DEST_DIR="$REPO_DIR/car"
PREBUILT_DIR="$REPO_DIR/deploy/prebuilt"
PREBUILT_OPEN_SHELL="$PREBUILT_DIR/openshell"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Required command not found: $1"
}

ensure_repo_dir() {
  [ -d "$1" ] || fail "Directory not found: $1"
}

sync_car() {
  ensure_repo_dir "$CAR_SOURCE_DIR"
  mkdir -p "$CAR_DEST_DIR"
  require_cmd rsync

  info "Syncing CAR from $CAR_SOURCE_DIR"
  rsync -a --delete "$CAR_SOURCE_DIR/" "$CAR_DEST_DIR/"
}

download_openshell_release() {
  local tmpdir
  local staged_copy
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' RETURN

  info "Downloading OpenShell release asset from ${OPENSHELL_REPO}" >&2
  if command -v gh >/dev/null 2>&1; then
    GH_TOKEN="${GITHUB_TOKEN:-}" gh release download \
      --repo "$OPENSHELL_REPO" \
      --pattern "$OPENSHELL_ASSET" \
      --dir "$tmpdir"
  else
    require_cmd curl
    curl -fsSL \
      "https://github.com/${OPENSHELL_REPO}/releases/latest/download/${OPENSHELL_ASSET}" \
      -o "$tmpdir/$OPENSHELL_ASSET"
  fi

  require_cmd tar
  tar xzf "$tmpdir/$OPENSHELL_ASSET" -C "$tmpdir"

  [ -f "$tmpdir/openshell" ] || fail "Downloaded asset did not contain an openshell binary"
  staged_copy="$(mktemp /tmp/nemoclaw-openshell-XXXXXX)"
  cp "$tmpdir/openshell" "$staged_copy"
  chmod 755 "$staged_copy"
  printf '%s\n' "$staged_copy"
}

build_openshell_from_source() {
  require_cmd cargo
  ensure_repo_dir "$OPENSHELL_ROOT"

  info "Building OpenShell from local fork source at $OPENSHELL_ROOT" >&2
  (
    cd "$OPENSHELL_ROOT"
    cargo build \
      --release \
      -p "$OPENSHELL_CARGO_PACKAGE" \
      --target "$OPENSHELL_TARGET_TRIPLE"
  )

  local built_bin="$OPENSHELL_ROOT/target/$OPENSHELL_TARGET_TRIPLE/release/openshell"
  [ -f "$built_bin" ] || fail "OpenShell source build completed without producing $built_bin"
  printf '%s\n' "$built_bin"
}

resolve_openshell_binary() {
  if [ -n "$OPENSHELL_BINARY_SOURCE" ]; then
    [ -f "$OPENSHELL_BINARY_SOURCE" ] || fail "OPENSHELL_BINARY_SOURCE does not exist: $OPENSHELL_BINARY_SOURCE"
    printf '%s\n' "$OPENSHELL_BINARY_SOURCE"
    return
  fi

  local candidates=(
    "$OPENSHELL_ROOT/target/$OPENSHELL_TARGET_TRIPLE/release/openshell"
    "$OPENSHELL_ROOT/target/$OPENSHELL_TARGET_TRIPLE/release/openshell-sandbox"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  done

  if command -v cargo >/dev/null 2>&1; then
    if candidate="$(build_openshell_from_source 2>/dev/null)"; then
      printf '%s\n' "$candidate"
      return
    fi
    warn "Local OpenShell source build failed; falling back to ${OPENSHELL_REPO} release asset"
  fi

  if [ -d "$OPENSHELL_ROOT/.git" ] && [ -n "$(git -C "$OPENSHELL_ROOT" status --porcelain)" ]; then
    fail "OpenShell has local changes but no built linux/amd64 binary. Build the fork first or pass OPENSHELL_BINARY_SOURCE."
  fi

  download_openshell_release
}

install_openshell_binary() {
  local source_bin="$1"
  mkdir -p "$PREBUILT_DIR"

  if [ "$(cd "$(dirname "$source_bin")" && pwd)/$(basename "$source_bin")" = "$PREBUILT_OPEN_SHELL" ]; then
    info "OpenShell binary is already staged at $PREBUILT_OPEN_SHELL"
    chmod 755 "$PREBUILT_OPEN_SHELL"
    return
  fi

  info "Installing OpenShell binary from $source_bin"
  cp "$source_bin" "$PREBUILT_OPEN_SHELL"
  chmod 755 "$PREBUILT_OPEN_SHELL"
}

print_summary() {
  local source_bin="$1"
  info "Commercial build inputs are ready"
  echo "  CAR source:        $CAR_SOURCE_DIR"
  echo "  CAR destination:   $CAR_DEST_DIR"
  echo "  OpenShell source:  $source_bin"
  echo "  OpenShell staged:  $PREBUILT_OPEN_SHELL"
}

main() {
  ensure_repo_dir "$REPO_DIR"
  ensure_repo_dir "$CODICERA_ROOT"
  ensure_repo_dir "$OPENSHELL_ROOT"

  sync_car
  local openshell_bin
  openshell_bin="$(resolve_openshell_binary)"
  install_openshell_binary "$openshell_bin"
  print_summary "$openshell_bin"
}

main "$@"
