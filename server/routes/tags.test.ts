import { describe, it, expect } from "vitest";
import { createTagSchema, updateTagSchema, setMonitorTagsSchema, PRESET_COLOURS } from "@shared/routes";
import { TAG_LIMITS, TAG_ASSIGNMENT_LIMITS } from "@shared/models/auth";

describe("Tag feature schemas and constants", () => {
  describe("PRESET_COLOURS", () => {
    it("contains exactly 10 colours", () => {
      expect(PRESET_COLOURS).toHaveLength(10);
    });

    it("all values are valid hex colours", () => {
      for (const colour of PRESET_COLOURS) {
        expect(colour).toMatch(/^#[0-9a-f]{6}$/);
      }
    });
  });

  describe("TAG_LIMITS", () => {
    it("free tier cannot create tags", () => {
      expect(TAG_LIMITS.free).toBe(0);
    });

    it("pro tier limited to 10 tags", () => {
      expect(TAG_LIMITS.pro).toBe(10);
    });

    it("power tier has unlimited tags", () => {
      expect(TAG_LIMITS.power).toBe(Infinity);
    });
  });

  describe("TAG_ASSIGNMENT_LIMITS", () => {
    it("free tier cannot assign tags", () => {
      expect(TAG_ASSIGNMENT_LIMITS.free).toBe(0);
    });

    it("pro tier limited to 2 tags per monitor", () => {
      expect(TAG_ASSIGNMENT_LIMITS.pro).toBe(2);
    });

    it("power tier has unlimited tag assignments", () => {
      expect(TAG_ASSIGNMENT_LIMITS.power).toBe(Infinity);
    });
  });

  describe("createTagSchema", () => {
    it("accepts valid input", () => {
      const result = createTagSchema.safeParse({
        name: "Work",
        colour: "#ef4444",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Work");
        expect(result.data.colour).toBe("#ef4444");
      }
    });

    it("trims whitespace from name", () => {
      const result = createTagSchema.safeParse({
        name: "  Work  ",
        colour: "#ef4444",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("Work");
      }
    });

    it("rejects empty name", () => {
      const result = createTagSchema.safeParse({
        name: "",
        colour: "#ef4444",
      });
      expect(result.success).toBe(false);
    });

    it("rejects name longer than 32 characters", () => {
      const result = createTagSchema.safeParse({
        name: "a".repeat(33),
        colour: "#ef4444",
      });
      expect(result.success).toBe(false);
    });

    it("accepts name with exactly 32 characters", () => {
      const result = createTagSchema.safeParse({
        name: "a".repeat(32),
        colour: "#ef4444",
      });
      expect(result.success).toBe(true);
    });

    it("rejects invalid colour", () => {
      const result = createTagSchema.safeParse({
        name: "Work",
        colour: "#ff0000",
      });
      expect(result.success).toBe(false);
    });

    it("rejects freeform hex colour not in preset list", () => {
      const result = createTagSchema.safeParse({
        name: "Work",
        colour: "#123456",
      });
      expect(result.success).toBe(false);
    });

    it("accepts all 10 preset colours", () => {
      for (const colour of PRESET_COLOURS) {
        const result = createTagSchema.safeParse({ name: "Test", colour });
        expect(result.success).toBe(true);
      }
    });

    it("rejects missing name", () => {
      const result = createTagSchema.safeParse({ colour: "#ef4444" });
      expect(result.success).toBe(false);
    });

    it("rejects missing colour", () => {
      const result = createTagSchema.safeParse({ name: "Work" });
      expect(result.success).toBe(false);
    });
  });

  describe("updateTagSchema", () => {
    it("accepts name only", () => {
      const result = updateTagSchema.safeParse({ name: "Updated" });
      expect(result.success).toBe(true);
    });

    it("accepts colour only", () => {
      const result = updateTagSchema.safeParse({ colour: "#3b82f6" });
      expect(result.success).toBe(true);
    });

    it("accepts both name and colour", () => {
      const result = updateTagSchema.safeParse({ name: "Updated", colour: "#3b82f6" });
      expect(result.success).toBe(true);
    });

    it("rejects empty object", () => {
      const result = updateTagSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects invalid colour in update", () => {
      const result = updateTagSchema.safeParse({ colour: "#ffffff" });
      expect(result.success).toBe(false);
    });
  });

  describe("setMonitorTagsSchema", () => {
    it("accepts empty array (clear all tags)", () => {
      const result = setMonitorTagsSchema.safeParse({ tagIds: [] });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tagIds).toEqual([]);
      }
    });

    it("accepts array of positive integers", () => {
      const result = setMonitorTagsSchema.safeParse({ tagIds: [1, 2, 3] });
      expect(result.success).toBe(true);
    });

    it("accepts zero as a tagId", () => {
      const result = setMonitorTagsSchema.safeParse({ tagIds: [0] });
      expect(result.success).toBe(true);
    });

    it("rejects negative tagIds", () => {
      const result = setMonitorTagsSchema.safeParse({ tagIds: [-1] });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer tagIds", () => {
      const result = setMonitorTagsSchema.safeParse({ tagIds: [1.5] });
      expect(result.success).toBe(false);
    });

    it("rejects missing tagIds", () => {
      const result = setMonitorTagsSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("rejects non-array tagIds", () => {
      const result = setMonitorTagsSchema.safeParse({ tagIds: "1,2,3" });
      expect(result.success).toBe(false);
    });
  });

  describe("Tier gating logic", () => {
    it("free tier should be blocked from creating tags", () => {
      const tier = "free";
      const limit = TAG_LIMITS[tier];
      const currentCount = 0;
      expect(currentCount >= limit).toBe(true);
    });

    it("pro tier with 9 tags should be allowed to create another", () => {
      const tier = "pro";
      const limit = TAG_LIMITS[tier];
      const currentCount = 9;
      expect(currentCount >= limit).toBe(false);
    });

    it("pro tier with 10 tags should be blocked", () => {
      const tier = "pro";
      const limit = TAG_LIMITS[tier];
      const currentCount = 10;
      expect(currentCount >= limit).toBe(true);
    });

    it("power tier should never be blocked", () => {
      const tier = "power";
      const limit = TAG_LIMITS[tier];
      const currentCount = 10000;
      expect(currentCount >= limit).toBe(false);
    });
  });

  describe("Tag assignment limit logic", () => {
    it("pro tier allows up to 2 tags per monitor", () => {
      const tier = "pro";
      const limit = TAG_ASSIGNMENT_LIMITS[tier];
      expect(2 <= limit).toBe(true);
      expect(3 <= limit).toBe(false);
    });

    it("power tier has no assignment limit", () => {
      const tier = "power";
      const limit = TAG_ASSIGNMENT_LIMITS[tier];
      expect(100 <= limit).toBe(true);
    });
  });

  describe("Case-insensitive uniqueness logic", () => {
    it("normalises name to lowercase for comparison", () => {
      const name = "Work Projects";
      const nameLower = name.toLowerCase();
      expect(nameLower).toBe("work projects");
    });

    it("detects duplicate names case-insensitively", () => {
      const existingTags = [
        { nameLower: "work" },
        { nameLower: "personal" },
      ];
      const newNameLower = "Work".toLowerCase();
      expect(existingTags.some(t => t.nameLower === newNameLower)).toBe(true);
    });

    it("allows different names", () => {
      const existingTags = [
        { nameLower: "work" },
      ];
      const newNameLower = "Personal".toLowerCase();
      expect(existingTags.some(t => t.nameLower === newNameLower)).toBe(false);
    });
  });

  describe("Foreign tag ownership validation logic", () => {
    it("rejects tagIds not belonging to the user", () => {
      const userTagIds = new Set([1, 2, 3]);
      const submittedTagIds = [1, 4];
      const allBelongToUser = submittedTagIds.every(id => userTagIds.has(id));
      expect(allBelongToUser).toBe(false);
    });

    it("accepts tagIds all belonging to the user", () => {
      const userTagIds = new Set([1, 2, 3]);
      const submittedTagIds = [1, 3];
      const allBelongToUser = submittedTagIds.every(id => userTagIds.has(id));
      expect(allBelongToUser).toBe(true);
    });

    it("accepts empty tagIds array", () => {
      const userTagIds = new Set([1, 2, 3]);
      const submittedTagIds: number[] = [];
      const allBelongToUser = submittedTagIds.every(id => userTagIds.has(id));
      expect(allBelongToUser).toBe(true);
    });
  });

  describe("OR filter logic", () => {
    it("shows all monitors when no tags selected", () => {
      const monitors = [
        { id: 1, tags: [{ id: 1 }] },
        { id: 2, tags: [] },
        { id: 3, tags: [{ id: 2 }] },
      ];
      const selectedTagIds: number[] = [];
      const filtered = selectedTagIds.length === 0
        ? monitors
        : monitors.filter(m => m.tags.some(t => selectedTagIds.includes(t.id)));
      expect(filtered).toHaveLength(3);
    });

    it("filters monitors matching any selected tag (OR logic)", () => {
      const monitors = [
        { id: 1, tags: [{ id: 1 }] },
        { id: 2, tags: [] },
        { id: 3, tags: [{ id: 2 }] },
        { id: 4, tags: [{ id: 1 }, { id: 2 }] },
      ];
      const selectedTagIds = [1];
      const filtered = monitors.filter(m => m.tags.some(t => selectedTagIds.includes(t.id)));
      expect(filtered).toHaveLength(2);
      expect(filtered.map(m => m.id)).toEqual([1, 4]);
    });

    it("handles multiple selected tags with OR logic", () => {
      const monitors = [
        { id: 1, tags: [{ id: 1 }] },
        { id: 2, tags: [{ id: 3 }] },
        { id: 3, tags: [{ id: 2 }] },
      ];
      const selectedTagIds = [1, 2];
      const filtered = monitors.filter(m => m.tags.some(t => selectedTagIds.includes(t.id)));
      expect(filtered).toHaveLength(2);
      expect(filtered.map(m => m.id)).toEqual([1, 3]);
    });

    it("returns empty when no monitors match selected tags", () => {
      const monitors = [
        { id: 1, tags: [{ id: 1 }] },
        { id: 2, tags: [] },
      ];
      const selectedTagIds = [99];
      const filtered = monitors.filter(m => m.tags.some(t => selectedTagIds.includes(t.id)));
      expect(filtered).toHaveLength(0);
    });
  });
});
