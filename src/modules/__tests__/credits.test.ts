import { describe, expect, it } from 'vitest';

import { CreditTransaction } from '@/modules/credits/creditTransaction.model';
import * as credits from '@/modules/credits/credits.service';
import { signUp } from '@/test/helpers';

/**
 * The credit engine is the piece most worth pinning down: the balance is
 * derived from the ledger, so these tests check that every path writes exactly
 * one entry, and that undoing removes it.
 */
describe('task completion', () => {
  it('awards credits, writes a ledger entry and adds a timeline entry together', async () => {
    const user = await signUp();

    const task = (await user.auth('post', '/tasks').send({ title: 'Ship it', priority: 'HIGH' }).expect(201))
      .body;
    expect(task.creditValue).toBe(10);

    const before = await user.auth('get', '/credits/balance').expect(200);
    expect(before.body.balance).toBe(0);

    const completion = await user.auth('post', `/tasks/${task.id}/complete`).expect(200);
    expect(completion.body.creditsAwarded).toBe(10);
    expect(completion.body.balance).toBe(10);

    const ledger = await user.auth('get', '/credits/transactions').expect(200);
    expect(ledger.body.items).toHaveLength(1);
    expect(ledger.body.items[0].type).toBe('TASK_COMPLETION');

    const timeline = await user.auth('get', '/activities').expect(200);
    expect(timeline.body.items).toHaveLength(1);
    expect(timeline.body.items[0].source).toBe('TASK');
  });

  it('cannot be paid out twice, even if the request is repeated', async () => {
    const user = await signUp();
    const task = (await user.auth('post', '/tasks').send({ title: 'Ship it', priority: 'HIGH' })).body;

    await user.auth('post', `/tasks/${task.id}/complete`).expect(200);
    const second = await user.auth('post', `/tasks/${task.id}/complete`).expect(200);

    expect(second.body.creditsAwarded).toBe(0);
    expect(second.body.balance).toBe(10);

    const ledger = await user.auth('get', '/credits/transactions').expect(200);
    expect(ledger.body.items).toHaveLength(1);
  });

  it('survives two concurrent completions without double-paying', async () => {
    const user = await signUp();
    const task = (await user.auth('post', '/tasks').send({ title: 'Race', priority: 'CRITICAL' })).body;

    // The unique (userId, sourceRef) index is what makes this safe, not timing.
    await Promise.allSettled([
      user.auth('post', `/tasks/${task.id}/complete`),
      user.auth('post', `/tasks/${task.id}/complete`),
    ]);

    const balance = await user.auth('get', '/credits/balance').expect(200);
    expect(balance.body.balance).toBe(15);

    const rows = await CreditTransaction.countDocuments({ sourceRef: `task:${task.id}` });
    expect(rows).toBe(1);
  });

  it('rolls the ledger and the timeline back when un-completed', async () => {
    const user = await signUp();
    const task = (await user.auth('post', '/tasks').send({ title: 'Undo me', priority: 'HIGH' })).body;

    await user.auth('post', `/tasks/${task.id}/complete`).expect(200);
    const undone = await user.auth('post', `/tasks/${task.id}/uncomplete`).expect(200);

    expect(undone.body.balance).toBe(0);
    expect(undone.body.task.status).toBe('TODO');
    expect(undone.body.task.completedAt).toBeUndefined();

    const ledger = await user.auth('get', '/credits/transactions').expect(200);
    expect(ledger.body.items).toHaveLength(0);

    const timeline = await user.auth('get', '/activities').expect(200);
    expect(timeline.body.items).toHaveLength(0);
  });

  it('takes the credits away when the task is deleted', async () => {
    const user = await signUp();
    const task = (await user.auth('post', '/tasks').send({ title: 'Delete me', priority: 'HIGH' })).body;

    await user.auth('post', `/tasks/${task.id}/complete`).expect(200);
    await user.auth('delete', `/tasks/${task.id}`).expect(204);

    const balance = await user.auth('get', '/credits/balance').expect(200);
    expect(balance.body.balance).toBe(0);
  });

  it('derives the credit value from the server rules, not the client', async () => {
    const user = await signUp();

    // An absurd value is rejected outright rather than quietly accepted.
    await user
      .auth('post', '/tasks')
      .send({ title: 'Greedy', priority: 'LOW', creditValue: 999_999 })
      .expect(422);

    // With nothing proposed, the value comes from the server's own rules.
    const defaulted = (
      await user.auth('post', '/tasks').send({ title: 'Normal', priority: 'CRITICAL' }).expect(201)
    ).body;
    expect(defaulted.creditValue).toBe(15);
  });
});

