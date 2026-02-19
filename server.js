// server.js
import './server/bootstrap/loadEnv.js';
import express from 'express';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import mime from 'mime-types';
import JSZip from 'jszip';
import session from 'express-session';
import MongoStore from 'connect-mongo';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import cors from 'cors';
import csurf from 'csurf';

// Internal modules
import { connectToDatabase } from './server/db/index.js';
import authRoutes from './server/routes/auth.js';
import checkoutRoutes from './server/routes/checkout.js';
// NOTE: do NOT import webhook as a router; we mount a raw handler inline
import filesRoutes from './server/routes/files.js';
import downloadsRoutes from './server/routes/downloads.js';
import { attachUser } from './server/auth/index.js';
import { assertStripeEnv } from './server/bootstrap/envGuard.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Validate required environment variables
assertStripeEnv();

const app = express();
const port = process.env.PORT || 3000;

// If behind a proxy/CDN in prod, needed for secure cookies
app.set('trust proxy', 1);

// ─────────────────────────────────────────────────────────────
// Security middleware
// ─────────────────────────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: [
          "'self'", 
          "'unsafe-inline'", 
          'https://unpkg.com',
          'https://cdn.jsdelivr.net',
          'https://fonts.googleapis.com',
          'https://cdnjs.cloudflare.com'
        ],
        scriptSrc: [
          "'self'", 
          'https://unpkg.com',
          'https://cdn.jsdelivr.net',
          'https://js.stripe.com'
        ],
        scriptSrcAttr: [
          "'unsafe-inline'"
        ],
        frameSrc: [
          "'self'",
          'https://js.stripe.com',
          'https://hooks.stripe.com'
        ],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: [
          "'self'",
          'https://fonts.gstatic.com',
          'https://cdn.jsdelivr.net',
          'https://cdnjs.cloudflare.com'
        ],
        connectSrc: [
          "'self'",
          'https://api.tidesandcurrents.noaa.gov',
          'https://api-iwls.dfo-mpo.gc.ca',
          'https://api.stripe.com',
          'https://nominatim.openstreetmap.org',
          'https://unpkg.com',
          'https://cdn.jsdelivr.net'
        ],
      },
    },
  })
);

// CORS (allow your own origin)
app.use(
  cors({
    origin: process.env.APP_URL || 'http://localhost:3000',
    credentials: true,
  })
);

// Shared handler for rate limit 429 responses
const rateLimitHandler = (_req, res) => {
  res.status(429).json({ error: 'Too many requests. Please wait a moment.' });
};

// Rate limits - auth limiter is applied per-route in server/routes/auth.js
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  handler: rateLimitHandler,
});

// Downloads: per-user 5/min, per-IP 30/min
const downloadsUserLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 5,
  keyGenerator: (req) => req.user?._id?.toString() ?? ipKeyGenerator(req.ip),
  handler: rateLimitHandler,
});

const downloadsIPLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 30,
  handler: rateLimitHandler,
});

// Files (list/download): per-user 5/min, per-IP 30/min
const filesUserLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 5,
  keyGenerator: (req) => req.user?._id?.toString() ?? ipKeyGenerator(req.ip),
  handler: rateLimitHandler,
});

const filesIPLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 30,
  handler: rateLimitHandler,
});

// Session config (store added after DB connects)
let sessionConfig = {
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24h
  },
};

// Production: must not use missing or fallback SESSION_SECRET
if (process.env.NODE_ENV === 'production') {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret === 'fallback-secret-change-in-production') {
    throw new Error('SESSION_SECRET must be set to a secure value in production. Do not use the fallback.');
  }
  sessionConfig.secret = secret;
}

// Session middleware will be applied after DB connection

// ─────────────────────────────────────────────────────────────
// Stripe webhook MUST be mounted BEFORE express.json() using raw body
// ─────────────────────────────────────────────────────────────
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    // dynamic import to avoid raw-body conflicts
    const webhookHandler = (await import('./server/routes/webhook.js')).default;
    return webhookHandler(req, res);
  }
);

// Now safe to use JSON parser for normal routes
app.use(express.json());

// www → apex redirect
app.use((req, res, next) => {
  if (req.hostname === 'www.tideincal.com') {
    return res.redirect(301, 'https://tideincal.com' + req.originalUrl);
  }
  next();
});

// Static files FIRST
app.use(
  express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.css')) {
        res.setHeader('Content-Type', mime.lookup('css'));
      }
    },
  })
);

// Temporary ICS hosting
app.use('/tempICSFile', express.static(path.join(__dirname, 'tempICSFile')));

// Available regions
const availableRegions = ['canada', 'usa'];

// API: regions
app.get('/api/tide-regions', (_req, res) => {
  res.json({ regions: availableRegions });
});

