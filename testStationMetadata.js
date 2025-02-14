import fetch from 'sync-fetch';
import fs from 'fs'; //fileSaver

const inputFile = './data/validated_stations.json';
const inputFileFailed = './data/failed_stations.json';
const maxRetries = 3;

function sleep(ms){
  return new Promise(resolve => setTimeout(resolve, ms));
}


function fetchData(stationId){
    const metadataUrl = `https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/${stationId}/metadata`;
    try {
        const response = fetch(metadataUrl);
        const data = response.json();
        sleep(100);
        return data;
    } catch (error){
        console.error(`Error fetching data for ID ${stationId}: `, error.message);
    }
}

function checkIsTidal(filePath){
    let processed = 0;
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        const jsonArray = JSON.parse(data);
        
        let tidalCount = 0;
        
        for (const item of jsonArray) {
            processed += 1;
            if (item.id) {
                const apiData = fetchData(item.id);
                if (apiData && apiData.isTidal) {
                    tidalCount++;
                }
            }
            if (processed % 25 == 0) console.log(`processing... ${processed} processed`);
        }
        
        console.log(`Total count of items with 'isTidal': ${tidalCount}`);
    } catch (error) {
        console.error('Error processing JSON file:', error.message);
    }
}
console.log("total failed that is tidal");
checkIsTidal('./data/failed_stations.json');
console.log("total validated that is tidal: ");
checkIsTidal('./data/validated_stations.json');
