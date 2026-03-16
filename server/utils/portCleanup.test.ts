import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing the module under test
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { killStalePortProcess } from "./portCleanup";
import { execSync } from "child_process";

const mockExecSync = vi.mocked(execSync);

describe("killStalePortProcess", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(process, "kill").mockImplementation(() => true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("returns null when no process is listening on the port", () => {
    mockExecSync.mockImplementation(() => {
      const err = new Error("lsof: no matching addresses found");
      (err as any).status = 1;
      throw err;
    });

    expect(killStalePortProcess(5000)).toBeNull();
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("kills a single stale process and returns its PID (lsof)", () => {
    mockExecSync.mockReturnValue("12345\n" as any);

    const result = killStalePortProcess(5000);

    expect(result).toBe(12345);
    expect(process.kill).toHaveBeenCalledWith(12345, "SIGKILL");
    expect(mockExecSync).toHaveBeenCalledWith("lsof -ti tcp:5000", {
      encoding: "utf8",
      timeout: 5000,
    });
  });

  it("kills multiple stale processes when lsof returns multiple PIDs", () => {
    mockExecSync.mockReturnValue("12345\n67890\n" as any);

    const result = killStalePortProcess(5000);

    expect(result).toBe(12345);
    expect(process.kill).toHaveBeenCalledWith(12345, "SIGKILL");
    expect(process.kill).toHaveBeenCalledWith(67890, "SIGKILL");
    expect(process.kill).toHaveBeenCalledTimes(2);
  });

  it("returns null when lsof returns empty output", () => {
    mockExecSync.mockReturnValue("" as any);

    expect(killStalePortProcess(5000)).toBeNull();
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("never kills its own process", () => {
    mockExecSync.mockReturnValue(`${process.pid}\n` as any);

    const result = killStalePortProcess(5000);

    expect(result).toBeNull();
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("skips invalid PID values in lsof output", () => {
    mockExecSync.mockReturnValue("12345\nnotanumber\n67890\n" as any);

    killStalePortProcess(5000);

    expect(process.kill).toHaveBeenCalledWith(12345, "SIGKILL");
    expect(process.kill).toHaveBeenCalledWith(67890, "SIGKILL");
    expect(process.kill).toHaveBeenCalledTimes(2);
  });

  it("returns null for invalid port values without calling any commands", () => {
    const callsBefore = mockExecSync.mock.calls.length;
    expect(killStalePortProcess(-1)).toBeNull();
    expect(killStalePortProcess(0)).toBeNull();
    expect(killStalePortProcess(70000)).toBeNull();
    expect(killStalePortProcess(3.14)).toBeNull();
    expect(mockExecSync.mock.calls.length).toBe(callsBefore);
  });

  it("continues killing remaining PIDs when one throws ESRCH", () => {
    mockExecSync.mockReturnValue("12345\n67890\n" as any);
    const killSpy = vi.spyOn(process, "kill").mockImplementation((pid) => {
      if (pid === 12345) {
        const err = new Error("No such process") as any;
        err.code = "ESRCH";
        throw err;
      }
      return true;
    });

    const result = killStalePortProcess(5000);

    // First PID threw ESRCH so wasn't counted as killed; second succeeded
    expect(result).toBe(67890);
    expect(killSpy).toHaveBeenCalledTimes(2);
  });

  it("falls back to fuser when lsof is not available", () => {
    let callCount = 0;
    mockExecSync.mockImplementation((cmd: any) => {
      callCount++;
      if (typeof cmd === "string" && cmd.startsWith("lsof")) {
        // Simulate lsof not found (exit code 127 or ENOENT-like)
        const err = new Error("lsof: not found");
        (err as any).status = 127;
        throw err;
      }
      if (typeof cmd === "string" && cmd.startsWith("fuser")) {
        return "12345" as any;
      }
      return "" as any;
    });

    const result = killStalePortProcess(5000);

    expect(result).toBe(12345);
    expect(process.kill).toHaveBeenCalledWith(12345, "SIGKILL");
  });

  it("falls back to ss when both lsof and fuser are unavailable", () => {
    mockExecSync.mockImplementation((cmd: any) => {
      if (typeof cmd === "string" && cmd.startsWith("lsof")) {
        const err = new Error("lsof: not found");
        (err as any).status = 127;
        throw err;
      }
      if (typeof cmd === "string" && cmd.startsWith("fuser")) {
        const err = new Error("fuser: not found");
        (err as any).status = 127;
        throw err;
      }
      if (typeof cmd === "string" && cmd.startsWith("ss")) {
        return 'LISTEN  0  128  0.0.0.0:5000  0.0.0.0:*  users:(("node",pid=54321,fd=18))\n' as any;
      }
      return "" as any;
    });

    const result = killStalePortProcess(5000);

    expect(result).toBe(54321);
    expect(process.kill).toHaveBeenCalledWith(54321, "SIGKILL");
  });

  it("returns null when all tools are unavailable and no process found", () => {
    mockExecSync.mockImplementation(() => {
      const err = new Error("command not found");
      (err as any).status = 127;
      throw err;
    });

    expect(killStalePortProcess(5000)).toBeNull();
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("extracts PIDs from fuser stderr when stdout is empty", () => {
    mockExecSync.mockImplementation((cmd: any) => {
      if (typeof cmd === "string" && cmd.startsWith("lsof")) {
        const err = new Error("lsof: not found");
        (err as any).status = 127;
        throw err;
      }
      if (typeof cmd === "string" && cmd.startsWith("fuser")) {
        // fuser sometimes writes PIDs to stderr and exits non-zero
        const err = new Error("") as any;
        err.status = 0;
        err.stderr = " 11111 22222";
        throw err;
      }
      return "" as any;
    });

    const result = killStalePortProcess(5000);

    expect(result).toBe(11111);
    expect(process.kill).toHaveBeenCalledWith(11111, "SIGKILL");
    expect(process.kill).toHaveBeenCalledWith(22222, "SIGKILL");
  });

  it("handles fuser returning multiple space-separated PIDs on stdout", () => {
    mockExecSync.mockImplementation((cmd: any) => {
      if (typeof cmd === "string" && cmd.startsWith("lsof")) {
        const err = new Error("lsof: not found");
        (err as any).status = 127;
        throw err;
      }
      if (typeof cmd === "string" && cmd.startsWith("fuser")) {
        return " 11111 22222 " as any;
      }
      return "" as any;
    });

    const result = killStalePortProcess(5000);

    expect(result).toBe(11111);
    expect(process.kill).toHaveBeenCalledWith(11111, "SIGKILL");
    expect(process.kill).toHaveBeenCalledWith(22222, "SIGKILL");
    expect(process.kill).toHaveBeenCalledTimes(2);
  });

  it("extracts multiple PIDs from ss output", () => {
    mockExecSync.mockImplementation((cmd: any) => {
      if (typeof cmd === "string" && cmd.startsWith("lsof")) {
        const err = new Error("lsof: not found");
        (err as any).status = 127;
        throw err;
      }
      if (typeof cmd === "string" && cmd.startsWith("fuser")) {
        const err = new Error("fuser: not found");
        (err as any).status = 127;
        throw err;
      }
      if (typeof cmd === "string" && cmd.startsWith("ss")) {
        return 'LISTEN 0 128 0.0.0.0:5000 0.0.0.0:* users:(("node",pid=111,fd=18),("node",pid=222,fd=19))\n' as any;
      }
      return "" as any;
    });

    const result = killStalePortProcess(5000);

    expect(result).toBe(111);
    expect(process.kill).toHaveBeenCalledWith(111, "SIGKILL");
    expect(process.kill).toHaveBeenCalledWith(222, "SIGKILL");
    expect(process.kill).toHaveBeenCalledTimes(2);
  });

  it("returns null when ss shows no matching sockets", () => {
    mockExecSync.mockImplementation((cmd: any) => {
      if (typeof cmd === "string" && cmd.startsWith("lsof")) {
        const err = new Error("lsof: not found");
        (err as any).status = 127;
        throw err;
      }
      if (typeof cmd === "string" && cmd.startsWith("fuser")) {
        const err = new Error("fuser: not found");
        (err as any).status = 127;
        throw err;
      }
      if (typeof cmd === "string" && cmd.startsWith("ss")) {
        // ss returns header only when no match
        return "State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process\n" as any;
      }
      return "" as any;
    });

    expect(killStalePortProcess(5000)).toBeNull();
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("ignores fuser stderr when exit status is not 0 or 1 (avoids false-positive PIDs)", () => {
    mockExecSync.mockImplementation((cmd: any) => {
      if (typeof cmd === "string" && cmd.startsWith("lsof")) {
        const err = new Error("lsof: not found");
        (err as any).status = 127;
        throw err;
      }
      if (typeof cmd === "string" && cmd.startsWith("fuser")) {
        // fuser usage error with numeric text in stderr
        const err = new Error("fuser: 22 not found") as any;
        err.status = 2;
        err.stderr = "fuser: 22 not found";
        throw err;
      }
      if (typeof cmd === "string" && cmd.startsWith("ss")) {
        return "" as any;
      }
      return "" as any;
    });

    // Should NOT parse "22" from stderr as a PID
    expect(killStalePortProcess(5000)).toBeNull();
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("warns when ss finds listeners but no PIDs (privilege issue)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockExecSync.mockImplementation((cmd: any) => {
      if (typeof cmd === "string" && cmd.startsWith("lsof")) {
        const err = new Error("lsof: not found");
        (err as any).status = 127;
        throw err;
      }
      if (typeof cmd === "string" && cmd.startsWith("fuser")) {
        const err = new Error("fuser: not found");
        (err as any).status = 127;
        throw err;
      }
      if (typeof cmd === "string" && cmd.startsWith("ss")) {
        // Unprivileged ss: shows LISTEN but no users:() section
        return "LISTEN 0 128 0.0.0.0:5000 0.0.0.0:*\n" as any;
      }
      return "" as any;
    });

    expect(killStalePortProcess(5000)).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ss found listeners on port 5000 but no PIDs"),
    );
  });

  it("falls through to fuser when lsof exits 1 with stderr (broken binary)", () => {
    mockExecSync.mockImplementation((cmd: any) => {
      if (typeof cmd === "string" && cmd.startsWith("lsof")) {
        // Broken lsof: exits 1 but has error on stderr
        const err = new Error("lsof: error") as any;
        err.status = 1;
        err.stderr = "lsof: WARNING: can't stat() fuse.gvfsd-fuse file system";
        throw err;
      }
      if (typeof cmd === "string" && cmd.startsWith("fuser")) {
        return "44444" as any;
      }
      return "" as any;
    });

    const result = killStalePortProcess(5000);
    expect(result).toBe(44444);
    expect(process.kill).toHaveBeenCalledWith(44444, "SIGKILL");
  });

  it("returns null when fuser confirms no process (exit 1) without trying ss", () => {
    const commands: string[] = [];
    mockExecSync.mockImplementation((cmd: any) => {
      if (typeof cmd === "string") commands.push(cmd);
      if (typeof cmd === "string" && cmd.startsWith("lsof")) {
        const err = new Error("lsof: not found");
        (err as any).status = 127;
        throw err;
      }
      if (typeof cmd === "string" && cmd.startsWith("fuser")) {
        // fuser exit 1 = no process found (authoritative answer)
        const err = new Error("");
        (err as any).status = 1;
        throw err;
      }
      return "" as any;
    });

    expect(killStalePortProcess(5000)).toBeNull();
    expect(process.kill).not.toHaveBeenCalled();
    // Only lsof and fuser tried — ss not needed
    expect(commands).toHaveLength(2);
    expect(commands[0]).toMatch(/^lsof/);
    expect(commands[1]).toMatch(/^fuser/);
  });
});
