/**
 * Habit scheduling and streaks (spec section 9).
 *
 * Rest days and unscheduled days never break a streak; only a genuinely missed
 * scheduled day does. Today stays neutral until it is completed, so an
 * unfinished day never reads as a break.
 */
export type HabitDayEntry = 'COMPLETED' | 'SKIPPED';
export type HabitDayState = HabitDayEntry | 'MISSED' | 'NOT_SCHEDULED';

export interface HabitLike {
  frequency: 'DAILY' | 'WEEKLY' | 'CUSTOM';
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  isActive: boolean;
  log: Record<string, HabitDayEntry>;
}

function weekdayOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
}

function shiftKey(dateKey: string, deltaDays: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + deltaDays);
  return date.toISOString().slice(0, 10);
}

export function isScheduled(habit: HabitLike, dateKey: string): boolean {
  if (!habit.isActive) return false;
  if (habit.frequency === 'DAILY') return true;
  return habit.days.includes(weekdayOf(dateKey));
}

export function dayState(habit: HabitLike, dateKey: string, todayKey: string): HabitDayState {
  if (!isScheduled(habit, dateKey)) return 'NOT_SCHEDULED';
  const logged = habit.log[dateKey];
  if (logged) return logged;
  return dateKey < todayKey ? 'MISSED' : 'NOT_SCHEDULED';
}

export function currentStreak(habit: HabitLike, todayKey: string): number {
  let streak = 0;
  let cursor = todayKey;

  for (let i = 0; i < 400; i += 1) {
    const logged = habit.log[cursor];

    if (logged === 'COMPLETED') {
      streak += 1;
    } else if (logged === 'SKIPPED' || !isScheduled(habit, cursor)) {
      // Rest day or not scheduled -- neutral, keep walking back.
    } else if (cursor === todayKey) {
      // Today is still open; it neither adds to nor breaks the streak.
    } else {
      break;
    }
    cursor = shiftKey(cursor, -1);
  }
  return streak;
}

export function longestStreak(habit: HabitLike): number {
  const completed = Object.entries(habit.log)
    .filter(([, value]) => value === 'COMPLETED')
    .map(([key]) => key)
    .sort();
  if (completed.length === 0) return 0;

  let best = 1;
  let run = 1;

  for (let i = 1; i < completed.length; i += 1) {
    const previous = completed[i - 1];
    const current = completed[i];
    const gapDays = Math.round(
      (new Date(`${current}T00:00:00.000Z`).getTime() -
        new Date(`${previous}T00:00:00.000Z`).getTime()) /
        86_400_000,
    );

    let bridged = gapDays === 1;
    if (!bridged && gapDays > 1 && gapDays <= 7) {
      bridged = true;
      for (let d = 1; d < gapDays; d += 1) {
        const key = shiftKey(previous, d);
        if (habit.log[key] !== 'SKIPPED' && isScheduled(habit, key)) {
          bridged = false;
          break;
        }
      }
    }

    run = bridged ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

export function completionRate(habit: HabitLike, dateKeys: string[]): number {
  const scheduled = dateKeys.filter((key) => isScheduled(habit, key));
  if (scheduled.length === 0) return 0;
  const done = scheduled.filter((key) => habit.log[key] === 'COMPLETED').length;
  return (done / scheduled.length) * 100;
}
