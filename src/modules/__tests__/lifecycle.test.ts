import { describe, expect, it } from 'vitest';

import * as credits from '@/modules/credits/credits.service';
import { request, signUp, testApp } from '@/test/helpers';

describe('goals', () => {
  it('derives progress from milestones and pays out once per milestone', async () => {
    const user = await signUp();

    const created = (
      await user
        .auth('post', '/goals')
        .send({ title: 'Ship the product', milestones: [{ title: 'Design' }, { title: 'Build' }] })
        .expect(201)
    ).body;

    expect(created.progress).toBe(0);
    const goalId = created.goal.id;
    const first = created.goal.milestones[0].id;

    const done = await user
      .auth('patch', `/goals/${goalId}/milestones/${first}`)
      .send({ isCompleted: true })
      .expect(200);

    expect(done.body.progress).toBe(50);
    expect(done.body.creditsAwarded).toBe(20);

    // Repeating the same state must not pay again.
    const again = await user
      .auth('patch', `/goals/${goalId}/milestones/${first}`)
      .send({ isCompleted: true })
      .expect(200);
    expect(again.body.creditsAwarded).toBe(0);
    expect(again.body.balance).toBe(20);

    // Unticking takes the payout back.
    const undone = await user
      .auth('patch', `/goals/${goalId}/milestones/${first}`)
      .send({ isCompleted: false })
      .expect(200);
    expect(undone.body.balance).toBe(0);
    expect(undone.body.progress).toBe(0);
  });

  it('uses a numeric target when one is set', async () => {
    const user = await signUp();

    const created = (
      await user
        .auth('post', '/goals')
        .send({ title: 'Save', targetValue: 500_000, currentValue: 200_000, unit: 'INR' })
        .expect(201)
    ).body;

    expect(created.progress).toBe(40);

    const logged = await user
      .auth('post', `/goals/${created.goal.id}/progress`)
      .send({ amount: 50_000 })
      .expect(200);

    expect(logged.body.goal.currentValue).toBe(250_000);
    expect(logged.body.progress).toBe(50);
  });

  it('unlinks tasks rather than deleting them when the goal goes', async () => {
    const user = await signUp();
    const goal = (await user.auth('post', '/goals').send({ title: 'Learn' }).expect(201)).body;
    const task = (
      await user.auth('post', '/tasks').send({ title: 'Read a chapter', goalId: goal.goal.id }).expect(201)
    ).body;

    await user.auth('delete', `/goals/${goal.goal.id}`).expect(204);

    const survivor = await user.auth('get', `/tasks/${task.id}`).expect(200);
    expect(survivor.body.goalId).toBeUndefined();
  });
});

describe('focus sessions', () => {
  it('runs one at a time', async () => {
    const user = await signUp();

    await user.auth('post', '/focus/start').send({ title: 'Deep work', targetMinutes: 50 }).expect(201);

    const second = await user
      .auth('post', '/focus/start')
      .send({ title: 'Another', targetMinutes: 25 })
      .expect(409);

    expect(second.body.error.message).toMatch(/already running/);
  });

  it('logs a timeline entry and pays for the time actually spent', async () => {
    const user = await signUp();
    await user.auth('post', '/focus/start').send({ title: 'Deep work', targetMinutes: 50 }).expect(201);

    const finished = await user.auth('post', '/focus/finish').expect(200);

    // Measured from the server's own timestamps, so a session that just started
    // is worth nothing — the client cannot claim otherwise.
    expect(finished.body.minutes).toBe(0);
    expect(finished.body.creditsAwarded).toBe(0);

    const timeline = await user.auth('get', '/activities').expect(200);
    expect(timeline.body.items).toHaveLength(1);
    expect(timeline.body.items[0].source).toBe('FOCUS');
  });

  it('discards an abandoned session entirely', async () => {
    const user = await signUp();
    await user.auth('post', '/focus/start').send({ title: 'Deep work', targetMinutes: 25 }).expect(201);

    await user.auth('post', '/focus/abandon').expect(204);

    const active = await user.auth('get', '/focus/active').expect(200);
    expect(active.body.session).toBeNull();

    const timeline = await user.auth('get', '/activities').expect(200);
    expect(timeline.body.items).toHaveLength(0);
  });
});

describe('activities and the timeline', () => {
  it('surfaces untracked gaps', async () => {
    const user = await signUp();
    const today = new Date().toISOString().slice(0, 10);

    await user
      .auth('post', '/activities')
      .send({
        title: 'Morning block',
        category: 'WORK',
        startTime: `${today}T09:00:00.000Z`,
        endTime: `${today}T11:00:00.000Z`,
      })
      .expect(201);

    await user
      .auth('post', '/activities')
      .send({
        title: 'Afternoon block',
        category: 'WORK',
        startTime: `${today}T15:00:00.000Z`,
        endTime: `${today}T16:00:00.000Z`,
      })
      .expect(201);

    const timeline = await user.auth('get', '/activities').expect(200);
    expect(timeline.body.items).toHaveLength(2);
    expect(timeline.body.gaps).toHaveLength(1);
    expect(timeline.body.gaps[0].minutes).toBe(240);
  });

  it('caps the credits a manually logged activity can award', async () => {
    const user = await signUp();

    await user
      .auth('post', '/activities')
      .send({ title: 'Nice try', creditsEarned: 100_000 })
      .expect(422);
  });

  it('rewrites the ledger entry when an activity is edited', async () => {
    const user = await signUp();
    const created = (
      await user.auth('post', '/activities').send({ title: 'Workout', creditsEarned: 10 }).expect(201)
    ).body;

    expect(created.balance).toBe(10);

    const updated = await user
      .auth('patch', `/activities/${created.activity.id}`)
      .send({ creditsEarned: 5 })
      .expect(200);

    expect(updated.body.balance).toBe(5);

    await user.auth('delete', `/activities/${created.activity.id}`).expect(204);
    const balance = await user.auth('get', '/credits/balance').expect(200);
    expect(balance.body.balance).toBe(0);
  });
});

