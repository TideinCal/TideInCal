require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use('/tempICSFile', express.static(path.join(__dirname, 'tempICSFile')));

// Ensure tempICSFile directory exists
const ensureDirExists = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }
};
ensureDirExists(path.join(__dirname, 'tempICSFile'));

// POST route for starting the data fetch process
app.post('/startDataFetch', async (req, res) => {
  const { stationID, stationTitle, country, feet, userTimezone } = req.body;
  console.log('Received request:', { stationID, stationTitle, country, feet, userTimezone }); // Debug log
  try {
    const fileName = await getYearData(stationID, stationTitle, country, feet, userTimezone);
    const fileUrl = `/tempICSFile/${fileName}`; // Construct the URL for the ICS file
    res.json({ message: 'Data fetching initiated', fileUrl });
  } catch (error) {
    console.error('Error fetching data:', error); // Debug log
    res.status(500).json({ error: error.toString() });
  }
});

// Route for Downloading the ICS File
app.get('/tempICSFile/tideEvents.ics', (req, res) => {
  const filePath = path.join(__dirname, 'tempICSFile', 'tideEvents.ics');
  console.log(`Serving file from: ${filePath}`); // Debugging statement

  res.setHeader('Content-Type', 'text/calendar');
  res.setHeader('Content-Disposition', 'attachment; filename="tideEvents.ics"');
  res.sendFile(filePath, (err) => {
    if (err) {
      console.error(`Error sending file: ${err}`); // Debugging statement
      res.status(404).send('File not found');
    }
  });
});

// Start the Server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Function to fetch tidal data and create ICS content
const getYearData = async (id, stationTitle, country, feet, userTimezone) => {
  const year = new Date().getFullYear();
  const nextYr = year + 1;
  const today = new Date();
  const month2d = String(today.getMonth() + 1).padStart(2, '0');
  const day2d = String(today.getDate()).padStart(2, '0');
  let events = [];

  const apiUrl = country === 'canada'
    ? `https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/${id}/data?time-series-code=wlp-hilo&from=${year}-${month2d}-${day2d}T00%3A00%3A00Z&to=${nextYr}-${month2d}-${day2d}T00%3A00%3A00Z`
    : `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${year}${month2d}${day2d}&end_date=${nextYr}${month2d}${day2d}&station=${id}&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&units=english&application=DataAPI_Sample&format=json`;

  const response = await fetch(apiUrl);
  const data = await response.json();
  const tideData = country === 'canada' ? data : data.predictions;

  tideData.forEach((entry, i) => {
    const tide = country === 'canada'
      ? entry.value > (tideData[i + 1]?.value || entry.value) ? "High Tide" : "Low Tide"
      : entry.type === 'L' ? "Low Tide" : "High Tide";

    const tideHeight = feet
      ? `${country === 'canada' ? (entry.value * 3.2808399).toFixed(2) : entry.v}Ft`
      : `${country === 'canada' ? entry.value : (entry.v / 3.2808399).toFixed(2)}M`;

    const startDate = new Date(country === 'canada' ? entry.eventDate : entry.t);
    const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // 30 minutes duration

    const eventContent = `BEGIN:VEVENT
UID:tide-event-${i}
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

  const icsContent = `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
PRODID:-//My Company//My Product//EN
METHOD:PUBLISH
X-WR-CALNAME:${stationTitle} Tides
X-WR-TIMEZONE:${userTimezone}
${events.join('\n')}
END:VCALENDAR`;

  console.log('ICS Content:\n', icsContent); // Debug log

  const calendarFileNm = `${stationTitle}_${year}_${nextYr}.ics`;
  const filePath = path.join(__dirname, 'tempICSFile', calendarFileNm);
  fs.writeFileSync(filePath, icsContent);

  return calendarFileNm;
};

// Helper function to format date for ICS
const formatDateForICS = (date, timezone) => {
  return new Date(date.toLocaleString('en-US', { timeZone: timezone })).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
};
