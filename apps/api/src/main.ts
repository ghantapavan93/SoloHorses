import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
// One .env at the repo root serves every workspace package; real environments set variables directly.
loadEnv({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
import './instrument';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { EnvService } from './platform/config/env.module';
import { HttpExceptionFilter } from './platform/http/http-exception.filter';
import { NoControlBytesPipe } from './platform/http/no-control-bytes.pipe';
import { correlationMiddleware } from './platform/observability/correlation.middleware';
import { MetricsService } from './platform/observability/metrics.service';

/**
 * A rejected promise nobody awaited is a bug to log and fix, not a reason to drop every
 * in-flight request. Sentry receives it through its own hook when configured.
 */
process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  process.stderr.write(`unhandled rejection: ${message}
`);
});

async function bootstrap(): Promise<void> {
  // rawBody keeps the exact bytes Stripe signed; JSON parsing would break signature checks.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true, bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.use(correlationMiddleware);
  const metrics = app.get(MetricsService);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const started = Date.now();
    res.on('finish', () =>
      metrics.observeRequest(`${req.method} ${routeOf(req)}`, res.statusCode, Date.now() - started),
    );
    next();
  });
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalPipes(new NoControlBytesPipe());
  app.enableShutdownHooks();

  const { env } = app.get(EnvService);
  app.enableCors({ origin: env.WEB_URL, credentials: false });
  // One hop of proxy is trusted, no more: a client cannot forge its own address past the platform's edge.
  if (env.TRUST_PROXY === 'on') app.set('trust proxy', 1);

  if (env.NODE_ENV !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(`${env.APP_NAME} API`)
        .setDescription('Synthetic data. Unofficial candidate prototype.')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(env.API_PORT);
}

/** Collapses ids so the metrics table has one row per route, not one per record. */
function routeOf(req: Request): string {
  return (req.originalUrl.split('?')[0] ?? '/')
    .replace(/\/[A-Z]{1,4}-\d{2}-\d{4,6}(?=\/|$)/g, '/:code')
    .replace(/\/[A-Z]{1,4}-\d{4,6}(?=\/|$)/g, '/:code')
    .replace(/\/c[a-z0-9]{20,}(?=\/|$)/g, '/:id')
    .replace(/\/(evt|corr|req|job)_[a-z0-9_]+(?=\/|$)/gi, '/:id');
}

void bootstrap();
