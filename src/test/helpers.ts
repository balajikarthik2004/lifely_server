import request, { type Agent } from 'supertest';
import type { Express } from 'express';

import { createApp } from '@/app';

/**
 * Every model must be imported before the app boots so its schema, and more
 * importantly its indexes, are registered.
 */
import '@/modules/users/user.model';
import '@/modules/tasks/task.model';
import '@/modules/habits/habit.model';
import '@/modules/goals/goal.model';
import '@/modules/activities/activity.model';
import '@/modules/credits/creditTransaction.model';
import '@/modules/rewards/reward.model';
import '@/modules/reflections/reflection.model';
import '@/modules/focus/focusSession.model';

export const API = '/api/v1';

let app: Express | undefined;

export function testApp(): Express {
  app ??= createApp();
  return app;
}

export interface TestUser {
  id: string;
  email: string;
  accessToken: string;
  refreshToken: string;
  /** A supertest agent with the Authorization header already attached. */
  auth: (method: 'get' | 'post' | 'patch' | 'delete', path: string) => request.Test;
}

let counter = 0;

export async function signUp(overrides: { email?: string; password?: string } = {}): Promise<TestUser> {
  counter += 1;
  const email = overrides.email ?? `user${counter}.${Date.now()}@example.com`;
  const password = overrides.password ?? 'a-long-enough-password';

  const response = await request(testApp())
    .post(`${API}/auth/register`)
    .send({ email, password, name: 'Test Person' })
    .expect(201);

  const { accessToken, refreshToken, user } = response.body;

  return {
    id: user.id,
    email,
    accessToken,
    refreshToken,
    auth: (method, path) =>
      request(testApp())[method](`${API}${path}`).set('Authorization', `Bearer ${accessToken}`),
  };
}

export function agent(): Agent {
  return request.agent(testApp());
}

export { request };
