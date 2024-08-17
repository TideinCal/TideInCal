
const dfo_url = "https://api-iwls.dfo-mpo.gc.ca/api/v1/stations";
const noaa_2 = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/tidepredstations.json";


let year = new Date().getFullYear();
let months = new Date();
let month = months.toLocaleString('en-US', { month: 'short' }).toUpperCase();
let day = new Date().getDate();
let hours = new Date().getUTCHours();

//icons for map
const myIcon = L.icon({
  iconUrl: 'img/redPin.png',
  iconSize: [36, 59],
  iconAnchor: [22, 50],
  clickable: true,
  title: 'Current Location',
  zIndexOffset: 1000,
  riseOnHover: true,
  riseOffset: 500,
});
const tideIcon = L.icon({
  iconUrl: 'img/waterdrop.png',
  iconSize: [36, 59],
  iconAnchor: [22, 50],
  clickable: true,
  title: 'Current Location',
  zIndexOffset: 0,
  riseOffset: 250,
});

// Dynamically load the popup once a tide icon is Selected
const renderModalContent = (title, id, stationLocation, lat, long, type) => {
  localStorage.setItem("country", stationLocation);
  localStorage.setItem("stationTitle", title);
  localStorage.setItem("stationID", id);
  localStorage.setItem("latitude", lat);
  localStorage.setItem("longitude", long);

  return `<div class="card w-88">
            <div class="card-body">
              <h5 class="card-title">${title} Tide Station.</h5>
              <h6 class="card-text"> Select "Download" to get 1 Year Of Tide Data To Your Calendar from this station</h6>
              <p class="card-text">${type}</p>
              <a href="https://buy.stripe.com/test_00g6rIbmh8x08KY9AA" class="btn btn-outline-primary"  id="getYear">Download File</a>
            </div>
          </div>`;
}

//-- Call Canadian DFO to get all the tide stations --//
const getTides = async () => {
  //-- Add map to Modal
  let map = L.map('map').setView([49.26083, -123.11389], 9);
  L.tileLayer('https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token={accessToken}', {
    attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
    maxZoom: 18,
    id: 'mapbox/streets-v11',
    tileSize: 512,
    zoomOffset: -1,
    accessToken: 'pk.eyJ1Ijoiam5lbHNvbjMzIiwiYSI6ImNqODIxZGpsNjcycnYzMnFueGlkdWQ0a3IifQ.TF0Kw6EQM-dt6bc4EGKM6g'
  }).addTo(map);
  map.invalidateSize();

  let findUserLocation = () => {
    //-- Get && Set user location
    navigator.geolocation.getCurrentPosition((position) => {
      let latitude = position.coords.latitude;
      let longitude = position.coords.longitude;

      const userLocation = L.marker([latitude, longitude], {icon: myIcon}).addTo(map);
      userLocation.setLatLng([latitude, longitude]);
      userLocation.setZIndexOffset(50);
      map.panTo(new L.LatLng(latitude, longitude));
    });
  }

  document.getElementById('mapBtn').addEventListener("click", findUserLocation);
  const responseCA = await fetch(dfo_url);
  const responseUS = await fetch(noaa_2);

  const dataCA = await responseCA.json();
  const dataNOAA = await responseUS.json();
  const datatStationsNOAA = dataNOAA.stationList;

console.log(datatStationsNOAA);
//console.log(dataCA);
    //-- CANADA --loop through the API Data to find Information and add them to a ClusterGroup --//
  const stationMarkerCAGroup = L.markerClusterGroup();
  for (let i = 0; i < dataCA.length; i++) {
    const stationStatus = dataCA[i].type;
    let tideCodeMatch = false;

    // Check for timeSeries wlp-hilo
    for (let j = 0; j < 5; j++) {
      if (dataCA[i].timeSeries[j] && dataCA[i].timeSeries[j].code === 'wlp-hilo') {
        tideCodeMatch = true;
        break; // Stop the loop if a match is found
      }
    }

    // Find the status of stations returned for map placement
    if (stationStatus === "PERMANENT" && tideCodeMatch ) { //|| stationStatus === "TEMPORARY"
      //console.log(dataCA[i].officialName);
     // console.log(dataCA[i].type);
      const type = dataCA[i].type
      const stationID = dataCA[i].id;
      const stationName = dataCA[i].officialName;
      const lat = dataCA[i].latitude;
      const long = dataCA[i].longitude;
      const stationMarker = L.marker([lat, long], {icon: tideIcon});
      const location = 'canada';

      stationMarkerCAGroup.addLayer(stationMarker);

      // -- On clicking a Marker, Create a popup -- //
      stationMarker.on('click', function () {
        let content = renderModalContent(stationName, stationID, location, lat, long, type);
        let latlng = L.latLng(lat, long);
        let popup = L.popup()
          .setLatLng(latlng)
          .setContent(content)
          .openOn(map);
      });
      map.addLayer(stationMarkerCAGroup);
      map.invalidateSize();
    }
  }

  //-- USA --- Loop through the NOAA API Data to find Information and add them to a ClusterGroup --//
  const stationMarkerUSGroup = L.markerClusterGroup();
  for (let i = 0; i < datatStationsNOAA.length; i++) {
    const stationID = datatStationsNOAA[i].stationId;
    const stationName = datatStationsNOAA[i].name;
    const lat = datatStationsNOAA[i].lat;
    const long = datatStationsNOAA[i].lon;
    const stationMarker = L.marker([lat, long], {icon: tideIcon});
    const location = 'usa';
    stationMarkerUSGroup.addLayer(stationMarker);

    // -- On clicking a Marker, Create a pop up -- //
    stationMarker.on('click', function() {
      let content = renderModalContent(stationName, stationID, location,  lat, long);
      let latlng = L.latLng(lat, long);
      let popup = L.popup()
        .setLatLng(latlng)
        .setContent(content)
        .openOn(map);
    });
  }
  map.addLayer(stationMarkerUSGroup);
  map.invalidateSize();

}
getTides();



















