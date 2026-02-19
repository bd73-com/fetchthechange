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
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "child_process";
import { build as viteBuild } from "vite";
import { build as esbuild } from "esbuild";
import { rm } from "fs/promises";

describe("build script db:push integration", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Prevent process.exit from actually exiting
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    // Restore env
    if (originalDatabaseUrl !== undefined) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
    process.env.NODE_ENV = originalNodeEnv;
    exitSpy.mockRestore();
    vi.resetModules();
  });

  it("runs drizzle-kit push when DATABASE_URL is set", async () => {
    process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";

    // Dynamically import to trigger buildAll()
    await import("./build.ts");

    // Wait for the async buildAll to complete
    await vi.waitFor(() => {
      expect(execSync).toHaveBeenCalledWith("npx drizzle-kit push", { stdio: "inherit" });
    });
  });

  it("skips drizzle-kit push when DATABASE_URL is not set", async () => {
    delete process.env.DATABASE_URL;

    await import("./build.ts");

    await vi.waitFor(() => {
      // viteBuild should still be called (build proceeds)
      expect(viteBuild).toHaveBeenCalled();
    });

    expect(execSync).not.toHaveBeenCalled();
  });

  it("runs drizzle-kit push before vite and esbuild", async () => {
    process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";

    const callOrder: string[] = [];
    vi.mocked(execSync).mockImplementation(() => {
      callOrder.push("db:push");
      return Buffer.from("");
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
      expect(callOrder).toEqual(["db:push", "vite", "esbuild"]);
    });
  });

  it("cleans dist directory before doing anything else", async () => {
    delete process.env.DATABASE_URL;

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

  it("calls process.exit(1) if drizzle-kit push fails", async () => {
    process.env.DATABASE_URL = "postgresql://localhost:5432/testdb";

    vi.mocked(execSync).mockImplementation(() => {
      throw new Error("drizzle-kit push failed: connection refused");
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await import("./build.ts");

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    consoleSpy.mockRestore();
  });
});
