// server/routes/__tests__/checkout.test.js
import { describe, it, expect } from 'vitest';
import { getProCouponSessionOptions } from '../checkout.js';

describe('getProCouponSessionOptions (Pro coupon at checkout)', () => {
  const testCouponId = 'Qs5nl4do';

  it('applies coupon when plan is unlimited, useProOffer is true, and env coupon is set', () => {
    const result = getProCouponSessionOptions('unlimited', true, testCouponId);
    expect(result.allow_promotion_codes).toBe(false);
    expect(result.discounts).toEqual([{ coupon: testCouponId }]);
  });

  it('applies coupon when useProOffer is string "true" (client JSON)', () => {
    const result = getProCouponSessionOptions('unlimited', 'true', testCouponId);
    expect(result.allow_promotion_codes).toBe(false);
    expect(result.discounts).toEqual([{ coupon: testCouponId }]);
  });

  it('does not apply coupon when useProOffer is false', () => {
    const result = getProCouponSessionOptions('unlimited', false, testCouponId);
    expect(result.allow_promotion_codes).toBe(true);
    expect(result.discounts).toBeUndefined();
  });

  it('does not apply coupon when useProOffer is undefined', () => {
    const result = getProCouponSessionOptions('unlimited', undefined, testCouponId);
    expect(result.allow_promotion_codes).toBe(true);
    expect(result.discounts).toBeUndefined();
  });

  it('does not apply coupon when env coupon is missing', () => {
    const result = getProCouponSessionOptions('unlimited', true, undefined);
    expect(result.allow_promotion_codes).toBe(true);
    expect(result.discounts).toBeUndefined();
  });

  it('does not apply coupon when env coupon is empty string', () => {
    const result = getProCouponSessionOptions('unlimited', true, '  ');
    expect(result.allow_promotion_codes).toBe(true);
    expect(result.discounts).toBeUndefined();
  });

  it('does not apply coupon for single plan even with useProOffer and coupon set', () => {
    const result = getProCouponSessionOptions('single', true, testCouponId);
    expect(result.allow_promotion_codes).toBe(true);
    expect(result.discounts).toBeUndefined();
  });

  it('trims env coupon value', () => {
    const result = getProCouponSessionOptions('unlimited', true, `  ${testCouponId}  `);
    expect(result.discounts).toEqual([{ coupon: testCouponId }]);
  });
});
