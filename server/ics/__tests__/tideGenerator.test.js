import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fetch from 'node-fetch';
import { generateICS } from '../index.js';

vi.mock('node-fetch', () => ({
  default: vi.fn()
}));

function parseEvents(ics) {
  return ics
    .split('BEGIN:VEVENT\n')
    .slice(1)
    .map((event) => Object.fromEntries(
      event
        .split('\n')
        .filter((line) => line.includes(':'))
        .map((line) => {
          const separator = line.indexOf(':');
          return [line.slice(0, separator), line.slice(separator + 1)];
        })
    ));
}

function mockResponse(data) {
  fetch.mockResolvedValue({
    ok: true,
    json: async () => data
  });
}

describe('generateICS tide timestamps', () => {
  const originalTimezone = process.env.TZ;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-08T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
    vi.clearAllMocks();
  });

  it('uses NOAA GMT instants and keeps DST and near-midnight tides in the local date', async () => {
    mockResponse({
      predictions: [
        { t: '2026-03-08 05:59', type: 'H', v: '1.0' },
        { t: '2026-03-08 06:30', type: 'L', v: '2.0' },
        { t: '2026-03-08 08:30', type: 'H', v: '3.0' },
        { t: '2026-03-09 04:59', type: 'L', v: '4.0' },
        { t: '2026-03-09 05:00', type: 'H', v: '5.0' }
      ]
    });

    const ics = await generateICS({
      id: '8729511',
      title: 'East Pass',
      country: 'usa',
      userTimezone: 'America/Los_Angeles',
      stationTimezone: 'America/Chicago',
      startDate: new Date('2026-03-08T12:00:00Z'),
      endDate: new Date('2026-03-08T18:00:00Z')
    });
    const events = parseEvents(ics);

    expect(events.map((event) => event.DTSTART)).toEqual([
      '20260308T063000Z',
      '20260308T083000Z',
      '20260309T045900Z'
    ]);
    expect(events.every((event) => event.DTSTAMP.endsWith('Z') && event.DTEND.endsWith('Z'))).toBe(true);

    const requestUrl = fetch.mock.calls[0][0];
    expect(requestUrl).toContain('time_zone=gmt');
    expect(requestUrl).toContain('begin_date=20260307');
    expect(requestUrl).toContain('end_date=20260310');
  });

  it('keeps Canadian ISO instants absolute and filters the expanded UTC response window', async () => {
    mockResponse([
      { eventDate: '2026-11-01T03:59:00.000Z', value: '1.0' },
      { eventDate: '2026-11-01T04:30:00.000Z', value: '2.0' },
      { eventDate: '2026-11-02T04:59:00.000Z', value: '3.0' },
      { eventDate: '2026-11-02T05:00:00.000Z', value: '4.0' }
    ]);

    const ics = await generateICS({
      id: 'CAN-1',
      title: 'Canadian Station',
      country: 'canada',
      userTimezone: 'UTC',
      stationTimezone: 'America/New_York',
      startDate: new Date('2026-11-01T12:00:00Z'),
      endDate: new Date('2026-11-01T18:00:00Z')
    });
    const events = parseEvents(ics);

    expect(events.map((event) => event.DTSTART)).toEqual([
      '20261101T043000Z',
      '20261102T045900Z'
    ]);
    expect(events.every((event) => event.DTSTART.endsWith('Z') && event.DTEND.endsWith('Z'))).toBe(true);
    expect(fetch.mock.calls[0][0]).toContain('from=2026-10-31T04%3A00%3A00.000Z');
    expect(fetch.mock.calls[0][0]).toContain('to=2026-11-03T05%3A00%3A00.000Z');
  });

  it('requests adjacent UTC dates for a positive-offset station date', async () => {
    mockResponse({
      predictions: [
        { t: '2026-12-31 15:30', type: 'H', v: '1.0' },
        { t: '2027-01-01 14:30', type: 'L', v: '2.0' },
        { t: '2027-01-01 15:00', type: 'H', v: '3.0' }
      ]
    });

    const ics = await generateICS({
      id: 'POSITIVE-OFFSET',
      title: 'Positive Offset Station',
      country: 'usa',
      userTimezone: 'UTC',
      stationTimezone: 'Asia/Tokyo',
      startDate: new Date('2027-01-01T12:00:00Z'),
      endDate: new Date('2027-01-01T13:00:00Z')
    });

    expect(parseEvents(ics).map((event) => event.DTSTART)).toEqual([
      '20261231T153000Z',
      '20270101T143000Z'
    ]);
    expect(fetch.mock.calls[0][0]).toContain('begin_date=20261230');
    expect(fetch.mock.calls[0][0]).toContain('end_date=20270102');
  });

  it('customer-evidence regression (not NOAA-verified): East Pass 2025-06-19 18:43 Chicago is 23:43Z', async () => {
    mockResponse({
      // Reported customer evidence: 2025-06-19 18:43 America/Chicago.
      predictions: [
        { t: '2025-06-19 23:43', type: 'H', v: '1.0' }
      ]
    });

    const ics = await generateICS({
      id: '8729511',
      title: 'East Pass',
      country: 'usa',
      userTimezone: 'UTC',
      stationTimezone: 'America/Chicago',
      startDate: new Date('2025-06-19T12:00:00Z'),
      endDate: new Date('2025-06-19T13:00:00Z')
    });

    expect(parseEvents(ics).map((event) => event.DTSTART)).toEqual([
      '20250619T234300Z'
    ]);
  });

  it('produces the same tide output regardless of the Node process timezone', async () => {
    const response = {
      predictions: [
        { t: '2026-03-08 06:30', type: 'L', v: '2.0' }
      ]
    };
    mockResponse(response);
    process.env.TZ = 'UTC';
    const utcOutput = await generateICS({
      id: '8729511',
      title: 'East Pass',
      country: 'usa',
      userTimezone: 'America/Los_Angeles',
      stationTimezone: 'America/Chicago',
      startDate: new Date('2026-03-08T12:00:00Z'),
      endDate: new Date('2026-03-08T18:00:00Z')
    });

    mockResponse(response);
    process.env.TZ = 'America/Los_Angeles';
    const pacificOutput = await generateICS({
      id: '8729511',
      title: 'East Pass',
      country: 'usa',
      userTimezone: 'America/Los_Angeles',
      stationTimezone: 'America/Chicago',
      startDate: new Date('2026-03-08T12:00:00Z'),
      endDate: new Date('2026-03-08T18:00:00Z')
    });

    expect(pacificOutput).toBe(utcOutput);
  });
});