// API: stations by region
app.get('/api/tide-stations', (req, res) => {
  const region = req.query.region;
  const filePath = path.join(__dirname, 'data', `${region}_stations.json`);

  if (!availableRegions.includes(region)) {
    return res.status(400).json({ error: `Region "${region}" is not supported` });
  }

  if (fs.existsSync(filePath)) {
    const tideStations = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    return res.json(tideStations);
  }

  return res
    .status(404)
    .json({ error: `Tide station data for "${region}" is not available` });
});

// ─────────────────────────────────────────────────────────────
// Routes that don't require DB (webhook/static) are already above.
// Everything that needs sessions/user comes after DB connection.
// ─────────────────────────────────────────────────────────────
async function startServer() {
  let dbConnected = false;
  let client = null;

  // Try to connect to MongoDB
  try {
    const result = await connectToDatabase();
    client = result.client;
    dbConnected = true;

    // Configure session store with MongoDB
    sessionConfig.store = MongoStore.create({
      client,
      dbName: 'tideincal',
      collectionName: 'sessions',
      ttl: 14 * 24 * 3600, // 14 days
    });

    console.log('✅ MongoDB connected - full functionality enabled');
  } catch (err) {
    console.warn('⚠️  MongoDB connection failed:', err.message);
    console.warn('⚠️  Server will start with limited functionality (static files only)');
    console.warn('⚠️  Database-dependent routes will be disabled');
    
    // Use memory store as fallback (sessions won't persist across restarts)
    // Note: MemoryStore is the default when no store is specified
  }

  // Apply session middleware (works with or without MongoDB store)
  app.use(session(sessionConfig));

  // CSRF token endpoint (session-based, public)
  const csrfProtection = csurf({ cookie: false });
  app.get('/api/csrf', csrfProtection, (req, res) => {
    res.json({ csrfToken: req.csrfToken() });
  });
  
  // Only apply database-dependent middleware if connected
  if (dbConnected) {
    // Apply middleware that relies on req.session and DB
    app.use(attachUser);

    // Auth/checkout/file routes (rate-limited where appropriate)
    app.use('/api/auth', authRoutes);
    app.use('/api/checkout', checkoutLimiter, checkoutRoutes);
    app.use('/api/files', filesUserLimiter, filesIPLimiter, filesRoutes);
    app.use('/api/downloads', downloadsUserLimiter, downloadsIPLimiter, downloadsRoutes);
  } else {
    // Mount routes with error handlers for DB-dependent endpoints
    app.use('/api/auth', (req, res) => {
      res.status(503).json({ error: 'Database not available. MongoDB connection required.' });
    });
    app.use('/api/checkout', (req, res) => {
      res.status(503).json({ error: 'Database not available. MongoDB connection required.' });
    });
    app.use('/api/files', (req, res) => {
      res.status(503).json({ error: 'Database not available. MongoDB connection required.' });
    });
    app.use('/api/downloads', (req, res) => {
      res.status(503).json({ error: 'Database not available. MongoDB connection required.' });
    });
  }

  // Success page
  app.get('/success', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'success.html'));
  });

  // Email verification page
  app.get('/verify-email', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'verify-email.html'));
  });

  // Password reset page
  app.get('/reset-password', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'reset-password.html'));
  });

  // Account page
  app.get('/account', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'account.html'));
  });

  // Home LAST
  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // CSRF error handler
  app.use((err, _req, res, next) => {
    if (err?.code === 'EBADCSRFTOKEN') {
      return res.status(403).json({ error: 'Invalid or missing CSRF token' });
    }
    next(err);
  });

  // Catch-all error handler: no stack or internal details
  app.use((err, _req, res, _next) => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Daily cleanup of old files (legacy; webhook/TTL handles new flow)
  cron.schedule('0 0 * * *', () => {
    const dir = './tempICSFile';
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    files.forEach((file) => {
      const filePath = path.join(dir, file);
      const stats = fs.statSync(filePath);
      if (Date.now() - stats.mtimeMs > 24 * 60 * 60 * 1000) {
        fs.unlinkSync(filePath);
      }
    });
  });

  app.listen(port, () => {
    const status = dbConnected ? '✅' : '⚠️  (DB disconnected)';
    console.log(`🚀 Server running on port ${port} ${status}`);
    if (!dbConnected) {
      console.log('📝 Note: Check your MONGO_URI environment variable and MongoDB connection');
    }
  });
}

startServer();

