import { execSync } from "child_process";

/**
 * Kill any stale process listening on the given TCP port.
 * Returns the first PID that was killed, or null if no process was found.
 */
export function killStalePortProcess(port: number): number | null {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
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
      try {
        console.warn(`Killing stale process on port ${port} (PID ${pid})`);
        process.kill(pid, "SIGKILL");
        if (firstKilled === null) firstKilled = pid;
      } catch (killErr: any) {
        // ESRCH = process already exited between lsof and kill — safe to ignore
        if (killErr?.code !== "ESRCH") {
          console.warn(`Failed to kill PID ${pid}:`, killErr?.message);
        }
      }
    }
    return firstKilled;
  } catch (err: any) {
    // lsof exits with status 1 when no process is found — expected happy path
    if (err?.status === 1) return null;
    // Log unexpected errors (missing lsof binary, permission issues, etc.)
    console.warn("Port cleanup failed:", err?.message ?? err);
    return null;
  }
}
