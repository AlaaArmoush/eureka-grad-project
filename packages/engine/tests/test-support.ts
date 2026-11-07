import { expect } from "vitest";
import type { EngineResult } from "../src/index.js";

export function unwrap<T>(result: EngineResult<T>): T {
  if (!result.ok) {
    throw new Error(JSON.stringify(result.diagnostics));
  }

  return result.value;
}

// Reject nonfinite results, then compare absolute error with a frozen bound.
// Each caller supplies the bound for its own fixture.
export function expectNear(
  actual: number,
  expected: number,
  tolerance: number
): void {
  expect(Number.isFinite(actual)).toBe(true);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}
