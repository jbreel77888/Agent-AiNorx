# ──────────────────────────────────────────────────────────────────────────────
# VaelorX Agent Image for Tensorlake
# ──────────────────────────────────────────────────────────────────────────────
# This image is pre-built with ALL runtime dependencies:
#   - Node.js + npm (for opencode)
#   - opencode-ai (pinned version)
#   - Python 3 + pip3 (for cloudscraper, requests, etc.)
#   - kortix-agent binary (the daemon)
#   - kortix-entrypoint script
#   - kortix CLI binary
#   - git, curl, tmux, gzip, unzip, sudo
#   - ldconfig.real symlink fix (prevents dpkg post-install failures)
#   - 2GB swap file (prevents OOM kills)
#
# When a sandbox boots from this image, the daemon is ready to launch
# immediately — no 3-5 min cold-boot install needed.
# ──────────────────────────────────────────────────────────────────────────────

FROM tensorlake/ubuntu-systemd:latest

# ── 1. Fix ldconfig.real symlink FIRST (prevents dpkg failures) ──────────────
# Some Tensorlake base images don't have /sbin/ldconfig.real, which causes
# ALL apt post-installation scripts to fail with:
#   exec: /sbin/ldconfig.real: not found
# This breaks pip3, wireguard, and every other package install.
RUN ln -sf /usr/sbin/ldconfig /sbin/ldconfig.real 2>/dev/null || true

# ── 2. Install apt dependencies ──────────────────────────────────────────────
# NOTE: ca-certificates is installed separately first to avoid the Tensorlake
# overlay redirect issue (ca-certificates.conf.dpkg-old symlink).
RUN apt-get update -o Acquire::Retries=2 && \
    apt-get install -y --no-install-recommends ca-certificates && \
    apt-get install -y --no-install-recommends \
      curl git gzip unzip tmux nodejs npm sudo \
      python3 python3-pip python3-venv \
      netcat-openbsd wget && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ── 3. Install opencode (pinned version) ─────────────────────────────────────
ARG OPENCODE_VERSION=1.15.10
RUN npm install -g --no-audit --no-fund "opencode-ai@${OPENCODE_VERSION}" && \
    opencode --version

# ── 4. Create runtime directories ────────────────────────────────────────────
RUN mkdir -p /opt/kortix/home/.local/share \
             /opt/kortix/home/.config \
             /opt/kortix/home/.cache \
             /opt/kortix/apps/sandbox \
             /opt/kortix/packages \
             /workspace \
             /ephemeral/kortix-master/opencode \
             /var/run/kortix

# ── 5. Create 2GB swap file (prevents OOM kills during heavy operations) ─────
RUN dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none && \
    chmod 600 /swapfile && \
    mkswap /swapfile && \
    echo '/swapfile none swap sw 0 0' >> /etc/fstab

# ── 6. Copy the kortix-agent binary ──────────────────────────────────────────
COPY kortix-agent.gz /tmp/kortix-agent.gz
RUN gunzip -c /tmp/kortix-agent.gz > /usr/local/bin/kortix-agent && \
    chmod 755 /usr/local/bin/kortix-agent && \
    chown root:root /usr/local/bin/kortix-agent && \
    rm /tmp/kortix-agent.gz

# ── 7. Copy the kortix CLI binary ────────────────────────────────────────────
COPY kortix.gz /tmp/kortix.gz
RUN gunzip -c /tmp/kortix.gz > /usr/local/bin/kortix && \
    chmod 755 /usr/local/bin/kortix && \
    chown root:root /usr/local/bin/kortix && \
    rm /tmp/kortix.gz

# ── 8. Copy the entrypoint script ────────────────────────────────────────────
COPY entrypoint.sh /usr/local/bin/kortix-entrypoint
RUN chmod 755 /usr/local/bin/kortix-entrypoint

# ── 9. Set ownership ─────────────────────────────────────────────────────────
RUN chown -R tl-user:tl-user /opt/kortix /workspace /ephemeral 2>/dev/null || true

# ── 10. Pre-bake scaffold files into /workspace ──────────────────────────────
# These files are created by the daemon's simple-mode boot, but pre-baking them
# saves time and ensures consistency. The daemon will NOT overwrite existing files
# (its scaffold injection checks for existing files first).
COPY scaffold/ /workspace/

# ── 11. Verify everything is working ─────────────────────────────────────────
RUN test -x /usr/local/bin/kortix-agent && \
    opencode --version && \
    python3 --version && \
    pip3 --version && \
    echo "BUILD_OK"
