// The public build must stay the public build.
//
// The private branch (private-job-city-address) is the same app with a different identity: its own data folder,
// port 4748, its own installer, -private release tags, pre-releases only, and an address feature that puts the
// job's city on the resume. PR #23 merged that branch into main, which quietly turned the public app into the
// private one for everybody who downloads it. This check runs on every pull request into main, and on main
// itself, so that can't happen again without someone being told.
//
// Run by .github/workflows/public-build.yml. Nothing here is private-branch-specific knowledge: it asserts what
// the PUBLIC build is, and names what it found instead.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(root, p), "utf8");

// [file, must be there, must NOT be there, what it means]
const RULES = [
  ["b3spoken/src/helper/paths.mjs", /'B3spoken'/, /B3spoken-Private|b3spoken-private/i,
    "the data folder people's resumes and tracker live in"],
  ["b3spoken/src/helper/main.mjs", /\|\| 4747/, /\|\| 4748/,
    "the port the board opens on"],
  ["b3spoken/installer/b3spoken.iss", /^AppName=B3spoken$/m, /\(Private\)|B3spoken-Private/,
    "what the installer calls the app and where it puts it"],
  ["b3spoken/installer/b3spoken.iss", /^OutputBaseFilename=B3spoken-Setup-/m, null,
    "the installer's file name"],
  ["b3spoken/src/helper/updater.mjs", /\^b3spoken-v\\d\+\\\.\\d\+\\\.\\d\+\$/, /-private/,
    "the release tags the app updates itself from"],
  [".github/workflows/b3spoken-release.yml", /--latest\b/, /--prerelease/,
    "how a release is published"],
  ["b3spoken/src/helper/tailor/tailor.mjs", null, /addressFor/,
    "the job-city address, which is a private-build feature"],
  ["b3spoken/src/helper/places.mjs", null, /export function (jobCity|addressFor|employerCities|cityForJob)/,
    "the job-city address helpers, which are private-build only"],
];

const problems = [];
for (const [file, must, mustNot, what] of RULES) {
  let text;
  try {
    text = read(file);
  } catch {
    problems.push(`${file} is missing, so ${what} can't be checked`);
    continue;
  }
  if (mustNot && mustNot.test(text))
    problems.push(`${file}: this is the private build's version of ${what} (found "${mustNot.exec(text)[0]}")`);
  else if (must && !must.test(text))
    problems.push(`${file}: ${what} is not the public build's (nothing matching ${must})`);
}

if (!problems.length) {
  console.log("OK this is the public build");
  process.exit(0);
}
console.error("This branch carries the private build's identity:\n");
for (const p of problems) console.error(`  - ${p}`);
console.error(`
The private branch is never merged into main: it is the same app with its own
folder, port, installer and release tags, and merging it hands every public
download the private build. Put the private work on private-job-city-address
and cherry-pick shared fixes the other way (main -> private) instead.`);
process.exit(1);
