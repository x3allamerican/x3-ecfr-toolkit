/**
 * X3 eCFR Toolkit: read the Code of Federal Regulations from the official eCFR API
 * (https://www.ecfr.gov/developers/documentation/api/v1) as clean, paragraph-level data.
 *
 * - parseCitation / findCitations / formatCitation / ecfrUrl: work with "49 CFR 395.3(a)(2)" style citations.
 * - parseSectionXml / parseDocumentXml: turn eCFR XML into sections and labeled paragraphs.
 * - diffSections: what changed between two versions of a section, paragraph by paragraph.
 * - createClient: a small typed client for titles, versions, structure, full text, search and change history.
 *
 * Zero dependencies. Runs in Node 18+ and the browser (note: eCFR's full-text XML endpoint does not send CORS
 * headers, so browser code can use the JSON endpoints but must fetch full text through a server).
 */

// ---------------------------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------------------------

export interface Citation {
  /** CFR title number, e.g. 49. Undefined when the text did not name one ("§ 395.3"). */
  title?: number;
  /** Part number as written, e.g. "395". */
  part: string;
  /** Section number, e.g. "395.3". Undefined for a whole-part citation. */
  section?: string;
  /** Paragraph labels in order, e.g. ["a", "3", "ii"]. */
  paragraph: string[];
  /** The text that was matched. */
  raw: string;
}

const CITE_RE =
  /(?:\b(\d{1,2})\s*C\.?\s?F\.?\s?R\.?\s*(?:(?:[Pp]arts?|§§?)\s*)?|§§?\s*|\b[Pp]art\s+)(\d{1,4})(?:\.(\d{1,4}[a-z]?(?:-\d+)?))?((?:\([a-zA-Z0-9]{1,5}\))*)/g;

function toCitation(m: RegExpExecArray, defaultTitle?: number): Citation {
  const title = m[1] ? Number(m[1]) : defaultTitle;
  const part = m[2];
  const section = m[3] ? `${part}.${m[3]}` : undefined;
  const paragraph = section ? [...(m[4] ?? '').matchAll(/\(([a-zA-Z0-9]+)\)/g)].map((x) => x[1]) : [];
  const raw = section ? m[0] : m[0].replace(/\([^)]*\)+$/, '');
  return { title, part, section, paragraph, raw: raw.trim() };
}

/**
 * Parse one citation such as "49 CFR 395.3(a)(2)", "29 C.F.R. § 1910.147(c)(4)(i)", "40 CFR Part 112" or
 * "§ 192.605". Returns null if the text holds no citation.
 */
export function parseCitation(text: string, defaultTitle?: number): Citation | null {
  CITE_RE.lastIndex = 0;
  const m = CITE_RE.exec(text);
  return m ? toCitation(m, defaultTitle) : null;
}

/** Find every CFR citation in a block of text, e.g. the cross references inside a regulation. */
export function findCitations(text: string, defaultTitle?: number): Citation[] {
  const out: Citation[] = [];
  CITE_RE.lastIndex = 0;
  for (let m = CITE_RE.exec(text); m; m = CITE_RE.exec(text)) out.push(toCitation(m, defaultTitle));
  return out;
}

/** "49 CFR 395.3(a)(2)" or "40 CFR Part 112". */
export function formatCitation(c: Pick<Citation, 'title' | 'part' | 'section' | 'paragraph'>): string {
  const t = c.title !== undefined ? `${c.title} CFR ` : '§ ';
  if (!c.section) return c.title !== undefined ? `${c.title} CFR Part ${c.part}` : `Part ${c.part}`;
  return `${t}${c.section}${(c.paragraph ?? []).map((p) => `(${p})`).join('')}`;
}

/** Link to the citation on ecfr.gov, current or as of a date (YYYY-MM-DD). */
export function ecfrUrl(c: Pick<Citation, 'title' | 'part' | 'section' | 'paragraph'>, date?: string): string {
  if (c.title === undefined) throw new Error('A title number is needed to build an eCFR link.');
  const base = `https://www.ecfr.gov/${date ? `on/${date}` : 'current'}/title-${c.title}`;
  if (!c.section) return `${base}/part-${c.part}`;
  const p = c.paragraph?.length ? `#p-${c.section}${c.paragraph.map((x) => `(${x})`).join('')}` : '';
  return `${base}/section-${c.section}${p}`;
}

