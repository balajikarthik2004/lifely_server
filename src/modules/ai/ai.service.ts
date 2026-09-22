/**
 * AI service (spec sections 25, 46, 47).
 *
 * `AIProvider` is the seam. The bundled `LocalAnalyst` is deterministic and
 * reads only the structured `AIContext` that `buildContext` assembles — never
 * the raw database. Pointing this at a hosted model means implementing one
 * interface and swapping the export at the bottom; no route changes.
 *
 * Guardrails: every sentence below is derived from recorded data. Where data is
 * missing, the assistant says so rather than inventing an activity.
 */
import { lastNDayKeys, todayKey } from '@/common/utils/dates';
import { toObjectId } from '@/common/utils/ownership';
import { currentStreak, type HabitLike } from '@/domain/habits';
import * as activitiesService from '@/modules/activities/activities.service';
import * as analytics from '@/modules/analytics/analytics.service';
import * as credits from '@/modules/credits/credits.service';
import { Goal } from '@/modules/goals/goal.model';
import { goalProgress } from '@/domain/goals';
import { Habit } from '@/modules/habits/habit.model';
import { Task } from '@/modules/tasks/task.model';
import { User } from '@/modules/users/user.model';

export interface AIContext {
  profile: { name: string; workStart: string; workEnd: string };
  today: analytics.DailyRecord;
  week: analytics.DailyRecord[];
  goals: { title: string; progress: number; deadline?: string; status: string }[];
  habits: { name: string; streak: number; category: string }[];
  openTasks: { title: string; priority: string; dueDate?: string }[];
  minutesByCategory: Record<string, number>;
  untrackedMinutes: number;
  balance: number;
}

export interface AIReply {
  text: string;
  suggestions?: string[];
  /** What the answer was derived from, so the client can be honest about it. */
  basedOn: string[];
}

export interface AIProvider {
  summarizeDay(ctx: AIContext): Promise<AIReply>;
  analyzeProductivity(ctx: AIContext): Promise<AIReply>;
  planTomorrow(ctx: AIContext): Promise<AIReply>;
  analyzeHabits(ctx: AIContext): Promise<AIReply>;
  analyzeGoals(ctx: AIContext): Promise<AIReply>;
  chat(message: string, ctx: AIContext): Promise<AIReply>;
}

export const AI_QUICK_ACTIONS = [
  'Summarize my day',
  'Where did I lose time?',
  'Plan tomorrow for me',
  'How are my habits doing?',
  'Am I moving toward my goals?',
];

/**
 * Assemble the context (spec section 46).
 *
 * Deliberately small and shaped: a summary of today, the week, goals, habits,
 * open tasks and balances. The whole database is never handed to a model.
 */
export async function buildContext(userId: string): Promise<AIContext> {
  const owner = toObjectId(userId);
  const today = todayKey();

  const [user, week, goals, habits, openTasks, todaysActivities, balance] = await Promise.all([
    User.findById(userId),
    analytics.recordsForRange(userId, 7),
    Goal.find({ userId: owner, status: 'ACTIVE' }),
    Habit.find({ userId: owner, isActive: true }),
    Task.find({ userId: owner, status: 'TODO' }).sort({ dueDate: 1 }).limit(20),
    activitiesService.forDay(userId, today),
    credits.getBalance(userId),
  ]);

  const gaps = activitiesService.findGaps(todaysActivities);

  const minutesByCategory: Record<string, number> = {};
  todaysActivities.forEach((activity) => {
    minutesByCategory[activity.category] =
      (minutesByCategory[activity.category] ?? 0) + activity.durationMinutes;
  });

  return {
    profile: {
      name: user?.profile.name ?? 'there',
      workStart: user?.profile.workStart ?? '09:00',
      workEnd: user?.profile.workEnd ?? '18:00',
    },
    today: week[week.length - 1],
    week,
    goals: goals.map((goal) => ({
      title: goal.title,
      progress: goalProgress(goal),
      deadline: goal.deadline,
      status: goal.status,
    })),
    habits: habits.map((habit) => ({
      name: habit.name,
      category: habit.category,
      streak: currentStreak(
        {
          frequency: habit.frequency,
          days: habit.days,
          isActive: habit.isActive,
          log: Object.fromEntries(habit.log ?? new Map()) as HabitLike['log'],
        },
        today,
      ),
    })),
    openTasks: openTasks.map((task) => ({
      title: task.title,
      priority: task.priority,
      dueDate: task.dueDate,
    })),
    minutesByCategory,
    untrackedMinutes: gaps.reduce((sum, gap) => sum + gap.minutes, 0),
    balance,
  };
}

