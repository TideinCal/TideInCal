import argon2 from 'argon2';
import { getDatabase } from '../db/index.js';
import { z } from 'zod';

// Validation schemas
export const passwordSchema = z
  .string()
  .min(8)
  .regex(/^(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/, 'Password must include a number and a special character.');

export const signupSchema = z.object({
  email: z.string().email().toLowerCase(),
  password: passwordSchema,
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
      const { ObjectId } = await import('mongodb');
      
      const user = await db.collection('users').findOne(
        { _id: new ObjectId(req.session.userId) },
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

export function requireVerified(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!req.user.emailVerifiedAt) {
    return res.status(403).json({
      error: 'Email verification required',
      needsVerification: true
    });
  }
  next();
}
