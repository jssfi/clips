const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'src', 'build-info.json');
const buildInfo = {
  buildTime: new Date().toISOString()
};

fs.writeFileSync(target, `${JSON.stringify(buildInfo, null, 2)}\n`);
console.log(`Build time: ${buildInfo.buildTime}`);
