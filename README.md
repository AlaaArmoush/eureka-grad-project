# Eureka commands

Run from the repository root.

## Run

```bash
docker compose up -d --wait db                                   # start of a session that uses the server or challenges
npm run dev --workspace=@eureka/server                           # when the page needs the API (Challenges); leave it running
npm run dev --workspace=@eureka/web -- --host 127.0.0.1          # whenever you want to see the website or lab; leave it running
docker compose stop db                                           # end of the day; keeps all data
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
npm run db:seed                              # after adding or editing a challenge file, and on a new database
npm exec --workspace=@eureka/server -- prisma studio --config prisma.config.ts   # when you want to look at or edit rows in the browser
```
