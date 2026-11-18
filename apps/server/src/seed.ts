// Local seed data: the setup account for fresh-clone checks, and every challenge definition file in prisma/challenges.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { findChallengeDefinitionProblems, type ChallengeDefinition } from "@eureka/contracts";
import { validateScene } from "@eureka/engine";
import { auth, prisma } from "./auth.ts";
import type { Prisma } from "./generated/prisma/client.ts";

const challengeDirectory = fileURLToPath(new URL("../prisma/challenges/", import.meta.url));

const seedEmail = "setup@eureka.test";
const seedName = "Eureka Local Setup";

function requireSeedPassword(): string {
  const password = process.env.EUREKA_SEED_PASSWORD;

  if (!password) {
    throw new Error(
      "EUREKA_SEED_PASSWORD is required in the repository-root .env",
    );
  }

  if (password.length < 12) {
    throw new Error("EUREKA_SEED_PASSWORD must contain at least 12 characters");
  }

  return password;
}

async function seedLocalAccount(): Promise<void> {
  const password = requireSeedPassword();

  const existingUser = await prisma.user.findUnique({
    where: {
      email: seedEmail,
    },
    select: {
      accounts: {
        select: {
          providerId: true,
        },
      },
    },
  });

  if (existingUser) {
    const hasCredentialAccount = existingUser.accounts.some(
      (account) => account.providerId === "credential",
    );

    if (!hasCredentialAccount) {
      throw new Error(
        `${seedEmail} exists without a credential account; seed stopped`,
      );
    }

    console.log(`Seed user ${seedEmail} already exists; no changes made.`);
    return;
  }

  await auth.api.signUpEmail({
    body: {
      name: seedName,
      email: seedEmail,
      password,
    },
  });

  console.log(`Created local seed user ${seedEmail}.`);
}

// Read one challenge file and refuse it unless its JSON shape, references, bounds and scene are all sound.
async function readChallengeFile(fileName: string): Promise<{ readonly definition: ChallengeDefinition; readonly stored: Prisma.InputJsonValue }> {
  const text = await readFile(`${challengeDirectory}${fileName}`, "utf8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${fileName}: not valid JSON (${error instanceof Error ? error.message : String(error)}).`, { cause: error });
  }

  const problems = findChallengeDefinitionProblems(parsed);

  if (problems.length > 0) {
    throw new Error(`${fileName}: ${problems.map((problem) => `${problem.path || "(file)"}: ${problem.message}`).join(" | ")}`);
  }

  const definition = parsed as ChallengeDefinition;

  if (fileName !== `${definition.id}.json`) {
    throw new Error(`${fileName}: the file must be named ${definition.id}.json after its id.`);
  }

  const scene = validateScene(definition.scene);

  if (!scene.ok) {
    throw new Error(`${fileName}: scene rejected by the engine: ${scene.diagnostics.map((item) => `${item.path}: ${item.message}`).join(" | ")}`);
  }

  return { definition, stored: parsed as Prisma.InputJsonValue };
}

// Store each file once per id and revision. A stored revision is immutable, so changed content must be a new revision.
async function seedChallenges(): Promise<void> {
  const fileNames = (await readdir(challengeDirectory)).filter((name) => name.endsWith(".json")).sort();

  for (const fileName of fileNames) {
    const { definition, stored } = await readChallengeFile(fileName);
    const existing = await prisma.challenge.findUnique({
      where: { id_revision: { id: definition.id, revision: definition.revision } },
    });

    if (existing === null) {
      await prisma.challenge.create({
        data: {
          id: definition.id,
          revision: definition.revision,
          topic: definition.topic,
          level: definition.level,
          published: true,
          definition: stored,
        },
      });
      console.log(`Created challenge ${definition.id} revision ${definition.revision}.`);
    } else if (isDeepStrictEqual(existing.definition, stored)) {
      console.log(`Challenge ${definition.id} revision ${definition.revision} is unchanged.`);
    } else {
      throw new Error(`${fileName}: revision ${definition.revision} is already stored with different content. Change "revision" in the file instead.`);
    }
  }
}

try {
  await seedLocalAccount();
  await seedChallenges();
} finally {
  await prisma.$disconnect();
}
