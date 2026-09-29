/**
 * Local PostgreSQL for development without Docker (real PostgreSQL binaries via embedded-postgres).
 *   npm run db:start      → starts on :5433, data in ./.pgdata (persistent). Ctrl+C to stop.
 * With Docker available you can use docker-compose.yml instead; both expose the same DATABASE_URL.
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const dataDir = path.resolve(".pgdata");
const port = Number(process.env.DEV_DB_PORT ?? 5433);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  port,
  user: "postgres",
  password: "postgres", // local-only development cluster, bound to localhost
  persistent: true,
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  postgresFlags: ["-c", "listen_addresses=localhost", "-c", "timezone=UTC", "-c", "io_method=sync"],
  onLog: () => undefined,
});

async function main() {
  if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
    console.log(`Initialising cluster in ${dataDir}…`);
    await pg.initialise();
  }
  await pg.start();
  for (const db of ["nossoafter"]) {
    try {
      await pg.createDatabase(db);
      console.log(`Created database ${db}`);
    } catch {
      /* already exists */
    }
  }
  console.log(`PostgreSQL ready: postgres://postgres:postgres@localhost:${port}/nossoafter`);
  const stop = async () => {
    console.log("\nStopping PostgreSQL…");
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // keep the process alive
  setInterval(() => undefined, 1 << 30);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
