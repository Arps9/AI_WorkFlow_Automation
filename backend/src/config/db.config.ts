import mongoose from 'mongoose';
import { env } from './env.config';
import { logger } from '../utils/logger';

let memoryServer: any = null;

const redact = (uri: string) => uri.replace(/\/\/([^:@/]+):([^@/]+)@/, '//$1:****@');

export async function connectDB(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  mongoose.set('strictQuery', true);

  try {
    logger.info('Connecting to MongoDB…', { uri: redact(env.MONGODB_URI) });
    await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    logger.info('Connected to MongoDB');
    return;
  } catch (err: any) {
    logger.warn(`MongoDB connection failed (${err.message}).`);
    if (env.NODE_ENV === 'production') throw err;
  }

  // Development convenience: spin up a throw-away in-memory MongoDB (data is lost on restart)
  try {
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    memoryServer = await MongoMemoryServer.create({ instance: { launchTimeout: 30000 } });
    await mongoose.connect(memoryServer.getUri());
    logger.warn('Using IN-MEMORY MongoDB — data will be lost when the server stops. Set MONGODB_URI for persistence.');
  } catch (memErr: any) {
    throw new Error(`No database available. Start MongoDB locally, use Docker (docker compose up mongodb) or set MONGODB_URI to MongoDB Atlas. (${memErr.message})`);
  }
}

export async function disconnectDB(): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    if (memoryServer) {
      await memoryServer.stop();
      memoryServer = null;
    }
  } catch (err: any) {
    logger.error('Error during MongoDB disconnect', { error: err.message });
  }
}
