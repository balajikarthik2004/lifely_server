import { z } from 'zod';

/** 'yyyy-MM-dd' — the app keys a day by local calendar date, not by timestamp. */
export const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date in yyyy-MM-dd form');

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function toDateKey(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

export function lastNDayKeys(n: number, end: Date = new Date()): string[] {
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - i);
    keys.push(day.toISOString().slice(0, 10));
  }
  return keys;
}

/** Inclusive start / exclusive end timestamps covering one calendar day. */
export function dayBounds(dateKey: string): { start: Date; end: Date } {
  const start = new Date(`${dateKey}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}
