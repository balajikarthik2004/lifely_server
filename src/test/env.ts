/**
 * Test environment. Set before anything imports config/env, so the schema
 * validates against these rather than a developer machine.
 */
process.env.NODE_ENV = 'test';
// globalSetup has already put the in-memory replica set URI here.
process.env.MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/lifely-test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-that-is-definitely-long-enough-000';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-that-is-definitely-long-enough-0';
process.env.LOG_LEVEL = 'silent';
