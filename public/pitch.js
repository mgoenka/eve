// Slide navigation for pitch.html (external file so the CSP needs no inline scripts).
const TOTAL = 5;
let cur = 0;
const slides = document.getElementById('slides');
const dotsBox = document.getElementById('dots');
for (let i = 0; i < TOTAL; i++) {
  const d = document.createElement('div');
  d.className = 'dot' + (i === 0 ? ' active' : '');
  d.onclick = () => go(i);
  dotsBox.appendChild(d);
}
function go(i) {
  cur = Math.max(0, Math.min(TOTAL - 1, i));
  slides.style.transform = `translateX(-${cur * 100}vw)`;
  [...dotsBox.children].forEach((d, idx) => d.classList.toggle('active', idx === cur));
}
document.getElementById('prevZone').onclick = () => go(cur - 1);
document.getElementById('nextZone').onclick = () => go(cur + 1);
window.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); go(cur + 1); }
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(cur - 1); }
  else if (e.key === 'Home') { go(0); }
  else if (e.key === 'End') { go(TOTAL - 1); }
});
