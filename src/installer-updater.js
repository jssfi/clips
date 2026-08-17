function createInstallerUpdater({ feedUrl, onState, updater }) {
  const activeUpdater = updater || require('electron-updater').autoUpdater;
  const listeners = {
    'checking-for-update': () => onState({ status: 'checking', message: '' }),
    'update-available': info => onState({ status: 'downloading', version: info.version, percent: 0, message: '' }),
    'download-progress': progress => onState({ status: 'downloading', percent: Math.round(progress.percent || 0) }),
    'update-downloaded': info => onState({ status: 'ready', version: info.version, percent: 100, message: 'Restart to update' }),
    'update-not-available': info => onState({ status: 'idle', version: info?.version, percent: 0, message: '' }),
    error: error => onState({ status: 'error', percent: 0, message: error?.message || String(error) })
  };

  activeUpdater.autoDownload = true;
  activeUpdater.autoInstallOnAppQuit = true;
  activeUpdater.setFeedURL({ provider: 'generic', url: feedUrl });
  for (const [event, listener] of Object.entries(listeners)) activeUpdater.on(event, listener);

  return {
    check() { return activeUpdater.checkForUpdates().catch(() => {}); },
    async restart(beforeQuit) {
      if (beforeQuit) await beforeQuit();
      activeUpdater.quitAndInstall(true, true);
      return true;
    },
    dispose() {
      for (const [event, listener] of Object.entries(listeners)) activeUpdater.removeListener(event, listener);
    }
  };
}

module.exports = { createInstallerUpdater };
