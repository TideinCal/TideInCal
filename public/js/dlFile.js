const tideIcon = L.icon({
  iconUrl: 'img/waterdrop.png',
  iconSize: [36, 59],
  iconAnchor: [22, 50],
  clickable: false,
  title: 'Desired Location',
  zIndexOffset: 0,
  riseOnHover: true,
  riseOffset: 250,
});

// Grab LocalStorage values
// let country = "canada";
// let stationTitle = "Nanaimo Harbour";
// let stationID = "5cebf1de3d0f4a073c4bb96d";
// let lat = 49.1628;
// let long = -123.9235;
let country = localStorage.getItem("region");
let stationTitle = localStorage.getItem("stationTitle");
let stationID = localStorage.getItem("stationID");
let lat = localStorage.getItem("latitude");
let long = localStorage.getItem("longitude");


let year = new Date().getFullYear();
let nextYr = year+1;
let months = new Date();
let month = months.toLocaleString('en-US', { month: 'short' }).toUpperCase();
let day = new Date().getDate();
let hours = new Date().getUTCHours();

// set ICS function to variable for ICE File creation


document.getElementById('stnName').innerHTML=`Your station is: <b>${stationTitle}</b>`;
document.getElementById('iDate').innerHTML=`${day}`;
document.getElementById('gDate').innerHTML=`${day}`;
document.getElementById('iMonth').innerHTML=`${month}`;
document.getElementById('gMonth').innerHTML=`${month}`;

// Create Leaflet Map

let map = L.map('map', {zoomControl: false}).setView([lat, long], 12);
L.tileLayer('https://api.mapbox.com/styles/v1/{id}/tiles/{z}/{x}/{y}?access_token={accessToken}', {
  attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, Imagery © <a href="https://www.mapbox.com/">Mapbox</a>',
  center: [lat, long],
  maxZoom: 18,
  id: 'mapbox/streets-v11',
  tileSize: 512,
  zoomOffset: -1,
  accessToken: 'pk.eyJ1Ijoiam5lbHNvbjMzIiwiYSI6ImNqODIxZGpsNjcycnYzMnFueGlkdWQ0a3IifQ.TF0Kw6EQM-dt6bc4EGKM6g'
}).addTo(map);

$(window).trigger('resize');
// Set the Tide Station to the new map
const userLocation = L.marker([lat, long], {icon: tideIcon}).addTo(map);
userLocation.setLatLng([lat, long]);
map.panTo(new L.LatLng(lat, long));
map.dragging.disable();
map.scrollWheelZoom.disable();

// Timer to get downloadable file
let timerStart = () => {
  $('#loadingModal').modal('show');

  let progressBar = $('.progress-bar');
  let progress = 0;
  const interval = 1000; // 1 second interval

  const timer = setInterval(function () {
    progress += (interval / 2000) * 100; // 30 seconds
    progressBar.css('width', progress + '%').attr('aria-valuenow', progress);

    if (progress >= 100) {
      clearInterval(timer);
      document.getElementById('getIt').classList.remove('d-none');

      // make the call to get the file.
      document.getElementById('getIt').addEventListener('click', function () {
        let isFeet = $('#feetCheck').is(":checked");

        console.log({
          stationID,
          stationTitle,
          country,
          feet: isFeet
        });

        fetch('/startDataFetch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            stationID,
            stationTitle,
            country,
            feet: isFeet,
          }),
        })
          .then(response => response.json())
          .then(({ message, fileUrl }) => {
            console.log('Data fetch initiated:', fileUrl);

            // Trigger the download of the ICS file
            window.location.href = fileUrl;
          })
          .catch(error => console.error('Error:', error));
      });
    }
  }, interval);
}


document.getElementById('iCalDlBtn').addEventListener('click', function () {
  timerStart();
});

document.getElementById('gCalDlBtn').addEventListener('click', function () {
  timerStart();
});






















