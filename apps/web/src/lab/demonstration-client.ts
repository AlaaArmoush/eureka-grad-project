// Reads the published Curriculum questions from the server once, and again on request.
import { useCallback, useEffect, useState } from "react";
import { readDemonstrations, type DemonstrationDefinition } from "./demonstrations.js";

export type DemonstrationCatalogue =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly demonstrations: readonly DemonstrationDefinition[] };

// Ask the server for the latest published revision of every question and keep those that pass the shared check.
// The server already leaves out failing records; anything dropped here goes to the console, never to the learner.
export async function fetchDemonstrations(): Promise<DemonstrationCatalogue> {
  let response: Response;

  try {
    response = await fetch("/api/v1/demos");
  } catch {
    return { status: "error", message: "The curriculum server is not reachable, so the questions cannot be shown. The lab still works. Start the server with: npm run dev --workspace=@eureka/server" };
  }

  if (!response.ok) {
    return { status: "error", message: `The curriculum server answered ${response.status}.` };
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return { status: "error", message: "The curriculum server sent something that is not JSON." };
  }

  const list = typeof body === "object" && body !== null && "demonstrations" in body ? body.demonstrations : undefined;

  if (!Array.isArray(list)) {
    return { status: "error", message: "The curriculum server's answer has no question list." };
  }

  return { status: "ready", demonstrations: readDemonstrations(list, (message) => console.warn(message)) };
}

// The question catalogue for the whole app: loaded once on mount, reloaded by retry. An answer arriving after unmount is ignored.
export function useDemonstrationCatalogue(): { readonly catalogue: DemonstrationCatalogue; retry(): void } {
  const [catalogue, setCatalogue] = useState<DemonstrationCatalogue>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void fetchDemonstrations().then((result) => {
      if (!cancelled) {
        setCatalogue(result);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setCatalogue({ status: "loading" });
    setAttempt((count) => count + 1);
  }, []);

  return { catalogue, retry };
}
