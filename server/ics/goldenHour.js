/**
 * Golden Hour ICS calendar generation using SunCalc.
 * Isolated from moon and tide logic. Two events per day: morning (sunrise → goldenHourEnd), evening (goldenHour → sunset).
 */
import SunCalc from 'suncalc';

/**
 * Format date for ICS (floating local time)
 * @param {Date} date
 * @param {string} timezone
 * @returns {string}
 */
function formatDateForICS(date, timezone) {
  const local = new Date(date.toLocaleString('en-US', { timeZone: timezone || 'UTC' }));
  return `${local.getFullYear()}${String(local.getMonth() + 1).padStart(2, '0')}${String(local.getDate()).padStart(2, '0')}T${String(local.getHours()).padStart(2, '0')}${String(local.getMinutes()).padStart(2, '0')}${String(local.getSeconds()).padStart(2, '0')}`;
}

/**
 * Generate Golden Hour ICS calendar content.
 * @param {Object} opts
 * @param {number} opts.lat - Latitude
 * @param {number} opts.lng - Longitude
 * @param {string} opts.locationName - Display name for the location
 * @param {Date} opts.startDate - Start of date range
 * @param {Date} opts.endDate - End of date range
 * @param {string} [opts.timezone='UTC'] - User timezone
 * @returns {string} ICS content
 */
export function generateGoldenHourICS({ lat, lng, locationName, startDate, endDate, timezone = 'UTC' }) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const events = [];

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const date = new Date(d);
    const times = SunCalc.getTimes(date, lat, lng);

    if (times.sunrise && times.goldenHourEnd) {
      const dtStart = new Date(times.sunrise);
      const dtEnd = new Date(times.goldenHourEnd);
      const uid = `golden-morning-${lat}-${lng}-${date.getTime()}-${Math.random().toString(36).slice(2, 8)}@tideincal.com`;
      events.push(`BEGIN:VEVENT
UID:${uid}
SEQUENCE:0
DTSTAMP:${formatDateForICS(new Date(), timezone)}
DTSTART:${formatDateForICS(dtStart, timezone)}
DTEND:${formatDateForICS(dtEnd, timezone)}
SUMMARY:☀️ Morning Golden Hour • ${(locationName || 'Location').replace(/\n/g, ' ')}
DESCRIPTION:Location: ${(locationName || 'Location').replace(/\n/g, ' ')}\\nWindow: Sunrise to golden hour end
LOCATION:${(locationName || '').replace(/\n/g, ' ')}
STATUS:CONFIRMED
END:VEVENT`);
    }

    if (times.goldenHour && times.sunset) {
      const dtStart = new Date(times.goldenHour);
      const dtEnd = new Date(times.sunset);
      const uid = `golden-evening-${lat}-${lng}-${date.getTime()}-${Math.random().toString(36).slice(2, 8)}@tideincal.com`;
      events.push(`BEGIN:VEVENT
UID:${uid}
SEQUENCE:0
DTSTAMP:${formatDateForICS(new Date(), timezone)}
DTSTART:${formatDateForICS(dtStart, timezone)}
DTEND:${formatDateForICS(dtEnd, timezone)}
SUMMARY:☀️ Evening Golden Hour • ${(locationName || 'Location').replace(/\n/g, ' ')}
DESCRIPTION:Location: ${(locationName || 'Location').replace(/\n/g, ' ')}\\nWindow: Golden hour start to sunset
LOCATION:${(locationName || '').replace(/\n/g, ' ')}
STATUS:CONFIRMED
END:VEVENT`);
    }
  }

  const calendarName = `☀️ Golden Hour - ${(locationName || 'Location').replace(/\n/g, ' ')}`;
  return `BEGIN:VCALENDAR
VERSION:2.0
CALSCALE:GREGORIAN
PRODID:-//Tide In Calendar//GoldenHour//EN
METHOD:PUBLISH
X-WR-CALNAME:${calendarName}
X-WR-TIMEZONE:${timezone}
${events.join('\n')}
END:VCALENDAR`;
}
