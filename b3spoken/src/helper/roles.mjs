// Roles: what the resume supports, related and niche roles, and a check for targets far from the resume.
// Works with no AI; when an AI is connected its suggestions are added (and still checked against the resume).
import { norm } from './resume/library.mjs';

// title, the words that show a resume supports it, and related roles.
export const ROLES = [
  ['Software Developer', 'python java javascript typescript c# react node api git software developer engineer', ['Full-Stack Developer', 'Back-End Developer', 'QA Automation Engineer', 'Junior Software Engineer']],
  ['Full-Stack Developer', 'react next.js node typescript javascript postgresql api full-stack frontend backend', ['Front-End Developer', 'Back-End Developer', 'Software Developer']],
  ['Front-End Developer', 'react javascript typescript css html ui ux next.js tailwind frontend', ['Full-Stack Developer', 'UI Developer', 'Web Developer']],
  ['Back-End Developer', 'python node api rest sql postgresql docker backend flask django', ['Software Developer', 'Integration Developer', 'Platform Engineer']],
  ['Python Developer', 'python pytest flask django automation scripts api', ['Automation Engineer', 'Back-End Developer', 'Data Engineer']],
  ['AI / LLM Application Developer', 'llm openai anthropic gemini prompt ai api structured output agents', ['Python Developer', 'Automation Engineer', 'Solutions Engineer']],
  ['QA Automation Engineer', 'pytest testing automated tests selenium playwright ci qa', ['Software Developer in Test', 'Software Developer']],
  ['DevOps Engineer', 'docker kubernetes ci/cd github actions terraform aws azure linux pipeline', ['Cloud Engineer', 'Site Reliability Engineer', 'Build and Release Engineer']],
  ['Cloud Engineer', 'aws azure gcp cloud terraform docker kubernetes', ['DevOps Engineer', 'Cloud Support Engineer']],
  ['Data Analyst', 'sql excel python tableau power bi analysis dashboards data', ['Business Analyst', 'Reporting Analyst', 'Data Engineer']],
  ['Data Engineer', 'python sql etl pipeline spark airflow data warehouse postgresql', ['Data Analyst', 'Analytics Engineer', 'Back-End Developer']],
  ['Security Analyst', 'security vulnerability siem soc nmap incident threat cybersecurity compliance', ['SOC Analyst', 'Vulnerability Management Analyst', 'IT Security Specialist', 'GRC Analyst']],
  ['SOC Analyst', 'soc siem splunk incident alerts threat detection monitoring security', ['Security Analyst', 'Incident Response Analyst']],
  ['Vulnerability Management Analyst', 'vulnerability scanning nessus openvas nmap patch remediation', ['Security Analyst', 'Penetration Tester (junior)']],
  ['GRC / IT Compliance Analyst', 'compliance audit risk policy controls governance iso soc 2 evidence', ['IT Auditor', 'Risk Analyst', 'Security Analyst']],
  ['IT Support Specialist', 'it support help desk tickets troubleshooting hardware software active directory l1 l2', ['Desktop Support Technician', 'Systems Administrator', 'Service Desk Analyst']],
  ['Systems Administrator', 'windows linux active directory servers backups networking administration', ['IT Support Specialist', 'Network Administrator', 'Cloud Engineer']],
  ['Network Administrator', 'network routing switching firewall cisco tcp/ip vpn', ['Systems Administrator', 'Network Technician']],
  ['Technical Support Engineer', 'support troubleshooting customers api debugging tickets', ['Solutions Engineer', 'IT Support Specialist', 'Customer Success Engineer']],
  ['Business Analyst', 'requirements stakeholders process analysis documentation sql', ['Data Analyst', 'Product Analyst', 'Project Coordinator']],
  ['Project Coordinator', 'project schedule coordination stakeholders delivery team', ['Project Manager', 'Operations Coordinator']],
  ['Product Manager', 'product roadmap requirements users stakeholders launch', ['Product Analyst', 'Business Analyst']],
  ['Accountant', 'accounting reconciliation gaap ifrs ledger tax financial statements', ['Bookkeeper', 'Financial Analyst', 'Accounts Payable Clerk']],
  ['Administrative Assistant', 'scheduling office calendar data entry reception administration', ['Office Coordinator', 'Executive Assistant', 'Receptionist']],
  ['Customer Service Representative', 'customer service calls inquiries resolution retail support', ['Client Support Specialist', 'Sales Associate']],
  ['Sales Representative', 'sales quota leads crm pipeline clients', ['Account Executive', 'Business Development Representative']],
  ['Marketing Coordinator', 'marketing social media campaigns content seo email', ['Digital Marketing Specialist', 'Content Coordinator']],
  ['Registered Nurse', 'nursing patient care rn clinical medication', ['Clinical Nurse', 'Community Health Nurse']],
  ['Warehouse Associate', 'warehouse inventory forklift shipping receiving picking', ['Inventory Clerk', 'Shipper/Receiver']],
].map(([title, words, related]) => ({ title, words: words.split(' '), related }));

// Whole-word matches only ("rn" must not match "internal").
const has = (textNorm, w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}($|[^a-z0-9])`).test(textNorm);
const score = (textNorm, words) => words.filter(w => has(textNorm, w)).length / words.length;

// Roles the resume supports, best first, with a reason built from the words actually found.
export function suggestRoles(text, { limit = 8 } = {}) {
  const t = norm(text);
  return ROLES.map(r => ({ r, s: score(t, r.words), hits: r.words.filter(w => has(t, w)) }))
    .filter(x => x.s >= 0.25).sort((a, b) => b.s - a.s).slice(0, limit)
    .map(({ r, s, hits }) => ({ title: r.title, fit: Math.round(s * 100), reason: `Your resume mentions ${hits.slice(0, 4).join(', ')}`, related: r.related }));
}

// Is a target far from what the resume supports? Returns { far, fit, closest }.
export function checkTarget(text, target) {
  const t = norm(text);
  const known = ROLES.find(r => norm(r.title) === norm(target)) || ROLES.find(r => norm(target).includes(norm(r.title)) || norm(r.title).includes(norm(target)));
  const words = known ? known.words : norm(target).split(' ').filter(w => w.length > 2);
  const fit = words.length ? score(t, words) : 0;
  return { target, fit: Math.round(fit * 100), far: fit < 0.2, closest: suggestRoles(text, { limit: 3 }).map(r => r.title) };
}
