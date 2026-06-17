import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for Drizzle.");

const parsedDatabaseUrl = new URL(process.env.DATABASE_URL);

export default defineConfig({
  schema: "./src/swaps/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  tablesFilter: ["handshake_*"],
  dbCredentials: {
    host: parsedDatabaseUrl.hostname,
    port: parsedDatabaseUrl.port ? Number(parsedDatabaseUrl.port) : 5432,
    user: decodeURIComponent(parsedDatabaseUrl.username),
    password: decodeURIComponent(parsedDatabaseUrl.password),
    database: parsedDatabaseUrl.pathname.replace(/^\//, ""),
    ssl: "require",
  },
});
