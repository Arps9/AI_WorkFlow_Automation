import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.config';
import { UserModel, UserRole } from '../models/user.model';

export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
}

export function signToken(user: { id: string; email: string; name: string; role: UserRole }): string {
  return jwt.sign({ sub: user.id, email: user.email, name: user.name, role: user.role }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as any });
}

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** Verifies the JWT and attaches req.user. Deactivated users are rejected. */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ success: false, error: { message: 'Authentication required', statusCode: 401 } });
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as unknown as JwtPayload;
    const user = await UserModel.findById(payload.sub).lean().catch(() => null);
    if (!user || user.isActive === false) return res.status(401).json({ success: false, error: { message: 'Account not found or disabled', statusCode: 401 } });
    req.user = { id: String(user._id), email: user.email, name: user.name, role: user.role };
    next();
  } catch {
    return res.status(401).json({ success: false, error: { message: 'Invalid or expired session — please sign in again', statusCode: 401 } });
  }
}

/** Role-based access control. Roles are hierarchical: admin > manager > user. */
const RANK: Record<UserRole, number> = { user: 1, manager: 2, admin: 3 };

export function requireRole(min: UserRole) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ success: false, error: { message: 'Authentication required', statusCode: 401 } });
    if (RANK[req.user.role] < RANK[min]) return res.status(403).json({ success: false, error: { message: `Requires ${min} role`, statusCode: 403 } });
    next();
  };
}
