import 'express';

declare global {
  namespace Express {
    interface AuthUser {
      id: string;
      email: string;
      name: string;
      role: 'admin' | 'manager' | 'user';
    }
    interface Request {
      user?: AuthUser;
      rawBody?: Buffer;
    }
  }
}

export {};
