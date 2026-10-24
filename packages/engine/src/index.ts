// Keeps package consumers on one stable public entry point.
export {
  createEngine
} from "./engine.js";

export { validateScene } from "./validation.js";

// Exposes public operation results without engine internals.
export type {
  AdvanceReceipt,
  CommandAcceptance,
  Engine
} from "./engine.js";

export type {
  EngineDiagnostic,
  EngineDiagnosticCode,
  EngineResult,
  EngineStatus
} from "./diagnostics.js";
