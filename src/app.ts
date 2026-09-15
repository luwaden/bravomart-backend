import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import path from 'node:path';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { notFound } from './middlewares/notFound.js';
import { errorHandler } from './middlewares/errorHandler.js';

/**
 * A factory function — `createApp()` — rather than a module-level `const
 * app = express()`. This is what makes the app testable: a test file can
 * call `createApp()` to get a fresh Express instance and hit it with
 * supertest, without ever calling `app.listen()` or touching a real port.
 * server.ts (the only place that actually starts listening) is the sole
 * caller of this function in normal operation.
 */
export function createApp(): express.Express {
  const app = express();

  // Sets a battery of security-related HTTP response headers (CSP frame
  // options, disables X-Powered-By, etc.) — the "why wouldn't you" of
  // Express middleware.
  app.use(helmet());

  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      // Required for the browser to send/receive the httpOnly refresh
      // cookie cross-origin (the API and the Vite dev server run on
      // different ports, which counts as a different origin).
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use(morgan(env.NODE_ENV === 'development' ? 'dev' : 'combined'));

  // Serves whatever upload.service.ts has written to disk — KYC documents
  // and AI-generated product photos — back out over HTTP.
  app.use(`/${env.UPLOAD_DIR}`, express.static(path.join(process.cwd(), env.UPLOAD_DIR)));

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api', routes);

  // Must be last: unmatched routes fall through to `notFound`, and any
  // error passed to `next(err)` anywhere above skips straight to
  // `errorHandler`, bypassing everything in between.
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
