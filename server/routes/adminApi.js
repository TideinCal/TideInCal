import { Router } from 'express';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { getDashboardData } from '../services/admin/getDashboardData.js';
import { searchCustomers } from '../services/admin/searchCustomers.js';
import { getCustomerDetail } from '../services/admin/getCustomerDetail.js';

const router = Router();

router.use(requireAdmin);

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
