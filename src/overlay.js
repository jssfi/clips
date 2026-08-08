const toast = document.getElementById('toast');
const message = document.getElementById('message');

window.clipsOverlay.onShow(next => {
  toast.classList.remove('visible');
  toast.removeAttribute('data-kind');
  void toast.offsetWidth;
  message.textContent = next.message;
  toast.dataset.kind = next.kind;
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('visible')));
});

window.clipsOverlay.onHide(() => toast.classList.remove('visible'));
