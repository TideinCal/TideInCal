const canvas = document.getElementById('rippleCanvas');
const ctx = canvas.getContext('2d');
let width, height;

function resize() {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

const ripples = [];

document.addEventListener('click', createRipple);
document.addEventListener('touchstart', e => {
  const touch = e.touches[0];
  createRipple({ clientX: touch.clientX, clientY: touch.clientY });
});

function createRipple(e) {
  ripples.push({
    x: e.clientX,
    y: e.clientY,
    baseRadius: 0,
    opacity: 1
  });
}

function animate() {
  ctx.clearRect(0, 0, width, height);

  for (let i = 0; i < ripples.length; i++) {
    const r = ripples[i];
    const maxRings = 3;

    for (let j = 0; j < maxRings; j++) {
      const radius = r.baseRadius + j * 10;
      const fade = Math.max(0, r.opacity - j * 0.15);
      const lineWidth = 8 - j * 2.5;

      if (fade > 0 && lineWidth > 0) {
        ctx.beginPath();
        ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 255, 255, ${fade * 0.15})`;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
    }

    r.baseRadius += 1.0;
    r.opacity -= 0.01;

    if (r.opacity <= 0) {
      ripples.splice(i, 1);
      i--;
    }
  }

  requestAnimationFrame(animate);
}

animate();
