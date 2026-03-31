#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 Infrastacks Inc. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

REGISTRY_NAME="${ACR_REGISTRY_NAME:-codiceraimages}"
IMAGE_NAME="${NEMOCLAW_IMAGE_NAME:-nemoclaw}"
IMAGE_TAG="${NEMOCLAW_IMAGE_TAG:-latest}"
IMAGE_REF="${IMAGE_NAME}:${IMAGE_TAG}"
# ACR agent pool for faster builds (Rust compile needs CPU).
# Create once: az acr agentpool create -r codiceraimages -n build-pool --tier S2 --count 1
AGENT_POOL="${ACR_AGENT_POOL:-}"

"$SCRIPT_DIR/prepare-commercial-build.sh"

EXTRA_ARGS=()
if [ -n "$AGENT_POOL" ]; then
  EXTRA_ARGS+=(--agent-pool "$AGENT_POOL")
fi

exec az acr build \
  --registry "$REGISTRY_NAME" \
  --platform linux/amd64 \
  -t "$IMAGE_REF" \
  -f "$REPO_DIR/deploy/Dockerfile" \
  ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} \
  "$REPO_DIR"
