import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "prisma/config";

const serverRoot = dirname(fileURLToPath(import.meta.url));

loadEnvFile(resolve(serverRoot, "../../.env"));

const postgresPassword = process.env.POSTGRES_PASSWORD;

if (!postgresPassword) {
  throw new Error("POSTGRES_PASSWORD is required in the repository-root .env");
}

const databaseUrl = new URL(
  "postgresql://eureka@127.0.0.1:5432/eureka",
);

databaseUrl.password = postgresPassword;

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx src/seed.ts"
  },
  datasource: {
    url: databaseUrl.toString(),
  },
});
