import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

let pool: Pool | null = null;

/** Full read/write pool — used by the API service for reads and for the
 * human-approval publish path. Never given to the AI/extraction code path. */
export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

let aiPool: Pool | null = null;

/** Restricted pool for AI/worker extraction code — connects as
 * corruptintel_ai, which has no write grant on published tables at the
 * database level (see migrations/002_ai_role_permissions.sql). This is the
 * mechanical backstop: even a bug in application logic cannot make the
 * extraction pipeline write a fact directly. */
export function getAiPool(): Pool {
  if (!aiPool) {
    const connectionString = process.env.AI_DATABASE_URL;
    if (!connectionString) {
      throw new Error("AI_DATABASE_URL is not set");
    }
    aiPool = new Pool({ connectionString, max: 5 });
  }
  return aiPool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/** Runs `fn` inside a transaction on the full-privilege pool, committing on
 * success and rolling back on any thrown error. Use for any write that must
 * also produce an audit_logs row in the same transaction. */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closeAll(): Promise<void> {
  if (pool) await pool.end();
  if (aiPool) await aiPool.end();
}
