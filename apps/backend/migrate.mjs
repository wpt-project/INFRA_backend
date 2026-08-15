import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is missing in environment");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  console.log('Connecting to PostgreSQL...');
  await client.connect();

  const db = drizzle(client);
  console.log('Applying pending migrations from ./drizzle...');

  await migrate(db, { migrationsFolder: './drizzle' });

  console.log('✓ All migrations applied successfully!');
  await client.end();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  client.end();
  process.exit(1);
});