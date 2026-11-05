// All job sources B3spoken scans. Add a source by writing a module with the same shape and listing it here.
import greenhouse from './greenhouse.mjs';
import lever from './lever.mjs';
import ashby from './ashby.mjs';
import workday from './workday.mjs';
import smartrecruiters from './smartrecruiters.mjs';
import workable from './workable.mjs';
import jobbank from './jobbank.mjs';

export const SOURCES = { greenhouse, lever, ashby, workday, smartrecruiters, workable, jobbank };

// Which hiring system does this careers link belong to? -> { source, target } or null
export function detect(url) {
  for (const s of Object.values(SOURCES)) {
    const target = s.fromUrl(url);
    if (target) return { source: s.id, target };
  }
  return null;
}
