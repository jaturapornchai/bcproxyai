import { describe, it, expect } from "vitest";
import { computeOnboarding } from "../onboarding";

const base = { providersWithKey: 0, modelsPassed: 0, successfulRequests: 0, clientConnected: false };

describe("computeOnboarding", () => {
  it("fresh install: first step is current, rest todo, 0%", () => {
    const s = computeOnboarding(base);
    expect(s.steps.map((x) => x.status)).toEqual(["current", "todo", "todo", "todo"]);
    expect(s.percent).toBe(0);
    expect(s.currentId).toBe("provider");
  });

  it("advances current to the first unfinished step", () => {
    const s = computeOnboarding({ ...base, providersWithKey: 1, modelsPassed: 3 });
    expect(s.steps.map((x) => x.status)).toEqual(["done", "done", "current", "todo"]);
    expect(s.completed).toBe(2);
    expect(s.percent).toBe(50);
  });

  it("a later step done out of order stays done; current is still the earliest gap", () => {
    const s = computeOnboarding({ ...base, successfulRequests: 5 });
    expect(s.steps.map((x) => x.status)).toEqual(["current", "todo", "done", "todo"]);
    expect(s.currentId).toBe("provider");
  });

  it("all done: no current step, 100%", () => {
    const s = computeOnboarding({ providersWithKey: 2, modelsPassed: 4, successfulRequests: 1, clientConnected: true });
    expect(s.currentId).toBeNull();
    expect(s.percent).toBe(100);
    expect(s.steps.every((x) => x.status === "done")).toBe(true);
  });
});
