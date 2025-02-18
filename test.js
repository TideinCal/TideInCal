import fetch from 'node-fetch';

const stationId = '5cebf1df3d0f4a073c4bbd1e';
const today = new Date();
const year = today.getFullYear();
const nextYear = year + 1;
const month2d = String(today.getMonth() + 1).padStart(2, '0');
const day2d = String(today.getDate()).padStart(2, '0');
const fromDate = `${year}-${month2d}-${day2d}`;
const toDate = `${nextYear}-${month2d}-${day2d}`;

const apiUrl = `https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/${stationId}/data?time-series-code=wlp-hilo&from=${fromDate}T00%3A00%3A00Z&to=${toDate}T00%3A00%3A00Z`;

async function testStation() {
  try {
    console.log(`Testing URL: ${apiUrl}`);
    const response = await fetch(apiUrl);
    console.log(`HTTP Status: ${response.status}`);
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Error fetching data for station:', errorData);
      return;
    }
    const data = await response.json();
    console.log('Fetched Data:', JSON.stringify(data, null, 2));
    console.log(apiUrl);
  } catch (error) {
    console.error('Unexpected error:', error.message);
  }
}


testStation();
