export type EngineDiagnosticCode =
  | "DISPOSED_ENGINE"
  | "DUPLICATE_COMMAND_ID"
  | "DUPLICATE_ENTITY_ID"
  | "EMPTY_ID"
  | "INVALID_ADVANCE_COUNT"
  | "INVALID_BODY_KIND"
  | "INVALID_INTEGER"
  | "NONFINITE_NUMBER"
  | "NONFINITE_STATE"
  | "OUT_OF_RANGE"
  | "PAST_TARGET_TICK"
  | "RUN_IN_PROGRESS"
  | "SOURCE_CHANGED"
  | "UNKNOWN_ENTITY_ID"
  | "UNRESOLVED_EVENT_LIMIT"
  | "UNSUPPORTED_COMMAND"
  | "UNSUPPORTED_SCENE_FEATURE"
  | "INVALID_INITIAL_OVERLAP";

export interface EngineDiagnostic {
  readonly code: EngineDiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly entityId?: string;
}

export type EngineResult<T> =
  | {
    readonly ok: true;
    readonly value: T;
  }
  | EngineFailure;

export type EngineStatus =
  | {
    readonly ok: true;
  }
  | EngineFailure;

export interface EngineFailure {
  readonly ok: false;
  readonly diagnostics: readonly EngineDiagnostic[];
}

export function failure(code: EngineDiagnosticCode, path: string, message: string, entityId?: string): EngineFailure {
  const diagnostic: EngineDiagnostic =
    entityId === undefined
      ? { code, path, message }
      : { code, path, message, entityId };

  return {
    ok: false,
    diagnostics: [diagnostic]
  };
}