describe('analytics', () => {
  it('reports a zero score for a day with nothing on it', async () => {
    const user = await signUp();

    const today = await user.auth('get', '/analytics/today').expect(200);
    expect(today.body.lifeScore).toBe(0);
    expect(today.body.tasksTotal).toBe(0);
  });

  it('moves the Life Score as work is completed', async () => {
    const user = await signUp();

    const task = (await user.auth('post', '/tasks').send({ title: 'A', priority: 'HIGH' })).body;
    const habit = (await user.auth('post', '/habits').send({ name: 'Exercise', creditValue: 10 })).body;

    await user.auth('post', `/tasks/${task.id}/complete`).expect(200);
    await user.auth('post', `/habits/${habit.habit.id}/complete`).expect(200);

    const today = await user.auth('get', '/analytics/today').expect(200);
    expect(today.body.tasksCompleted).toBe(1);
    expect(today.body.tasksTotal).toBe(1);
    expect(today.body.habitsCompleted).toBe(1);
    expect(today.body.creditsEarned).toBe(20);
    expect(today.body.lifeScore).toBeGreaterThan(0);
  });

  it('returns a breakdown that explains the score', async () => {
    const user = await signUp();

    const breakdown = await user.auth('get', '/analytics/life-score').expect(200);
    expect(breakdown.body.components).toHaveLength(6);
    expect(breakdown.body.components.map((c: { key: string }) => c.key)).toEqual([
      'tasks',
      'habits',
      'goals',
      'focus',
      'health',
      'reflection',
    ]);
  });

  it('fills the whole insights screen in one call', async () => {
    const user = await signUp();

    const overview = await user.auth('get', '/analytics/overview?days=7').expect(200);
    expect(overview.body.week).toHaveLength(7);
    expect(overview.body.credits).toBeDefined();
    expect(overview.body.averages).toBeDefined();
    expect(overview.body.habitConsistency).toBeDefined();
  });
});

describe('the assistant', () => {
  it('says there is nothing to read rather than inventing a day', async () => {
    const user = await signUp();

    const reply = await user.auth('post', '/ai/summarize-day').expect(200);
    expect(reply.body.text).toMatch(/Nothing is logged for today/);
  });

  it('answers from the record once there is one', async () => {
    const user = await signUp();
    const task = (await user.auth('post', '/tasks').send({ title: 'A', priority: 'HIGH' })).body;
    await user.auth('post', `/tasks/${task.id}/complete`).expect(200);

    const reply = await user.auth('post', '/ai/summarize-day').expect(200);
    expect(reply.body.text).toMatch(/1 of 1 tasks/);
    expect(reply.body.basedOn).toContain('credit ledger');
  });

  it('will not claim a workout that was never logged', async () => {
    const user = await signUp();

    const reply = await user.auth('post', '/ai/analyze-productivity').expect(200);
    expect(reply.body.text).toMatch(/timeline is empty/);
  });

  it('exposes exactly the context it reads', async () => {
    const user = await signUp();

    const context = await user.auth('get', '/ai/context').expect(200);
    expect(Object.keys(context.body).sort()).toEqual([
      'balance',
      'goals',
      'habits',
      'minutesByCategory',
      'openTasks',
      'profile',
      'today',
      'untrackedMinutes',
      'week',
    ]);
  });
});

describe('account data', () => {
  it('exports everything the account holds', async () => {
    const user = await signUp();
    await user.auth('post', '/tasks').send({ title: 'Exported task' }).expect(201);

    const exported = await user.auth('get', '/users/me/export').expect(200);

    expect(exported.body.account.email).toBe(user.email);
    expect(exported.body.tasks).toHaveLength(1);
    expect(exported.body).toHaveProperty('habits');
    expect(exported.body).toHaveProperty('transactions');
  });

  it('deletes the account and everything in it', async () => {
    const user = await signUp();
    const task = (await user.auth('post', '/tasks').send({ title: 'Doomed', priority: 'HIGH' })).body;
    await user.auth('post', `/tasks/${task.id}/complete`).expect(200);

    await user.auth('delete', '/users/me').expect(204);

    // Nothing is left behind in the ledger either.
    expect(await credits.getBalance(user.id)).toBe(0);
    await user.auth('get', '/users/me').expect(404);
  });
});

describe('health', () => {
  it('reports the database state without needing a token', async () => {
    const response = await request(testApp()).get('/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.database).toBe('connected');
  });
});
