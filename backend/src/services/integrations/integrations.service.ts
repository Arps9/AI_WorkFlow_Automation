import mongoose from 'mongoose';
import { IntegrationMetadata } from './integration.interface';
import { ConnectedAccountModel } from '../../models/connected-account.model';
import { env, isGoogleOAuthConfigured } from '../../config/env.config';
import { CREDENTIAL_FIELDS, TokenProvider, getCredentials, hasEnvCredentials, saveCredentials } from './credentials.service';
import { slackService } from '../slack/slack.service';
import { jiraService } from '../jira/jira.service';
import { githubService } from '../github/github.service';
import { notionService } from '../notion/notion.service';
import { GOOGLE_SCOPES } from '../google/google-auth.service';
import { toolRegistry } from '../../tools/tool-registry';
import { IntegrationError } from './http';

const CATALOG: Record<string, Omit<IntegrationMetadata, 'status' | 'connectionSource' | 'accountEmail' | 'accountName' | 'tools'>> = {
  gmail: { id: 'gmail', name: 'Gmail', description: 'Read, search, classify and summarise email; AI replies; attachments.', category: 'email', icon: 'mail', authType: 'oauth2', docsUrl: 'https://developers.google.com/gmail/api', capabilities: ['Read & search', 'AI summaries', 'Urgency detection', 'Auto-reply drafts', 'Send email', 'Attachments'] },
  drive: { id: 'drive', name: 'Google Drive', description: 'Search documents, summarise files, extract PDF text, upload and organise folders.', category: 'storage', icon: 'hard-drive', authType: 'oauth2', docsUrl: 'https://developers.google.com/drive', capabilities: ['Document search', 'AI summaries', 'PDF text extraction', 'Upload', 'Organise folders'] },
  calendar: { id: 'calendar', name: 'Google Calendar', description: 'Schedule meetings, check availability, detect conflicts and create reminders.', category: 'productivity', icon: 'calendar', authType: 'oauth2', docsUrl: 'https://developers.google.com/calendar', capabilities: ['Schedule meetings', 'Free/busy', 'Conflict detection', 'Reminders', 'Meet links'] },
  slack: { id: 'slack', name: 'Slack', description: 'Notify teams, read and summarise channels, mention users and schedule reminders.', category: 'communication', icon: 'message-square', authType: 'api_key', docsUrl: 'https://api.slack.com/apps', capabilities: ['Send messages', 'Read channels', 'AI summaries', 'Mentions', 'Scheduled reminders'] },
  jira: { id: 'jira', name: 'Jira', description: 'Create tickets, update status, assign developers, sprint analytics and AI priority.', category: 'project_management', icon: 'check-square', authType: 'api_key', docsUrl: 'https://developer.atlassian.com/cloud/jira/platform/rest/v3/', capabilities: ['Create tickets', 'Update status', 'Assign', 'Sprint analytics', 'AI priority'] },
  github: { id: 'github', name: 'GitHub', description: 'Repositories, issues, AI pull-request summaries, commits, releases and analytics.', category: 'developer', icon: 'git-branch', authType: 'api_key', docsUrl: 'https://docs.github.com/en/rest', capabilities: ['List repos', 'Create issues', 'AI PR summaries', 'Commit monitoring', 'Release tracking', 'Analytics'] },
  notion: { id: 'notion', name: 'Notion', description: 'Create pages for meeting notes, reports and documentation; search the workspace.', category: 'productivity', icon: 'file-text', authType: 'api_key', docsUrl: 'https://developers.notion.com', capabilities: ['Create pages', 'Meeting notes', 'Daily reports', 'Search', 'Knowledge import'] },
};

const TESTERS: Record<TokenProvider, (creds: any) => Promise<{ accountName?: string; accountEmail?: string; metadata?: any }>> = {
  slack: (c) => slackService.testConnection(c),
  jira: (c) => jiraService.testConnection(c),
  github: (c) => githubService.testConnection(c),
  notion: (c) => notionService.testConnection(c),
};

