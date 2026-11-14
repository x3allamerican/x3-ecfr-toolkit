# X3 eCFR Toolkit

**Read the Code of Federal Regulations as clean, paragraph-level data.** A zero-dependency TypeScript client and parser for the official [eCFR API](https://www.ecfr.gov/developers/documentation/api/v1), plus a command line tool.

**[Try the Regulation Change Tracker →](https://x3allamerican.github.io/x3-ecfr-toolkit/)** See every amendment to any CFR part since a date, search the CFR, and turn citations in any text into links.

Built and maintained by **X3**, the team behind [X3 Fleet Safety](https://x3fleetsafety.com), [X3 Workplace Safety](https://x3workplacesafety.com), [X3 Pipeline](https://x3pipeline.com) and [X3 Maritime](https://x3maritime.com).

## Why

The eCFR API returns raw XML where paragraph numbers are just text: `<P>(b) <I>Implementation</I>—(1) ...`. To cite, compare or check a rule you need to know that a paragraph is `29 CFR 1904.7(b)(5)(ii)(I)`, and that the capital `(I)` is a letter, not a roman numeral. This toolkit does that work:

- **Citations:** parse `49 CFR 395.3(a)(2)`, `29 C.F.R. § 1910.147(c)(4)`, `40 CFR Part 112` or `§ 192.605`; find every citation in a block of text; build eCFR links, current or as of a date.
- **Paragraphs:** every section comes back as labeled paragraphs with a full citation each, nested correctly through all levels.
- **Change history:** substantive amendments to a part or section since a date, grouped by day.
- **Diffs:** what changed in a section between two dates, paragraph by paragraph.
- **Search:** full-text search with a citation and link on every hit.

## Install

```sh
npm install github:x3allamerican/x3-ecfr-toolkit
```

## Use

```ts
import { createClient, parseCitation, findCitations, ecfrUrl } from '@x3/ecfr-toolkit';

const ecfr = createClient({ userAgent: 'my-app (me@example.com)' });

// The text of a citation and everything under it
const { section, paragraphs } = await ecfr.cite('49 CFR 395.3(a)(3)');
paragraphs.map((p) => p.citation); // ['49 CFR 395.3(a)(3)(i)', '49 CFR 395.3(a)(3)(ii)']

// Every paragraph of a section, as of a date
const s = await ecfr.section(29, '1904.7', '2024-01-01');
s.paragraphs[1]; // { label: '(b)(1)', path: ['b','1'], text: '(b) Implementation—(1) How do I decide ...', citation: '29 CFR 1904.7(b)(1)' }

// What changed in Part 192 since 2024
const days = await ecfr.changes(49, { part: '192', since: '2024-01-01' });

// Paragraph-level diff of a section between two dates
const { changes } = await ecfr.compare(49, '395.1', '2019-01-01', '2021-01-01');

// Search
const { results } = await ecfr.search('lockout', { title: 29 });

// Offline helpers
findCitations('see § 1904.7(b)(4) and 49 CFR 382.305', 29);
ecfrUrl(parseCitation('49 CFR 395.3(a)(2)')!); // https://www.ecfr.gov/current/title-49/section-395.3#p-395.3(a)(2)
```

All client methods: `titles`, `latestDate`, `versions`, `structure`, `xml`, `section`, `part`, `cite`, `search`, `changes`, `compare`. Parsers that work on XML you already have: `parseSectionXml`, `parseDocumentXml`, `diffSections`, `xmlText`.

## Command line

```sh
npx github:x3allamerican/x3-ecfr-toolkit cite "49 CFR 395.3(a)(2)"
npx github:x3allamerican/x3-ecfr-toolkit changes 29 --part 1904 --since 2023-01-01
npx github:x3allamerican/x3-ecfr-toolkit compare 49 395.1 2019-01-01 2021-01-01
npx github:x3allamerican/x3-ecfr-toolkit search "sleeper berth" --title 49
```

Add `--json` for machine-readable output.

## Notes

- Works in Node 18+ and the browser. In the browser, the JSON endpoints (titles, versions, structure, search) work directly; the full-text XML endpoint does not send CORS headers, so fetch full text from a server.
- Dates default to the newest date the eCFR has published for that title.
- The eCFR is an editorial compilation kept current by the Office of the Federal Register. It is not the official legal edition of the CFR. This is not legal advice.
- Please send a `userAgent` that identifies your app, and cache what you can.

## Develop

```sh
npm install
npm test               # offline tests with saved eCFR XML
ECFR_LIVE=1 npm test   # also hit the live API
npm run build
```

## License

MIT. Free for any use, including commercial. Regulation text is a U.S. government work.
