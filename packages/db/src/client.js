import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
function createDatabase() {
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) {
        throw new Error("POSTGRES_URL environment variable is not set. Please configure it in your environment.");
    }
    const pool = new Pool({ connectionString });
    return drizzle({ client: pool, schema, casing: "snake_case" });
}
export const db = createDatabase();
