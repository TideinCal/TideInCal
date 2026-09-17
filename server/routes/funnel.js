import { Router } from 'express';
import { z } from 'zod';
import { getDatabase } from '../db/index.js';
import { productDedupeKey, recordFunnelEvent } from '../funnel/index.js';
import { readAttributionFromRequest, sanitizeAcquisitionRecord } from '../attribution/index.js';

const router = Router();
export const productSelectionSchema = z.object({
  productType: z.enum(['single', 'golden', 'tide_and_golden', 'subscription']),
  stationCountry: z.enum(['canada', 'usa', 'unknown']).optional(),
}).strict();

router.post('/product-selected', async (req, res) => {
  try {
    const body = productSelectionSchema.parse(req.body || {});
    const acquisition = sanitizeAcquisitionRecord(readAttributionFromRequest(req));
    if (!acquisition?.journeyId) return res.status(204).end();
    const result = await recordFunnelEvent({
      db: getDatabase(),
      eventName: 'product_selected',
      acquisition,
      productType: body.productType,
      stationCountry: body.stationCountry,
      userId: req.user?._id,
      isTest: req.user?.isTest,
      dedupeKey: productDedupeKey(acquisition, body.productType),
    });
    res.status(result.recorded ? 201 : 200).json({ recorded: result.recorded });
  } catch (error) {
    if (error.name === 'ZodError' || error instanceof TypeError) {
      return res.status(400).json({ error: 'Invalid funnel event' });
    }
    console.error('[funnel] product selection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
