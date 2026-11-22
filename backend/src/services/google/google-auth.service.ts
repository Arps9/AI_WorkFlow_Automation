import { google } from 'googleapis';
import mongoose from 'mongoose';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { env, isGoogleOAuthConfigured } from '../../config/env.config';
import { ConnectedAccountModel, IConnectedAccount } from '../../models/connected-account.model';
import { logger } from '../../utils/logger';

/** One Google OAuth grant powers Gmail, Google Drive and Google Calendar. */
export const GOOGLE_SCOPES = {
  base: ['openid', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'],
  gmail: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send'],
  drive: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'],
  calendar: ['https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'],
};

export const ALL_GOOGLE_SCOPES = [...GOOGLE_SCOPES.base, ...GOOGLE_SCOPES.gmail, ...GOOGLE_SCOPES.drive, ...GOOGLE_SCOPES.calendar];

class GoogleAuthService {
  private newClient(): OAuth2Client {
    return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);
  }

  public getAuthUrl(userId: string): string {
    if (!isGoogleOAuthConfigured()) throw new Error('Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
    const state = jwt.sign({ uid: userId, purpose: 'google_oauth' }, env.JWT_SECRET, { expiresIn: '15m' });
    return this.newClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', include_granted_scopes: true, scope: ALL_GOOGLE_SCOPES, state });
  }

  public verifyState(state: string): string {
    const payload = jwt.verify(state, env.JWT_SECRET) as any;
    if (payload?.purpose !== 'google_oauth' || !payload.uid) throw new Error('Invalid OAuth state');
    return payload.uid;
  }

  public async exchangeCode(code: string, userId: string): Promise<IConnectedAccount> {
    const client = this.newClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    const info = await google.oauth2({ version: 'v2', auth: client }).userinfo.get();

    const existing = await ConnectedAccountModel.findOne({ userId, provider: 'gmail' }).select('+refreshToken');
    const account = await ConnectedAccountModel.findOneAndUpdate(
      { userId, provider: 'gmail' },
      {
        userId,
        provider: 'gmail',
        accountEmail: info.data.email || undefined,
        accountName: info.data.name || undefined,
        accessToken: tokens.access_token || undefined,
        // Google only returns a refresh token on first consent — keep the old one otherwise
        refreshToken: tokens.refresh_token || existing?.refreshToken,
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
        scopes: tokens.scope ? tokens.scope.split(' ') : [],
        status: 'connected',
        metadata: { picture: info.data.picture },
      },
      { upsert: true, new: true }
    );
    logger.info(`Google account connected for user ${userId} (${info.data.email})`);
    return account!;
  }

  public async getAccount(userId: string) {
    if (mongoose.connection.readyState !== 1) return null;
    return ConnectedAccountModel.findOne({ userId, provider: 'gmail', status: 'connected' });
  }

  public async hasScope(userId: string, service: 'gmail' | 'drive' | 'calendar'): Promise<boolean> {
    const acct = await this.getAccount(userId).catch(() => null);
    if (!acct) return false;
    return GOOGLE_SCOPES[service].some((s) => (acct.scopes || []).includes(s));
  }

  /** Returns an authorized OAuth client for the user, or null when Google isn't connected. */
  public async getClient(userId: string, service?: 'gmail' | 'drive' | 'calendar'): Promise<OAuth2Client | null> {
    if (!isGoogleOAuthConfigured() || mongoose.connection.readyState !== 1) return null;
    let account: IConnectedAccount | null = null;
    try {
      account = await ConnectedAccountModel.findOne({ userId, provider: 'gmail', status: 'connected' }).select('+accessToken +refreshToken');
    } catch {
      return null;
    }
    if (!account || (!account.accessToken && !account.refreshToken)) return null;
    if (service && account.scopes?.length && !GOOGLE_SCOPES[service].some((s) => account!.scopes.includes(s))) return null;

    const client = this.newClient();
    client.setCredentials({
      access_token: account.accessToken,
      refresh_token: account.refreshToken,
      expiry_date: account.expiresAt ? account.expiresAt.getTime() : undefined,
    });
    client.on('tokens', async (t) => {
      const update: any = {};
      if (t.access_token) update.accessToken = t.access_token;
      if (t.expiry_date) update.expiresAt = new Date(t.expiry_date);
      if (t.refresh_token) update.refreshToken = t.refresh_token;
      await ConnectedAccountModel.updateOne({ userId, provider: 'gmail' }, update).catch(() => null);
    });
    return client;
  }

  public async disconnect(userId: string) {
    const acct = await ConnectedAccountModel.findOne({ userId, provider: 'gmail' }).select('+accessToken');
    if (acct?.accessToken) await this.newClient().revokeToken(acct.accessToken).catch(() => null);
    await ConnectedAccountModel.updateOne({ userId, provider: 'gmail' }, { status: 'disconnected', $unset: { accessToken: 1, refreshToken: 1 } });
  }
}

export const googleAuthService = new GoogleAuthService();
