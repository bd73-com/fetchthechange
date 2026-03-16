import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSetGlobalDispatcher, constructorArgs } = vi.hoisted(() => ({
  mockSetGlobalDispatcher: vi.fn(),
  constructorArgs: [] as any[],
}));

vi.mock("undici", () => ({
  Agent: class MockAgent {
    constructor(opts: any) {
      constructorArgs.push(opts);
    }
  },
  setGlobalDispatcher: mockSetGlobalDispatcher,
}));

describe("globalAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constructorArgs.length = 0;
    vi.resetModules();
  });

  it("creates an Agent with keepAlive and bounded connections", async () => {
    await import("./globalAgent");

    expect(constructorArgs).toHaveLength(1);
    const config = constructorArgs[0];
    expect(config.keepAliveTimeout).toBe(4_000);
    expect(config.keepAliveMaxTimeout).toBe(10_000);
    expect(config.connections).toBe(2);
    expect(config.pipelining).toBe(1);
    expect(config.connect.timeout).toBe(10_000);
  });

  it("calls setGlobalDispatcher with the created agent", async () => {
    await import("./globalAgent");

    expect(mockSetGlobalDispatcher).toHaveBeenCalledOnce();
    expect(mockSetGlobalDispatcher.mock.calls[0][0]).toBeInstanceOf(Object);
  });
});
