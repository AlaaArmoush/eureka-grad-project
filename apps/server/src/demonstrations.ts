import { Router } from "express";
import { findDemonstrationProblems } from "@eureka/contracts";
import { prisma } from "./auth.ts";

export const demonstrationRoutes = Router();

// A stored demonstration the shared check refuses is never served. The author learns why in the server log; learners never see it.
function passesCheck(definition: unknown, id: string, revision: number): boolean {
  const first = findDemonstrationProblems(definition)[0];

  if (first !== undefined) {
    console.warn(`Demonstration ${id} revision ${revision} is published but fails the data check, so it is not served. ${first.path || "(definition)"}: ${first.message}`);
    return false;
  }

  return true;
}

// List the latest published revision of every demonstration, in topic and question order.
demonstrationRoutes.get("/", async (_request, response) => {
  const rows = await prisma.demonstration.findMany({
    where: { published: true },
    orderBy: [{ id: "asc" }, { revision: "desc" }],
    distinct: ["id"],
    select: { id: true, revision: true, topic: true, position: true, definition: true },
  });

  rows.sort((left, right) => left.topic.localeCompare(right.topic) || left.position - right.position);
  response.json({ demonstrations: rows.filter((row) => passesCheck(row.definition, row.id, row.revision)).map((row) => row.definition) });
});

// Read one demonstration by id: its latest published revision, when it passes the check.
demonstrationRoutes.get("/:id", async (request, response) => {
  const row = await prisma.demonstration.findFirst({
    where: { id: request.params.id, published: true },
    orderBy: { revision: "desc" },
    select: { id: true, revision: true, definition: true },
  });

  if (row === null || !passesCheck(row.definition, row.id, row.revision)) {
    response.status(404).json({ error: "not_found" });
    return;
  }

  response.json({ demonstration: row.definition });
});
