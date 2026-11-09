// Scam warning signs in a job posting. Jobs come from employers' own hiring systems or Job Bank, so scams are rare,
// but fake postings do get through (especially on job sites and pasted links).
// - "stop" signs (asking the applicant for money, banking details, gift cards, crypto, reshipping) hide the job.
// - "warn" signs (chat apps instead of the employer's own channels, a personal email address to apply) show a warning.
const STOP = [
  [/\b(?:pay|send|transfer|deposit)\b[^.!?\n]{0,40}\b(?:fee|deposit|payment|money|funds)\b[^.!?\n]{0,40}\b(?:to (?:apply|start|begin|be (?:hired|considered))|for (?:training|equipment|onboarding|your (?:kit|starter|application)))/i, 'asks you to pay to apply, train or get equipment'],
  [/\b(?:application|registration|training|processing|onboarding|starter[- ]kit|equipment) fee\b/i, 'mentions a fee you would pay'],
  [/\b(?:cashier'?s|certified) che(?:que|ck)\b|\bdeposit (?:the|a) che(?:que|ck)\b|\bmobile deposit\b/i, 'involves depositing a cheque for them (a common fake-cheque scam)'],
  [/\bgift ?cards?\b[^.!?\n]{0,60}\b(?:buy|purchase|send|pay)\b|\b(?:buy|purchase|send|pay)\b[^.!?\n]{0,60}\bgift ?cards?\b/i, 'involves buying gift cards'],
  [/\b(?:you(?:'ll| will)?|to)\s+(?:pay|send|deposit|transfer|buy)\b[^.!?\n]{0,40}\b(?:bitcoin|crypto(?:currency)?|usdt|btc)\b|\b(?:bitcoin|crypto(?:currency)?|usdt|btc)\b[^.!?\n]{0,40}\b(?:from|into|to) your (?:own )?(?:wallet|account)\b/i, 'asks you to pay or move cryptocurrency'],
  [/\b(?:reship(?:ping)?|re-ship|package (?:forwarding|inspector|handler)|forward (?:packages|parcels))\b/i, 'is a package reshipping job (a common scam)'],
  [/\b(?:bank (?:account|login|details)|online banking (?:login|password)|social insurance number|SIN number)\b[^.!?\n]{0,60}\b(?:before|to (?:apply|be considered)|with your application|in your (?:application|reply))/i, 'asks for banking details or your SIN before hiring'],
  [/\b(?:you will|you'll|you)\s+(?:act as|become|work as) (?:a |an |our )?(?:money mule|money transfer agent|payment (?:processing )?agent)\b|\bprocess(?:ing)? payments? (?:through|into) your (?:own )?(?:personal )?(?:bank )?account/i, 'asks you to move money through your own account'],
];
const WARN = [
  [/\b(?:telegram|whatsapp|signal|google hangouts|wickr)\b[^.!?\n]{0,60}\b(?:interview(?:s|ed|ing)?|contact(?:ed)?|message|apply|reach|text)\b|\b(?:interview(?:s|ed|ing)?|contact(?:ed)?|message|apply|reach|text)\b[^.!?\n]{0,60}\b(?:on|via|through|using) (?:telegram|whatsapp|signal|google hangouts|wickr)\b/i, 'asks you to talk or interview over a chat app'],
  [/\b(?:apply|send (?:your )?(?:resume|cv)|email (?:your )?(?:resume|cv))\b[^.!?\n]{0,60}\b[a-z0-9._%+-]+@(?:gmail|yahoo|hotmail|outlook|aol|proton(?:mail)?|icloud)\.[a-z]{2,}\b/i, 'asks you to apply to a personal email address'],
  [/\b(?:no (?:interview|experience) (?:needed|required)[^.!?\n]{0,40}\$\s?\d{3,}\s*(?:\/|per|a)\s*(?:day|week))|\bearn \$\s?\d{3,}\s*(?:\/|per|a)\s*(?:day|hour)\b/i, 'promises unusually high pay for little work'],
];

// Returns { stop: [reasons], warn: [reasons] } (empty lists when nothing looks wrong).
export function scamSigns(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const hits = list => [...new Set(list.filter(([re]) => re.test(t)).map(([, why]) => why))];
  return { stop: hits(STOP), warn: hits(WARN) };
}
