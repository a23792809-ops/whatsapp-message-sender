import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {});
  const config = app.get(ConfigService);
  const logger = new Logger('HTTP');

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
  });

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