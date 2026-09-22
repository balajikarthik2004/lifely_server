import { describe, expect, it } from 'vitest';

import { API, request, signUp, testApp } from '@/test/helpers';

describe('POST /auth/register', () => {
  it('creates an account and returns tokens', async () => {
    const response = await request(testApp())
      .post(`${API}/auth/register`)
      .send({ email: 'new@example.com', password: 'a-long-enough-password', name: 'Kiran' })
      .expect(201);

    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
    expect(response.body.user.email).toBe('new@example.com');
    expect(response.body.user.profile.name).toBe('Kiran');
  });

  it('never returns the password hash or the stored refresh tokens', async () => {
    const response = await request(testApp())
      .post(`${API}/auth/register`)
      .send({ email: 'secret@example.com', password: 'a-long-enough-password' })
      .expect(201);

    expect(response.body.user.passwordHash).toBeUndefined();
    expect(response.body.user.refreshTokens).toBeUndefined();
  });

  it('rejects a short password with a readable message', async () => {
    const response = await request(testApp())
      .post(`${API}/auth/register`)
      .send({ email: 'short@example.com', password: 'abc' })
      .expect(422);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details[0].message).toMatch(/at least 10 characters/);
  });

  it('rejects a malformed email', async () => {
    await request(testApp())
      .post(`${API}/auth/register`)
      .send({ email: 'not-an-email', password: 'a-long-enough-password' })
      .expect(422);
  });

  it('refuses a duplicate account', async () => {
    await signUp({ email: 'taken@example.com' });

    const response = await request(testApp())
      .post(`${API}/auth/register`)
      .send({ email: 'taken@example.com', password: 'a-long-enough-password' })
      .expect(409);

    expect(response.body.error.message).toMatch(/already exists/);
  });
});

describe('POST /auth/login', () => {
  it('returns tokens for the right password', async () => {
    await signUp({ email: 'login@example.com', password: 'a-long-enough-password' });

    const response = await request(testApp())
      .post(`${API}/auth/login`)
      .send({ email: 'login@example.com', password: 'a-long-enough-password' })
      .expect(200);

    expect(response.body.accessToken).toEqual(expect.any(String));
  });

  it('gives the same answer for a wrong password and an unknown account', async () => {
    await signUp({ email: 'known@example.com', password: 'a-long-enough-password' });

    const wrongPassword = await request(testApp())
      .post(`${API}/auth/login`)
      .send({ email: 'known@example.com', password: 'the-wrong-password' })
      .expect(401);

    const unknownAccount = await request(testApp())
      .post(`${API}/auth/login`)
      .send({ email: 'nobody@example.com', password: 'the-wrong-password' })
      .expect(401);

    // Identical wording, so the response cannot be used to enumerate accounts.
    expect(wrongPassword.body.error.message).toBe(unknownAccount.body.error.message);
  });
});

describe('token handling', () => {
  it('refuses a request with no token', async () => {
    const response = await request(testApp()).get(`${API}/tasks`).expect(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('refuses a forged token', async () => {
    await request(testApp())
      .get(`${API}/tasks`)
      .set('Authorization', 'Bearer not.a.real.token')
      .expect(401);
  });

  it('exchanges a refresh token and rotates it', async () => {
    const user = await signUp();

    const first = await request(testApp())
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: user.refreshToken })
      .expect(200);

    expect(first.body.accessToken).toEqual(expect.any(String));
    expect(first.body.refreshToken).not.toBe(user.refreshToken);

    // The old token is single-use: presenting it again must fail.
    await request(testApp())
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: user.refreshToken })
      .expect(401);
  });

  it('invalidates the session on logout', async () => {
    const user = await signUp();

    await user.auth('post', '/auth/logout').send({ refreshToken: user.refreshToken }).expect(204);

    await request(testApp())
      .post(`${API}/auth/refresh`)
      .send({ refreshToken: user.refreshToken })
      .expect(401);
  });
});

describe('ownership', () => {
  it('hides another account’s data behind a 404, not a 403', async () => {
    const owner = await signUp();
    const stranger = await signUp();

    const created = await owner.auth('post', '/tasks').send({ title: 'Private task' }).expect(201);

    // A 404 leaks nothing about what other accounts contain.
    await stranger.auth('get', `/tasks/${created.body.id}`).expect(404);
    await stranger.auth('patch', `/tasks/${created.body.id}`).send({ title: 'Hijack' }).expect(404);
    await stranger.auth('delete', `/tasks/${created.body.id}`).expect(404);
    await stranger.auth('post', `/tasks/${created.body.id}/complete`).expect(404);
  });

  it('does not leak other accounts in list endpoints', async () => {
    const owner = await signUp();
    const stranger = await signUp();

    await owner.auth('post', '/tasks').send({ title: 'Mine' }).expect(201);

    const response = await stranger.auth('get', '/tasks').expect(200);
    expect(response.body.items).toHaveLength(0);
  });
});
