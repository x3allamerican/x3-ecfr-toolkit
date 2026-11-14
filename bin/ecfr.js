#!/usr/bin/env node
// X3 eCFR Toolkit command line. Run `ecfr help`.
import { createClient } from '../dist/index.js';

const HELP = `X3 eCFR Toolkit: read federal regulations from the official eCFR.

  ecfr cite "49 CFR 395.3(a)(2)" [--date 2024-01-01]   Text of a citation
  ecfr section 49 395.3 [--date YYYY-MM-DD]             Every paragraph of a section
  ecfr search "sleeper berth" [--title 49] [--part 395] Full-text search
  ecfr changes 49 --since 2024-01-01 [--part 395]       Amendments since a date
  ecfr compare 49 395.3 2020-01-01 [2026-01-01]         What changed in a section
  ecfr titles                                           All 50 titles and their dates

Add --json to any command for machine-readable output.
Free and open source from X3: https://github.com/x3allamerican/x3-ecfr-toolkit`;

const args = process.argv.slice(2);
const flags = {};
const pos = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const k = args[i].slice(2);
    flags[k] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
  } else pos.push(args[i]);
}
const [cmd, ...rest] = pos;
const c = createClient({ userAgent: 'x3-ecfr-toolkit-cli' });
const out = (data, text) => console.log(flags.json ? JSON.stringify(data, null, 2) : text());

try {
  switch (cmd) {
    case 'cite': {
      const r = await c.cite(rest.join(' '), flags.date);
      out(r, () => `${r.section.heading}\n\n${r.paragraphs.map((p) => p.text).join('\n\n')}`);
      break;
    }
    case 'section': {
      const s = await c.section(Number(rest[0]), rest[1], flags.date);
      out(s, () => `${s.heading}\n\n${s.text}`);
      break;
    }
    case 'search': {
      const r = await c.search(rest.join(' '), { title: flags.title ? Number(flags.title) : undefined, part: flags.part, perPage: Number(flags.limit ?? 10) });
      out(r, () => `${r.total} matches\n\n${r.results.map((x) => `${x.citation}  ${(x.headings?.section ?? '').replace(/<[^>]+>/g, '')}\n  ${x.full_text_excerpt.replace(/<[^>]+>/g, '').slice(0, 220)}\n  ${x.url}`).join('\n\n')}`);
      break;
    }
    case 'changes': {
      if (!flags.since) throw new Error('Add --since YYYY-MM-DD');
      const r = await c.changes(Number(rest[0]), { since: flags.since, part: flags.part, section: flags.section });
      out(r, () => (r.length ? r.map((d) => `${d.date}\n${d.sections.map((s) => `  ${s.citation.includes(', ') ? s.name : `${s.citation}  ${s.name.replace(/^§\s*[\d.]+\s*/, '')}`}${s.removed ? ' (removed)' : ''}`).join('\n')}`).join('\n\n') : 'No substantive changes.'));
      break;
    }
    case 'compare': {
      const r = await c.compare(Number(rest[0]), rest[1], rest[2], rest[3]);
      out(r, () => `${rest[1]}: ${r.from} to ${r.to}, ${r.changes.length} change(s)\n\n${r.changes.map((x) => `${x.kind.toUpperCase()} ${x.citation}\n${x.before ? `  - ${x.before}\n` : ''}${x.after ? `  + ${x.after}\n` : ''}`).join('\n')}`);
      break;
    }
    case 'titles': {
      const t = await c.titles();
      out(t, () => t.map((x) => `${String(x.number).padStart(2)}  ${x.name}${x.reserved ? ' (reserved)' : ''}  [current to ${x.up_to_date_as_of ?? 'n/a'}]`).join('\n'));
      break;
    }
    default:
      console.log(HELP);
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
