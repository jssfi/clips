const { Menu, nativeImage, Tray } = require('electron');
const { trayIconPng } = require('./tray-icon');

function createTrayController({ getWindow }) {
  let tray = null;
  const icon = (recording, size) => nativeImage.createFromBuffer(trayIconPng(recording, size));

  function showWindow() {
    const window = getWindow();
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  function update(recording) {
    if (tray && !tray.isDestroyed()) {
      tray.setImage(icon(recording));
      tray.setToolTip(recording ? 'jss/clips — Recording' : 'jss/clips');
    }
    const window = getWindow();
    if (window && !window.isDestroyed()) window.setIcon(icon(recording, 256));
  }

  function create({ openPreferredUi, saveClip, quit }) {
    tray = new Tray(icon(false));
    tray.setToolTip('jss/clips');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open jss/clips', click: openPreferredUi },
      { label: 'Open desktop window', click: showWindow },
      { label: 'Save clip', click: saveClip },
      { type: 'separator' },
      { label: 'Quit', click: quit }
    ]));
    tray.on('double-click', openPreferredUi);
  }

  return { create, showWindow, update };
}

module.exports = { createTrayController };