// ─────────────────────────────────────────────────────────────
// ICS generator (existing logic preserved)
// ─────────────────────────────────────────────────────────────
const getYearData = async (id, stationTitle, country, feet, userTimezone) => {
  const year = new Date().getFullYear();
  const nextYr = year + 1;
  const today = new Date();
  const month2d = String(today.getMonth() + 1).padStart(2, '0');
  const day2d = String(today.getDate()).padStart(2, '0');
  let events = [];

  const apiUrl =
    country === 'canada'
      ? `https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/${id}/data?time-series-code=wlp-hilo&from=${year}-${month2d}-${day2d}T00%3A00%3A00Z&to=${nextYr}-${month2d}-${day2d}T00%3A00%3A00Z`
      : `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${year}${month2d}${day2d}&end_date=${nextYr}${month2d}${day2d}&station=${id}&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&units=english&application=DataAPI_Sample&format=json`;

  const response = await fetch(apiUrl);
  const data = await response.json();
  const tideData = country === 'canada' ? data : data.predictions;

  tideData.forEach((entry, i) => {
    let tide;

    if (country === 'canada') {
      const currentHeight = parseFloat(entry.value);
      const prev = tideData[i - 1] ? parseFloat(tideData[i - 1].value) : null;
      const next = tideData[i + 1] ? parseFloat(tideData[i + 1].value) : null;

      if (prev === null) {
        tide = currentHeight > next ? 'High Tide' : 'Low Tide';
      } else if (next === null) {
        tide = currentHeight > prev ? 'High Tide' : 'Low Tide';
      } else {
        tide =
          currentHeight > prev && currentHeight > next
            ? 'High Tide'
            : 'Low Tide';
      }
    } else {
      tide = entry.type === 'L' ? 'Low Tide' : 'High Tide';
    }

    const tideHeight = feet
      ? `${
        country === 'canada' ? (entry.value * 3.2808399).toFixed(2) : entry.v
      }Ft`
      : `${
        country === 'canada'
          ? entry.value
          : (entry.v / 3.2808399).toFixed(2)
      }M`;

    const rawTime =
      country === 'canada' ? entry.eventDate : `${entry.t}:00`; // add seconds for NOAA

    const startDate = new Date(
      new Date(rawTime).toLocaleString('en-US', { timeZone: userTimezone })
    );
    const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // +30 min

    const eventUID = `tide-${id}-${startDate.getTime()}-${Math.random()
      .toString(36)
      .substr(2, 6)}@tideincal.com`;

    const eventContent = `BEGIN:VEVENT
UID:${eventUID}
SEQUENCE:0
DTSTAMP:${formatDateForICS(new Date())}
DTSTART:${formatDateForICS(startDate, country, userTimezone)}
DTEND:${formatDateForICS(endDate, country, userTimezone)}
SUMMARY:${stationTitle} ${tide} @ ${tideHeight}
DESCRIPTION:${tideHeight}Tide at ${stationTitle}
LOCATION:${stationTitle}
STATUS:CONFIRMED
END:VEVENT`;

    events.push(eventContent);
  });

  const calendarName = `Tide - ${stationTitle} - ${year}-${month2d}-${day2d}`;
  const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
PRODID:-//Tide In Calendar//TideCal//EN
METHOD:PUBLISH
X-WR-CALNAME:${calendarName}
X-WR-TIMEZONE:${userTimezone}
${events.join('\n')}
END:VCALENDAR`;

  const calendarFileNm = `${stationTitle}_${year}_${nextYr}.ics`;
  const filePath = path.join(__dirname, 'tempICSFile', calendarFileNm);
  fs.writeFileSync(filePath, icsContent);
  return calendarFileNm;
};

const formatDateForICS = (date, country, userTimezone) => {
  if (country === 'canada') {
    return new Date(date).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  } else {
    const local = new Date(
      date.toLocaleString('en-US', { timeZone: userTimezone })
    );
    return `${local.getFullYear()}${String(local.getMonth() + 1).padStart(
      2,
      '0'
    )}${String(local.getDate()).padStart(2, '0')}T${String(
      local.getHours()
    ).padStart(2, '0')}${String(local.getMinutes()).padStart(2, '0')}${String(
      local.getSeconds()
    ).padStart(2, '0')}`;
  }
};


//
//     //--------------------- FOR UK -------------------------//
//     // } else if ( country ==="uk") {
//     //
//     //   const uk_year =`http://environment.data.gov.uk/flood-monitoring/id/stations/${id}/readings?startdate=${year}-${month2d}-${day2d}&enddate=${nextYr}-${month2d}-${day2d}`;
//     //   //const uk_year1 =`http://environment.data.gov.uk/flood-monitoring/id/stations/`;
//     //   const respYearUK = await fetch(uk_year);
//     //   const oneYearUK = await respYearUK.json();
//     //   console.log(oneYearUK);
//     //   console.log('cherio');
//     //
//   } else {
//     console.error("Oh shit! You got nothing!")
//   }
// };

