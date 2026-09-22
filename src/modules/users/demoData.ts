/**
 * Demo history for an account.
 *
 * Builds a believable fortnight so a fresh account has something to look at.
 * Everything is written through the same services the API uses, which means the
 * credit ledger it produces is real rather than fabricated.
 *
 * Used by `npm run seed` (for the demo login) and by
 * `POST /api/v1/users/me/demo-data` (for the app's "load sample data").
 */
import * as activities from '@/modules/activities/activities.service';
import * as goals from '@/modules/goals/goals.service';
import * as habits from '@/modules/habits/habits.service';
import * as reflections from '@/modules/reflections/reflections.service';
import * as rewards from '@/modules/rewards/rewards.service';
import * as tasks from '@/modules/tasks/tasks.service';

import { clearOwnedData } from './ownedCollections';
import { User } from './user.model';
import { toObjectId } from '@/common/utils/ownership';

function dayKey(offset: number): string {
  return new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
}

function at(offset: number, time: string): string {
  return new Date(`${dayKey(offset)}T${time}:00.000Z`).toISOString();
}

/** Deterministic, so re-seeding produces the same demo week. */
function seeded(index: number, day: number): number {
  const x = Math.sin(index * 127.1 + day * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const HABIT_SEEDS = [
  { name: 'Wake before 6:30', icon: '☀️', category: 'PERSONAL', creditValue: 5, reliability: 0.85 },
  { name: 'Exercise', icon: '\u{1F3CB}️', category: 'HEALTH', creditValue: 10, reliability: 0.8 },
  { name: 'Read 20 pages', icon: '\u{1F4D6}', category: 'LEARNING', creditValue: 5, reliability: 0.7 },
  { name: 'Meditate 10 min', icon: '\u{1F9D8}', category: 'PERSONAL', creditValue: 5, reliability: 0.65 },
  { name: 'Drink 3L water', icon: '\u{1F4A7}', category: 'HEALTH', creditValue: 3, reliability: 0.6 },
  { name: 'Lights out by 23:00', icon: '\u{1F634}', category: 'HEALTH', creditValue: 5, reliability: 0.55 },
] as const;

const DAY_ACTIVITIES = [
  { time: '06:45', end: '07:30', title: 'Morning workout', icon: '\u{1F3CB}️', category: 'HEALTH', credits: 10 },
  { time: '09:30', end: '11:30', title: 'Deep work', icon: '\u{1F4BB}', category: 'WORK', credits: 20 },
  { time: '14:00', end: '15:30', title: 'Project work', icon: '\u{1F4BB}', category: 'WORK', credits: 10 },
  { time: '17:00', end: '17:45', title: 'Learning', icon: '\u{1F4DA}', category: 'LEARNING', credits: 5 },
  { time: '20:30', end: '21:10', title: 'Reading', icon: '\u{1F4D6}', category: 'LEARNING', credits: 5 },
] as const;

/**
 * Replaces everything the account owns with the demo fortnight.
 *
 * Clearing first is what makes this safe to run twice: the ledger and the
 * derived-activity indexes are unique per source, so a second pass over the same
 * habit-days would otherwise collide.
 */
export async function seedDemoData(userId: string): Promise<void> {
  await clearOwnedData(toObjectId(userId));

  await User.updateOne(
    { _id: toObjectId(userId) },
    {
      $set: {
        onboarded: true,
        'profile.statement': 'Building a better me.',
        'profile.avatarEmoji': '\u{1F680}',
      },
    },
  );

  /* Goals ---------------------------------------------------------------- */
  const career = await goals.create(userId, {
    title: 'Become a full-stack developer',
    why: 'So I can build and ship my own products end to end, without waiting on anyone.',
    icon: '\u{1F4BB}',
    category: 'WORK',
    deadline: dayKey(-120),
    milestones: [
      { title: 'Finish advanced TypeScript course' },
      { title: 'Build a REST API with auth' },
      { title: 'Ship a full-stack side project' },
      { title: 'Learn system design fundamentals' },
      { title: 'Deploy on a cloud provider' },
    ],
  });

  // Mark the first three as reached, which pays out through the credit engine.
  for (const milestone of career.goal.milestones.slice(0, 3)) {
    await goals.setMilestone(userId, String(career.goal._id), String(milestone._id), true);
  }

  await goals.create(userId, {
    title: 'Save 5 lakhs',
    why: 'A real safety net means I can take the risk I keep talking about.',
    icon: '\u{1F4B0}',
    category: 'FINANCE',
    targetValue: 500_000,
    currentValue: 200_000,
    unit: '₹',
    deadline: dayKey(-250),
  });

  await goals.create(userId, {
    title: 'Read 24 books this year',
    icon: '\u{1F4DA}',
    category: 'LEARNING',
    targetValue: 24,
    currentValue: 9,
    unit: 'books',
  });

  /* Habits --------------------------------------------------------------- */
  const created = await Promise.all(
    HABIT_SEEDS.map((seed) =>
      habits.create(userId, {
        name: seed.name,
        icon: seed.icon,
        category: seed.category,
        creditValue: seed.creditValue,
      }),
    ),
  );

  for (let index = 0; index < created.length; index += 1) {
    const habitId = String(created[index].habit._id);
    for (let offset = 13; offset >= 0; offset -= 1) {
      if (seeded(index, offset) < HABIT_SEEDS[index].reliability) {
        await habits.complete(userId, habitId, dayKey(offset));
      }
    }
  }

  /* Activities ----------------------------------------------------------- */
  for (let offset = 13; offset >= 0; offset -= 1) {
    for (let index = 0; index < DAY_ACTIVITIES.length; index += 1) {
      const seed = DAY_ACTIVITIES[index];
      if (seeded(index + 40, offset) > 0.82) continue; // some days simply slip
      await activities.create(userId, {
        title: seed.title,
        icon: seed.icon,
        category: seed.category,
        startTime: at(offset, seed.time),
        endTime: at(offset, seed.end),
        creditsEarned: seed.credits,
      });
    }
  }

  /* Tasks ---------------------------------------------------------------- */
  const today = dayKey(0);
  const taskSeeds = [
    { title: 'Finish ERP testing round 2', priority: 'CRITICAL', category: 'WORK', done: true },
    { title: 'Send the client proposal', priority: 'HIGH', category: 'WORK', done: true },
    { title: 'Strength session', priority: 'HIGH', category: 'HEALTH', done: true },
    { title: 'Review monthly budget', priority: 'MEDIUM', category: 'FINANCE', done: false },
    { title: 'Call home', priority: 'LOW', category: 'FAMILY', done: false },
  ] as const;

  for (const seed of taskSeeds) {
    const task = await tasks.create(userId, {
      title: seed.title,
      priority: seed.priority,
      category: seed.category,
      dueDate: today,
      estimatedMinutes: 45,
    });
    if (seed.done) await tasks.complete(userId, String(task._id));
  }

  /* Rewards -------------------------------------------------------------- */
  await rewards.create(userId, {
    title: 'Movie night',
    description: 'A film, the good snacks, no laptop in the room.',
    icon: '\u{1F37F}',
    creditCost: 500,
    category: 'ENTERTAINMENT',
  });
  await rewards.create(userId, {
    title: 'Dinner out',
    icon: '\u{1F37D}️',
    creditCost: 800,
    category: 'FOOD',
  });
  await rewards.create(userId, {
    title: 'Something you have wanted',
    icon: '\u{1F6CD}️',
    creditCost: 2000,
    category: 'SHOPPING',
  });

  /* Reflections ---------------------------------------------------------- */
  await reflections.save(userId, {
    date: dayKey(1),
    mood: 4,
    energy: 4,
    wentWell: 'Two clean hours on the ERP module before anyone messaged me.',
    couldBeBetter: 'Lost the afternoon to context switching between three threads.',
    learned: 'Batching reviews into one slot works far better than replying as they arrive.',
    tomorrow: 'Protect the 9-11 block and keep the phone in the other room.',
  });
}
