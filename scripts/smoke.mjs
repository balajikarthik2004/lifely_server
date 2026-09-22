/**
 * End-to-end smoke test against the COMPILED server.
 *
 * Boots dist/index.js as a real process against a real MongoDB, then drives it
 * over HTTP exactly as the mobile app would. This is the check that the build
 * output — not just the source — actually works.
 */
import { spawn } from 'node:child_process';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

const PORT = 4111;
const BASE = `http://127.0.0.1:${PORT}`;
const API = `${BASE}/api/v1`;

let failures = 0;
function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : `  -> ${detail}`}`);
}

async function call(method, path, { token, body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function waitForHealth(deadlineMs = 40_000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(`${BASE}/health`);
      if (response.ok) return await response.json();
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error('Server did not become healthy in time');
}

const replSet = await MongoMemoryReplSet.create({
  replSet: { count: 1, storageEngine: 'wiredTiger' },
  binary: { version: process.env.MONGOMS_VERSION ?? '7.0.14' },
});

const server = spawn(process.execPath, ['dist/index.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    MONGODB_URI: replSet.getUri('lifely-smoke'),
    JWT_ACCESS_SECRET: 'smoke-access-secret-that-is-long-enough-for-zod-ok',
    JWT_REFRESH_SECRET: 'smoke-refresh-secret-that-is-long-enough-for-zod-x',
    LOG_LEVEL: 'warn',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const serverLog = [];
server.stdout.on('data', (chunk) => serverLog.push(String(chunk)));
server.stderr.on('data', (chunk) => serverLog.push(String(chunk)));

try {
  const health = await waitForHealth();
  check('health reports the database connected', health.database === 'connected', JSON.stringify(health));

  /* Register -------------------------------------------------------------- */
  const email = `smoke.${Date.now()}@example.com`;
  const registered = await call('POST', '/auth/register', {
    body: { email, password: 'a-long-enough-password', name: 'Smoke' },
  });
  check('register returns 201', registered.status === 201, JSON.stringify(registered.body));
  const token = registered.body?.accessToken;
  check('register returns an access token', typeof token === 'string');
  check('register never leaks the password hash', registered.body?.user?.passwordHash === undefined);

  /* Auth is enforced ------------------------------------------------------ */
  const unauthorized = await call('GET', '/tasks');
  check('unauthenticated request is rejected', unauthorized.status === 401);

  /* Task -> credits -> timeline ------------------------------------------- */
  const task = await call('POST', '/tasks', {
    token,
    body: { title: 'Ship the backend', priority: 'CRITICAL' },
  });
  check('task created', task.status === 201, JSON.stringify(task.body));
  check('server sets the credit value from its own rules', task.body?.creditValue === 15);

  const completed = await call('POST', `/tasks/${task.body.id}/complete`, { token });
  check('completing a task awards credits', completed.body?.creditsAwarded === 15);
  check('balance reflects the ledger', completed.body?.balance === 15);

  const replay = await call('POST', `/tasks/${task.body.id}/complete`, { token });
  check('replaying the completion pays nothing extra', replay.body?.balance === 15);

  const timeline = await call('GET', '/activities', { token });
  check('completion landed on the timeline', timeline.body?.items?.length === 1);

  /* Habit ----------------------------------------------------------------- */
  const habit = await call('POST', '/habits', {
    token,
    body: { name: 'Exercise', creditValue: 10, category: 'HEALTH' },
  });
  check('habit created', habit.status === 201, JSON.stringify(habit.body));

  const kept = await call('POST', `/habits/${habit.body.habit.id}/complete`, { token });
  check('keeping a habit awards credits', kept.body?.creditsAwarded === 10);
  check('streak starts at one', kept.body?.habit?.currentStreak === 1);

  /* Reward: refusal then success ------------------------------------------ */
  const reward = await call('POST', '/rewards', {
    token,
    body: { title: 'Movie night', creditCost: 500 },
  });
  check('reward created', reward.status === 201);

  const tooPoor = await call('POST', `/rewards/${reward.body.id}/redeem`, { token });
  check('redemption refused when short', tooPoor.status === 409, JSON.stringify(tooPoor.body));
  check(
    'refusal says how much is missing',
    /475 more credits/.test(tooPoor.body?.error?.message ?? ''),
    tooPoor.body?.error?.message,
  );

  const cheap = await call('POST', '/rewards', { token, body: { title: 'Coffee', creditCost: 20 } });
  const redeemed = await call('POST', `/rewards/${cheap.body.id}/redeem`, { token });
  check('redemption succeeds when affordable', redeemed.status === 200, JSON.stringify(redeemed.body));
  check('balance debited exactly once', redeemed.body?.balance === 5);

  /* Analytics and the assistant ------------------------------------------- */
  const today = await call('GET', '/analytics/today', { token });
  check('analytics reports the day', today.body?.tasksCompleted === 1, JSON.stringify(today.body));
  check('life score is computed server-side', typeof today.body?.lifeScore === 'number');

  const summary = await call('POST', '/ai/summarize-day', { token });
  check('assistant answers from the record', /1 of 1 tasks/.test(summary.body?.text ?? ''), summary.body?.text);

  /* Validation and errors ------------------------------------------------- */
  const invalid = await call('POST', '/tasks', { token, body: { title: '' } });
  check('validation returns 422 with a readable message', invalid.status === 422);
  check(
    'validation error names the field',
    invalid.body?.error?.details?.[0]?.field === 'body.title',
    JSON.stringify(invalid.body),
  );

  const missing = await call('GET', '/nope', { token });
  check('unknown route returns a structured 404', missing.status === 404 && missing.body?.error?.code === 'NOT_FOUND');

  /* Graceful shutdown ----------------------------------------------------- */
  // Windows has no real SIGTERM: kill() terminates the process outright, so the
  // handler cannot run and there is nothing meaningful to assert.
  if (process.platform === 'win32') {
    console.log('SKIP  graceful SIGTERM shutdown (not supported on Windows)');
    server.kill();
  } else {
    server.kill('SIGTERM');
    const exitCode = await new Promise((resolve) => server.on('exit', resolve));
    check('shuts down cleanly on SIGTERM', exitCode === 0, `exit code ${exitCode}`);
  }
} catch (error) {
  failures += 1;
  console.log('FAIL  smoke run threw:', error.message);
  console.log(serverLog.join(''));
} finally {
  if (!server.killed) server.kill('SIGKILL');
  await replSet.stop();
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
