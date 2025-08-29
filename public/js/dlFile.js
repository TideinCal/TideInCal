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

let country = localStorage.getItem("region");
let stationTitle = localStorage.getItem("stationTitle");
let stationID = localStorage.getItem("stationID");
let lat = localStorage.getItem("latitude");
let long = localStorage.getItem("longitude");
document.getElementById('stnName').textContent = stationTitle;



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
 /*Carousel for warning */
const tutorialImages = [
  'tut1.jpg',
  'tut2.jpg',
  'tut3.jpg',
  'tut4.jpg',
  'tut5.jpg',
  'tut6.jpg'
];

const totalSlides = tutorialImages.length;
let currentSlide = 1;

function updateCarousel() {
  const img = document.getElementById('carouselImage');
  const counter = document.getElementById('carouselCounter');
  img.src = `/img/tutorial/${tutorialImages[currentSlide - 1]}`;
  counter.textContent = `${currentSlide} / ${totalSlides}`;
}

function nextSlide() {
  currentSlide = currentSlide === totalSlides ? 1 : currentSlide + 1;
  updateCarousel();
}

function prevSlide() {
  currentSlide = currentSlide === 1 ? totalSlides : currentSlide - 1;
  updateCarousel();
}

setTimeout(() => {
  map.invalidateSize();
}, 200);

document.addEventListener('DOMContentLoaded', updateCarousel);


document.getElementById('iCalDlBtn').addEventListener('click', function () {
  timerStart();
});
//
// document.getElementById('gCalDlBtn').addEventListener('click', function () {
//   timerStart();
// });