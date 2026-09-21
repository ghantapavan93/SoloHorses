import * as Sentry from '@sentry/nestjs';

/**
 * Error tracking. Imported first in main.ts so the SDK can instrument Nest before it boots.
 * With no DSN this is a no-op; nothing leaves the machine.
 */
const dsn = process.env.SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend(event) {
      // Never ship request bodies or auth headers; the app already redacts logs the same way.
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['x-service-secret'];
        }
      }
      return event;
    },
  });
}
