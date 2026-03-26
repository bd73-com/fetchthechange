import { describe, it, expect, vi, beforeEach } from "vitest";

// Capture the SQL operations passed to Drizzle's query builder
let capturedConflictSet: Record<string, unknown> | undefined;

const returningMock = vi.fn().mockResolvedValue([{ id: "user-1", email: "test@example.com" }]);
const onConflictDoUpdateMock = vi.fn().mockImplementation((opts: any) => {
  capturedConflictSet = opts.set;
  return { returning: returningMock };
});
const valuesMock = vi.fn().mockReturnValue({ onConflictDoUpdate: onConflictDoUpdateMock });
const insertMock = vi.fn().mockReturnValue({ values: valuesMock });
const whereMock = vi.fn().mockResolvedValue([{ id: "user-1", email: "test@example.com" }]);
const selectMock = vi.fn().mockReturnValue({
  from: vi.fn().mockReturnValue({ where: whereMock }),
});
const updateSetMock = vi.fn().mockReturnValue({
  where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "user-1" }]) }),
});
const updateMock = vi.fn().mockReturnValue({
  set: updateSetMock,
});

vi.mock("../../db", () => ({
  db: {
    insert: (...args: any[]) => insertMock(...args),
    select: (...args: any[]) => selectMock(...args),
    update: (...args: any[]) => updateMock(...args),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a: any, b: any) => ({ column: a, value: b })),
}));

vi.mock("@shared/models/auth", () => ({
  users: {
    id: "users.id",
    email: "users.email",
    firstName: "users.firstName",
    lastName: "users.lastName",
    profileImageUrl: "users.profileImageUrl",
    notificationEmail: "users.notificationEmail",
    tier: "users.tier",
    stripeCustomerId: "users.stripeCustomerId",
    stripeSubscriptionId: "users.stripeSubscriptionId",
    campaignUnsubscribed: "users.campaignUnsubscribed",
    unsubscribeToken: "users.unsubscribeToken",
    createdAt: "users.createdAt",
    updatedAt: "users.updatedAt",
  },
}));

import { authStorage } from "./storage";

describe("AuthStorage.upsertUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedConflictSet = undefined;
  });

  it("propagates database errors from conflict upsert", async () => {
    returningMock.mockRejectedValueOnce(new Error("db failure"));

    await expect(
      authStorage.upsertUser({
        id: "user-1",
        email: "user@example.com",
        firstName: "Jane",
        lastName: "Doe",
        profileImageUrl: null,
      }),
    ).rejects.toThrow("db failure");
  });

  it("passes only OIDC claim fields to onConflictDoUpdate SET clause", async () => {
    await authStorage.upsertUser({
      id: "user-1",
      email: "user@example.com",
      firstName: "Jane",
      lastName: "Doe",
      profileImageUrl: "https://img.example.com/jane.png",
    });

    expect(onConflictDoUpdateMock).toHaveBeenCalledTimes(1);
    const setKeys = Object.keys(capturedConflictSet!);

    // Drift guard: when all OIDC fields are defined, exactly 5 keys in SET
    expect(setKeys).toHaveLength(5);
    expect(setKeys).toContain("email");
    expect(setKeys).toContain("firstName");
    expect(setKeys).toContain("lastName");
    expect(setKeys).toContain("profileImageUrl");
    expect(setKeys).toContain("updatedAt");

    // Must NOT include user-managed fields
    expect(setKeys).not.toContain("notificationEmail");
    expect(setKeys).not.toContain("tier");
    expect(setKeys).not.toContain("stripeCustomerId");
    expect(setKeys).not.toContain("stripeSubscriptionId");
    expect(setKeys).not.toContain("campaignUnsubscribed");
    expect(setKeys).not.toContain("unsubscribeToken");
    expect(setKeys).not.toContain("id");
  });

  it("passes correct values for OIDC fields", async () => {
    await authStorage.upsertUser({
      id: "user-1",
      email: "new@example.com",
      firstName: "John",
      lastName: "Smith",
      profileImageUrl: null,
    });

    expect(capturedConflictSet!.email).toBe("new@example.com");
    expect(capturedConflictSet!.firstName).toBe("John");
    expect(capturedConflictSet!.lastName).toBe("Smith");
    expect(capturedConflictSet!.profileImageUrl).toBeNull();
    expect(capturedConflictSet!.updatedAt).toBeInstanceOf(Date);
  });

  it("does not leak extra fields even when userData contains unexpected keys", async () => {
    await authStorage.upsertUser({
      id: "user-1",
      email: "user@example.com",
      firstName: "Jane",
      lastName: "Doe",
      profileImageUrl: null,
      notificationEmail: "custom@alerts.com",
      tier: "power",
    } as any);

    const setKeys = Object.keys(capturedConflictSet!);
    // Even if the input object has notificationEmail/tier, the SET should not include them
    expect(setKeys).not.toContain("notificationEmail");
    expect(setKeys).not.toContain("tier");
  });

  it("excludes undefined OIDC fields from SET clause instead of passing undefined to Drizzle", async () => {
    await authStorage.upsertUser({
      id: "user-1",
      email: "user@example.com",
      firstName: undefined,
      lastName: undefined,
      profileImageUrl: undefined,
    });

    const setKeys = Object.keys(capturedConflictSet!);
    // Only email and updatedAt should be present — undefined fields are excluded
    expect(setKeys).toContain("email");
    expect(setKeys).toContain("updatedAt");
    expect(setKeys).not.toContain("firstName");
    expect(setKeys).not.toContain("lastName");
    expect(setKeys).not.toContain("profileImageUrl");
    // No value in the set clause should be undefined
    for (const value of Object.values(capturedConflictSet!)) {
      expect(value).not.toBeUndefined();
    }
  });
});
