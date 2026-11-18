import express from "express";
import { toNodeHandler } from "better-auth/node";
import { auth, prisma } from "./auth.ts";
import { challengeRoutes } from "./challenges.ts";
import { demonstrationRoutes } from "./demonstrations.ts";

const host = "127.0.0.1";
const port = 3000;
const app = express();

app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json());

app.use("/api/v1/challenges", challengeRoutes);
app.use("/api/v1/demos", demonstrationRoutes);

app.get("/health", async (_request, response) => {
  await prisma.$queryRaw`SELECT 1`;

  response.json({
    status: "ok",
    database: "reachable",
  });
});

const server = app.listen(port, host, () => {
  console.log(`Eureka server listening at http://${host}:${port}`);
});

let shutdownStarted = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownStarted) {
    return;
  }

  shutdownStarted = true;
  console.log(`Received ${signal}; closing Eureka server`);

  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });

    await prisma.$disconnect();
  } catch (error) {
    console.error("Server shutdown failed", error);
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
