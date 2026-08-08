const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');

let received = null;
ipcMain.on('capture:microphone-volume-set', (_event, percent) => {
  received = percent;
});

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'src', 'preload.js'),
      contextIsolation: true
    }
  });
  await window.loadURL('data:text/html,<input id="microphone-volume" type="range" min="0" max="200" value="100">');
  await window.webContents.executeJavaScript(`
    const slider = document.getElementById('microphone-volume');
    slider.value = '37';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  `);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(received, 37);
  console.log('Preload forwarded microphone slider input value 37 to the main process.');
  app.quit();
}).catch(error => {
  console.error(error);
  app.exit(1);
});
