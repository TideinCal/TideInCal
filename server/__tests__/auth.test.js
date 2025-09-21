import { test, describe, before } from 'node:test';
import assert from 'node:assert';
import argon2 from 'argon2';

describe('Authentication', () => {
  test('argon2 hash and verify', async () => {
    const password = 'testpassword123';
    
    // Hash password
    const hash = await argon2.hash(password);
    assert(typeof hash === 'string');
    assert(hash.length > 50);
    
    // Verify password
    const isValid = await argon2.verify(hash, password);
    assert.strictEqual(isValid, true);
    
    // Verify wrong password fails
    const isInvalid = await argon2.verify(hash, 'wrongpassword');
    assert.strictEqual(isInvalid, false);
  });
  
  test('login rejects wrong password', async () => {
    const password = 'testpassword123';
    const wrongPassword = 'wrongpassword';
    
    const hash = await argon2.hash(password);
    const isValid = await argon2.verify(hash, wrongPassword);
    
    assert.strictEqual(isValid, false);
  });
});

describe('Auth API endpoints', () => {
  // Note: These would require a test server setup
  // For now, we'll test the core auth logic
  
  test('password hashing is consistent', async () => {
    const password = 'testpassword123';
    const hash1 = await argon2.hash(password);
    const hash2 = await argon2.hash(password);
    
    // Hashes should be different (due to salt)
    assert.notStrictEqual(hash1, hash2);
    
    // But both should verify the same password
    const verify1 = await argon2.verify(hash1, password);
    const verify2 = await argon2.verify(hash2, password);
    
    assert.strictEqual(verify1, true);
    assert.strictEqual(verify2, true);
  });
});