// ---------------------------------------------------------------------------------------------
// XML -> sections and paragraphs
// ---------------------------------------------------------------------------------------------

export interface Paragraph {
  /** Full label, e.g. "(b)(1)(i)". Empty for an unlabeled paragraph (it belongs to `path`). */
  label: string;
  /** Labels of this paragraph and its parents, e.g. ["b", "1", "i"]. A level with no label is "?". */
  path: string[];
  /** Plain text with tags removed. */
  text: string;
  /** e.g. "29 CFR 1904.7(b)(1)(i)" */
  citation: string;
}

export interface Section {
  title?: number;
  /** "395.3", or an appendix name. */
  identifier: string;
  type: 'section' | 'appendix';
  /** "§ 395.3 Maximum driving time for property-carrying vehicles." */
  heading: string;
  citation: string;
  paragraphs: Paragraph[];
  /** All paragraph text joined with blank lines. */
  text: string;
  /** Authority and source notes, if present. */
  notes: string[];
  /** Tables in the section (rows of cell text, header row first), e.g. lists of exceptions or covered industries. */
  tables: string[][][];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}
/** Strip tags, decode entities, collapse whitespace. */
export function xmlText(s: string): string {
  return decode(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv', 'xvi', 'xvii', 'xviii', 'xix', 'xx',
  'xxi', 'xxii', 'xxiii', 'xxiv', 'xxv', 'xxvi', 'xxvii', 'xxviii', 'xxix', 'xxx'];
const nextLetter = (l?: string) => (l ? String.fromCharCode(l.charCodeAt(0) + 1) : 'a');
const nextRoman = (r?: string) => (r ? ROMAN[ROMAN.indexOf(r) + 1] : 'i');

/**
 * CFR paragraph levels: (a) lowercase letter, (1) number, (i) roman, (A) capital letter, then italic (1) and (i).
 * "(i)", "(v)" and "(x)" can be a letter or a roman numeral; the sequence decides.
 */
function levelOf(label: string, stack: string[], lastLevel: number): number {
  if (/^\d+$/.test(label)) return stack.length >= 4 && lastLevel >= 4 ? 5 : 2;
  if (/^[A-Z]+$/.test(label)) return 4;
  const isRoman = ROMAN.includes(label);
  const asLetter = label.length === 1 && (label === 'a' || nextLetter(stack[0]) === label);
  if (!isRoman) return 1;
  if (stack[2] !== undefined && nextRoman(stack[2]) === label && lastLevel >= 3) return 3;
  if (label === 'i' && lastLevel >= 2) return 3;
  return asLetter ? 1 : 3;
}

/** Read the labels at the start of a paragraph: "(c)(1) Any period", or "(b) <I>Heading</I>—(1) <I>Sub</I>". */
function leadingLabels(inner: string): string[] {
  const labels: string[] = [];
  let s = inner.trimStart();
  for (;;) {
    const m = /^\(([a-zA-Z]{1,5}|\d{1,3})\)\s*/.exec(s) ?? /^<I>\(([a-zA-Z]{1,5}|\d{1,3})\)<\/I>\s*/.exec(s);
    if (!m) break;
    labels.push(m[1]);
    s = s.slice(m[0].length);
    // "(b) <I>Implementation</I>—(1) <I>..." puts the first child on the same line.
    const inline = /^<I>[^<]{1,200}<\/I>\s*(?:[—–-]|&#x?(?:2014|2013|8212|8211);|&mdash;|&ndash;){0,2}\s*(?=\((?:[a-zA-Z]{1,5}|\d{1,3})\)\s)/i.exec(s);
    if (inline) s = s.slice(inline[0].length);
  }
  return labels;
}

function parseParagraphs(body: string, citationBase: string): Paragraph[] {
  const out: Paragraph[] = [];
  const stack: string[] = [];
  let lastLevel = 0;
  for (const m of body.matchAll(/<(P|FP)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)) {
    const inner = m[2];
    const labels = leadingLabels(inner);
    for (const lab of labels) {
      const lvl = levelOf(lab, stack, lastLevel);
      if (stack.length > lvl - 1) stack.length = lvl - 1;
      while (stack.length < lvl - 1) stack.push('?');
      stack.push(lab);
      lastLevel = lvl;
    }
    const path = [...stack];
    // '?' marks a level with no label (e.g. numbered items under an unlettered definition); leave it out of citations.
    const shown = path.filter((x) => x !== '?').map((x) => `(${x})`).join('');
    out.push({ label: labels.length ? shown : '', path, text: xmlText(inner), citation: `${citationBase}${shown}` });
  }
  return out;
}

function sectionFrom(attrs: string, body: string, title?: number): Section {
  const n = decode(/\bN="([^"]*)"/.exec(attrs)?.[1] ?? '');
  const type = /TYPE="APPENDIX"/i.test(attrs) ? 'appendix' : 'section';
  const meta = decode(decode(/hierarchy_metadata="([^"]*)"/.exec(attrs)?.[1] ?? ''));
  const metaCitation = /"citation":"([^"]*)"/.exec(meta)?.[1];
  const metaTitle = /title-(\d+)/.exec(meta)?.[1];
  const t = title ?? (metaTitle ? Number(metaTitle) : undefined);
  const heading = xmlText(/<HEAD>([\s\S]*?)<\/HEAD>/.exec(body)?.[1] ?? '');
  const citation = metaCitation ?? (t !== undefined ? `${t} CFR ${n}` : `§ ${n}`);
  const notes = [...body.matchAll(/<(AUTH|SOURCE|EDNOTE|CITA)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g)].map((x) => xmlText(x[2]));
  const clean = body.replace(/<(AUTH|SOURCE|EDNOTE|CITA)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g, '');
  const paragraphs = parseParagraphs(clean, type === 'section' ? citation : `${citation}`);
  const tables = [...clean.matchAll(/<(TABLE|GPOTABLE)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((tb) =>
    [...tb[2].matchAll(/<(TR|ROW|BOXHD)\b[^>]*>([\s\S]*?)<\/\1>/g)]
      .map((r) => [...r[2].matchAll(/<(TD|TH|ENT|CHED)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((c) => xmlText(c[2])))
      .filter((r) => r.length));
  return { title: t, identifier: n, type, heading, citation, paragraphs, text: paragraphs.map((p) => p.text).join('\n\n'), notes, tables };
}

/** Parse the XML for one section (a DIV8 element) from the eCFR full-text endpoint. */
export function parseSectionXml(xml: string, title?: number): Section {
  const all = parseDocumentXml(xml, title);
  if (!all.length) throw new Error('No section found in the XML.');
  return all[0];
}

/** Parse every section and appendix in a part, subpart or title XML document. */
export function parseDocumentXml(xml: string, title?: number): Section[] {
  const out: Section[] = [];
  for (const m of xml.matchAll(/<DIV([89])\b([^>]*)>([\s\S]*?)<\/DIV\1>/g)) out.push(sectionFrom(m[2], m[3], title));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------------------------

export interface ParagraphChange {
  kind: 'added' | 'removed' | 'changed';
  citation: string;
  before?: string;
  after?: string;
}

/** Paragraph-level differences between two versions of the same section. */
export function diffSections(before: Section, after: Section): ParagraphChange[] {
  const key = (p: Paragraph, i: number, list: Paragraph[]) => {
    // Unlabeled paragraphs are keyed by their parent and position among unlabeled siblings.
    if (p.label) return p.citation;
    let k = 0;
    for (let j = 0; j < i; j++) if (!list[j].label && list[j].citation === p.citation) k++;
    return `${p.citation}#${k}`;
  };
  const a = new Map(before.paragraphs.map((p, i, l) => [key(p, i, l), p] as const));
  const b = new Map(after.paragraphs.map((p, i, l) => [key(p, i, l), p] as const));
  const out: ParagraphChange[] = [];
  for (const [k, p] of a) {
    const q = b.get(k);
    if (!q) out.push({ kind: 'removed', citation: p.citation, before: p.text });
    else if (q.text !== p.text) out.push({ kind: 'changed', citation: p.citation, before: p.text, after: q.text });
  }
  for (const [k, q] of b) if (!a.has(k)) out.push({ kind: 'added', citation: q.citation, after: q.text });
  if (before.heading !== after.heading) out.unshift({ kind: 'changed', citation: `${after.citation} (heading)`, before: before.heading, after: after.heading });
  return out;
}

// ---------------------------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------------------------

export interface TitleInfo {
  number: number;
  name: string;
  latest_amended_on: string | null;
  latest_issue_date: string | null;
  up_to_date_as_of: string | null;
  reserved: boolean;
}

export interface ContentVersion {
  date: string;
  amendment_date: string;
  issue_date: string;
  identifier: string;
  name: string;
  part: string;
  substantive: boolean;
  removed: boolean;
  subpart: string | null;
  title: string;
  type: string;
}

export interface SearchResult {
  starts_on: string;
  ends_on: string | null;
  type: string;
  hierarchy: Record<string, string | null>;
  hierarchy_headings: Record<string, string | null>;
  headings: Record<string, string | null>;
  /** Excerpt with <strong> around the matches. */
  full_text_excerpt: string;
  score: number;
  removed: boolean;
  change_types?: string[];
  /** Added by the toolkit: the section citation and its eCFR link. */
  citation?: string;
  url?: string;
}

export interface StructureNode {
  identifier: string;
  label: string;
  label_level?: string;
  label_description?: string;
  reserved: boolean;
  type: string;
  size?: number;
  children?: StructureNode[];
}

export interface ChangeDay {
  /** Date the amendment took effect in the eCFR. */
  date: string;
  sections: { identifier: string; name: string; removed: boolean; citation: string; url: string }[];
}

export interface ClientOptions {
  /** Defaults to https://www.ecfr.gov */
  baseUrl?: string;
  /** Defaults to globalThis.fetch */
  fetch?: typeof fetch;
  /** Sent as User-Agent where the runtime allows it. Please identify your app. */
  userAgent?: string;
}

export interface EcfrClient {
  titles(): Promise<TitleInfo[]>;
  /** The newest date the eCFR has published for a title. */
  latestDate(title: number): Promise<string>;
  versions(title: number, filter?: { part?: string; subpart?: string; section?: string }): Promise<ContentVersion[]>;
  structure(title: number, date?: string): Promise<StructureNode>;
  /** Raw XML for a section, subpart or part. */
  xml(title: number, where: { part?: string; subpart?: string; section?: string }, date?: string): Promise<string>;
  section(title: number, section: string, date?: string): Promise<Section>;
  part(title: number, part: string, opts?: { subpart?: string; date?: string }): Promise<Section[]>;
  /** Look up a citation such as "49 CFR 395.3(a)(2)" and return the section and the cited paragraphs. */
  cite(citation: string, date?: string): Promise<{ section: Section; paragraphs: Paragraph[] }>;
  search(query: string, opts?: { title?: number; part?: string; date?: string; page?: number; perPage?: number }): Promise<{ results: SearchResult[]; total: number }>;
  /** Substantive amendments since a date, grouped by day, newest first. */
  changes(title: number, opts: { since: string; part?: string; section?: string; includeEditorial?: boolean }): Promise<ChangeDay[]>;
  /** What changed in a section between two dates. */
  compare(title: number, section: string, from: string, to?: string): Promise<{ from: string; to: string; changes: ParagraphChange[] }>;
}

export function createClient(options: ClientOptions = {}): EcfrClient {
  const base = (options.baseUrl ?? 'https://www.ecfr.gov').replace(/\/$/, '');
  const f = options.fetch ?? globalThis.fetch;
  if (!f) throw new Error('No fetch available. Pass options.fetch.');
  const headers: Record<string, string> = options.userAgent ? { 'User-Agent': options.userAgent } : {};
  let titleCache: Promise<TitleInfo[]> | undefined;

  async function get(path: string, params: Record<string, string | number | undefined> = {}, as: 'json' | 'text' = 'json') {
    const q = Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
    const url = `${base}${path}${q ? `?${q}` : ''}`;
    const res = await f(url, { headers });
    if (!res.ok) throw new Error(`eCFR ${res.status} for ${url}`);
    return as === 'json' ? res.json() : res.text();
  }
  const partOf = (section: string) => section.split('.')[0];

  const client: EcfrClient = {
    titles() {
      titleCache ??= get('/api/versioner/v1/titles.json').then((d: { titles: TitleInfo[] }) => d.titles);
      return titleCache;
    },
    async latestDate(title) {
      const t = (await client.titles()).find((x) => x.number === title);
      if (!t?.up_to_date_as_of) throw new Error(`Title ${title} has no published date.`);
      return t.up_to_date_as_of;
    },
    async versions(title, filter = {}) {
      const d = await get(`/api/versioner/v1/versions/title-${title}.json`, filter);
      return d.content_versions as ContentVersion[];
    },
    async structure(title, date) {
      return get(`/api/versioner/v1/structure/${date ?? (await client.latestDate(title))}/title-${title}.json`);
    },
    async xml(title, where, date) {
      const part = where.part ?? (where.section ? partOf(where.section) : undefined);
      return get(`/api/versioner/v1/full/${date ?? (await client.latestDate(title))}/title-${title}.xml`, { part, subpart: where.subpart, section: where.section }, 'text');
    },
    async section(title, section, date) {
      return parseSectionXml(await client.xml(title, { section }, date), title);
    },
    async part(title, part, opts = {}) {
      return parseDocumentXml(await client.xml(title, { part, subpart: opts.subpart }, opts.date), title);
    },
    async cite(text, date) {
      const c = parseCitation(text);
      if (!c?.title || !c.section) throw new Error(`"${text}" is not a section citation with a title, like "49 CFR 395.3(a)(2)".`);
      const section = await client.section(c.title, c.section, date);
      const want = c.paragraph;
      const paragraphs = want.length
        ? section.paragraphs.filter((p) => want.every((x, i) => p.path[i] === x))
        : section.paragraphs;
      return { section, paragraphs };
    },
    async search(query, opts = {}) {
      const d = await get('/api/search/v1/results', {
        query,
        'hierarchy[title]': opts.title,
        'hierarchy[part]': opts.part,
        date: opts.date,
        page: opts.page,
        per_page: opts.perPage ?? 20,
      });
      // The search index holds past versions too; keep the best-scoring hit per section.
      const seen = new Set<string>();
      const results = (d.results as SearchResult[]).filter((r) => {
        const k = `${r.hierarchy.title}|${r.hierarchy.section ?? r.hierarchy.appendix ?? r.hierarchy.part}`;
        return seen.has(k) ? false : (seen.add(k), true);
      }).map((r) => {
        const t = Number(r.hierarchy.title);
        const s = r.hierarchy.section ?? undefined;
        const c = { title: t, part: r.hierarchy.part ?? '', section: s, paragraph: [] };
        return { ...r, citation: formatCitation(c), url: ecfrUrl(c) };
      });
      return { results, total: Number(d.meta?.total_count ?? results.length) };
    },
    async changes(title, opts) {
      const v = await client.versions(title, { part: opts.part, section: opts.section });
      const keep = v.filter((x) => x.date >= opts.since && (opts.includeEditorial || x.substantive));
      const days = new Map<string, ChangeDay>();
      for (const x of keep) {
        const day = days.get(x.date) ?? { date: x.date, sections: [] };
        if (!day.sections.some((s) => s.identifier === x.identifier)) {
          const isSection = x.type === 'section';
          const c = { title, part: x.part, section: isSection ? x.identifier : undefined, paragraph: [] };
          day.sections.push({ identifier: x.identifier, name: x.name, removed: x.removed, citation: isSection ? formatCitation(c) : `${title} CFR Part ${x.part}, ${x.identifier}`, url: ecfrUrl(c, x.date) });
        }
        days.set(x.date, day);
      }
      return [...days.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
    },
    async compare(title, section, from, to) {
      const end = to ?? (await client.latestDate(title));
      const [a, b] = await Promise.all([client.section(title, section, from), client.section(title, section, end)]);
      return { from, to: end, changes: diffSections(a, b) };
    },
  };
  return client;
}
