import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { authRouter } from './routes/auth_routes.js';
import { kitRouter } from './routes/kit_routes.js';
import { practiceRouter } from './routes/practice_routes.js';
import { getDatabaseStatus } from './db/connection.js';

export const app = express();

// Security and utility middlewares
app.use(helmet({
  contentSecurityPolicy: false, // Allow client scripts in development
}));

const allowedOrigins = (process.env.CLIENT_URL || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length === 1 ? allowedOrigins[0] : allowedOrigins,
  credentials: true,
}));

app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  const dbStatus = getDatabaseStatus();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: dbStatus,
  });
});

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/kits', kitRouter);
app.use('/api/kits', practiceRouter);

// Centralized error handling
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Express Unhandled Error]', err);
  const statusCode = err.status || 500;
  res.status(statusCode).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: err.message || 'An unexpected server error occurred.',
  });
});
