import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const databasePath = process.env.DATABASE_PATH ?? "./data/pve-agent-console.db";

fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const sqlite = new Database(databasePath);
const db = drizzle(sqlite);

migrate(db, { migrationsFolder: path.resolve(dirname, "../drizzle") });
sqlite.close();

console.log(`migrated: ${databasePath}`);
