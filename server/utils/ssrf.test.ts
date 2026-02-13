import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock DNS resolution so test hostnames resolve to public IPs
vi.mock('dns/promises', () => ({
  resolve4: vi.fn().mockResolvedValue(['93.184.216.34']),
  resolve6: vi.fn().mockResolvedValue([]),
}));

import { ssrfSafeFetch, isPrivateIp } from "./ssrf";

describe("ssrfSafeFetch", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("follows a safe redirect and returns final response", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: { Location: "https://example.com/page2" },
        })
      )
      .mockResolvedValueOnce(
        new Response("final content", { status: 200 })
      );

    const response = await ssrfSafeFetch("https://example.com/page1");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("final content");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("blocks redirect to cloud metadata IP (169.254.x.x)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("", {
        status: 301,
        headers: { Location: "http://169.254.169.254/latest/meta-data/" },
      })
    );

    await expect(
      ssrfSafeFetch("https://example.com")
    ).rejects.toThrow("SSRF blocked");
  });

  it("blocks redirect to localhost", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("", {
        status: 302,
        headers: { Location: "http://127.0.0.1:8080/admin" },
      })
    );

    await expect(
      ssrfSafeFetch("https://example.com")
    ).rejects.toThrow("SSRF blocked");
  });

  it("blocks redirect to private 10.x range", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("", {
        status: 302,
        headers: { Location: "http://10.0.0.1/internal" },
      })
    );

    await expect(
      ssrfSafeFetch("https://example.com")
    ).rejects.toThrow("SSRF blocked");
  });

  it("blocks redirect to private 192.168.x range", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("", {
        status: 302,
        headers: { Location: "http://192.168.1.1/" },
      })
    );

    await expect(
      ssrfSafeFetch("https://example.com")
    ).rejects.toThrow("SSRF blocked");
  });

  it("blocks redirect to blocked hostname (metadata.google.internal)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("", {
        status: 302,
        headers: { Location: "http://metadata.google.internal/computeMetadata/v1/" },
      })
    );

    await expect(
      ssrfSafeFetch("https://example.com")
    ).rejects.toThrow("SSRF blocked");
  });

  it("blocks multi-hop redirect where final hop targets private IP", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: { Location: "https://example.com/step2" },
        })
      )
      .mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: { Location: "http://169.254.169.254/latest/meta-data/" },
        })
      );

    await expect(
      ssrfSafeFetch("https://example.com/step1")
    ).rejects.toThrow("SSRF blocked");
  });

  it("throws on too many redirects", async () => {
    for (let i = 0; i <= 10; i++) {
      fetchSpy.mockResolvedValueOnce(
        new Response("", {
          status: 302,
          headers: { Location: `https://example.com/hop${i + 1}` },
        })
      );
    }

    await expect(
      ssrfSafeFetch("https://example.com/start")
    ).rejects.toThrow("Too many redirects");
  });

  it("handles redirect with no Location header gracefully", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("no location", { status: 302 })
    );

    const response = await ssrfSafeFetch("https://example.com");
    expect(response.status).toBe(302);
    expect(await response.text()).toBe("no location");
  });

  it("resolves relative redirect URLs correctly", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response("", {
          status: 301,
          headers: { Location: "/new-path" },
        })
      )
      .mockResolvedValueOnce(
        new Response("redirected content", { status: 200 })
      );

    const response = await ssrfSafeFetch("https://example.com/old-path");
    expect(response.status).toBe(200);
    expect(fetchSpy.mock.calls[1][0]).toBe("https://example.com/new-path");
  });

  it("blocks redirect to non-http protocol (file://)", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("", {
        status: 302,
        headers: { Location: "file:///etc/passwd" },
      })
    );

    await expect(
      ssrfSafeFetch("https://example.com")
    ).rejects.toThrow("SSRF blocked");
  });

  it("blocks redirect to ftp protocol", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("", {
        status: 302,
        headers: { Location: "ftp://internal-server/data" },
      })
    );

    await expect(
      ssrfSafeFetch("https://example.com")
    ).rejects.toThrow("SSRF blocked");
  });

  it("passes through request options and overrides redirect to manual", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("ok", { status: 200 })
    );

    const controller = new AbortController();
    await ssrfSafeFetch("https://example.com", {
      headers: { "User-Agent": "TestBot" },
      signal: controller.signal,
      redirect: "follow" as RequestRedirect,
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({
        headers: { "User-Agent": "TestBot" },
        signal: controller.signal,
        redirect: "manual",
      })
    );
  });

  it("blocks initial URL that targets private IP", async () => {
    await expect(
      ssrfSafeFetch("http://127.0.0.1/admin")
    ).rejects.toThrow("SSRF blocked");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("handles all redirect status codes (301, 302, 303, 307, 308)", async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      fetchSpy.mockReset();
      fetchSpy
        .mockResolvedValueOnce(
          new Response("", {
            status,
            headers: { Location: "https://example.com/final" },
          })
        )
        .mockResolvedValueOnce(
          new Response(`response for ${status}`, { status: 200 })
        );

      const response = await ssrfSafeFetch("https://example.com/start");
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(`response for ${status}`);
    }
  });
});

describe("isPrivateIp", () => {
  it("detects 169.254.x.x as private", () => {
    expect(isPrivateIp("169.254.169.254")).toBe(true);
  });

  it("detects 10.x as private", () => {
    expect(isPrivateIp("10.0.0.1")).toBe(true);
  });

  it("detects 127.x as private", () => {
    expect(isPrivateIp("127.0.0.1")).toBe(true);
  });

  it("detects 192.168.x as private", () => {
    expect(isPrivateIp("192.168.1.1")).toBe(true);
  });

  it("detects ::1 as private", () => {
    expect(isPrivateIp("::1")).toBe(true);
  });

  it("does not flag public IPs", () => {
    expect(isPrivateIp("93.184.216.34")).toBe(false);
    expect(isPrivateIp("8.8.8.8")).toBe(false);
  });
});
