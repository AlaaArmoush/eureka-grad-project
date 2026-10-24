// Supplies commands and portable renderer snapshots.
import type {
  Command,
  Snapshot
} from "@eureka/contracts";

// Supplies the headless engine boundary and typed results.
import type {
  AdvanceReceipt,
  CommandAcceptance,
  Engine,
  EngineResult,
  EngineStatus
} from "@eureka/engine";

export interface LabController {
  enqueue(
    command: Command
  ): EngineResult<CommandAcceptance>;

  stepOnce(): EngineResult<AdvanceReceipt>;

  copySnapshot(): EngineResult<Snapshot>;

  reset(): EngineStatus;

  dispose(): EngineStatus;
}

export type SnapshotConsumer = (
  snapshot: Snapshot
) => void;

export function createLabController(
  engine: Engine,
  consumeSnapshot: SnapshotConsumer,
  releaseView: () => void
): EngineResult<LabController> {
  const initialSnapshot = engine.getSnapshot();

  if (!initialSnapshot.ok) {
    return initialSnapshot;
  }

  consumeSnapshot(initialSnapshot.value);

  let disposed = false;

  function stepOnce(): EngineResult<AdvanceReceipt> {
    const advanceResult = engine.advance(1);

    if (!advanceResult.ok) {
      return advanceResult;
    }

    const snapshotResult = engine.getSnapshot();

    if (!snapshotResult.ok) {
      return snapshotResult;
    }

    consumeSnapshot(snapshotResult.value);
    return advanceResult;
  }

  function reset(): EngineStatus {
    const resetResult = engine.reset();

    if (!resetResult.ok) {
      return resetResult;
    }

    const snapshotResult = engine.getSnapshot();

    if (!snapshotResult.ok) {
      return snapshotResult;
    }

    consumeSnapshot(snapshotResult.value);
    return { ok: true };
  }

  function dispose(): EngineStatus {
    if (disposed) {
      return { ok: true };
    }

    disposed = true;
    releaseView();
    return engine.dispose();
  }

  return {
    ok: true,
    value: {
      enqueue: (command) => engine.enqueue(command),
      stepOnce,
      copySnapshot: () => engine.copySnapshot(),
      reset,
      dispose
    }
  };
}
