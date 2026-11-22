import { getCredentials, SlackCreds } from '../integrations/credentials.service';
import { httpJSON, IntegrationError } from '../integrations/http';
import { liveOrDemo, DEMO_SLACK_CHANNELS, DEMO_SLACK_MESSAGES } from '../integrations/demo';
import { env } from '../../config/env.config';

const API = 'https://slack.com/api';

async function call<T = any>(creds: SlackCreds, method: string, body?: Record<string, any>, httpMethod: 'GET' | 'POST' = 'POST'): Promise<T> {
  const url = httpMethod === 'GET' && body ? `${API}/${method}?${new URLSearchParams(body as any).toString()}` : `${API}/${method}`;
  const data = await httpJSON<any>('slack', url, {
    method: httpMethod,
    headers: { Authorization: `Bearer ${creds.botToken}`, 'Content-Type': 'application/json; charset=utf-8' },
    body: httpMethod === 'POST' ? body || {} : undefined,
  });
  if (!data?.ok) {
    const hint =
      data?.error === 'not_in_channel'
        ? ' — invite the bot to the channel with /invite @YourBot'
        : data?.error === 'missing_scope'
          ? ` — add the "${data?.needed}" scope to the Slack app and reinstall it`
          : '';
    throw new IntegrationError('slack', `${data?.error || 'unknown_error'}${hint}`, 400);
  }
  return data as T;
}

class SlackService {
  private async creds(userId: string) {
    return (await getCredentials(userId, 'slack'))?.creds || null;
  }

  public async testConnection(creds: SlackCreds) {
    const r = await call<any>(creds, 'auth.test');
    return { accountName: `${r.team} (${r.user})`, metadata: { team: r.team, teamId: r.team_id, botUser: r.user, url: r.url } };
  }

  private async resolveChannelId(creds: SlackCreds, channel: string): Promise<string> {
    const c = (channel || creds.defaultChannel || env.SLACK_DEFAULT_CHANNEL).trim();
    if (/^[CGD][A-Z0-9]{6,}$/.test(c)) return c;
    const name = c.replace(/^#/, '');
    let cursor = '';
    for (let page = 0; page < 5; page++) {
      const r = await call<any>(creds, 'conversations.list', { types: 'public_channel,private_channel', limit: '200', exclude_archived: 'true', ...(cursor ? { cursor } : {}) }, 'GET');
      const found = (r.channels || []).find((ch: any) => ch.name === name);
      if (found) return found.id;
      cursor = r.response_metadata?.next_cursor;
      if (!cursor) break;
    }
    throw new IntegrationError('slack', `Channel "${c}" not found or bot has no access`, 400);
  }

  public async listChannels(userId: string) {
    return liveOrDemo('slack', await this.creds(userId), async (creds) => {
      const r = await call<any>(creds, 'conversations.list', { types: 'public_channel,private_channel', limit: '200', exclude_archived: 'true' }, 'GET');
      return { channels: (r.channels || []).map((c: any) => ({ id: c.id, name: c.name, isMember: c.is_member, memberCount: c.num_members })) };
    }, () => ({ channels: DEMO_SLACK_CHANNELS }));
  }

  private async mentionsFor(creds: SlackCreds, emails: string[] = []): Promise<string> {
    const ids: string[] = [];
    for (const email of emails.slice(0, 10)) {
      try {
        const r = await call<any>(creds, 'users.lookupByEmail', { email }, 'GET');
        if (r.user?.id) ids.push(`<@${r.user.id}>`);
      } catch {
        /* user not found — skip */
      }
    }
    return ids.join(' ');
  }

  public async sendMessage(userId: string, params: { channel?: string; message: string; mentionEmails?: string[]; mentionChannel?: boolean }) {
    return liveOrDemo('slack', await this.creds(userId), async (creds) => {
      const channelId = await this.resolveChannelId(creds, params.channel || '');
      const mentions = await this.mentionsFor(creds, params.mentionEmails);
      const text = `${params.mentionChannel ? '<!channel> ' : ''}${mentions ? mentions + ' ' : ''}${params.message}`;
      const r = await call<any>(creds, 'chat.postMessage', { channel: channelId, text, unfurl_links: false });
      return { status: 'sent', channel: params.channel || channelId, ts: r.ts, message: `Posted to ${params.channel || channelId}` };
    }, () => ({ status: 'sent', channel: params.channel || env.SLACK_DEFAULT_CHANNEL, ts: `${Date.now() / 1000}`, message: `Simulated Slack post to ${params.channel || env.SLACK_DEFAULT_CHANNEL}`, preview: params.message }));
  }

  public async scheduleMessage(userId: string, params: { channel?: string; message: string; postAt: string }) {
    const postAt = Math.floor(new Date(params.postAt).getTime() / 1000);
    if (!postAt || Number.isNaN(postAt)) throw new IntegrationError('slack', 'postAt must be a valid date-time', 400);
    return liveOrDemo('slack', await this.creds(userId), async (creds) => {
      const channelId = await this.resolveChannelId(creds, params.channel || '');
      const r = await call<any>(creds, 'chat.scheduleMessage', { channel: channelId, text: params.message, post_at: postAt });
      return { status: 'scheduled', scheduledMessageId: r.scheduled_message_id, postAt: params.postAt, message: `Reminder scheduled in ${params.channel || channelId}` };
    }, () => ({ status: 'scheduled', postAt: params.postAt, message: `Simulated reminder scheduled for ${params.postAt}` }));
  }

  public async readChannel(userId: string, params: { channel?: string; limit?: number }) {
    return liveOrDemo('slack', await this.creds(userId), async (creds) => {
      const channelId = await this.resolveChannelId(creds, params.channel || '');
      const r = await call<any>(creds, 'conversations.history', { channel: channelId, limit: String(params.limit || 50) }, 'GET');
      const messages = (r.messages || []).reverse().map((m: any) => ({ user: m.user_profile?.real_name || m.user || m.bot_id || 'unknown', text: m.text || '', ts: m.ts }));
      return { channel: params.channel || channelId, messages };
    }, () => ({ channel: params.channel || '#engineering', messages: DEMO_SLACK_MESSAGES }));
  }
}

export const slackService = new SlackService();
