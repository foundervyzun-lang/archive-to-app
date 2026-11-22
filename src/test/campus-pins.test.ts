import { describe, expect, it } from "vitest";
import { clampPinPosition } from "@/lib/campus-pins";

describe("campus pin placement", () => {
  it("keeps pins inside the map edges (4%–96%)", () => {
    expect(clampPinPosition(-10)).toBe(4);
    expect(clampPinPosition(120)).toBe(96);
    expect(clampPinPosition(50.456)).toBe(50.46);
  });
});
