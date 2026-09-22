import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module.js';

describe('Request DTO validation (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  it('POST /templates with an empty body returns 400', () => {
    return request(app.getHttpServer()).post('/templates').send({}).expect(400);
  });

  it('POST /campaigns without customerIds returns 400', () => {
    return request(app.getHttpServer())
      .post('/campaigns')
      .send({ name: 'Test campaign', templateId: 'some-template-id' })
      .expect(400);
  });

  it('POST /whatsapp/test without "to" returns 400', () => {
    return request(app.getHttpServer())
      .post('/whatsapp/test')
      .send({ message: 'Hello from Vitest' })
      .expect(400);
  });

  it('POST /campaigns with a valid body but non-existent template passes DTO validation and reaches service validation (404, not 400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/campaigns')
      .send({
        name: 'Service validation test campaign',
        templateId: '00000000-0000-0000-0000-000000000001',
        customerIds: ['00000000-0000-0000-0000-000000000002'],
      })
      .expect(404);
    expect(res.body.message).toContain('Template');
    expect(res.body.message).toContain('not found');
  });

  afterAll(async () => {
    await app.close();
  });
});