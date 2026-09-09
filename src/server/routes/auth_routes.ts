import { Router, Response } from 'express';
import jwt from 'jsonwebtoken';
import { UserRepository } from '../db/models/User.js';
import { authenticateToken, AuthenticatedRequest, JWT_SECRET } from '../middleware/auth.js';

export const authRouter = Router();

// Register
authRouter.post('/register', async (req, res): Promise<any> => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Email, password, and name are required.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Password must be at least 6 characters.' });
    }

    const existing = await UserRepository.findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'USER_EXISTS', message: 'An account with this email already exists.' });
    }

    const user = await UserRepository.create({ email, password, name });
    const token = jwt.sign(
      { id: user._id || user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: (process.env.SESSION_EXPIRY || '7d') as any }
    );

    res.cookie('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.status(201).json({
      message: 'Account created successfully',
      user: { id: user._id || user.id, email: user.email, name: user.name },
      token,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message || 'Registration failed' });
  }
});

// Login
authRouter.post('/login', async (req, res): Promise<any> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'VALIDATION_ERROR', message: 'Email and password are required.' });
    }

    const user = await UserRepository.findByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
    }

    const token = jwt.sign(
      { id: user._id || user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: (process.env.SESSION_EXPIRY || '7d') as any }
    );

    res.cookie('session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return res.json({
      message: 'Logged in successfully',
      user: { id: user._id || user.id, email: user.email, name: user.name },
      token,
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'SERVER_ERROR', message: err.message || 'Login failed' });
  }
});

// Logout
authRouter.post('/logout', (_req, res) => {
  res.clearCookie('session_token');
  res.json({ message: 'Logged out successfully' });
});

// Current User Profile
authRouter.get('/me', authenticateToken, (req: AuthenticatedRequest, res: Response): any => {
  return res.json({ user: req.user });
});
