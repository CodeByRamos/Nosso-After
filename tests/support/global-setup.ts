/**
 * Starts a throwaway REAL PostgreSQL (embedded-postgres) for integration tests and applies the
 * migrations. Concurrency/locking behavior can only be verified against the real engine.
 * Set TEST_DATABASE_URL to use an existing server instead (CI with a Postgres service).
 */
import EmbeddedPostgres from "embedded-postgres";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { runMigrations } from "../../scripts/migrate";
import { TEST_DB_PORT } from "./constants";

export default async function setup() {
  if (process.env.TEST_DATABASE_URL) {
    await runMigrations(process.env.TEST_DATABASE_URL);
    return;
  }
  const dir = path.resolve(".pgdata-test");
  rmSync(dir, { recursive: true, force: true });
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port: TEST_DB_PORT,
    user: "postgres",
    password: "postgres",
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    postgresFlags: ["-c", "listen_addresses=localhost", "-c", "max_connections=200", "-c", "fsync=off", "-c", "io_method=sync"],
    onLog: () => undefined,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("nossoafter_test");
  await runMigrations(`postgres://postgres:postgres@localhost:${TEST_DB_PORT}/nossoafter_test`);
  return async () => {
    // pg_ctl performs a clean fast shutdown on every platform (child processes included).
    const pgCtl = path.resolve("node_modules/@embedded-postgres", `${process.platform}-${process.arch}`, "native/bin/pg_ctl");
    try {
      if (existsSync(dir)) execFileSync(pgCtl, ["-D", dir, "stop", "-m", "fast", "-w"], { stdio: "ignore" });
    } catch {
      await pg.stop();
    }
    rmSync(dir, { recursive: true, force: true });
  };
}
