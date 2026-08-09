function displayVersion(value) {
  const version = String(value || '');
  const nightly = /^(\d+)\.(\d+)\.\d+-nightly\.\d+\.([0-9a-f]+)$/i.exec(version);
  if (nightly) return `${nightly[1]}.${nightly[2]}-${nightly[3]}`;
  const stable = /^(\d+)\.(\d+)\.0$/.exec(version);
  return stable ? `${stable[1]}.${stable[2]}` : version;
}

module.exports = { displayVersion };
