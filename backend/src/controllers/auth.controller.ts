import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { UserModel } from '../models/user.model';
import { signToken } from '../middleware/auth.middleware';
import { googleAuthService } from '../services/google/google-auth.service';
import { env, isGoogleOAuthConfigured } from '../config/env.config';
import { audit } from '../services/audit/audit.service';
import { logger } from '../utils/logger';

const RegisterSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().toLowerCase().email('Valid email required'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});
const LoginSchema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) });
const PasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(128) });

const publicUser = (u: any) => ({ id: String(u._id), name: u.name, email: u.email, role: u.role, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt });

export class AuthController {
  static async register(req: Request, res: Response) {
    if (!env.ALLOW_REGISTRATION) return res.status(403).json({ success: false, error: { message: 'Registration is disabled', statusCode: 403 } });
    const data = RegisterSchema.parse(req.body);
    if (await UserModel.exists({ email: data.email })) return res.status(409).json({ success: false, error: { message: 'An account with this email already exists', statusCode: 409 } });
    const isFirst = (await UserModel.countDocuments()) === 0;
    const user = await UserModel.create({ name: data.name, email: data.email, passwordHash: await bcrypt.hash(data.password, 10), role: isFirst ? 'admin' : 'user', lastLoginAt: new Date() });
    audit({ userId: String(user._id), userEmail: user.email, action: 'auth.register', status: 'success', ip: req.ip });
    res.status(201).json({ success: true, token: signToken({ id: String(user._id), email: user.email, name: user.name, role: user.role }), user: publicUser(user) });
  }

  static async login(req: Request, res: Response) {
    const data = LoginSchema.parse(req.body);
    const user = await UserModel.findOne({ email: data.email }).select('+passwordHash');
    const ok = user && user.isActive !== false && (await bcrypt.compare(data.password, user.passwordHash));
    if (!user || !ok) {
      audit({ userEmail: data.email, action: 'auth.login', status: 'failure', ip: req.ip });
      return res.status(401).json({ success: false, error: { message: 'Invalid email or password', statusCode: 401 } });
    }
    user.lastLoginAt = new Date();
    await user.save();
    audit({ userId: String(user._id), userEmail: user.email, action: 'auth.login', status: 'success', ip: req.ip });
    res.json({ success: true, token: signToken({ id: String(user._id), email: user.email, name: user.name, role: user.role }), user: publicUser(user) });
  }

  static async me(req: Request, res: Response) {
    const user = await UserModel.findById(req.user!.id);
    res.json({ success: true, user: user ? publicUser(user) : req.user });
  }

  static async changePassword(req: Request, res: Response) {
    const data = PasswordSchema.parse(req.body);
    const user = await UserModel.findById(req.user!.id).select('+passwordHash');
    if (!user || !(await bcrypt.compare(data.currentPassword, user.passwordHash))) return res.status(400).json({ success: false, error: { message: 'Current password is incorrect', statusCode: 400 } });
    user.passwordHash = await bcrypt.hash(data.newPassword, 10);
    await user.save();
    audit({ userId: req.user!.id, action: 'auth.password_change', status: 'success', ip: req.ip });
    res.json({ success: true, message: 'Password updated' });
  }

  // ---------------- Google OAuth (Gmail + Drive + Calendar)
  static async getGoogleAuthUrl(req: Request, res: Response) {
    if (!isGoogleOAuthConfigured()) {
      return res.json({ success: false, configured: false, url: null, message: 'Google OAuth is not configured on the server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env and restart.' });
    }
    res.json({ success: true, configured: true, url: googleAuthService.getAuthUrl(req.user!.id) });
  }

  static async handleGoogleCallback(req: Request, res: Response) {
    const { code, state, error } = req.query as Record<string, string>;
    if (error) return res.redirect(`${env.FRONTEND_URL}/integrations?error=${encodeURIComponent(error)}`);
    if (!code || !state) return res.redirect(`${env.FRONTEND_URL}/integrations?error=missing_code`);
    try {
      const userId = googleAuthService.verifyState(state);
      const acct = await googleAuthService.exchangeCode(code, userId);
      audit({ userId, action: 'integration.connect', provider: 'google', status: 'success', details: { email: acct.accountEmail, scopes: acct.scopes } });
      res.redirect(`${env.FRONTEND_URL}/integrations?success=google_connected`);
    } catch (err: any) {
      logger.error('Google OAuth callback failed', { error: err.message });
      res.redirect(`${env.FRONTEND_URL}/integrations?error=${encodeURIComponent(err.message?.slice(0, 120) || 'oauth_failed')}`);
    }
  }

  static async getAuthStatus(req: Request, res: Response) {
    const acct = await googleAuthService.getAccount(req.user!.id).catch(() => null);
    res.json({
      success: true,
      user: req.user,
      gmail: {
        connected: Boolean(acct),
        accountEmail: acct?.accountEmail,
        accountName: acct?.accountName,
        scopes: acct?.scopes || [],
        isDemoMode: !acct && env.DEMO_MODE,
        oauthConfigured: isGoogleOAuthConfigured(),
      },
    });
  }

  static async disconnectGoogle(req: Request, res: Response) {
    await googleAuthService.disconnect(req.user!.id);
    audit({ userId: req.user!.id, action: 'integration.disconnect', provider: 'google', status: 'success' });
    res.json({ success: true, message: 'Google account disconnected' });
  }
}
