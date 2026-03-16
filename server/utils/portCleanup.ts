import { execSync } from "child_process";

/**
 * Resolve PIDs listening on a TCP port using the best available tool.
 * Tries lsof first, then fuser, then ss (Linux).
 */
function findPidsOnPort(port: number): number[] {
  // Try lsof (macOS + Linux)
  try {
    const output = execSync(`lsof -ti tcp:${port}`, { encoding: "utf8" }).trim();
    if (output) {
      return output
        .split("\n")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    }
    return [];
  } catch (err: any) {
    // Exit status 1 = no match (expected)
    if (err?.status === 1) return [];
    // lsof not found — fall through to next strategy
  }

  // Try fuser (common on Linux)
  try {
    const output = execSync(`fuser ${port}/tcp`, {
      encoding: "utf8",
      // fuser writes PIDs to stderr
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // fuser outputs space-separated PIDs to stdout (or stderr depending on version)
    const combined = output || "";
    if (combined) {
      return combined
        .split(/\s+/)
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    }
    return [];
  } catch (err: any) {
    // fuser exits 1 when no process is found
    if (err?.status === 1) return [];
    // Try stderr output — some fuser versions write PIDs there
    const stderr = (err?.stderr ?? "").toString().trim();
    if (stderr) {
      const pids = stderr
        .split(/\s+/)
        .map((s: string) => Number(s.trim()))
        .filter((n: number) => Number.isFinite(n) && n > 0);
      if (pids.length > 0) return pids;
    }
    // fuser not found — fall through to next strategy
  }

  // Try ss (Linux, part of iproute2 — almost always available)
  try {
    // ss -tlnp shows listening TCP sockets with process info
    const output = execSync(`ss -tlnp sport = :${port}`, { encoding: "utf8" });
    const pids: number[] = [];
    // Extract pid= values from output like: users:(("node",pid=12345,fd=18))
    const pidRegex = /pid=(\d+)/g;
    let match;
    while ((match = pidRegex.exec(output)) !== null) {
      const pid = Number(match[1]);
      if (Number.isFinite(pid) && pid > 0) {
        pids.push(pid);
      }
    }
    return pids;
  } catch {
    // ss also unavailable — give up
  }

  return [];
}

/**
 * Kill any stale process listening on the given TCP port.
 * Returns the first PID that was killed, or null if no process was found.
 */
export function killStalePortProcess(port: number): number | null {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  try {
    const pids = findPidsOnPort(port);
    if (pids.length === 0) return null;

    let firstKilled: number | null = null;
    for (const pid of pids) {
      // Never kill our own process
      if (pid === process.pid) continue;
      try {
        console.warn(`Killing stale process on port ${port} (PID ${pid})`);
        process.kill(pid, "SIGKILL");
        if (firstKilled === null) firstKilled = pid;
      } catch (killErr: any) {
        // ESRCH = process already exited between lookup and kill — safe to ignore
        if (killErr?.code !== "ESRCH") {
          console.warn(`Failed to kill PID ${pid}:`, killErr?.message);
        }
      }
    }
    return firstKilled;
  } catch (err: any) {
    console.warn("Port cleanup failed:", err?.message ?? err);
    return null;
  }
}
