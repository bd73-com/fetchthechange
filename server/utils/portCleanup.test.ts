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

  it("kills a single stale process and returns its PID", () => {
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

  it("uses the correct port number in the lsof command", () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("no match");
    });

    killStalePortProcess(3000);

    expect(mockExecSync).toHaveBeenCalledWith("lsof -ti tcp:3000", {
      encoding: "utf8",
    });
  });

  it("returns null for invalid port values without calling lsof", () => {
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
});
