import argon2 from 'argon2';
import { getDatabase } from '../db/index.js';
import { z } from 'zod';

// Validation schemas
export const signupSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(8),
  firstName: z.string().min(1).max(50).optional(),
  lastName: z.string().min(1).max(50).optional()
});

export const loginSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1)
});

export async function hashPassword(password) {
  return await argon2.hash(password);
}

export async function verifyPassword(hash, password) {
  try {
    return await argon2.verify(hash, password);
  } catch (error) {
    return false;
  }
}

export async function attachUser(req, res, next) {
  try {
    if (req.session && req.session.userId) {
      const db = getDatabase();
      const user = await db.collection('users').findOne(
        { _id: req.session.userId },
        { projection: { passwordHash: 0 } }
      );
      req.user = user;
    }
    next();
  } catch (error) {
    console.error('Error in attachUser:', error);
    req.user = null;
    next();
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}
