import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // `rawBody` keeps the exact bytes Meta sent on `req.rawBody`. The webhook
  // signature is an HMAC over those bytes, so a re-serialised object would
  // change key order and whitespace and every signature would fail. The buffer
  // is only retained for routes that read it; nothing else is affected.
  //
  // `bodyParser: false` hands parser registration to us so the size limit can
  // be set explicitly. Express's implicit default is 100kb, which is smaller
  // than a batched Meta delivery notification: a large batch is rejected with
  // 413, Meta retries it forever, and those delivery statuses are silently
  // never recorded. `useBodyParser` re-applies Nest's own rawBody verify hook,
  // so signature verification is unaffected by the custom limit.
  const app = await NestFactory.create(AppModule, { rawBody: true, bodyParser: false });
  const config = app.get(ConfigService);
  const logger = new Logger('HTTP');

  const bodyLimit = process.env.BODY_LIMIT?.trim() || '1mb';
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { extended: true, limit: bodyLimit });

  app.use(helmet());

  app.use((req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      const status = res.statusCode;
      if (status >= 500) {
        logger.error(`${req.method} ${req.originalUrl} ${status} ${Date.now() - startedAt}ms`);
      } else if (status >= 400) {
        logger.warn(`${req.method} ${req.originalUrl} ${status} ${Date.now() - startedAt}ms`);
      } else {
        logger.log(`${req.method} ${req.originalUrl} ${status} ${Date.now() - startedAt}ms`);
      }
    });
    next();
  });

  const allowedOrigins = (config.get<string>('ALLOWED_ORIGINS') || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  const allowAll = allowedOrigins.includes('*');
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      if (allowAll || !origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Stricter, path-scoped limit for the admin login endpoint.
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { statusCode: 429, message: 'Too many login attempts. Please try again later.' },
  });
  app.use('/auth/login', loginLimiter);

  app.use(
    rateLimit({
      windowMs: Number(config.get<string>('RATE_LIMIT_WINDOW_MS') || 60_000),
      limit: Number(config.get<string>('RATE_LIMIT_MAX') || 300),
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { statusCode: 429, message: 'Too many requests, please try again later.' },
    }),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  await app.listen(3001);
  logger.log(`Bharat Gas WhatsApp Sender API listening on :3001`);
}
await bootstrap();