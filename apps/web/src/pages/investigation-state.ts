import type { DemonstrationDefinition, DemonstrationParameters } from "../lab/demonstrations.js";

// Everything a student has chosen for one question; it survives switching questions and pages.
export interface InvestigationState {
  readonly reference: string;
  readonly comparison: string;
  readonly shared: DemonstrationParameters;
  readonly choice: number | null;
  // Zero until "Run both" is pressed; each press after that replays the animation.
  readonly runCount: number;
}

export function initialState(definition: DemonstrationDefinition): InvestigationState {
  return {
    reference: definition.reference,
    comparison: definition.comparison,
    shared: { ...definition.sharedDefaults },
    choice: null,
    runCount: 0,
  };
}
