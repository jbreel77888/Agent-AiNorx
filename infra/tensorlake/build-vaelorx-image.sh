#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Build and register the vaelorx-agent image on Tensorlake.
#
# Prerequisites:
#   - TENSORLAKE_API_KEY env var set
#   - TENSORLAKE_ORGANIZATION_ID env var set
#   - TENSORLAKE_PROJECT_ID env var set
#   - tl CLI installed (pip install tensorlake)
#   - The kortix-agent binary built (run from repo root):
#       cd apps/kortix-sandbox-agent-server && bun install && bun build --compile ...
#
# Usage:
#   ./build-vaelorx-image.sh
#
# What this script does:
#   1. Builds the kortix-agent binary (if not present)
#   2. Gzips the binaries
#   3. Copies the entrypoint script
#   4. Builds the Docker image using Tensorlake's image builder
#   5. Registers it as "vaelorx-agent"
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE_NAME="vaelorx-agent"
BUILD_DIR="/tmp/vaelorx-image-build"

echo "=== Building vaelorx-agent image for Tensorlake ==="
echo "Repo root: $REPO_ROOT"
echo "Image name: $IMAGE_NAME"
echo ""

# ── 1. Prepare build context ─────────────────────────────────────────────────
echo "[1/5] Preparing build context..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"
cp "$REPO_ROOT/infra/tensorlake/vaelorx-agent.Dockerfile" "$BUILD_DIR/Dockerfile"
cp "$REPO_ROOT/apps/sandbox/entrypoint.sh" "$BUILD_DIR/entrypoint.sh"

# ── 2. Build/gzip the kortix-agent binary ────────────────────────────────────
echo "[2/5] Preparing kortix-agent binary..."
AGENT_BIN="$REPO_ROOT/apps/kortix-sandbox-agent-server/dist/kortix-agent"
if [ ! -f "$AGENT_BIN" ]; then
    echo "  Building kortix-agent binary..."
    cd "$REPO_ROOT/apps/kortix-sandbox-agent-server"
    bun install --frozen-lockfile
    bun build --compile --target=bun-linux-x64 \
        --outfile dist/kortix-agent \
        src/main.ts
    cd "$REPO_ROOT"
fi
gzip -c "$AGENT_BIN" > "$BUILD_DIR/kortix-agent.gz"
echo "  Agent binary: $(du -h "$BUILD_DIR/kortix-agent.gz" | cut -f1)"

# ── 3. Build/gzip the kortix CLI binary ──────────────────────────────────────
echo "[3/5] Preparing kortix CLI binary..."
CLI_BIN="$REPO_ROOT/apps/kortix-sandbox-cli/dist/kortix"
if [ ! -f "$CLI_BIN" ]; then
    echo "  WARN: kortix CLI binary not found at $CLI_BIN"
    echo "  Creating placeholder..."
    mkdir -p "$REPO_ROOT/apps/kortix-sandbox-cli/dist"
    echo '#!/bin/bash' > "$CLI_BIN"
    chmod +x "$CLI_BIN"
fi
gzip -c "$CLI_BIN" > "$BUILD_DIR/kortix.gz"
echo "  CLI binary: $(du -h "$BUILD_DIR/kortix.gz" | cut -f1)"

# ── 4. Build the image on Tensorlake ─────────────────────────────────────────
echo "[4/5] Building image on Tensorlake..."
cd "$BUILD_DIR"
tl sbx image create ./Dockerfile --registered-name "$IMAGE_NAME"
echo "  Image built and registered as: $IMAGE_NAME"

# ── 5. Verify ────────────────────────────────────────────────────────────────
echo "[5/5] Verifying image..."
tl sbx image ls | grep "$IMAGE_NAME" || echo "  WARN: image not found in list"
echo ""
echo "=== Done! ==="
echo "Image '$IMAGE_NAME' is ready."
echo "Sandboxes can now be created with: Sandbox.create({ image: '$IMAGE_NAME' })"
