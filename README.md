# Eureka commands

Run from the repository root.

## Run the app

Run these in order at the start of a session. Curriculum and Challenges read from the database, so the lab alone needs only the last line.

```bash
npm run build --workspace=@eureka/engine                         # web and server read the built contracts and engine
docker compose up -d --wait db                                   # start the database
npm run db:seed                                                  # load the demonstration and challenge files; unchanged records are skipped
npm run dev --workspace=@eureka/server                           # the API; leave it running in its own terminal
npm run dev --workspace=@eureka/web -- --host 127.0.0.1          # the website and lab; leave it running, open the address Vite prints
```

At the end of the day:

```bash
docker compose stop db                                           # keeps all data
```

## Check

```bash
npm run typecheck     # after applying any batch of code, and before every commit
npm run lint          # same: after applying code, and before every commit
npm run test          # before every commit, and after changing shared code (contracts, engine, evaluator)
npm exec --workspace=@eureka/web -- vitest run tests/lab/curriculum.test.ts   # one test is failing and you want fast reruns
```

## Packages

```bash
npm install                                  # after you edit a package.json
npm run build --workspace=@eureka/engine     # after editing packages/contracts or packages/engine: web and server read the built copy, so stale types mean run this
```

## Database

```bash
npm run db:migrate -- --name <what_changed>  # after you edit schema.prisma: creates and applies the migration
npm run db:generate                          # after pulling a changed schema.prisma, or when TypeScript says a table or field is missing on prisma
npm run db:seed                              # after adding or editing a challenge or demonstration file, and on a new database
npm exec --workspace=@eureka/server -- prisma studio --config prisma.config.ts   # when you want to look at or edit rows in the browser
```
