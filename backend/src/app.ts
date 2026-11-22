import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { env, isGoogleOAuthConfigured } from './config/env.config';
import { requestLogger } from './middleware/request-logger.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import { apiLimiter } from './middleware/rate-limit.middleware';
import { publicRouter, apiRouter } from './routes';
import { aiService } from './services/ai/ai.service';
import { hasEnvCredentials } from './services/integrations/credentials.service';

export function createApp(): Application {
  const app: Application = express();
  app.set('trust proxy', 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: Array.from(new Set([env.FRONTEND_URL, 'http://localhost:3000', 'http://127.0.0.1:3000'])),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'x-requested-with'],
    })
  );
  // keep the raw body for webhook signature verification (GitHub)
  app.use(express.json({ limit: '5mb', verify: (req: any, _res, buf) => (req.rawBody = buf) }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));
  app.use(requestLogger);

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'AutoFlow AI — Enterprise AI Workflow Automation API',
      version: '2.0.0',
      demoMode: env.DEMO_MODE,
      timezone: env.APP_TIMEZONE,
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      ai: aiService.getStatus(),
      integrations: {
        googleOAuth: isGoogleOAuthConfigured(),
        gemini: Boolean(env.GEMINI_API_KEY),
        slackEnv: hasEnvCredentials('slack'),
        jiraEnv: hasEnvCredentials('jira'),
        githubEnv: hasEnvCredentials('github'),
        notionEnv: hasEnvCredentials('notion'),
      },
    });
  });

  app.use('/api', apiLimiter);
  app.use('/api', publicRouter);
  app.use('/api', apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
