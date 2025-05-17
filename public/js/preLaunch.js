const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('show');
      observer.unobserve(entry.target);
    }
  });
}, {
  threshold: 0.5 // wait until 50% of the element is in view
});

document.querySelectorAll('.fade-in-up').forEach((el, index) => {
  observer.observe(el);
  el.style.transitionDelay = `${index * 0.15}s`; // stagger by 150ms each
});
document.querySelectorAll('.fade-in-up').forEach((el, index) => {
  observer.observe(el);
  el.style.transitionDelay = `${index * 0.15}s`;
});
const buttons = document.getElementsByClassName('cta-button');
for (let i = 0; i < buttons.length; i++) {
  buttons[i].addEventListener('click', function () {
    window.open('https://app.tideincal.com', '_blank');
  });
}
