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
});
