// Runs before AppModule (and its ConfigModule) is imported, so the backend
// connects to a DEDICATED test database instead of the developer's real
// `event_ops` data. dotenv (used by ConfigModule) does not override variables
// already present in process.env, so this assignment wins over `.env`.
//
// The `event_ops_test` database is created + seeded out-of-band (schema cloned
// from `event_ops`, accounts loaded via seed.js with DB_NAME=event_ops_test).
process.env.DB_NAME = 'event_ops_test';
// Keep the AI feature inert during tests (no outbound DeepSeek calls).
process.env.DEEPSEEK_API_KEY = '';
