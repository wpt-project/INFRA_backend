import "dotenv/config";
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();

  const result = await client.query(`
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE tablename = '__drizzle_migrations';
  `);

  console.table(result.rows);
} finally {
  await client.end();
}