//UK and AUS Urls
//const uk_url = "https://environment.data.gov.uk/flood-monitoring/id/stations?type=TideGauge";
//const aus_url ="http://www.bom.gov.au/australia/tides/tide_prediction_sites.json";

// -------- For UK Station Markers  ---------- //
// Put back in getTides()
//-- UK --- Loop through the UK API Data to find Information and add them to a ClusterGroup --//
// const stationMarkerUKGroup = L.markerClusterGroup();
// for (let i = 0; i < dataUkItems.length; i++) {
//
//   const stationID = dataUkItems[i].label;
//   const stationNotation = dataUkItems[i].notation;
//   const stationName = dataUkItems[i].label;
//   const lat = dataUkItems[i].lat;
//   const long = dataUkItems[i].long;
//   console.log(long);
//   console.log(lat);
//
//   const stationMarker = L.marker([lat, long], {icon: tideIcon});
//   const location = 'uk';
//   stationMarkerUKGroup.addLayer(stationMarker);
//
//   // -- On clicking a Marker, Create a pop up -- //
//  stationMarker.on('click', function() {
//       let content = renderModalContent(stationName, stationID, location,  lat, long);
//       let latlng = L.latLng(lat, long);
//       let popup = L.popup()
//         .setLatLng(latlng)
//         .setContent(content)
//         .openOn(map);
//     });
//   }
//   map.addLayer(stationMarkerUKGroup);
//   map.invalidateSize();

//-- Australia --- Loop through the Aus API Data to find Information and add them to a ClusterGroup --//
// const stationMarkerAusGroup = L.markerClusterGroup();
// for (let i = 0; i < dataAusItems.length; i++) {
//
//   const stationID = dataAusItems[i].label;
//   const stationNotation = dataAusItems[i].notation;
//   const stationName = dataAusItems[i].label;
//   const lat = dataAusItems[i].lat;
//   const long = dataAusItems[i].long;
//   console.log(long);
//   console.log(lat);
//
//   const stationMarker = L.marker([lat, long], {icon: tideIcon});
//   const location = 'uk';
//   stationMarkerAusGroup.addLayer(stationMarker);
//
//   // -- On clicking a Marker, Create a pop up -- //
//   stationMarker.on('click', function() {
//     let content = renderModalContent(stationName, stationID, location,  lat, long);
//     let latlng = L.latLng(lat, long);
//     let popup = L.popup()
//       .setLatLng(latlng)
//       .setContent(content)
//       .openOn(map);
//   });
// }
// map.addLayer(stationMarkerAusGroup);
// map.invalidateSize();





// -- When Modal closes, Refresh the map -- //
// $('.modal').on('hidden.bs.modal', function () {
//   location.reload();
// });
