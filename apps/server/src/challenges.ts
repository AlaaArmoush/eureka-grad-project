import { Router } from "express";
import { findChallengeDefinitionProblems } from "@eureka/contracts";
import { prisma } from "./auth.ts";

export const challengeRoutes = Router();

// A stored definition the shared check refuses is never served. The author learns why in the server log; learners never see it.
function passesCheck(definition: unknown, id: string, revision: number): boolean {
  const first = findChallengeDefinitionProblems(definition)[0];

  if (first !== undefined) {
    console.warn(`Challenge ${id} revision ${revision} is published but fails the data check, so it is not served. ${first.path || "(definition)"}: ${first.message}`);
    return false;
  }

  return true;
}

// List the latest published revision of every challenge that passes the check.
challengeRoutes.get("/", async (_request, response) => {
  const rows = await prisma.challenge.findMany({
    where: { published: true },
    orderBy: [{ id: "asc" }, { revision: "desc" }],
    distinct: ["id"],
    select: { id: true, revision: true, definition: true },
  });

  response.json({ challenges: rows.filter((row) => passesCheck(row.definition, row.id, row.revision)).map((row) => row.definition) });
});

// Read one challenge by id: its latest published revision, when it passes the check.
challengeRoutes.get("/:id", async (request, response) => {
  const row = await prisma.challenge.findFirst({
    where: { id: request.params.id, published: true },
    orderBy: { revision: "desc" },
    select: { id: true, revision: true, definition: true },
  });

  if (row === null || !passesCheck(row.definition, row.id, row.revision)) {
    response.status(404).json({ error: "not_found" });
    return;
  }

  response.json({ challenge: row.definition });
});
