// The person's answers from onboarding. Saved only on their computer (profile.json).
// The search keywords (roles) are the only part that ever leaves it, and only as plain job titles.
import { PROVINCES } from './jobs.mjs';

const AUTH = ['citizen', 'permanent-resident', 'open-work-permit', 'employer-permit', 'study-permit', 'needs-sponsorship'];
const str = (v, max = 120) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
const list = (v, max = 20, len = 80) => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(',')).map(x => str(x, len)).filter(Boolean))].slice(0, max);
const money = v => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 && n < 10_000_000 ? Math.round(n * 100) / 100 : null; };

export function cleanProfile(p = {}) {
  const unit = u => (u === 'hour' ? 'hour' : 'year');
  return {
    targetRoles: list(p.targetRoles, 8),
    extraRoles: list(p.extraRoles, 12),
    // Floor and goal each have their own unit, e.g. at least $35 an hour, aiming for $100,000 a year.
    payFloor: money(p.payFloor), payFloorUnit: unit(p.payFloorUnit), payGoal: money(p.payGoal), payGoalUnit: unit(p.payGoalUnit),
    province: PROVINCES.includes(p.province) ? p.province : '',
    cities: list(p.cities, 10, 60),
    remote: ['yes', 'no', 'only'].includes(p.remote) ? p.remote : 'yes',
    workAuth: AUTH.includes(p.workAuth) ? p.workAuth : '',
    startDate: /^\d{4}-\d{2}-\d{2}$/.test(p.startDate || '') ? p.startDate : '',
    missingSkills: list(p.missingSkills, 30, 60),
    avoidIndustries: list(p.avoidIndustries, 20, 60),
    done: !!p.done,
  };
}

// Pay in dollars per year, from a floor/goal given per hour or per year (2,080 working hours a year).
export const yearly = (amount, unit) => (amount == null ? null : unit === 'hour' ? Math.round(amount * 2080) : amount);

// The roles the search uses: the person's targets plus the extra roles they switched on.
export const searchRoles = p => [...new Set([...(p.targetRoles || []), ...(p.extraRoles || [])])].slice(0, 12);
