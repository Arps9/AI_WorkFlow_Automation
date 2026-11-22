import dotenv from 'dotenv';
import path from 'path';

// Load .env from the project root first, then backend/.env (backend values win if both exist)
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

const bool = (v: string | undefined, def: boolean) => (v === undefined || v === '' ? def : v.toLowerCase() === 'true');

export interface EnvConfig {
  PORT: number;
  NODE_ENV: string;
  BACKEND_URL: string;
  FRONTEND_URL: string;
  MONGODB_URI: string;
  DEMO_MODE: boolean;
  APP_TIMEZONE: string;

  // Auth & security
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  ENCRYPTION_KEY: string;
  DEMO_ADMIN_EMAIL: string;
  DEMO_ADMIN_PASSWORD: string;
  ALLOW_REGISTRATION: boolean;

  // AI
  GEMINI_API_KEY: string;
  GEMINI_MODEL: string;
  GEMINI_EMBEDDING_MODEL: string;

  // Google OAuth (Gmail + Drive + Calendar)
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;

  // Org-wide integration fallbacks (users can also connect their own from the UI)
  SLACK_BOT_TOKEN: string;
  SLACK_DEFAULT_CHANNEL: string;
  JIRA_HOST: string;
  JIRA_EMAIL: string;
  JIRA_API_TOKEN: string;
  JIRA_DEFAULT_PROJECT: string;
  GITHUB_TOKEN: string;
  GITHUB_DEFAULT_REPO: string;
  GITHUB_WEBHOOK_SECRET: string;
  NOTION_API_KEY: string;
  NOTION_PARENT_PAGE_ID: string;

  SCHEDULER_ENABLED: boolean;
}

export const env: EnvConfig = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  BACKEND_URL: process.env.BACKEND_URL || `http://localhost:${process.env.PORT || '5000'}`,
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/ai-workflow-automation',
  DEMO_MODE: bool(process.env.DEMO_MODE, true),
  APP_TIMEZONE: process.env.APP_TIMEZONE || 'Asia/Kolkata',

  JWT_SECRET: process.env.JWT_SECRET || 'change-me-dev-only-jwt-secret',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'change-me-dev-only-encryption-key',
  DEMO_ADMIN_EMAIL: process.env.DEMO_ADMIN_EMAIL || 'admin@autoflow.ai',
  DEMO_ADMIN_PASSWORD: process.env.DEMO_ADMIN_PASSWORD || 'Admin@123',
  ALLOW_REGISTRATION: bool(process.env.ALLOW_REGISTRATION, true),

  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-flash-latest',
  GEMINI_EMBEDDING_MODEL: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',

  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback',

  SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN || '',
  SLACK_DEFAULT_CHANNEL: process.env.SLACK_DEFAULT_CHANNEL || '#general',
  JIRA_HOST: (process.env.JIRA_HOST || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
  JIRA_EMAIL: process.env.JIRA_EMAIL || '',
  JIRA_API_TOKEN: process.env.JIRA_API_TOKEN || '',
  JIRA_DEFAULT_PROJECT: process.env.JIRA_DEFAULT_PROJECT || '',
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
  GITHUB_DEFAULT_REPO: process.env.GITHUB_DEFAULT_REPO || '',
  GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET || '',
  NOTION_API_KEY: process.env.NOTION_API_KEY || '',
  NOTION_PARENT_PAGE_ID: process.env.NOTION_PARENT_PAGE_ID || '',

  SCHEDULER_ENABLED: bool(process.env.SCHEDULER_ENABLED, true),
};

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
