# Moon Phases Calendar Specification
Project: TideInCal
Feature: Lunar Calendar
Component: ICS Calendar Generator

## Objective

Implement a Moon Phases calendar generator that produces a separate ICS calendar containing a daily lunar phase event for every day in the user's entitled date range.

The Moon Phases calendar must be generated separately from tide station calendars so lunar events are not duplicated when users subscribe to multiple locations.

The lunar calendar will be available:

• automatically for Pro users
• optionally as a standalone add on purchase

---

## Scope

This feature must only implement:

• daily lunar phase detection
• daily moon illumination percentage
• lunar calendar generation
• richer descriptions for major moon phases
• lunar eclipse handling
• entitlement based calendar range
• download range enforcement based on remaining entitlement

This task must not modify existing tide calendar generation logic.

---

## Calendar Architecture

Moon phases must be delivered as a separate ICS calendar.

Example structure:

Tide calendars per location

victoria-tides.ics
tofino-tides.ics

Moon calendar

moon-phases-2026.ics

Moon phases must not be embedded inside tide calendars.

This prevents duplicate moon events when users subscribe to multiple tide stations.

---

## Calendar Behavior

The lunar calendar must contain one all day event for every day in the generated range.

This means the calendar should always show the moon phase for that day and the moon illumination percentage, so the moon feels present and useful inside the user's calendar.

Examples of daily event summaries:

🌑 New Moon
🌒 Waxing Crescent @ 23.8%
🌓 First Quarter
🌔 Waxing Gibbous @ 74.1%
🌕 Full Moon
🌖 Waning Gibbous @ 66.2%
🌗 Last Quarter
🌘 Waning Crescent @ 18.4%

This calendar is intended to answer:

• what phase is the moon in today
• what phase will it be this weekend
• when are the major lunar events approaching

---

## Daily Lunar Phases

The system must generate one event per day using the correct daily lunar phase.

Supported daily phases:

🌑 New Moon
🌒 Waxing Crescent
🌓 First Quarter
🌔 Waxing Gibbous
🌕 Full Moon
🌖 Waning Gibbous
🌗 Last Quarter
🌘 Waning Crescent

These phase labels should be used consistently.

---

## Event Titles

Each daily event summary must use the emoji and phase label together.

For non major phases, include the illumination percentage in the summary.

Examples:

🌒 Waxing Crescent @ 23.8%
🌔 Waxing Gibbous @ 74.1%
🌖 Waning Gibbous @ 66.2%
🌘 Waning Crescent @ 18.4%

For the four major phases, do not include a percentage in the summary.

Examples:

🌑 New Moon
🌓 First Quarter
🌕 Full Moon
🌗 Last Quarter

This makes the calendar easy to scan visually while still giving daily usefulness.

---

## Event Description Rules

Each event must include a description.

### Standard Daily Description

For regular daily moon phases, use this format:

Lunar phase: Waxing Crescent
Illumination: 23.8%

The phase name and illumination percentage must match the correct daily phase.

Examples:

Lunar phase: Waning Gibbous
Illumination: 66.2%

Lunar phase: Waxing Gibbous
Illumination: 74.1%

---

## Special Descriptions For Major Lunar Events

For the four major lunar phases, the description should be richer.

### New Moon

Lunar phase: New Moon
Illumination: 0%
Tidal ranges are often stronger near full and new moons.

### First Quarter

Lunar phase: First Quarter
Illumination: 50%
Tidal ranges are often more moderate near quarter moons.

### Full Moon

Lunar phase: Full Moon
Illumination: 100%
Tidal ranges are often stronger near full and new moons.

### Last Quarter

Lunar phase: Last Quarter
Illumination: 50%
Tidal ranges are often more moderate near quarter moons.

These richer descriptions make the major lunar events feel more meaningful while still keeping the daily calendar useful.

---

## Eclipse Handling

If a lunar eclipse occurs on a day within the generated range, do not create a separate eclipse event.

Instead, append eclipse information to that day's lunar event description.

