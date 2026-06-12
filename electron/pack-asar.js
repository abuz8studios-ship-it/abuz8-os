// Repack a source folder into an app.asar using electron's asar packer.
const asar = require('@electron/asar');
const src = process.argv[2];
const dest = process.argv[3];
asar.createPackage(src, dest)
  .then(() => console.log('PACKED -> ' + dest))
  .catch((e) => { console.error('PACK ERR ' + e.message); process.exit(1); });
