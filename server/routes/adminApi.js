import { Router } from 'express';
import csurf from 'csurf';
import { z } from 'zod';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { getDatabase } from '../db/index.js';
import { getDashboardData } from '../services/admin/getDashboardData.js';
import { searchCustomers } from '../services/admin/searchCustomers.js';
import { getCustomerDetail } from '../services/admin/getCustomerDetail.js';
import { createAdminNote, MAX_NOTE_LENGTH } from '../services/admin/createAdminNote.js';
import { setCustomerMarkedForReview } from '../services/admin/setCustomerMarkedForReview.js';

const router = Router();
const csrfProtection = csurf({ cookie: false });

router.use(requireAdmin);

const noteBodySchema = z.object({
  note: z.string().trim().min(1).max(MAX_NOTE_LENGTH),
});

const markReviewBodySchema = z.object({
  markedForReview: z.boolean(),
});

// GET /api/admin/dashboard
router.get('/dashboard', async (_req, res) => {
  try {
    const data = await getDashboardData();
    res.json(data);
  } catch (error) {
    console.error('[admin] dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/customers?query=
router.get('/customers', async (req, res) => {
  try {
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    const customers = await searchCustomers(query);
    res.json({ customers });
  } catch (error) {
    console.error('[admin] customers search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/customers/:userId/notes
router.post('/customers/:userId/notes', csrfProtection, async (req, res) => {
  try {
    const { ObjectId } = await import('mongodb');
    let targetUserId;
    try {
      targetUserId = new ObjectId(req.params.userId);
    } catch {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const db = getDatabase();
    const exists = await db.collection('users').findOne({ _id: targetUserId }, { projection: { _id: 1 } });
    if (!exists) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const validated = noteBodySchema.parse(req.body || {});
    const adminUserId = new ObjectId(req.user._id);

    const result = await createAdminNote({
      targetUserId,
      adminUserId,
      noteText: validated.note,
    });

    res.status(201).json({ note: result.note });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('[admin] create note error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/admin/customers/:userId/mark-for-review
router.post('/customers/:userId/mark-for-review', csrfProtection, async (req, res) => {
  try {
    const { ObjectId } = await import('mongodb');
    let targetUserId;
    try {
      targetUserId = new ObjectId(req.params.userId);
    } catch {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const db = getDatabase();
    const exists = await db.collection('users').findOne({ _id: targetUserId }, { projection: { _id: 1 } });
    if (!exists) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const validated = markReviewBodySchema.parse(req.body || {});
    const adminUserId = new ObjectId(req.user._id);

    const result = await setCustomerMarkedForReview({
      targetUserId,
      adminUserId,
      markedForReview: validated.markedForReview,
    });

    if (!result.ok) {
      return res.status(404).json({ error: result.error || 'Customer not found' });
    }

    res.json({
      markedForReview: result.markedForReview,
      unchanged: !!result.unchanged,
    });
  } catch (error) {
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: 'Invalid input', details: error.errors });
    }
    console.error('[admin] mark-for-review error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/customers/:userId
router.get('/customers/:userId', async (req, res) => {
  try {
    const detail = await getCustomerDetail(req.params.userId);
    if (!detail) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(detail);
  } catch (error) {
    console.error('[admin] customer detail error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
