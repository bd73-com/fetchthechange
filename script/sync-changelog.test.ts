import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
}));

import { writeFileSync } from "node:fs";

describe("sync-changelog", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalToken = process.env.GITHUB_TOKEN;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    if (originalToken !== undefined) {
      process.env.GITHUB_TOKEN = originalToken;
    } else {
      delete process.env.GITHUB_TOKEN;
    }
  });

  function mockFetch(releases: any[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(releases),
        text: () => Promise.resolve(""),
      }),
    );
  }

  it("writes valid TypeScript with entries sorted by date descending", async () => {
    mockFetch([
      {
        tag_name: "v1.0.0",
        published_at: "2026-01-15T00:00:00Z",
        body: "### Features\n- First release",
        draft: false,
        prerelease: false,
      },
      {
        tag_name: "v1.1.0",
        published_at: "2026-02-20T00:00:00Z",
        body: "### Bug Fixes\n- Fix thing",
        draft: false,
        prerelease: false,
      },
    ]);

    await import("./sync-changelog.ts");

    await vi.waitFor(() => {
      expect(writeFileSync).toHaveBeenCalled();
    });

    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;

    expect(written).toContain("export interface ChangelogEntry");
    expect(written).toContain("export const changelog: ChangelogEntry[]");

    // v1.1.0 (Feb) should come before v1.0.0 (Jan) in the output
    const idx110 = written.indexOf("1.1.0");
    const idx100 = written.indexOf("1.0.0");
    expect(idx110).toBeLessThan(idx100);
  });

  it("filters out draft and prerelease entries", async () => {
    mockFetch([
      {
        tag_name: "v1.0.0",
        published_at: "2026-01-01T00:00:00Z",
        body: "release",
        draft: false,
        prerelease: false,
      },
      {
        tag_name: "v2.0.0-rc.1",
        published_at: "2026-03-01T00:00:00Z",
        body: "prerelease",
        draft: false,
        prerelease: true,
      },
      {
        tag_name: "v1.2.0",
        published_at: "2026-02-01T00:00:00Z",
        body: "draft",
        draft: true,
        prerelease: false,
      },
    ]);

    await import("./sync-changelog.ts");

    await vi.waitFor(() => {
      expect(writeFileSync).toHaveBeenCalled();
    });

    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain("1.0.0");
    expect(written).not.toContain("2.0.0-rc.1");
    expect(written).not.toContain("1.2.0");
  });

  it("strips v prefix from tag names", async () => {
    mockFetch([
      {
        tag_name: "v3.5.1",
        published_at: "2026-01-01T00:00:00Z",
        body: "notes",
        draft: false,
        prerelease: false,
      },
    ]);

    await import("./sync-changelog.ts");

    await vi.waitFor(() => {
      expect(writeFileSync).toHaveBeenCalled();
    });

    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    // Should contain "3.5.1" as version, not "v3.5.1"
    expect(written).toContain('"3.5.1"');
    expect(written).not.toMatch(/"v3\.5\.1"/);
  });

  it("handles null body gracefully", async () => {
    mockFetch([
      {
        tag_name: "v1.0.0",
        published_at: "2026-01-01T00:00:00Z",
        body: null,
        draft: false,
        prerelease: false,
      },
    ]);

    await import("./sync-changelog.ts");

    await vi.waitFor(() => {
      expect(writeFileSync).toHaveBeenCalled();
    });

    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('"body": ""');
  });

  it("extracts YYYY-MM-DD date from published_at", async () => {
    mockFetch([
      {
        tag_name: "v1.0.0",
        published_at: "2026-03-07T14:30:00Z",
        body: "notes",
        draft: false,
        prerelease: false,
      },
    ]);

    await import("./sync-changelog.ts");

    await vi.waitFor(() => {
      expect(writeFileSync).toHaveBeenCalled();
    });

    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain('"2026-03-07"');
  });

  it("sends Authorization header when GITHUB_TOKEN is set", async () => {
    process.env.GITHUB_TOKEN = "ghp_test123";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchMock);

    await import("./sync-changelog.ts");

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe("Bearer ghp_test123");
  });

  it("does not send Authorization header without GITHUB_TOKEN", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
      text: () => Promise.resolve(""),
    });
    vi.stubGlobal("fetch", fetchMock);

    await import("./sync-changelog.ts");

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const headers = fetchMock.mock.calls[0][1].headers;
    expect(headers.Authorization).toBeUndefined();
  });

  it("exits with code 1 on API error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve("rate limited"),
      }),
    );

    await import("./sync-changelog.ts");

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  it("writes empty array when no releases exist", async () => {
    mockFetch([]);

    await import("./sync-changelog.ts");

    await vi.waitFor(() => {
      expect(writeFileSync).toHaveBeenCalled();
    });

    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    expect(written).toContain("export const changelog: ChangelogEntry[] = [];");
  });
});
