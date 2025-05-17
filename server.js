import 'dotenv/config.js'
import express from 'express';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import cron from 'node-cron';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import mime from "mime-types";
import JSZip from 'jszip';

const __filename = fileURLToPath(import.meta.url);
// const __dirname = dirname(__filename);
const __dirname = path.resolve();

const app = express();
const port = process.env.PORT || 3000;


app.use(express.static(path.join(__dirname, 'public')));
//serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.css')) {
      res.setHeader('Content-Type', mime.lookup('css'));
    }
  }
}));
app.use(express.json());

app.use((req, res, next) => {
  if (req.hostname === 'www.tideincal.com') {
    return res.redirect(301, 'https://tideincal.com' + req.originalUrl);
  }
  next();
});

app.get('/', (req, res) => {
  const host = req.hostname;

  if (host === 'app.tideincal.com') {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.sendFile(path.join(__dirname, 'public', 'polishPre.html'));
  }
});

app.use('/tempICSFile', express.static(path.join(__dirname, 'tempICSFile')));

// Ensure tempICSFile directory exists
const ensureDirExists = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
};
ensureDirExists(path.join(__dirname, 'tempICSFile'));

// Available regions with functional APIs or data
const availableRegions = ['canada', 'usa']; // Add 'uk', 'australia' when ready

// Route to provide the list of supported regions
app.get('/api/tide-regions', (req, res) => {
  res.json({ regions: availableRegions });
});

// Route to fetch tide stations for a specific region
app.get('/api/tide-stations', (req, res) => {
  const region = req.query.region;
  const filePath = path.join(__dirname, 'data', `${region}_stations.json`);

  if (!availableRegions.includes(region)) {
    return res.status(400).json({ error: `Region "${region}" is not supported` });
  }

  if (fs.existsSync(filePath)) {
    const tideStations = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    res.json(tideStations);
  } else {
    res.status(404).json({ error: `Tide station data for "${region}" is not available` });
  }
});


// POST route for starting the data fetch process
app.post('/startDataFetch', async (req, res) => {
  const { stationID, stationTitle, country, feet, userTimezone } = req.body;
  console.log(`received: ${JSON.stringify(req.body)}`);
  console.log('Received request:', { stationID, stationTitle, country, feet, userTimezone });

  try {
    const fileName = await getYearData(stationID, stationTitle, country, feet, userTimezone);
    const fileUrl = `/tempICSFile/${fileName}`;
    res.json({ message: 'Data fetching initiated', fileUrl });
  } catch (error) {
    console.error('Error fetching data:', error);
    res.status(500).json({ error: error.toString() });
  }
});

// Cleanup old ICS files daily ( WILL NEED TO CHANGE THIS)
cron.schedule('0 0 * * *', () => {
  const dir = './tempICSFile';
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stats = fs.statSync(filePath);

    if (Date.now() - stats.mtimeMs > 24 * 60 * 60 * 1000) {
      fs.unlinkSync(filePath);
    }
  });
  console.log('Old ICS files cleaned up!');
});

// Start the Server
// app.get('/', (req, res) => {
//   console.log('Request hostname:', req.hostname);
//   const host = req.hostname;
//     if (host.includes('app.')) {
//       res.sendFile(path.join(__dirname, 'public', 'index.html'));
//     } else {
//       res.sendFile(path.join(__dirname, 'public', 'polishPre.html'));
//     }
//   });


app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

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
    const tide =
      country === 'canada'
        ? entry.value > (tideData[i + 1]?.value || entry.value)
          ? 'High Tide'
          : 'Low Tide'
        : entry.type === 'L'
          ? 'Low Tide'
          : 'High Tide';

    const tideHeight = feet
      ? `${
        country === 'canada'
          ? (entry.value * 3.2808399).toFixed(2)
          : entry.v
      }Ft`
      : `${
        country === 'canada'
          ? entry.value
          : (entry.v / 3.2808399).toFixed(2)
      }M`;

    const startDate = new Date(country === 'canada' ? entry.eventDate : entry.t);
    const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // 30 min duration

    // ✅ Generate unique UID per event
    const eventUID = `tide-${id}-${startDate.getTime()}-${Math.random().toString(36).substr(2, 6)}@tideincal.com`;

    // ✅ ICS Event Content
    const eventContent = `BEGIN:VEVENT
UID:${eventUID}
SEQUENCE:0
DTSTAMP:${formatDateForICS(new Date())}
DTSTART:${formatDateForICS(startDate, userTimezone)}
DTEND:${formatDateForICS(endDate, userTimezone)}
SUMMARY:${tide} @ ${tideHeight}
DESCRIPTION:Tide at ${stationTitle}
LOCATION:${stationTitle}
STATUS:CONFIRMED
END:VEVENT`;

    events.push(eventContent);
  });

  // ✅ Unique calendar name to avoid conflicts
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
// Format date for ICS
const formatDateForICS = (date, timezone) => {
  return new Date(date.toLocaleString('en-US', { timeZone: timezone }))
    .toISOString()
    .replace(/[-:]/g, '')
    .split('.')[0] + 'Z';
};
