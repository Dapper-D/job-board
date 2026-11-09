// All job sources B3spoken scans. Add a source by writing a module with the same shape and listing it here.
import greenhouse from './greenhouse.mjs';
import lever from './lever.mjs';
import ashby from './ashby.mjs';
import workday from './workday.mjs';
import smartrecruiters from './smartrecruiters.mjs';
import workable from './workable.mjs';
import jobbank from './jobbank.mjs';
import bamboohr from './bamboohr.mjs';
import breezy from './breezy.mjs';
import pinpoint from './pinpoint.mjs';
import teamtailor from './teamtailor.mjs';
import oraclecloud from './oraclecloud.mjs';
import phenom from './phenom.mjs';
import amazon from './amazon.mjs';
import google from './google.mjs';
import apple from './apple.mjs';
import rippling from './rippling.mjs';
import eightfold from './eightfold.mjs';
import jibe from './jibe.mjs';
import successfactors from './successfactors.mjs';
import taleo from './taleo.mjs';
import jobvite from './jobvite.mjs';
import remotive from './remotive.mjs';
import remoteok from './remoteok.mjs';
import jobicy from './jobicy.mjs';
import himalayas from './himalayas.mjs';

// Employer hiring systems first (they are the employer's own postings), then job sites (feed: true), then Job Bank (runs on each computer).
export const SOURCES = { greenhouse, lever, ashby, workday, smartrecruiters, workable, bamboohr, breezy, pinpoint, teamtailor, oraclecloud, phenom, eightfold, jibe, successfactors, taleo, jobvite, rippling, amazon, google, apple, remotive, remoteok, jobicy, himalayas, jobbank };

// Which hiring system does this careers link belong to? -> { source, target } or null
export function detect(url) {
  for (const s of Object.values(SOURCES)) {
    const target = s.fromUrl(url);
    if (target) return { source: s.id, target };
  }
  return null;
}
