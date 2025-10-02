import { Router } from 'express';
import { getDatabase } from '../db/index.js';
import { 
  hashPassword, 
  verifyPassword, 
  signupSchema, 
  loginSchema,
  attachUser,
  requireAuth 
} from '../auth/index.js';

const router = Router();

// Apply attachUser to all auth routes
router.use(attachUser);

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const validated = signupSchema.parse(req.body);
    const { email, password, firstName, lastName } = validated;
    
    const db = getDatabase();
    
    // Check if user already exists
    const existingUser = await db.collection('users').findOne({ email });
    if (existingUser) {
      return res.status(409).json({ error: 'User already exists' });
    }
    
    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const now = new Date();
    
    const result = await db.collection('users').insertOne({
      email,
      passwordHash,
      firstName: firstName || null,
      lastName: lastName || null,
      emailVerifiedAt: null,
      stripeCustomerId: null,
      unlimited: false,
      unlimitedSince: null,
      entitlements: [],
      createdAt: now,
      updatedAt: now
    });
    
    // Set session
    req.session.userId = result.insertedId;
    
    // Return user without sensitive data
    const user = {
      _id: result.insertedId,
      email,
      firstName,
      lastName
    };
    
    res.status(201).json({ user });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Signup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const validated = loginSchema.parse(req.body);
    const { email, password } = validated;
    
    const db = getDatabase();
    
    // Find user
    const user = await db.collection('users').findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Verify password
    const isValidPassword = await verifyPassword(user.passwordHash, password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Set session
    req.session.userId = user._id;
    
    // Return user without sensitive data
    const userResponse = {
      _id: user._id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName
    };
    
    res.json({ user: userResponse });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).json({ error: 'Could not log out' });
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out successfully' });
  });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  const user = {
    _id: req.user._id,
    email: req.user.email,
    firstName: req.user.firstName,
    lastName: req.user.lastName
  };
  res.json({ user });
});

// GET /api/auth/me/entitlements
router.get('/me/entitlements', requireAuth, (req, res) => {
  const entitlements = {
    unlimited: req.user.unlimited || false,
    unlimitedSince: req.user.unlimitedSince || null,
    entitlements: req.user.entitlements || []
  };
  res.json(entitlements);
});

export default router;
