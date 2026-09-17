import { describe, it, expect } from 'vitest';
import {
  isChargeFullyRefunded,
  isChargePartiallyRefunded,
} from '../handleChargeRefunded.js';

describe('isChargeFullyRefunded / isChargePartiallyRefunded', () => {
  it('detects full refund when amount_refunded equals amount', () => {
    expect(isChargeFullyRefunded({ amount: 1000, amount_refunded: 1000 })).toBe(true);
    expect(isChargePartiallyRefunded({ amount: 1000, amount_refunded: 1000 })).toBe(false);
  });

  it('detects partial refund', () => {
    expect(isChargePartiallyRefunded({ amount: 1000, amount_refunded: 400 })).toBe(true);
    expect(isChargeFullyRefunded({ amount: 1000, amount_refunded: 400 })).toBe(false);
  });

  it('treats no refund as neither full nor partial', () => {
    expect(isChargeFullyRefunded({ amount: 1000, amount_refunded: 0 })).toBe(false);
    expect(isChargePartiallyRefunded({ amount: 1000, amount_refunded: 0 })).toBe(false);
  });
});
