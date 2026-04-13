import { describe, it, expect } from "vitest";
import { calcTier } from "../scanner";

describe("calcTier", () => {
  it("returns 'large' for context >= 128000", () => {
    expect(calcTier(128000)).toBe("large");
    expect(calcTier(200000)).toBe("large");
    expect(calcTier(1000000)).toBe("large");
  });

  it("returns 'medium' for context >= 32000 and < 128000", () => {
    expect(calcTier(32000)).toBe("medium");
    expect(calcTier(64000)).toBe("medium");
    expect(calcTier(127999)).toBe("medium");
  });

  it("returns 'small' for context < 32000", () => {
    expect(calcTier(0)).toBe("small");
    expect(calcTier(8000)).toBe("small");
    expect(calcTier(31999)).toBe("small");
  });
});
