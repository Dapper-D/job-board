# B3spoken changelog

## Unreleased

### Tailored resumes and cover letters now work like the Job Hunt Kit's
- **The AI tailors the documents** when Claude Code or Codex is connected. It writes a summary for each job from your real resume, picks 3–5 skill groups (only skills already on your resume), and chooses the experience, projects and bullets that fit the job best, in the best order. Before, it could only reorder your lines.
- **Honesty check on every AI draft.** A draft is rejected and redone once if it:
  - claims a skill you said you don't have
  - names a tool that isn't on your resume
  - uses a number that isn't on your resume or in the posting
  - opens the letter with "I'm applying…"

  If the second draft also fails, the documents use your own lines in the best order, and the job's notes say why.
- **Resume layout like the kit:**
  - headings in this order: Professional Summary, Skills, Education, then Professional Experience and Key Projects
  - the job title appears only as "Seeking a ___ role." at the end of the summary, never as a headline that looks like a title you held
- **Clickable links.** Your email, GitHub (shown as the word "GitHub" in the header), LinkedIn (full address, so applicant tracking systems can read it) and project addresses are links in the PDF. Still no metadata in the file.
- **Cover letter in your template:**
  - "Subject: Application for ___" and "Dear Hiring Manager,"
  - a hook tied to the company
  - your closest proof
  - three labelled bullets
  - why this company plus an honest gap
  - a close

  It shrinks text to stay on one page. Without an AI, the rule-based letter no longer opens with "I'm applying for…".
- Still to do: embed the Carlito font (Calibri's metrics) instead of Helvetica.
