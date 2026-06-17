import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../swaps/schema";

type Database = ReturnType<typeof drizzle<typeof schema>>;

let dbClient: Database | undefined;

export function getDb() {
  if (dbClient) return dbClient;

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Set DATABASE_URL for Postgres-backed swap storage.");

  const parsedDatabaseUrl = new URL(databaseUrl);
  const pool = new Pool({
    host: parsedDatabaseUrl.hostname,
    port: parsedDatabaseUrl.port ? Number(parsedDatabaseUrl.port) : 5432,
    user: decodeURIComponent(parsedDatabaseUrl.username),
    password: decodeURIComponent(parsedDatabaseUrl.password),
    database: parsedDatabaseUrl.pathname.replace(/^\//, ""),
    ssl: {
      rejectUnauthorized: true,
    },
  });

  dbClient = drizzle(pool, { schema });
  return dbClient;
}
