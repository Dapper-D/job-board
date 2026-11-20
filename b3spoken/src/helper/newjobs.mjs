// "New matches" pop-ups: after each refresh, B3spoken compares the jobs on the board with the ones it has already
// told the person about, and says so when there are new ones.
// The first check on a computer only remembers what is there (no pop-up for a board full of jobs nobody asked about).
// Jobs are remembered for 30 days, so a job that leaves the board and comes back is not announced twice.

const KEEP_DAYS = 30;

// jobs: the board's matches now. seen: the saved state ({ primed, ids: { id: ISO date first seen } }) or null.
// Returns { fresh: jobs not seen before (board order), state: the state to save }.
export function newMatches(jobs, seen, { now = Date.now() } = {}) {
  const at = new Date(now).toISOString();
  const cutoff = now - KEEP_DAYS * 864e5;
  const ids = {};
  for (const [id, when] of Object.entries(seen?.ids || {})) if (Date.parse(when) >= cutoff) ids[id] = when;
  const primed = !!seen?.primed;
  const fresh = [];
  for (const j of jobs || []) {
    if (!j?.id) continue;
    if (!ids[j.id]) {
      if (primed) fresh.push(j);
      ids[j.id] = at;
    }
  }
  return { fresh, state: { primed: true, checkedAt: at, ids } };
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

// The pop-up's words. Windows shows at most 63 characters of title and 255 of text.
export function popupText(fresh) {
  const n = fresh.length;
  const title = n === 1 ? '1 new job match on B3spoken' : `${n} new job matches on B3spoken`;
  const lines = fresh.slice(0, 3).map(j => clip(`${j.title} at ${j.company}`.replace(/\s+/g, ' ').trim(), 80));
  if (n > 3) lines.push(`and ${n - 3} more`);
  return { title: clip(title, 63), text: clip(`${lines.join('\n')}\nClick to open your job board.`, 255) };
}
