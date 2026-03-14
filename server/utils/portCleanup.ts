import { execSync } from "child_process";

/**
 * Kill any stale process listening on the given TCP port.
 * Returns the PID that was killed, or null if no process was found.
 */
export function killStalePortProcess(port: number): number | null {
  try {
    const output = execSync(`lsof -ti tcp:${port}`, { encoding: "utf8" }).trim();
    if (!output) return null;
    // lsof may return multiple PIDs (one per line); kill them all
    const pids = output
      .split("\n")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    let firstKilled: number | null = null;
    for (const pid of pids) {
      // Never kill our own process
      if (pid === process.pid) continue;
      console.warn(`Killing stale process on port ${port} (PID ${pid})`);
      process.kill(pid, "SIGKILL");
      if (firstKilled === null) firstKilled = pid;
    }
    return firstKilled;
  } catch {
    // lsof exits non-zero when no process is found — expected happy path
    return null;
  }
}
