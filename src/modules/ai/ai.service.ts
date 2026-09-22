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
import { GoogleGenAI, Type } from '@google/genai';
import { env } from '@/config/env';
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


class GeminiAnalyst implements AIProvider {
  private async askGemini(prompt: string, ctx: AIContext): Promise<AIReply> {
    if (!env.GEMINI_API_KEY) {
      return {
        text: 'I am not configured yet. Please add your GEMINI_API_KEY to the server configuration.',
        suggestions: ['How to add API key?'],
        basedOn: [],
      };
    }
    
    const gemini = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    const replySchema = {
      type: Type.OBJECT,
      properties: {
        text: { type: Type.STRING },
        suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
        basedOn: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['text', 'basedOn'],
    };

    const contextString = JSON.stringify(ctx, null, 2);
    const systemInstruction = `You are a personalized productivity assistant for the Lifely app. Answer the user's query concisely and directly, using ONLY the provided JSON context about their day, week, goals, habits, and tasks. Never invent data. Keep responses under 3 sentences unless asked otherwise. Return JSON exactly matching the requested schema.`;
    
    try {
      const response = await gemini.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          { role: 'user', parts: [{ text: `Context:\n${contextString}\n\nQuery:\n${prompt}` }] }
        ],
        config: {
          systemInstruction,
          responseMimeType: 'application/json',
          responseSchema: replySchema,
        }
      });

      const replyJson = response.text;
      if (!replyJson) throw new Error('Empty response from Gemini');
      
      const parsed = JSON.parse(replyJson);
      return parsed as AIReply;
    } catch (e) {
      console.error('Failed to parse or fetch Gemini response', e);
      return { text: 'I encountered an error understanding my own response or reaching the AI service.', basedOn: [] };
    }
  }

  async summarizeDay(ctx: AIContext): Promise<AIReply> {
    return this.askGemini("Summarize my day, highlight any specific achievements or areas where I missed things.", ctx);
  }
  async analyzeProductivity(ctx: AIContext): Promise<AIReply> {
    return this.askGemini("Where did I lose time? Analyze my productivity and timeline.", ctx);
  }
  async planTomorrow(ctx: AIContext): Promise<AIReply> {
    return this.askGemini("Plan tomorrow for me based on my open tasks, work hours, and habits.", ctx);
  }
  async analyzeHabits(ctx: AIContext): Promise<AIReply> {
    return this.askGemini("How are my habits doing? Identify my strongest and weakest ones.", ctx);
  }
  async analyzeGoals(ctx: AIContext): Promise<AIReply> {
    return this.askGemini("Am I moving toward my goals? Break down the progress.", ctx);
  }
  async chat(message: string, ctx: AIContext): Promise<AIReply> {
    return this.askGemini(message, ctx);
  }
}

export const aiProvider: AIProvider = new GeminiAnalyst();

/** Recent days available to the assistant, stated so the client can show it. */
export function contextWindowDays(): number {
  return lastNDayKeys(7).length;
}
