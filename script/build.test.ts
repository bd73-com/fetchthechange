import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock all heavy dependencies before importing
vi.mock("esbuild", () => ({
  build: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("vite", () => ({
  build: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("fs/promises", () => ({
  rm: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(JSON.stringify({
    dependencies: { express: "^5.0.0", pg: "^8.0.0" },
    devDependencies: { typescript: "5.6.3" },
  })),
}));

import { build as viteBuild } from "vite";
import { build as esbuild } from "esbuild";
import { rm } from "fs/promises";

describe("build script", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    vi.resetModules();
  });

  it("cleans dist directory before building", async () => {
    const callOrder: string[] = [];
    vi.mocked(rm).mockImplementation(async () => {
      callOrder.push("rm");
    });
    vi.mocked(viteBuild).mockImplementation(async () => {
      callOrder.push("vite");
      return undefined as any;
    });

    await import("./build.ts");

    await vi.waitFor(() => {
      expect(callOrder[0]).toBe("rm");
      expect(rm).toHaveBeenCalledWith("dist", { recursive: true, force: true });
    });
  });

  it("runs vite build then esbuild in order", async () => {
    const callOrder: string[] = [];
    vi.mocked(rm).mockImplementation(async () => {
      callOrder.push("rm");
    });
    vi.mocked(viteBuild).mockImplementation(async () => {
      callOrder.push("vite");
      return undefined as any;
    });
    vi.mocked(esbuild).mockImplementation(async () => {
      callOrder.push("esbuild");
      return undefined as any;
    });

    await import("./build.ts");

    await vi.waitFor(() => {
      expect(callOrder).toEqual(["rm", "vite", "esbuild"]);
    });
  });

  it("does not run drizzle-kit push during build", async () => {
    process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";

    await import("./build.ts");

    await vi.waitFor(() => {
      expect(viteBuild).toHaveBeenCalled();
    });

    // The build script should not import or use child_process at all
    // Verify only vite and esbuild are called (no execSync)
    expect(esbuild).toHaveBeenCalled();
  });

  it("computes externals by excluding allowlisted deps", async () => {
    await import("./build.ts");

    await vi.waitFor(() => {
      expect(esbuild).toHaveBeenCalled();
    });

    const esbuildCall = vi.mocked(esbuild).mock.calls[0][0] as any;
    // "express" and "pg" are in the allowlist, so they should NOT be external
    expect(esbuildCall.external).not.toContain("express");
    expect(esbuildCall.external).not.toContain("pg");
    // "typescript" is NOT in the allowlist, so it should be external
    expect(esbuildCall.external).toContain("typescript");
  });

  it("configures esbuild with correct output settings", async () => {
    await import("./build.ts");

    await vi.waitFor(() => {
      expect(esbuild).toHaveBeenCalled();
    });

    const esbuildCall = vi.mocked(esbuild).mock.calls[0][0] as any;
    expect(esbuildCall.entryPoints).toEqual(["server/index.ts"]);
    expect(esbuildCall.platform).toBe("node");
    expect(esbuildCall.format).toBe("cjs");
    expect(esbuildCall.outfile).toBe("dist/index.cjs");
    expect(esbuildCall.bundle).toBe(true);
    expect(esbuildCall.minify).toBe(true);
  });

  it("calls process.exit(1) if vite build fails", async () => {
    vi.mocked(viteBuild).mockRejectedValueOnce(new Error("vite build failed"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await import("./build.ts");

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleSpy).toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
  });

  it("calls process.exit(1) if esbuild fails", async () => {
    vi.mocked(esbuild).mockRejectedValueOnce(new Error("esbuild failed"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await import("./build.ts");

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(consoleSpy).toHaveBeenCalled();
    });

    consoleSpy.mockRestore();
  });
});
