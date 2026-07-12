#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Build and register the vaelorx-agent image on Tensorlake.
#
# Prerequisites:
#   - TENSORLAKE_API_KEY env var set
#   - TENSORLAKE_ORGANIZATION_ID env var set
#   - TENSORLAKE_PROJECT_ID env var set
#   - Python tensorlake SDK installed (pip install tensorlake)
#   - The kortix-agent binary built (run from repo root):
#       cd apps/kortix-sandbox-agent-server && bun install && bun build --compile ...
#
# Usage:
#   ./build-vaelorx-image.sh
#
# What this script does:
#   1. Builds the kortix-agent binary (if not present)
#   2. Gzips the binaries
#   3. Copies the entrypoint script + scaffold files
#   4. Builds the Docker image using Tensorlake's image builder (4 CPU, 16GB RAM)
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
echo "[1/6] Preparing build context..."
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/scaffold/.vaelorx/memory"
mkdir -p "$BUILD_DIR/scaffold/.vaelorx/opencode/agents"
mkdir -p "$BUILD_DIR/scaffold/.vaelorx/opencode/skills"
mkdir -p "$BUILD_DIR/scaffold/.vaelorx/opencode/tools"
cp "$REPO_ROOT/infra/tensorlake/vaelorx-agent.Dockerfile" "$BUILD_DIR/Dockerfile"
cp "$REPO_ROOT/apps/sandbox/entrypoint.sh" "$BUILD_DIR/entrypoint.sh"

# Copy scaffold files
cp "$REPO_ROOT/packages/starter/templates/base/.vaelorx/memory/MEMORY.md" "$BUILD_DIR/scaffold/.vaelorx/memory/"
cp "$REPO_ROOT/packages/starter/templates/base/.vaelorx/opencode/agents/vaelorx.md" "$BUILD_DIR/scaffold/.vaelorx/opencode/agents/"
cp "$REPO_ROOT/packages/starter/templates/base/.vaelorx/opencode/agents/memory-reflector.md" "$BUILD_DIR/scaffold/.vaelorx/opencode/agents/" 2>/dev/null || true
cp -r "$REPO_ROOT/packages/starter/templates/base/.vaelorx/opencode/tools/"* "$BUILD_DIR/scaffold/.vaelorx/opencode/tools/" 2>/dev/null || true
cp -r "$REPO_ROOT/packages/starter/templates/base/.vaelorx/opencode/skills/"* "$BUILD_DIR/scaffold/.vaelorx/opencode/skills/" 2>/dev/null || true
cp "$REPO_ROOT/packages/starter/templates/base/vaelorx.toml" "$BUILD_DIR/scaffold/" 2>/dev/null || true
cp "$REPO_ROOT/packages/starter/templates/base/.gitignore" "$BUILD_DIR/scaffold/" 2>/dev/null || true

echo "  Scaffold files prepared"

# ── 2. Build/gzip the kortix-agent binary ────────────────────────────────────
echo "[2/6] Preparing kortix-agent binary..."
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
echo "[3/6] Preparing kortix CLI binary..."
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
echo "[4/6] Building image on Tensorlake (4 CPU, 16GB RAM)..."
cd "$BUILD_DIR"

python3 << PYEOF
from tensorlake import Image
import os

build_dir = "$BUILD_DIR"

image = (
    Image(name="$IMAGE_NAME", base_image="tensorlake/ubuntu-systemd")
    .run("echo '#!/bin/sh' > /sbin/ldconfig.real && chmod +x /sbin/ldconfig.real")
    .run("apt-get update -o Acquire::Retries=2 && apt-get install -y --no-install-recommends -o Dpkg::Options::=--force-confdef curl git gzip unzip tmux nodejs npm sudo python3 python3-pip python3-venv netcat-openbsd wget && apt-get clean && rm -rf /var/lib/apt/lists/*")
    .run("npm install -g --no-audit --no-fund opencode-ai@1.15.10")
    .run("mkdir -p /opt/kortix/home/.local/share /opt/kortix/home/.config /opt/kortix/home/.cache /opt/kortix/apps/sandbox /opt/kortix/packages /workspace /ephemeral/kortix-master/opencode /var/run/kortix")
    .run("dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none && chmod 600 /swapfile && mkswap /swapfile")
    .copy("kortix-agent.gz", "/tmp/kortix-agent.gz")
    .run("gunzip -c /tmp/kortix-agent.gz > /usr/local/bin/kortix-agent && chmod 755 /usr/local/bin/kortix-agent && rm /tmp/kortix-agent.gz")
    .copy("kortix.gz", "/tmp/kortix.gz")
    .run("gunzip -c /tmp/kortix.gz > /usr/local/bin/kortix && chmod 755 /usr/local/bin/kortix && rm /tmp/kortix.gz")
    .copy("entrypoint.sh", "/usr/local/bin/kortix-entrypoint")
    .run("chmod 755 /usr/local/bin/kortix-entrypoint")
    .copy("scaffold", "/workspace/")
    .run("chown -R tl-user:tl-user /opt/kortix /workspace /ephemeral 2>/dev/null || true")
    .run("test -x /usr/local/bin/kortix-agent && opencode --version && python3 --version && pip3 --version && echo BUILD_OK")
)

print("Building image...", flush=True)
result = image.build(
    registered_name="$IMAGE_NAME",
    context_dir=build_dir,
    verbose=True,
    cpus=4.0,
    memory_mb=16384,
)
print(f"BUILD_SUCCESS: {result}", flush=True)
PYEOF

echo "  Image built and registered as: $IMAGE_NAME"

# ── 5. Verify ────────────────────────────────────────────────────────────────
echo "[5/6] Verifying image..."
python3 -c "
from tensorlake import list_sandbox_images
images = list_sandbox_images()
for img in (images or []):
    if '$IMAGE_NAME' in (img.get('name', '')):
        print(f'  Found: {img[\"name\"]} | size={img.get(\"snapshot_size_bytes\", 0) / 1024 / 1024:.1f} MB')
" 2>/dev/null || echo "  (verification skipped)"

# ── 6. Done ──────────────────────────────────────────────────────────────────
echo "[6/6] Done!"
echo ""
echo "Image '$IMAGE_NAME' is ready."
echo "Sandboxes can now be created with: Sandbox.create({ image: '$IMAGE_NAME' })"
