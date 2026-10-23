// local account for setup/fresh-clone checks
import { auth, prisma } from "./auth.ts";

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

async function seed(): Promise<void> {
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

try {
  await seed();
} finally {
  await prisma.$disconnect();
}
