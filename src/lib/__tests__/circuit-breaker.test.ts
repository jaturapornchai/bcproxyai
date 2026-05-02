import { describe, it, expect, beforeEach } from "vitest";
import {
  acquireCircuitProbe,
  releaseCircuitProbe,
  recordRecentFailure,
  recordRecentSuccess,
} from "@/lib/learning";

const KEY = "test-provider:test-model";

beforeEach(() => {
  // Drain any leftover state from previous tests
  recordRecentSuccess(KEY);
});

describe("circuit breaker", () => {
  it("starts closed when no failures", () => {
    const r = acquireCircuitProbe(KEY);
    expect(r.state).toBe("closed");
    expect(r.allow).toBe(true);
    releaseCircuitProbe(KEY);
  });

  it("stays closed after a single failure (threshold is 2)", () => {
    recordRecentFailure(KEY);
    const r = acquireCircuitProbe(KEY);
    expect(r.state).toBe("closed");
    expect(r.allow).toBe(true);
    releaseCircuitProbe(KEY);
  });

  it("opens to half-open after threshold failures", () => {
    recordRecentFailure(KEY);
    recordRecentFailure(KEY);
    const first = acquireCircuitProbe(KEY);
    expect(first.state).toBe("half-open");
    expect(first.allow).toBe(true);
    // A second concurrent probe must be rejected
    const second = acquireCircuitProbe(KEY);
    expect(second.state).toBe("half-open");
    expect(second.allow).toBe(false);
    releaseCircuitProbe(KEY);
    releaseCircuitProbe(KEY); // safe to call extra
  });

  it("admits another probe once the first releases", () => {
    recordRecentFailure(KEY);
    recordRecentFailure(KEY);
    const first = acquireCircuitProbe(KEY);
    expect(first.allow).toBe(true);
    releaseCircuitProbe(KEY);
    const second = acquireCircuitProbe(KEY);
    expect(second.allow).toBe(true);
    releaseCircuitProbe(KEY);
  });

  it("closes immediately on a single success", () => {
    recordRecentFailure(KEY);
    recordRecentFailure(KEY);
    expect(acquireCircuitProbe(KEY).state).toBe("half-open");
    releaseCircuitProbe(KEY);

    recordRecentSuccess(KEY);
    const r = acquireCircuitProbe(KEY);
    expect(r.state).toBe("closed");
    expect(r.allow).toBe(true);
    releaseCircuitProbe(KEY);
  });

  it("isolates failures per modelId", () => {
    recordRecentFailure(KEY);
    recordRecentFailure(KEY);
    const r = acquireCircuitProbe("other:model");
    expect(r.state).toBe("closed");
    releaseCircuitProbe("other:model");
    releaseCircuitProbe(KEY);
  });
});