// -- get 1 year of data
// const getYearData = async (id, stationTitle) => {
//
//
//   // make day and month 2 digits if below 10.
//   let  twoDigits = (monthOrDay) => { return (monthOrDay < 10 ? '0' : '') + monthOrDay;}
//   let month2d = twoDigits(months.getMonth()+1);
//   let day2d = twoDigits(day);
//
//   // ---   Write logic for differentiating API's  ---  //
//   if (country === 'canada') {
//     // Fetch 1 year of Canadian US, and UK Tidal Data
//     const dfo_year = `https://api-iwls.dfo-mpo.gc.ca/api/v1/stations/${id}/data?time-series-code=wlp-hilo&from=${year}-${month2d}-${day2d}T15%3A00%3A00Z&to=${nextYr}-${month2d}-${day2d}T00%3A00%3A00Z`;
//     const respYearDfo = await fetch(dfo_year);
//     console.log(respYearDfo);
//     const oneYearDfo = await respYearDfo.json();
//     console.log(oneYearDfo);
//
//
//     for (let i = 0; i < oneYearDfo.length -1; i++) {
//       let tide ="";
//
//       if(oneYearDfo[i].value > oneYearDfo[i + 1].value) {
//         tide = "High Tide";
//       } else {
//         tide = "Low Tide";
//       }
//
//       let tideHeight;
//       // check if Foot or radio button is checked.
//       if(document.getElementById('feetCheck').checked){
//         let tideInFeet = oneYearDfo[i].value * 3.2808399;
//         tideInFeet = parseFloat(tideInFeet).toFixed(2);
//         tideHeight = `${tideInFeet}Ft;`
//       }else {
//         tideHeight = `${oneYearDfo[i].value}M;`
//       }
//       console.log(stationTitle)
//       console.log(tideHeight);
//       console.log(oneYearDfo[i].eventDate);
//       console.log(tide);
//       console.log("-------------------------");
//
//       //cal.addEvent(`${tideHeight}`, `${tide}`, `${stationTitle}`, `${oneYearDfo[i].eventDate}`, `${oneYearDfo[i].eventDate}`);
//       console.log(`${tideHeight}`, `${tide}`, `${stationTitle}`, `${oneYearDfo[i].eventDate}`, `${oneYearDfo[i].eventDate}`);
//       /*cal.addEvent(event.title, event.description, null, event.start, event.end);*/
//     }
//
//   } else if ( country === 'usa') {
//
//     const noaa_year = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${year}${month2d}${day2d}&end_date=${nextYr}${month2d}${day2d}&station=${id}&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&units=english&application=DataAPI_Sample&format=json`;
//     const respYearNoaa = await fetch(noaa_year);
//     const oneYearUSA = await respYearNoaa.json();
//     const oneYearNoaa = oneYearUSA.predictions;
//     console.log(oneYearNoaa);
//
//     for (let i = 0; i < oneYearNoaa.length -1; i++){
//       let tide ="";
//       if(oneYearNoaa[i].type === "H") {
//         tide = "High Tide";
//       } else {
//         tide = "Low Tide";
//       }
//
//       let tideHeight;
//       // check if Foot or radio button is checked.
//       if(document.getElementById('feetCheck').checked){
//         let tideInFeet = oneYearNoaa[i].v * 3.2808399;
//         tideInFeet = parseFloat(tideInFeet).toFixed(2);
//         tideHeight = `${tideInFeet}Ft;`
//       }else {
//         tideHeight = `${oneYearNoaa[i].v}M;`
//       }
//       //cal.addEvent(`${tideHeight}`, `${tide}`, `${stationTitle}`, `${oneYearNoaa[i].t}`, `${oneYearNoaa[i].t}`);
//       console.log(`${tideHeight}, ${tide}, ${stationTitle}, ${oneYearNoaa[i].t}, ${oneYearNoaa[i].t}`);
//
//     }
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



