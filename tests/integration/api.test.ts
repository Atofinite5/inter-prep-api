import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import { app } from '../../src/server/app.js';
import { connectDatabase, disconnectDatabase } from '../../src/server/db/connection.js';

describe('Express Server API Integration', () => {
  let server: http.Server;
  let baseUrl: string;
  let sessionCookie = '';

  beforeAll(async () => {
    await connectDatabase();
    await new Promise<void>(resolve => {
      server = app.listen(0, () => {
        const address = server.address() as any;
        baseUrl = `http://localhost:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await disconnectDatabase();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('GET /health returns status ok', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('ok');
  });

  it('rejects unauthenticated requests to protected kit endpoints', async () => {
    const res = await fetch(`${baseUrl}/api/kits`);
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('UNAUTHORIZED');
  });

  it('registers a new user and returns session cookie and token', async () => {
    const email = `test_${Date.now()}@example.com`;
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password: 'Password123!',
        name: 'Test Candidate',
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.user.email).toBe(email);
    expect(data.token).toBeDefined();

    // Extract cookie
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      sessionCookie = setCookie.split(';')[0];
    } else {
      sessionCookie = `session_token=${data.token}`;
    }
  });

  it('GET /api/auth/me returns authenticated user details', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: sessionCookie },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.user).toBeDefined();
    expect(data.user.name).toBe('Test Candidate');
  });

  it('POST /api/kits/generate generates and persists a kit for the user', async () => {
    const res = await fetch(`${baseUrl}/api/kits/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        jd: 'Senior Python Engineer. Required: FastAPI, Docker, PostgreSQL.',
        companyUrl: 'https://example.com',
        days: 3,
      }),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.id).toBeDefined();
    expect(data.kit.schedule.days_available).toBe(3);

    // Verify GET /api/kits lists this kit
    const listRes = await fetch(`${baseUrl}/api/kits`, {
      headers: { Cookie: sessionCookie },
    });
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.kits.length).toBeGreaterThanOrEqual(1);

    // Verify GET /api/kits/:id retrieves the kit
    const getRes = await fetch(`${baseUrl}/api/kits/${data.id}`, {
      headers: { Cookie: sessionCookie },
    });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.id).toBe(data.id);
  });
});
