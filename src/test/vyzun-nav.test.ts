import { describe, expect, it } from "vitest";
import { extractNavMarker, parseNavIntent } from "@/lib/vyzun-nav";

describe("VYZUN AI smart navigation", () => {
  it("routes 'take me to the map' to the Campus Map", () => {
    expect(parseNavIntent("take me to the map")).toBe("map");
  });
  it("routes 'open reels' to Reels", () => {
    expect(parseNavIntent("open reels")).toBe("reels");
  });
  it("routes 'go to my profile' to Profile", () => {
    expect(parseNavIntent("go to my profile")).toBe("profile");
  });
  it("routes 'open scanner' to the Scanner", () => {
    expect(parseNavIntent("open scanner")).toBe("scan");
  });
  it("answers how-to questions instead of navigating", () => {
    expect(parseNavIntent("How do I pin on the campus map?")).toBeNull();
  });
  it("reads a valid AI navigation marker and drops unknown ones", () => {
    expect(extractNavMarker("Opening it now ✨ [[nav:reels]]")).toEqual({ text: "Opening it now ✨", target: "reels" });
    expect(extractNavMarker("Sure [[nav:bank]]").target).toBeNull();
  });
});
