// Greenhouse public Job Board API (no key needed): boards-api.greenhouse.io/v1/boards/<board>/jobs
import { request } from '../http.mjs';
import { makeJob, htmlToText } from '../job.mjs';

const HOSTS = ['boards-api.greenhouse.io'];

export default {
  id: 'greenhouse',
  label: 'Greenhouse',
  hosts: HOSTS,
  // job-boards.greenhouse.io/<board>, boards.greenhouse.io/<board>, boards-api.../boards/<board>
  fromUrl(url) {
    let u; try { u = new URL(url); } catch { return null; }
    if (!/(^|\.)greenhouse\.io$/.test(u.hostname)) return null;
    const board = u.searchParams.get('for') || u.pathname.split('/').filter(s => s && !['v1', 'boards', 'embed', 'job_board'].includes(s))[0];
    return board && /^[A-Za-z0-9_-]+$/.test(board) ? { board } : null;
  },
  parse(data, target) {
    return (data?.jobs || []).map(j => makeJob({
      source: 'greenhouse', company: data.company?.name || target.name || target.board, nativeId: j.id,
      title: j.title, url: j.absolute_url, location: j.location?.name,
      postedAt: j.first_published || j.updated_at,
      description: htmlToText(j.content),
      department: (j.departments || []).map(d => d.name).join(', '),
      salary: (j.metadata || []).find(m => /salary|pay|compensation/i.test(m.name || ''))?.value,
    })).filter(Boolean);
  },
  async fetchJobs(target) {
    const r = await request(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(target.board)}/jobs?content=true`, { allow: HOSTS, parse: 'json' });
    return this.parse(r.json, target);
  },
};