describe('habit completion', () => {
  it('awards the habit value and records the day', async () => {
    const user = await signUp();
    const created = (
      await user.auth('post', '/habits').send({ name: 'Exercise', creditValue: 10 }).expect(201)
    ).body;

    const result = await user.auth('post', `/habits/${created.habit.id}/complete`).expect(200);

    expect(result.body.creditsAwarded).toBe(10);
    expect(result.body.balance).toBe(10);
    expect(result.body.habit.stateToday).toBe('COMPLETED');
    expect(result.body.habit.currentStreak).toBe(1);
  });

  it('is idempotent for the same day', async () => {
    const user = await signUp();
    const created = (await user.auth('post', '/habits').send({ name: 'Read', creditValue: 5 })).body;

    await user.auth('post', `/habits/${created.habit.id}/complete`).expect(200);
    const second = await user.auth('post', `/habits/${created.habit.id}/complete`).expect(200);

    expect(second.body.creditsAwarded).toBe(0);
    expect(second.body.balance).toBe(5);
  });

  it('clears a day cleanly, leaving no orphaned credits', async () => {
    const user = await signUp();
    const created = (await user.auth('post', '/habits').send({ name: 'Read', creditValue: 5 })).body;

    await user.auth('post', `/habits/${created.habit.id}/complete`).expect(200);
    const cleared = await user.auth('post', `/habits/${created.habit.id}/clear`).expect(200);

    expect(cleared.body.balance).toBe(0);
    expect(cleared.body.habit.stateToday).toBe('PENDING');
  });

  it('treats a rest day as neutral', async () => {
    const user = await signUp();
    const created = (await user.auth('post', '/habits').send({ name: 'Rest', creditValue: 5 })).body;

    const skipped = await user.auth('post', `/habits/${created.habit.id}/skip`).expect(200);

    expect(skipped.body.balance).toBe(0);
    expect(skipped.body.habit.stateToday).toBe('SKIPPED');
  });

  it('refuses to tick off a day that has not happened yet', async () => {
    const user = await signUp();
    const created = (await user.auth('post', '/habits').send({ name: 'Future', creditValue: 5 })).body;

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const response = await user
      .auth('post', `/habits/${created.habit.id}/complete`)
      .send({ date: tomorrow })
      .expect(400);

    expect(response.body.error.message).toMatch(/has not happened yet/);
  });

  it('pays a streak bonus once the streak is long enough', async () => {
    const user = await signUp();
    const created = (await user.auth('post', '/habits').send({ name: 'Streak', creditValue: 5 })).body;
    const habitId = created.habit.id;

    // Ten prior days plus today makes an eleven-day streak: one full week of
    // bonus (+2) on top of the base 5.
    for (let daysAgo = 10; daysAgo >= 1; daysAgo -= 1) {
      const date = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
      await user.auth('post', `/habits/${habitId}/complete`).send({ date }).expect(200);
    }

    const today = await user.auth('post', `/habits/${habitId}/complete`).expect(200);
    expect(today.body.habit.currentStreak).toBe(11);
    expect(today.body.creditsAwarded).toBe(7);
  });
});