export class IntegrationsService {
  private static instance: IntegrationsService;
  public static getInstance(): IntegrationsService {
    if (!IntegrationsService.instance) IntegrationsService.instance = new IntegrationsService();
    return IntegrationsService.instance;
  }

  public async getAllIntegrations(userId: string): Promise<IntegrationMetadata[]> {
    const accounts = mongoose.connection.readyState === 1 ? await ConnectedAccountModel.find({ userId }).catch(() => []) : [];
    const byProvider = new Map(accounts.map((a) => [a.provider, a]));
    const google = byProvider.get('gmail');
    const googleConnected = google?.status === 'connected';

    return Object.values(CATALOG).map((meta) => {
      const tools = toolRegistry.getForProvider(meta.id).filter((t) => !t.workflowOnly).map((t) => t.displayName);
      if (['gmail', 'drive', 'calendar'].includes(meta.id)) {
        const scopes = google?.scopes || [];
        const granted = googleConnected && (scopes.length === 0 || GOOGLE_SCOPES[meta.id as 'gmail'].some((s) => scopes.includes(s)));
        return {
          ...meta,
          tools,
          status: granted ? 'connected' : 'available',
          connectionSource: granted ? 'user' : env.DEMO_MODE ? 'demo' : 'none',
          accountEmail: granted ? google?.accountEmail : undefined,
          accountName: granted ? google?.accountName : undefined,
          oauthConfigured: isGoogleOAuthConfigured(),
          sharedGoogleGrant: true,
        } as IntegrationMetadata;
      }
      const p = meta.id as TokenProvider;
      const acct = byProvider.get(p);
      const userConnected = acct?.status === 'connected';
      const envConnected = hasEnvCredentials(p);
      return {
        ...meta,
        tools,
        status: userConnected || envConnected ? 'connected' : 'available',
        connectionSource: userConnected ? 'user' : envConnected ? 'env' : env.DEMO_MODE ? 'demo' : 'none',
        accountName: userConnected ? acct?.accountName : envConnected ? 'Configured in .env' : undefined,
        accountEmail: userConnected ? acct?.accountEmail : undefined,
        credentialFields: CREDENTIAL_FIELDS[p],
        lastError: acct?.lastError,
      } as IntegrationMetadata;
    });
  }

  public async connect(userId: string, provider: string, credentials: Record<string, any>) {
    if (!(provider in TESTERS)) throw new IntegrationError(provider, 'This provider connects through Google OAuth, not API keys', 400);
    const p = provider as TokenProvider;
    const fields = CREDENTIAL_FIELDS[p];
    const clean: Record<string, string> = {};
    for (const f of fields) {
      const v = String(credentials?.[f.key] ?? '').trim();
      if (f.required && !v) throw new IntegrationError(p, `${f.label} is required`, 400);
      if (v) clean[f.key] = v;
    }
    if (p === 'jira') clean.host = clean.host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const profile = await TESTERS[p](clean); // throws if the credentials are wrong
    await saveCredentials(userId, p, clean, profile);
    return { provider: p, status: 'connected', ...profile };
  }

  public async test(userId: string, provider: string) {
    if (!(provider in TESTERS)) throw new IntegrationError(provider, 'Use Google OAuth status for Google services', 400);
    const resolved = await getCredentials(userId, provider as TokenProvider);
    if (!resolved) throw new IntegrationError(provider, 'Not connected', 400);
    try {
      const profile = await TESTERS[provider as TokenProvider](resolved.creds);
      await ConnectedAccountModel.updateOne({ userId, provider }, { lastError: undefined }).catch(() => null);
      return { ok: true, source: resolved.source, ...profile };
    } catch (err: any) {
      await ConnectedAccountModel.updateOne({ userId, provider }, { lastError: err.message }).catch(() => null);
      throw err;
    }
  }

  public async disconnect(userId: string, provider: string) {
    await ConnectedAccountModel.updateOne({ userId, provider }, { status: 'disconnected', $unset: { credentials: 1 } });
    return { provider, status: 'disconnected' };
  }
}

export const integrationsService = IntegrationsService.getInstance();
