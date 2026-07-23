#!/usr/bin/env python3
"""
Detached build script — kicks off the vaelorx-agent image build on
Tensorlake and continues in the background. Writes progress to
/tmp/vaelorx-image-build.log.

Runs the build via tensorlake SDK, which uses the
tensorlake-create-sandbox-image.cjs CLI under the hood.

This is a double-fork detached process: parent exits immediately,
child runs in the background, log written to /tmp.
"""
import os
import sys
import time
import subprocess
import signal

LOG_FILE = "/tmp/vaelorx-image-build.log"
PID_FILE = "/tmp/vaelorx-image-build.pid"

def write_log(msg: str) -> None:
    with open(LOG_FILE, "a") as f:
        f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
        f.flush()

def main() -> int:
    # Check binaries exist
    repo = "/home/z/my-project"
    agent_bin = f"{repo}/apps/kortix-sandbox-agent-server/dist/kortix-agent"
    cli_bin = f"{repo}/apps/cli/dist/kortix"
    if not os.path.exists(agent_bin):
        print(f"ERROR: {agent_bin} not found")
        return 1
    if not os.path.exists(cli_bin):
        print(f"ERROR: {cli_bin} not found")
        return 1

    # Required env
    required = ["TENSORLAKE_API_KEY", "TENSORLAKE_ORGANIZATION_ID", "TENSORLAKE_PROJECT_ID"]
    for v in required:
        if not os.environ.get(v):
            print(f"ERROR: {v} not set")
            return 1

    # Truncate log
    with open(LOG_FILE, "w") as f:
        f.write(f"=== VaelorX Image Build — started {time.strftime('%Y-%m-%d %H:%M:%S')} ===\n")
        f.write(f"Agent binary: {os.path.getsize(agent_bin) / 1024 / 1024:.1f} MB\n")
        f.write(f"CLI binary:   {os.path.getsize(cli_bin) / 1024 / 1024:.1f} MB\n")
        f.write(f"Image name:   vaelorx-agent\n")
        f.write(f"Base image:   tensorlake/ubuntu-systemd\n")
        f.write(f"Build resources: 4 vCPU, 16GB RAM\n\n")

    # Kick the shell script — it's already structured to run end-to-end.
    cmd = ["bash", f"{repo}/infra/tensorlake/build-vaelorx-image.sh"]
    env = os.environ.copy()
    proc = subprocess.Popen(
        cmd,
        stdout=open(LOG_FILE, "a"),
        stderr=subprocess.STDOUT,
        cwd=repo,
        env=env,
        # Detach from parent — survives parent exit.
        start_new_session=True,
    )

    with open(PID_FILE, "w") as f:
        f.write(str(proc.pid))

    print(f"Build started in background (PID {proc.pid}).")
    print(f"Log: {LOG_FILE}")
    print(f"PID: {PID_FILE}")
    print(f"Monitor with: tail -f {LOG_FILE}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
