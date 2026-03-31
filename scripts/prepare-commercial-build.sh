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

CAR_SOURCE_DIR="$CODICERA_ROOT/car"
CAR_DEST_DIR="$REPO_DIR/car"
BUILD_CONTEXT_DIR="$REPO_DIR/.build"
OPENSHELL_CONTEXT_DIR="$BUILD_CONTEXT_DIR/openshell-src"
PREBUILT_DIR="$REPO_DIR/deploy/prebuilt"

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

sync_openshell_source() {
  ensure_repo_dir "$OPENSHELL_ROOT"
  mkdir -p "$OPENSHELL_CONTEXT_DIR"
  require_cmd rsync

  info "Syncing OpenShell fork source from $OPENSHELL_ROOT"
  rsync -a --delete \
    --exclude '.git/' \
    --exclude 'target/' \
    --exclude '.direnv/' \
    --exclude '.jj/' \
    --exclude 'node_modules/' \
    "$OPENSHELL_ROOT/" "$OPENSHELL_CONTEXT_DIR/"
}

print_summary() {
  info "Commercial build inputs are ready"
  echo "  CAR source:        $CAR_SOURCE_DIR"
  echo "  CAR destination:   $CAR_DEST_DIR"
  echo "  OpenShell repo:    $OPENSHELL_REPO"
  echo "  OpenShell source:  $OPENSHELL_ROOT"
  echo "  OpenShell staged:  $OPENSHELL_CONTEXT_DIR"
}

main() {
  ensure_repo_dir "$REPO_DIR"
  ensure_repo_dir "$CODICERA_ROOT"
  ensure_repo_dir "$OPENSHELL_ROOT"

  sync_car
  sync_openshell_source
  print_summary
}

main "$@"
