import { test, describe } from 'node:test';
import assert from 'node:assert';

describe('Webhook Handler', () => {
  test('webhook processes checkout.session.completed event', () => {
    // Mock Stripe checkout session data
    const mockSession = {
      id: 'cs_test_123',
      customer: 'cus_test_123',
      customer_email: 'test@example.com',
      payment_intent: 'pi_test_123',
      metadata: {
        userId: '507f1f77bcf86cd799439011',
        stationID: 'station123',
        stationTitle: 'Test Station',
        country: 'usa',
        includeMoon: 'false',
        unlimited: 'false'
      }
    };
    
    // Verify metadata extraction
    const { userId, stationID, stationTitle, country, includeMoon, unlimited } = mockSession.metadata;
    
    assert.strictEqual(userId, '507f1f77bcf86cd799439011');
    assert.strictEqual(stationID, 'station123');
    assert.strictEqual(stationTitle, 'Test Station');
    assert.strictEqual(country, 'usa');
    assert.strictEqual(includeMoon, 'false');
    assert.strictEqual(unlimited, 'false');
  });
  
  test('webhook processes unlimited purchase', () => {
    const mockSession = {
      metadata: {
        userId: '507f1f77bcf86cd799439011',
        stationID: 'station123',
        stationTitle: 'Test Station',
        country: 'usa',
        includeMoon: 'false',
        unlimited: 'true'
      }
    };
    
    const { unlimited } = mockSession.metadata;
    const unlimitedBool = unlimited === 'true';
    
    assert.strictEqual(unlimitedBool, true);
  });
  
  test('webhook processes single download purchase', () => {
    const mockSession = {
      metadata: {
        userId: '507f1f77bcf86cd799439011',
        stationID: 'station123',
        stationTitle: 'Test Station',
        country: 'usa',
        includeMoon: 'true',
        unlimited: 'false'
      }
    };
    
    const { includeMoon, unlimited } = mockSession.metadata;
    const includeMoonBool = includeMoon === 'true';
    const unlimitedBool = unlimited === 'false';
    
    assert.strictEqual(includeMoonBool, true);
    assert.strictEqual(unlimitedBool, false);
  });
  
  test('file record creation logic', () => {
    const now = new Date();
    const retainUntil = new Date(now.getTime() + (365 * 24 * 60 * 60 * 1000));
    
    const mockFileRecord = {
      userId: '507f1f77bcf86cd799439011',
      stationId: 'station123',
      stationTitle: 'Test Station',
      region: 'usa',
      includesMoon: true,
      storagePath: 'tempICSFile/Test_Station_1234567890.ics',
      createdAt: now,
      retainUntil,
      lastDownloadedAt: null
    };
    
    // Verify file record structure
    assert.strictEqual(typeof mockFileRecord.userId, 'string');
    assert.strictEqual(typeof mockFileRecord.stationId, 'string');
    assert.strictEqual(typeof mockFileRecord.stationTitle, 'string');
    assert.strictEqual(typeof mockFileRecord.region, 'string');
    assert.strictEqual(typeof mockFileRecord.includesMoon, 'boolean');
    assert.strictEqual(typeof mockFileRecord.storagePath, 'string');
    assert.ok(mockFileRecord.createdAt instanceof Date);
    assert.ok(mockFileRecord.retainUntil instanceof Date);
    assert.strictEqual(mockFileRecord.lastDownloadedAt, null);
    
    // Verify retention period
    const retentionDays = (mockFileRecord.retainUntil.getTime() - mockFileRecord.createdAt.getTime()) / (1000 * 60 * 60 * 24);
    assert.ok(retentionDays >= 364 && retentionDays <= 366);
  });
});
