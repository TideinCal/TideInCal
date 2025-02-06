import fetch from 'node-fetch';
import fs from 'fs';
import pLimit from 'p-limit';

const apiUrls = {
  canada: 'https://api-iwls.dfo-mpo.gc.ca/api/v1/stations',
};

const outputFile = './data/validated_stations.json';
const limit = pLimit(5); // Adjust concurrency as needed
const maxRetries = 3;

async function fetchMetadata(region) {
  try {
    console.log(`Fetching metadata for ${region}...`);
    const response = await fetch(apiUrls[region]);
    if (!response.ok) {
      throw new Error(`Failed to fetch metadata: ${response.statusText}`);
    }
    const data = await response.json();
    return data.map((station) => ({
      id: station.id,
      name: station.officialName || 'Unnamed Station',
      lat: station.latitude,
      lon: station.longitude,
    }));
  } catch (error) {
    console.error(`Error fetching metadata for ${region}:`, error.message);
    return [];
  }
}

async function fetchOneYearData(station, attempt = 1) {
  const year = new Date().getFullYear();
  const nextYr = year + 1;
  const today = new Date();
  const month2d = String(today.getMonth() + 1).padStart(2, '0');
  const day2d = String(today.getDate()).padStart(2, '0');

  const url = `https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/${station.id}/data?time-series-code=wlp-hilo&from=${year}-${month2d}-${day2d}T00%3A00%3A00Z&to=${nextYr}-${month2d}-${day2d}T00%3A00%3A00Z`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        console.log(`Station ${station.name} (ID: ${station.id}) does not return data.`);
        return false;
      }
      if (response.status === 429 && attempt < maxRetries) {
        console.log(`Rate limit reached. Retrying station ${station.name} in 2 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        return await fetchOneYearData(station, attempt + 1);
      }
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    console.error(
      `Failed to fetch data for station ${station.name} (ID: ${station.id}): ${error.message}`
    );
    return false;
  }
}

async function validateStations(region) {
  const metadata = await fetchMetadata(region);
  const validatedStations = [];
  const failedStations = [];

  await Promise.all(
    metadata.map((station) =>
      limit(async () => {
        console.log(`Validating station: ${station.name} (${station.id})`);
        const isValid = await fetchOneYearData(station);
        if (isValid) {
          validatedStations.push(station);
        } else {
          failedStations.push(station);
        }
      })
    )
  );

  console.log(`Validation complete. Valid stations: ${validatedStations.length}`);
  console.log(`Failed stations: ${failedStations.length}`);
  fs.writeFileSync(outputFile, JSON.stringify(validatedStations, null, 2));
  console.log(`Validated stations saved to ${outputFile}`);
}

async function main() {
  await validateStations('canada');
}

main();