describe('reward redemption', () => {
  it('refuses when the balance is short and leaves the ledger untouched', async () => {
    const user = await signUp();
    const reward = (
      await user.auth('post', '/rewards').send({ title: 'Movie night', creditCost: 500 }).expect(201)
    ).body;

    const response = await user.auth('post', `/rewards/${reward.id}/redeem`).expect(409);

    expect(response.body.error.code).toBe('INSUFFICIENT_CREDITS');
    expect(response.body.error.message).toMatch(/500 more credits/);

    const ledger = await user.auth('get', '/credits/transactions').expect(200);
    expect(ledger.body.items).toHaveLength(0);
  });

  it('deducts exactly once', async () => {
    const user = await signUp();
    await credits.record(user.id, { amount: 600, type: 'ADJUSTMENT', description: 'Seed' });

    const reward = (await user.auth('post', '/rewards').send({ title: 'Movie', creditCost: 500 })).body;
    const redeemed = await user.auth('post', `/rewards/${reward.id}/redeem`).expect(200);

    expect(redeemed.body.spent).toBe(500);
    expect(redeemed.body.balance).toBe(100);
    expect(redeemed.body.reward.redemptions).toHaveLength(1);
  });

  it('will not let a second redemption overdraw the balance', async () => {
    const user = await signUp();
    await credits.record(user.id, { amount: 600, type: 'ADJUSTMENT', description: 'Seed' });
    const reward = (await user.auth('post', '/rewards').send({ title: 'Movie', creditCost: 500 })).body;

    await user.auth('post', `/rewards/${reward.id}/redeem`).expect(200);
    await user.auth('post', `/rewards/${reward.id}/redeem`).expect(409);

    const balance = await user.auth('get', '/credits/balance').expect(200);
    expect(balance.body.balance).toBe(100);
  });

  it('never goes negative when two redemptions race', async () => {
    const user = await signUp();
    await credits.record(user.id, { amount: 600, type: 'ADJUSTMENT', description: 'Seed' });
    const reward = (await user.auth('post', '/rewards').send({ title: 'Movie', creditCost: 500 })).body;

    // Both requests see a sufficient balance before either writes. The
    // transaction is what stops them both succeeding.
    await Promise.allSettled([
      user.auth('post', `/rewards/${reward.id}/redeem`),
      user.auth('post', `/rewards/${reward.id}/redeem`),
    ]);

    const balance = await credits.getBalance(user.id);
    expect(balance).toBeGreaterThanOrEqual(0);
    expect(balance).toBe(100);
  });
});

describe('reflections', () => {
  it('pays out on the first save and not again on an edit', async () => {
    const user = await signUp();

    const first = await user
      .auth('post', '/reflections')
      .send({ mood: 4, energy: 4, wentWell: 'Focused morning' })
      .expect(200);
    expect(first.body.creditsAwarded).toBe(5);

    const edited = await user
      .auth('post', '/reflections')
      .send({ mood: 5, energy: 4, wentWell: 'Edited' })
      .expect(200);

    expect(edited.body.creditsAwarded).toBe(0);
    expect(edited.body.balance).toBe(5);
    expect(edited.body.reflection.wentWell).toBe('Edited');

    const all = await user.auth('get', '/reflections').expect(200);
    expect(all.body.items).toHaveLength(1);
  });
});

describe('the ledger guarantee', () => {
  it('pays a given source exactly once, even without relying on the index', async () => {
    const user = await signUp();

    const first = await credits.record(user.id, {
      amount: 15,
      type: 'TASK_COMPLETION',
      description: 'Once only',
      sourceRef: 'task:regression',
    });

    const second = await credits.record(user.id, {
      amount: 15,
      type: 'TASK_COMPLETION',
      description: 'Once only',
      sourceRef: 'task:regression',
    });

    // The same row comes back rather than a second payout. This is the guard
    // that a production deployment depends on before its indexes finish
    // building -- a bug the end-to-end smoke run caught.
    expect(String(second._id)).toBe(String(first._id));
    expect(await credits.getBalance(user.id)).toBe(15);
    expect(await CreditTransaction.countDocuments({ sourceRef: 'task:regression' })).toBe(1);
  });

  it('leaves adjustments without a source free to repeat', async () => {
    const user = await signUp();

    await credits.record(user.id, { amount: 5, type: 'ADJUSTMENT', description: 'One' });
    await credits.record(user.id, { amount: 5, type: 'ADJUSTMENT', description: 'Two' });

    expect(await credits.getBalance(user.id)).toBe(10);
  });
});

describe('manual adjustments', () => {
  it('are bounded so a client cannot mint credits', async () => {
    const user = await signUp();

    await user.auth('post', '/credits/adjust').send({ amount: 100_000, description: 'nope' }).expect(422);
    await user.auth('post', '/credits/adjust').send({ amount: 0, description: 'nope' }).expect(422);

    const allowed = await user
      .auth('post', '/credits/adjust')
      .send({ amount: 25, description: 'Forgot to log a workout' })
      .expect(201);

    expect(allowed.body.balance).toBe(25);
  });
});
