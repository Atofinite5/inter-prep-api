import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    name: string;
  };
}

export const JWT_SECRET = process.env.JWT_SECRET || 'dev_jwt_secret_key_1234567890';

export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  // Check cookie or Bearer token header
  const token = req.cookies?.session_token || req.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!token) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Authentication required. Please log in to access your kits.',
    });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string; name: string };
    req.user = decoded;
    next();
  } catch (err: any) {
    res.status(401).json({
      error: 'SESSION_EXPIRED',
      message: 'Your session has expired or is invalid. Please log in again.',
    });
  }
}