function formatDuration(minutes: number): string {
  if (minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function addHours(time: string, hours: number): string {
  const [h, m] = time.split(':').map(Number);
  return `${String((h + hours) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

class LocalAnalyst implements AIProvider {
  async summarizeDay(ctx: AIContext): Promise<AIReply> {
    const { today } = ctx;
    const nothingYet =
      today.tasksCompleted === 0 && today.habitsCompleted === 0 && today.creditsEarned === 0;

    if (nothingYet) {
      return {
        text: 'Nothing is logged for today yet, so there is nothing for me to read into. Log one activity or tick off a habit and I will have something to work with.',
        suggestions: ['Plan tomorrow for me', 'How are my habits doing?'],
        basedOn: ["today's record"],
      };
    }

    const pastDays = ctx.week.filter((r) => r.date <= todayKey());
    const avgScore = pastDays.reduce((sum, r) => sum + r.lifeScore, 0) / (pastDays.length || 1);
    const delta = today.lifeScore - avgScore;
    const comparison =
      avgScore > 0
        ? delta >= 0
          ? ` That puts you ${Math.round(delta)} points above your week so far.`
          : ` That is ${Math.round(-delta)} points below your week so far — there is still time.`
        : '';

    return {
      text: `You completed ${today.tasksCompleted} of ${today.tasksTotal || today.tasksCompleted} tasks, kept ${today.habitsCompleted} of ${today.habitsTotal} habits, and spent ${formatDuration(today.focusMinutes)} in focused work, earning ${today.creditsEarned} credits. Your Life Score is ${today.lifeScore}.${comparison}`,
      suggestions: ['Where did I lose time?', 'Plan tomorrow for me'],
      basedOn: ['tasks', 'habits', 'activities', 'credit ledger'],
    };
  }

  async analyzeProductivity(ctx: AIContext): Promise<AIReply> {
    const entries = Object.entries(ctx.minutesByCategory)
      .filter(([, minutes]) => minutes > 0)
      .sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) {
      return {
        text: 'Your timeline is empty for today, so I cannot tell where the time went. Adding even three or four entries makes this much more useful.',
        suggestions: ['Summarize my day'],
        basedOn: ['timeline'],
      };
    }

    const [topCategory, topMinutes] = entries[0];
    const gapLine =
      ctx.untrackedMinutes >= 45
        ? ` You also have ${formatDuration(ctx.untrackedMinutes)} of untracked time today — I cannot say what happened there, only that nothing was logged.`
        : ' Almost all of your day is accounted for, which is unusual and good.';

    return {
      text: `Your biggest block today was ${topCategory.toLowerCase()} at ${formatDuration(topMinutes)}. Focused sessions came to ${formatDuration(ctx.today.focusMinutes)}.${gapLine}`,
      suggestions: ['Plan tomorrow for me', 'Am I moving toward my goals?'],
      basedOn: ['timeline', 'focus sessions'],
    };
  }

  async planTomorrow(ctx: AIContext): Promise<AIReply> {
    const rank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    const open = [...ctx.openTasks].sort((a, b) => rank[a.priority] - rank[b.priority]);
    const start = ctx.profile.workStart;

    const lines = [`${start}–${addHours(start, 2)}  Deep work`];
    if (open[0]) lines.push(`   → ${open[0].title}`);
    lines.push(`${addHours(start, 2)}–${addHours(start, 3)}  Shallow work, messages, reviews`);
    if (open[1]) lines.push(`   → ${open[1].title}`);
    lines.push('13:00–14:00  Lunch, away from the screen');
    lines.push(`14:00–${addHours(start, 7)}  Second focus block`);
    if (open[2]) lines.push(`   → ${open[2].title}`);

    const healthHabit = ctx.habits.find((h) => h.category === 'HEALTH');
    if (healthHabit) lines.push(`18:00–19:00  ${healthHabit.name}`);
    lines.push('21:30  Reflection, then lights out');

    const basis = open.length
      ? `Built from your ${open.length} open ${open.length === 1 ? 'task' : 'tasks'} and your usual hours.`
      : 'You have no open tasks, so this is just your usual shape of day.';

    return {
      text: `${basis}\n\n${lines.join('\n')}\n\nThe first block is the one worth defending.`,
      suggestions: ['Summarize my day', 'How are my habits doing?'],
      basedOn: ['open tasks', 'habits', 'preferred hours'],
    };
  }

  async analyzeHabits(ctx: AIContext): Promise<AIReply> {
    if (ctx.habits.length === 0) {
      return {
        text: 'You have not set up any habits yet. Two or three is plenty to start — more than that and they tend to collapse together.',
        suggestions: ['Plan tomorrow for me'],
        basedOn: ['habits'],
      };
    }

    const ranked = [...ctx.habits].sort((a, b) => b.streak - a.streak);
    const best = ranked[0];
    const weakest = ranked[ranked.length - 1];

    const bestLine =
      best.streak > 0
        ? `${best.name} is your strongest right now at ${best.streak} ${best.streak === 1 ? 'day' : 'days'}.`
        : 'No habit has a live streak today.';

    const weakLine =
      ranked.length > 1 && weakest.streak === 0
        ? ` ${weakest.name} is the one slipping — it has no current streak.`
        : '';

    return {
      text: `${bestLine}${weakLine} Across today you have kept ${ctx.today.habitsCompleted} of ${ctx.today.habitsTotal} scheduled habits.`,
      suggestions: ['Summarize my day', 'Am I moving toward my goals?'],
      basedOn: ['habit logs'],
    };
  }

  async analyzeGoals(ctx: AIContext): Promise<AIReply> {
    if (ctx.goals.length === 0) {
      return {
        text: 'There are no active goals to measure against. A goal gives the daily work somewhere to point.',
        suggestions: ['Plan tomorrow for me'],
        basedOn: ['goals'],
      };
    }

    const scored = [...ctx.goals].sort((a, b) => b.progress - a.progress);
    const lead = scored[0];
    const lag = scored[scored.length - 1];
    const deadlineNote = lag.deadline ? ` Its deadline is ${lag.deadline}.` : '';

    if (scored.length === 1) {
      return {
        text: `${lead.title} is at ${Math.round(lead.progress)}%.${deadlineNote}`,
        suggestions: ['Plan tomorrow for me'],
        basedOn: ['goals'],
      };
    }

    return {
      text: `${lead.title} is furthest along at ${Math.round(lead.progress)}%. ${lag.title} is the one lagging at ${Math.round(lag.progress)}%.${deadlineNote} I can only see what has been logged — if you have made progress off-app, update it and this will sharpen.`,
      suggestions: ['How are my habits doing?', 'Summarize my day'],
      basedOn: ['goals', 'milestones'],
    };
  }

  async chat(message: string, ctx: AIContext): Promise<AIReply> {
    const q = message.toLowerCase();

    if (/(summar|how was|my day|today)/.test(q)) return this.summarizeDay(ctx);
    if (/(waste|lose time|lost time|where did|time go|untracked)/.test(q)) {
      return this.analyzeProductivity(ctx);
    }
    if (/(plan|tomorrow|schedule)/.test(q)) return this.planTomorrow(ctx);
    if (/(habit|streak|routine)/.test(q)) return this.analyzeHabits(ctx);
    if (/(goal|progress|milestone)/.test(q)) return this.analyzeGoals(ctx);

    if (/(credit|balance|reward)/.test(q)) {
      return {
        text: `You are holding ${ctx.balance.toLocaleString('en-US')} credits, and earned ${ctx.today.creditsEarned} of them today.`,
        suggestions: ['Summarize my day'],
        basedOn: ['credit ledger'],
      };
    }

    if (/(tip|advice|help me|improve|better)/.test(q)) {
      const weakest = [...ctx.week]
        .filter((r) => r.date <= todayKey())
        .sort((a, b) => a.lifeScore - b.lifeScore)[0];
      const dayNote = weakest ? ` Your weakest day this week was ${weakest.date}.` : '';
      return {
        text: `One thing that reliably moves the number: protect a single two-hour block tomorrow morning and put your hardest task in it.${dayNote}`,
        suggestions: ['Plan tomorrow for me'],
        basedOn: ['weekly records'],
      };
    }

    return {
      text: 'I work from what you have logged here — your day, habits, goals, credits and reflections. Ask me about any of those and I will answer from the actual record rather than guessing.',
      suggestions: AI_QUICK_ACTIONS,
      basedOn: [],
    };
  }
}

export const aiProvider: AIProvider = new LocalAnalyst();

/** Recent days available to the assistant, stated so the client can show it. */
export function contextWindowDays(): number {
  return lastNDayKeys(7).length;
}
