// The person's tracker: status, notes and a follow-up date per job. Saved only on their computer (tracker.json).
export const STATUSES = ['saved', 'applied', 'interview', 'offer', 'rejected', 'not-interested'];

export function cleanEntry(e = {}, prev = {}) {
  const status = STATUSES.includes(e.status) ? e.status : e.status === '' ? '' : prev.status || '';
  const notes = e.notes != null ? String(e.notes).replace(/\u0000/g, '').slice(0, 5000) : prev.notes || '';
  const followUp = e.followUp === '' ? '' : /^\d{4}-\d{2}-\d{2}$/.test(e.followUp || '') ? e.followUp : prev.followUp || '';
  const out = { status, notes, followUp, updatedAt: new Date().toISOString() };
  if (status === 'applied' && prev.status !== 'applied') {
    out.appliedAt = out.updatedAt;
    if (!out.followUp) out.followUp = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10); // a nudge a week later
  } else if (prev.appliedAt) out.appliedAt = prev.appliedAt;
  return out;
}

export const dueToday = (entry, today = new Date().toISOString().slice(0, 10)) =>
  !!entry?.followUp && entry.followUp <= today && !['rejected', 'not-interested', 'offer'].includes(entry.status);
