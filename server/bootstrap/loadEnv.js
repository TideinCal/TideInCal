import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '..', '..', '.env');
const cwdEnvPath = resolve(process.cwd(), '.env');

// Prefer cwd .env (works when running from worktree or project root), then file-relative path
const pathToLoad = existsSync(cwdEnvPath) ? cwdEnvPath : existsSync(envPath) ? envPath : envPath;
const result = dotenv.config({ path: pathToLoad, override: true });
if (process.env.NODE_ENV !== 'production' && !process.env.STRIPE_PRO_UPGRADE_COUPON?.trim()) {
  console.warn('[loadEnv] STRIPE_PRO_UPGRADE_COUPON not set in .env - Pro upsell coupon will not apply');
}
if (result.error && process.env.NODE_ENV !== 'production') {
  console.warn('[loadEnv] Could not load .env:', result.error.message);
}
