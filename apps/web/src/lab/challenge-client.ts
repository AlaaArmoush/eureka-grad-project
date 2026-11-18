import { findChallengeDefinitionProblems, type ChallengeDefinition } from "@eureka/contracts";

export interface ChallengeCatalogue {
  readonly challenges: readonly ChallengeDefinition[];
}

export type ChallengeCatalogueResult =
  | { readonly ok: true; readonly value: ChallengeCatalogue }
  | { readonly ok: false; readonly message: string };

// Ask the server for the latest published revision of every challenge and keep those that pass the check.
// The server already leaves out failing definitions; this is a safety net, and anything it drops is reported to the console, never to the learner.
export async function fetchChallengeCatalogue(): Promise<ChallengeCatalogueResult> {
  let response: Response;

  try {
    response = await fetch("/api/v1/challenges");
  } catch {
    return { ok: false, message: "The challenge server is not reachable. Start it with: npm run dev --workspace=@eureka/server" };
  }

  if (!response.ok) {
    return { ok: false, message: `The challenge server answered ${response.status}.` };
  }

  let body: unknown;

  try {
    body = await response.json();
  } catch {
    return { ok: false, message: "The challenge server sent something that is not JSON." };
  }

  const list = typeof body === "object" && body !== null && "challenges" in body ? body.challenges : undefined;

  if (!Array.isArray(list)) {
    return { ok: false, message: "The challenge server's answer has no challenge list." };
  }

  const challenges: ChallengeDefinition[] = [];

  for (const item of list) {
    const problems = findChallengeDefinitionProblems(item);
    const first = problems[0];

    if (first === undefined) {
      challenges.push(item as ChallengeDefinition);
    } else {
      const name = typeof item === "object" && item !== null && "id" in item ? String(item.id) : "a challenge";
      console.warn(`Challenge ${name} was left out: ${first.path || "(definition)"}: ${first.message}`);
    }
  }

  return { ok: true, value: { challenges } };
}