Only lunar eclipses should be included in this feature.

Do not include solar eclipses in the lunar calendar at this stage.

Use a reliable astronomy source or library to detect lunar eclipse dates and types.

Supported eclipse labels:

• Penumbral Lunar Eclipse
• Partial Lunar Eclipse
• Total Lunar Eclipse

Example eclipse enhanced description:

Lunar phase: Full Moon
Illumination: 100%
Tidal ranges are often stronger near full and new moons.
Also: Total Lunar Eclipse occurs today.
Visibility depends on location and local weather.

This keeps the calendar clean and avoids multiple moon events on the same day.

---

## Event Format

Moon phase events must be all day events.

ICS format:

DTSTART;VALUE=DATE:YYYYMMDD
DTEND;VALUE=DATE:YYYYMMDD

Important rule:

DTEND must be the following day according to the ICS specification.

Example:

DTSTART;VALUE=DATE:20260423
DTEND;VALUE=DATE:20260424

No timezone must be included.

This ensures the event appears correctly as an all day event in the user's local calendar.

---

## VCALENDAR Format

The generated file must be a valid ICS calendar with a complete VCALENDAR wrapper.

Required calendar level fields:

BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//TideInCal//MoonPhases//EN
CALSCALE:GREGORIAN
X-WR-CALNAME:Moon Phases
END:VCALENDAR

The file must contain one VEVENT for each day in the generated range.

---

## VEVENT Requirements

Each VEVENT must include:

• SUMMARY
• DTSTART
• DTEND
• DESCRIPTION
• UID
• DTSTAMP

UID must be stable and unique per event.

DTSTAMP must be included in UTC format.

Example:

UID:moon-20260423@tideincal.com
DTSTAMP:20260313T120000Z

---

## Example Events

### Example Standard Daily Event

BEGIN:VEVENT
UID:moon-20260420@tideincal.com
DTSTAMP:20260313T120000Z
SUMMARY:🌒 Waxing Crescent @ 23.8%
DTSTART;VALUE=DATE:20260420
DTEND;VALUE=DATE:20260421
DESCRIPTION:Lunar phase: Waxing Crescent\nIllumination: 23.8%
END:VEVENT

### Example Full Moon Event

BEGIN:VEVENT
UID:moon-20260423@tideincal.com
DTSTAMP:20260313T120000Z
SUMMARY:🌕 Full Moon
DTSTART;VALUE=DATE:20260423
DTEND;VALUE=DATE:20260424
DESCRIPTION:Lunar phase: Full Moon\nIllumination: 100%\nTidal ranges are often stronger near full and new moons.
END:VEVENT

### Example Full Moon Event With Lunar Eclipse

BEGIN:VEVENT
UID:moon-20260423@tideincal.com
DTSTAMP:20260313T120000Z
SUMMARY:🌕 Full Moon
DTSTART;VALUE=DATE:20260423
DTEND;VALUE=DATE:20260424
DESCRIPTION:Lunar phase: Full Moon\nIllumination: 100%\nTidal ranges are often stronger near full and new moons.\nAlso: Total Lunar Eclipse occurs today.\nVisibility depends on location and local weather.
END:VEVENT

---

## Lunar Calculation Consistency

Daily phase and illumination must be calculated using a consistent evaluation time for each day.

Use one consistent time reference for all calculations, such as noon UTC or another fixed daily calculation point.

Do not vary the calculation time from one day to the next.

---

## Calendar Generation Inputs

The lunar calendar generator must accept:

startDate
endDate

Example conceptual generator:

generateMoonCalendar(startDate, endDate)

The generator must create one daily event for each day in the generated range.

---

## Entitlement Rules

Moon calendar generation depends on how the user obtained access.

### Pro Users

Moon phases are included with Pro.

The calendar that is generated must only cover the user's remaining active Pro period at the moment of download.

Generation range:

startDate = today
endDate = subscriptionRenewalDate

The calendar must end exactly on the user's Pro renewal date.

A user must not be able to generate moon events beyond the end of their current active Pro period.

