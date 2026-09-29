// Verifies that every artefact a release is supposed to ship is on disk.
//
// `.output` is a dot-directory and upload-artifact skips hidden files by
// default, which is how a release can end up publishing only the XPIs. Both
// workflows collect into `releases/` and then run this, so a missing browser
// target fails the job instead of shipping a partial release.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.argv[2] ?? 'releases';

const EXPECTED = [
  { label: 'Chrome MV3 zip', test: (n) => n.endsWith('-chrome.zip') },
  { label: 'Firefox zip', test: (n) => n.endsWith('-firefox.zip') },
  { label: 'Firefox sources zip (AMO)', test: (n) => n.endsWith('-sources.zip') },
  { label: 'Firefox XPI', test: (n) => n.endsWith('.xpi') },
];

let present;
try {
  present = readdirSync(DIR).filter((name) => {
    try {
      return statSync(join(DIR, name)).isFile();
    } catch {
      return false;
    }
  });
} catch (error) {
  console.error(`Cannot read ${DIR}/: ${error.message}`);
  process.exit(1);
}

if (present.length === 0) {
  console.error(`${DIR}/ is empty; nothing was packaged.`);
  process.exit(1);
}

console.log(`Artefacts in ${DIR}/:`);
for (const name of present.sort()) {
  const size = statSync(join(DIR, name)).size;
  console.log(`  ${name}  (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

const missing = EXPECTED.filter((kind) => !present.some((name) => kind.test(name)));
for (const kind of missing) {
  console.error(`Missing artefact: ${kind.label}`);
}

// A zero-byte artefact is a build that failed quietly.
const empty = present.filter((name) => statSync(join(DIR, name)).size === 0);
for (const name of empty) {
  console.error(`Empty artefact: ${name}`);
}

if (missing.length > 0 || empty.length > 0) {
  process.exit(1);
}

console.log(`All ${EXPECTED.length} artefact kinds present.`);
