import { createApp } from './app';
import { env } from './config/env.config';
import { connectDB, disconnectDB } from './config/db.config';
import { seedDatabaseIfEmpty } from './utils/seed';
import { schedulerService } from './services/workflows/scheduler.service';
import { aiService } from './services/ai/ai.service';
import { logger } from './utils/logger';

async function bootstrap() {
  try {
    if (env.JWT_SECRET.startsWith('change-me') && env.NODE_ENV === 'production') {
      throw new Error('Set a strong JWT_SECRET (and ENCRYPTION_KEY) before running in production');
    }
    await connectDB();
    await seedDatabaseIfEmpty();

    const app = createApp();
    const server = app.listen(env.PORT, () => {
      const ai = aiService.getStatus();
      logger.info('=======================================================');
      logger.info(`AutoFlow AI API running on http://localhost:${env.PORT}`);
      logger.info(`Health:      http://localhost:${env.PORT}/api/health`);
      logger.info(`AI:          ${ai.live ? `Gemini (${ai.model})` : 'heuristic fallback (no GEMINI_API_KEY)'}`);
      logger.info(`Demo mode:   ${env.DEMO_MODE} | Timezone: ${env.APP_TIMEZONE}`);
      logger.info('=======================================================');
    });

    if (env.SCHEDULER_ENABLED) schedulerService.start();

    const shutdown = async () => {
      logger.info('Shutting down…');
      schedulerService.stop();
      server.close(async () => {
        await disconnectDB();
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 5000).unref();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err: any) {
    logger.error('Failed to start server', { error: err.message });
    process.exit(1);
  }
}

if (require.main === module) bootstrap();
