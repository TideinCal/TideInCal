const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('show');
      observer.unobserve(entry.target);
    }
  });
}, {
  threshold: 0.3 // wait until 30% of the element is in view
});

document.querySelectorAll('.fade-in-up').forEach((el, index) => {
  observer.observe(el);
  el.style.transitionDelay = `${index * 0.15}s`; // stagger by 150ms each
});
document.querySelectorAll('.fade-in-up').forEach((el, index) => {
  observer.observe(el);
  el.style.transitionDelay = `${index * 0.15}s`;
});

