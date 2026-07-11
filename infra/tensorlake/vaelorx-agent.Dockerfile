# ──────────────────────────────────────────────────────────────────────────────
# VaelorX Agent Image for Tensorlake
# ──────────────────────────────────────────────────────────────────────────────
# This image is pre-built with ALL runtime dependencies:
#   - Node.js + npm (for opencode)
#   - opencode-ai (pinned version)
#   - kortix-agent binary (the daemon)
#   - kortix-entrypoint script
#   - kortix CLI binary
#   - git, curl, ca-certificates, tmux, gzip, unzip
#   - 2GB swap file (prevents OOM kills)
#
# When a sandbox boots from this image, the daemon is ready to launch
# immediately — no 3-5 min cold-boot install needed.
#
# Build context: the Suna repo root (same as apps/api/Dockerfile).
# The build needs the kortix-agent binary from the sandbox-agent build stage.
# ──────────────────────────────────────────────────────────────────────────────

FROM tensorlake/ubuntu-systemd:latest

# ── 1. Install apt dependencies (same set as cold-boot setup) ─────────────────
RUN apt-get update -o Acquire::Retries=2 && \
    apt-get install -y --no-install-recommends \
      ca-certificates curl git gzip unzip tmux nodejs npm sudo && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ── 2. Install opencode (pinned version) ─────────────────────────────────────
ARG OPENCODE_VERSION=1.15.10
RUN npm install -g --no-audit --no-fund "opencode-ai@${OPENCODE_VERSION}" && \
    opencode --version

# ── 3. Create runtime directories ────────────────────────────────────────────
RUN mkdir -p /opt/kortix/home/.local/share \
             /opt/kortix/home/.config \
             /opt/kortix/home/.cache \
             /opt/kortix/apps/sandbox \
             /opt/kortix/packages \
             /workspace \
             /ephemeral/kortix-master/opencode \
             /var/run/kortix

# ── 4. Create 2GB swap file (prevents OOM kills during heavy operations) ─────
RUN dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none && \
    chmod 600 /swapfile && \
    mkswap /swapfile && \
    echo '/swapfile none swap sw 0 0' >> /etc/fstab

# ── 5. Copy the kortix-agent binary ──────────────────────────────────────────
# This must match the binary built by apps/api/Dockerfile's sandbox-agent stage.
# In CI, build the sandbox-agent stage first and copy the binary here.
# For local builds, place the binary at context root as `kortix-agent`.
COPY kortix-agent.gz /tmp/kortix-agent.gz
RUN gunzip -c /tmp/kortix-agent.gz > /usr/local/bin/kortix-agent && \
    chmod 755 /usr/local/bin/kortix-agent && \
    chown root:root /usr/local/bin/kortix-agent && \
    rm /tmp/kortix-agent.gz

# ── 6. Copy the kortix CLI binary (optional, for MCP executor) ────────────────
COPY kortix.gz /tmp/kortix.gz
RUN gunzip -c /tmp/kortix.gz > /usr/local/bin/kortix && \
    chmod 755 /usr/local/bin/kortix && \
    chown root:root /usr/local/bin/kortix && \
    rm /tmp/kortix.gz

# ── 7. Copy the entrypoint script ────────────────────────────────────────────
COPY entrypoint.sh /usr/local/bin/kortix-entrypoint
RUN chmod 755 /usr/local/bin/kortix-entrypoint

# ── 8. Set ownership ─────────────────────────────────────────────────────────
RUN chown -R tl-user:tl-user /opt/kortix /workspace /ephemeral 2>/dev/null || true

# ── 9. Verify the binary is executable ───────────────────────────────────────
RUN test -x /usr/local/bin/kortix-agent && echo "OK: kortix-agent executable"

# The image is ready. Sandboxes boot from this image with:
#   Sandbox.create({ image: "vaelorx-agent" })
# The daemon is launched at boot time by the API's provisionSessionSandbox()
# which writes session.env + /etc/pt-env then calls kortix-entrypoint.
