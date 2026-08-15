import "dotenv/config";
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();

const result = await client.query(`
  SELECT schema_name
  FROM information_schema.schemata
  WHERE schema_name = 'drizzle'
`);

console.table(result.rows);

await client.end();
