import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import { env } from "@/lib/env";
import * as schema from "@/lib/schema";

let dbInstance: ReturnType<typeof drizzle<typeof schema>> | null = null;
let neonSqlInstance: ReturnType<typeof neon> | null = null;

export const getDb = () => {
  if (!dbInstance) {
    dbInstance = drizzle(neon(env.databaseUrl), { schema });
  }

  return dbInstance;
};

/** Raw Neon HTTP client for non-interactive sql.transaction batches. */
export const getNeonSql = () => {
  if (!neonSqlInstance) {
    neonSqlInstance = neon(env.databaseUrl);
  }

  return neonSqlInstance;
};
