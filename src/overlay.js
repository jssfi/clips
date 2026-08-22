const toast = document.getElementById('toast');
const message = document.getElementById('message');
const detail = document.getElementById('detail');
const impactCanvas = document.getElementById('impact');
const impactContext = impactCanvas.getContext('2d', { alpha: true, desynchronized: true });
const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

const impactColors = {
  recording: [255, 77, 79],
  'recording-stopped': [160, 171, 190],
  saved: [126, 226, 168],
  'clip-saved': [126, 226, 168],
  warning: [255, 184, 77],
  error: [255, 94, 99]
};

let impactFrame = null;
let impactGeneration = 0;

function clearImpact() {
  impactGeneration += 1;
  if (impactFrame !== null) cancelAnimationFrame(impactFrame);
  impactFrame = null;
  impactContext.clearRect(0, 0, impactCanvas.width, impactCanvas.height);
}

function prepareImpactCanvas() {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.round(impactCanvas.clientWidth * pixelRatio);
  const height = Math.round(impactCanvas.clientHeight * pixelRatio);
  if (impactCanvas.width !== width || impactCanvas.height !== height) {
    impactCanvas.width = width;
    impactCanvas.height = height;
  }
  impactContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  return pixelRatio;
}

function roundedRectDistance(x, y, rect, radius) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const offsetX = Math.abs(x - centerX) - (rect.width / 2 - radius);
  const offsetY = Math.abs(y - centerY) - (rect.height / 2 - radius);
  const outside = Math.hypot(Math.max(offsetX, 0), Math.max(offsetY, 0));
  return outside + Math.min(Math.max(offsetX, offsetY), 0) - radius;
}

function startImpact() {
  clearImpact();
  if (motionPreference.matches || !toast.classList.contains('visible')) return;

  const pixelRatio = prepareImpactCanvas();
  const canvasRect = impactCanvas.getBoundingClientRect();
  const kind = toast.dataset.kind;
  const color = impactColors[kind] || [210, 216, 226];
  const reverse = kind === 'recording-stopped';
  const startingColor = reverse ? impactColors.recording : color;
  const generation = impactGeneration;
  const startedAt = performance.now();
  const duration = 640;
  const spacing = 9;
  const maximumDistance = 132;

  function render(now) {
    if (generation !== impactGeneration) return;
    const elapsed = Math.min((now - startedAt) / duration, 1);
    const eased = 1 - Math.pow(1 - elapsed, 3);
    const front = (reverse ? 1 - eased : eased) * maximumDistance;
    const echoDirection = reverse ? 1 : -1;
    const fade = Math.pow(1 - elapsed, 0.72);
    const colorShift = reverse ? Math.min(Math.max((elapsed - 0.34) / 0.3, 0), 1) : 1;
    const frameColor = startingColor.map((channel, index) => Math.round(channel + (color[index] - channel) * colorShift));
    const toastRect = toast.getBoundingClientRect();
    const rect = {
      left: toastRect.left - canvasRect.left,
      top: toastRect.top - canvasRect.top,
      width: toastRect.width,
      height: toastRect.height
    };

    impactContext.clearRect(0, 0, impactCanvas.width / pixelRatio, impactCanvas.height / pixelRatio);
    impactContext.globalCompositeOperation = 'lighter';

    for (let y = spacing / 2; y < canvasRect.height; y += spacing) {
      // The toast arrived from above, so the landing force only escapes sideways and down.
      if (y < rect.top) continue;
      const rowOffset = Math.round(y / spacing) % 2 ? spacing / 2 : 0;
      for (let x = spacing / 2 + rowOffset; x < canvasRect.width; x += spacing) {
        const distance = roundedRectDistance(x, y, rect, 12);
        if (distance <= 0 || distance > maximumDistance + 16) continue;

        const primary = Math.exp(-Math.pow((distance - front) / 7.5, 2));
        const echo = Math.exp(-Math.pow((distance - (front + echoDirection * 24)) / 9.5, 2)) * 0.42;
        const afterEcho = Math.exp(-Math.pow((distance - (front + echoDirection * 44)) / 12, 2)) * 0.16;
        const wave = Math.min(primary + echo + afterEcho, 1);
        if (wave < 0.025) continue;

        const grain = 0.82 + 0.18 * Math.sin(x * 1.73 + y * 2.19);
        const alpha = wave * fade * grain * 0.82;
        const radius = 0.48 + wave * (2.05 - elapsed * 0.5);
        impactContext.fillStyle = `rgba(${frameColor[0]}, ${frameColor[1]}, ${frameColor[2]}, ${alpha})`;
        impactContext.beginPath();
        impactContext.arc(x, y, radius, 0, Math.PI * 2);
        impactContext.fill();
      }
    }

    impactContext.globalCompositeOperation = 'source-over';
    if (elapsed < 1) impactFrame = requestAnimationFrame(render);
    else clearImpact();
  }

  impactFrame = requestAnimationFrame(render);
}

function showToast(next) {
  clearImpact();
  toast.classList.remove('visible');
  toast.removeAttribute('data-kind');
  void toast.offsetWidth;
  message.textContent = next.message;
  detail.textContent = next.detail || '';
  detail.hidden = !next.detail;
  toast.dataset.kind = next.kind;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    toast.classList.add('visible');
    startImpact();
  }));
}

motionPreference.addEventListener('change', () => {
  if (motionPreference.matches) clearImpact();
});

if (window.clipsOverlay) {
  window.clipsOverlay.onShow(showToast);
  window.clipsOverlay.onHide(() => {
    clearImpact();
    toast.classList.remove('visible');
  });
}
