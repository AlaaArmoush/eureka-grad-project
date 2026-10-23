import { PrismaPg } from "@prisma/adapter-pg";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "./generated/prisma/client.ts";

loadEnvFile(fileURLToPath(new URL("../../../.env", import.meta.url)));

function requireEnvironment(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required in the repository-root .env`);
  }

  return value;
}

const postgresPassword = requireEnvironment("POSTGRES_PASSWORD");
const authSecret = requireEnvironment("BETTER_AUTH_SECRET");
const authBaseUrl = requireEnvironment("BETTER_AUTH_URL");

if (authSecret.length < 32) {
  throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
}

const databaseUrl = new URL(
  "postgresql://eureka@127.0.0.1:5432/eureka",
);

databaseUrl.password = postgresPassword;

const postgresAdapter = new PrismaPg(databaseUrl.toString());

export const prisma = new PrismaClient({
  adapter: postgresAdapter,
});

export const auth = betterAuth({
  appName: "Eureka",
  baseURL: authBaseUrl,
  secret: authSecret,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: [
    "http://127.0.0.1:5173",
    "http://localhost:5173",
  ],
});
