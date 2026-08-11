const toast = document.getElementById('toast');
const message = document.getElementById('message');
const detail = document.getElementById('detail');

window.clipsOverlay.onShow(next => {
  toast.classList.remove('visible');
  toast.removeAttribute('data-kind');
  void toast.offsetWidth;
  message.textContent = next.message;
  detail.textContent = next.detail || '';
  detail.hidden = !next.detail;
  toast.dataset.kind = next.kind;
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('visible')));
});

window.clipsOverlay.onHide(() => toast.classList.remove('visible'));
