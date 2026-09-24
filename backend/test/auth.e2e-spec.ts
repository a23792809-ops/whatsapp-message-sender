import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';
import { AuthService } from './../src/auth/auth.service.js';

describe('Admin authentication (e2e)', () => {
  let app: INestApplication<App>;
  const adminUsername = 'admin';
  const adminPassword = 'e2e-admin-password';

  beforeAll(async () => {
    process.env.ADMIN_USERNAME = adminUsername;
    process.env.ADMIN_PASSWORD_HASH = await AuthService.hashPassword(adminPassword);
    process.env.AUTH_SECRET = 'e2e-auth-secret';
    process.env.AUTH_SESSION_HOURS = '168';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD_HASH;
    delete process.env.AUTH_SECRET;
    delete process.env.AUTH_SESSION_HOURS;
  });

  async function login(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: adminUsername, password: adminPassword })
      .expect(201);
    const cookies = res.headers['set-cookie'] as unknown as string[] | undefined;
    const cookie = cookies?.[0]?.split(';')[0];
    expect(cookie).toMatch(/^bg_session=/);
    return cookie as string;
  }

  it('POST /auth/login succeeds with valid credentials and never leaks secrets', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: adminUsername, password: adminPassword })
      .expect(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.user.username).toBe(adminUsername);
    expect(res.body.password).toBeUndefined();
    expect(res.body.passwordHash).toBeUndefined();
    expect(res.body.token).toBeUndefined();
    const header = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(header).toContain('bg_session');
    expect(header).toContain('HttpOnly');
  });

  it('POST /auth/login fails with invalid credentials', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: adminUsername, password: 'not-the-password' })
      .expect(401);
  });

  it('POST /auth/login rejects a missing body field', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: adminUsername })
      .expect(400);
  });

  it('GET /auth/me reflects the session and rejects anonymous requests', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    const cookie = await login();
    const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie).expect(200);
    expect(me.body.user.username).toBe(adminUsername);
  });

  it('protected endpoints reject unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/customers').expect(401);
    await request(app.getHttpServer()).get('/templates').expect(401);
    await request(app.getHttpServer()).get('/campaigns').expect(401);
    await request(app.getHttpServer()).get('/messages').expect(401);
    await request(app.getHttpServer()).get('/whatsapp/status').expect(401);
    await request(app.getHttpServer())
      .post('/ai/generate')
      .send({ templateText: 'Hello {{name}}' })
      .expect(401);
  });

  it('authenticated requests reach protected endpoints', async () => {
    const cookie = await login();
    const res = await request(app.getHttpServer()).get('/customers').set('Cookie', cookie).expect(200);
    expect(res.body.data).toBeInstanceOf(Array);
  });

  it('GET /health remains publicly accessible', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('POST /auth/logout clears the session cookie (client is logged out)', async () => {
    const cookie = await login();
    const res = await request(app.getHttpServer()).post('/auth/logout').expect(201);
    const clearHeader = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(clearHeader).toMatch(/^bg_session=;/);
    expect(clearHeader).toMatch(/Expires=Thu, 01 Jan 1970/);
    await request(app.getHttpServer()).get('/customers').expect(401);
  });
});