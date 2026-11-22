import mongoose from 'mongoose';
import { ConnectedAccountModel } from '../../models/connected-account.model';
import { decryptJSON, encryptJSON } from '../../utils/crypto';
import { env } from '../../config/env.config';

export type TokenProvider = 'slack' | 'jira' | 'github' | 'notion';

export interface SlackCreds { botToken: string; defaultChannel?: string }
export interface JiraCreds { host: string; email: string; apiToken: string; defaultProject?: string }
export interface GithubCreds { token: string; defaultRepo?: string }
export interface NotionCreds { apiKey: string; parentPageId?: string }

type CredMap = { slack: SlackCreds; jira: JiraCreds; github: GithubCreds; notion: NotionCreds };

export interface ResolvedCreds<P extends TokenProvider> {
  source: 'user' | 'env';
  creds: CredMap[P];
}

/** Form fields the frontend renders in the "Connect" dialog for token-based providers. */
export const CREDENTIAL_FIELDS: Record<TokenProvider, Array<{ key: string; label: string; type: 'text' | 'password'; placeholder: string; required: boolean; help?: string }>> = {
  slack: [
    { key: 'botToken', label: 'Bot User OAuth Token', type: 'password', placeholder: 'xoxb-…', required: true, help: 'Slack app → OAuth & Permissions → Bot User OAuth Token' },
    { key: 'defaultChannel', label: 'Default channel', type: 'text', placeholder: '#general', required: false },
  ],
  jira: [
    { key: 'host', label: 'Jira site', type: 'text', placeholder: 'your-team.atlassian.net', required: true },
    { key: 'email', label: 'Atlassian account email', type: 'text', placeholder: 'you@company.com', required: true },
    { key: 'apiToken', label: 'API token', type: 'password', placeholder: 'ATATT…', required: true, help: 'id.atlassian.com → Security → API tokens' },
    { key: 'defaultProject', label: 'Default project key', type: 'text', placeholder: 'AUTO', required: false },
  ],
  github: [
    { key: 'token', label: 'Personal access token', type: 'password', placeholder: 'github_pat_… or ghp_…', required: true, help: 'GitHub → Settings → Developer settings → Fine-grained tokens' },
    { key: 'defaultRepo', label: 'Default repository', type: 'text', placeholder: 'owner/repo', required: false },
  ],
  notion: [
    { key: 'apiKey', label: 'Internal integration secret', type: 'password', placeholder: 'ntn_… or secret_…', required: true, help: 'notion.so/my-integrations → New integration' },
    { key: 'parentPageId', label: 'Parent page ID (pages are created under it)', type: 'text', placeholder: '32-char id from the page URL', required: false },
  ],
};

function envCreds(provider: TokenProvider): any | null {
  switch (provider) {
    case 'slack':
      return env.SLACK_BOT_TOKEN ? { botToken: env.SLACK_BOT_TOKEN, defaultChannel: env.SLACK_DEFAULT_CHANNEL } : null;
    case 'jira':
      return env.JIRA_HOST && env.JIRA_EMAIL && env.JIRA_API_TOKEN
        ? { host: env.JIRA_HOST, email: env.JIRA_EMAIL, apiToken: env.JIRA_API_TOKEN, defaultProject: env.JIRA_DEFAULT_PROJECT }
        : null;
    case 'github':
      return env.GITHUB_TOKEN ? { token: env.GITHUB_TOKEN, defaultRepo: env.GITHUB_DEFAULT_REPO } : null;
    case 'notion':
      return env.NOTION_API_KEY ? { apiKey: env.NOTION_API_KEY, parentPageId: env.NOTION_PARENT_PAGE_ID } : null;
  }
}

export async function getCredentials<P extends TokenProvider>(userId: string, provider: P): Promise<ResolvedCreds<P> | null> {
  if (mongoose.connection.readyState === 1) {
    try {
      const acct = await ConnectedAccountModel.findOne({ userId, provider, status: 'connected' }).select('+credentials');
      const creds = decryptJSON<CredMap[P]>(acct?.credentials);
      if (creds) return { source: 'user', creds };
    } catch {
      /* DB error — fall through to env */
    }
  }
  const e = envCreds(provider);
  return e ? { source: 'env', creds: e } : null;
}

export function hasEnvCredentials(provider: TokenProvider): boolean {
  return Boolean(envCreds(provider));
}

export async function saveCredentials(
  userId: string,
  provider: TokenProvider,
  creds: Record<string, any>,
  profile: { accountName?: string; accountEmail?: string; metadata?: Record<string, any> }
) {
  return ConnectedAccountModel.findOneAndUpdate(
    { userId, provider },
    {
      userId,
      provider,
      credentials: encryptJSON(creds),
      status: 'connected',
      accountName: profile.accountName,
      accountEmail: profile.accountEmail,
      metadata: profile.metadata || {},
      lastError: undefined,
    },
    { upsert: true, new: true }
  );
}