Example:

If a Pro user downloads the lunar calendar on the last day of their subscription, the generated file must only include that last entitled day.
It must not generate another full year of moon events.

### Standalone Moon Purchase

If a user purchases the lunar calendar separately:

entitlementStartDate = originalPurchaseDate
entitlementEndDate = same calendar date one year later

Example:

originalPurchaseDate = 2026-05-01
entitlementEndDate = 2027-05-01

Users may regenerate the calendar during this entitlement period.

However, the generated file must never extend past the standalone entitlement end date.

The end date must remain fixed.

If the user purchases again, a new entitlement period begins.

### Effective Generation Rule

At the time of download, the system must generate the lunar calendar only for the user's currently remaining entitled window.

Use this rule:

effectiveStartDate = today
effectiveEndDate = current entitlement end date

This applies to both Pro and standalone lunar access.

This prevents a user from downloading a new calendar near the end of their entitlement period that extends beyond their actual paid access.

---

## Date Boundary Rules

When determining the lunar calendar entitlement window, use a true calendar year boundary rather than a fixed 365 day offset.

For standalone lunar purchases:

• entitlementStartDate = original purchase date
• entitlementEndDate = the same calendar date one year later

Example:

• purchase date: 2026-05-01
• entitlement end date: 2027-05-01

Do not calculate the entitlement period using a hardcoded 365 day offset.

Use calendar aware year addition so leap years and month boundaries are handled correctly.

The entitlement end date is inclusive for access checks and generation logic.

A lunar event that occurs on the entitlement end date must be included in the generated calendar if that date is still within the user's remaining entitlement window at the time of download.

---

## Calendar File Behavior

A single ICS file must be generated for the full generated range.

If the generated range spans more than one calendar year, do not split the output into multiple files.

Example:

startDate = 2026-12-20
endDate = 2027-01-10

Output:

moon-phases-2026.ics

This single file must contain all entitled lunar events from 2026-12-20 through 2027-01-10.

The filename year must always use the year of the calendar start date.

---

## Calendar Generation Behavior

Users may generate the lunar calendar multiple times.

However, the generated file must always respect the user's remaining entitlement window at the time of download.

Examples:

### Pro Example

today = 2026-05-01
subscriptionRenewalDate = 2027-05-01

Generated range:

2026-05-01 → 2027-05-01

### Pro Last Day Example

today = 2027-05-01
subscriptionRenewalDate = 2027-05-01

Generated range:

2027-05-01 → 2027-05-01

This must not generate events beyond 2027-05-01.

### Standalone Example

today = 2026-11-10
originalPurchaseDate = 2026-05-01
entitlementEndDate = 2027-05-01

Generated range:

2026-11-10 → 2027-05-01

This must not generate events before today and must not generate events beyond 2027-05-01.

---

## File Naming

The file name must contain the words moon-phases and the year of the generated range start date.

Required format:

moon-phases-${year}.ics

Example:

moon-phases-2026.ics

---

## Constraints

The implementation must ensure:

• moon phases are generated in a separate ICS file
• one lunar event is generated for every day in the generated range
• non major phases include illumination percentage in the summary
• all events include illumination percentage in the description
• major moon phases use the richer descriptions defined above
• lunar eclipses are appended to the daily event description rather than created as separate events
• solar eclipses are not included in this feature
• the generated range never extends beyond the user's current entitlement end date
• a user downloading on the last day of access cannot generate moon phases beyond that last entitled day
• the calendar respects entitlement dates
• no duplicate moon events appear

The implementation must not modify tide station calendar logic.

---

## Expected Result

Users with lunar access will be able to download a file named in this format:

moon-phases-${year}.ics

This calendar will contain one all day lunar event for every day in the generated range.

The calendar will always show the moon phase for that day. Major lunar events such as New Moon and Full Moon will include richer tidal context in the description. If a lunar eclipse occurs within the generated range, eclipse information will be appended to that day's lunar event description.

The generated calendar must never include dates beyond the user's current paid access period.