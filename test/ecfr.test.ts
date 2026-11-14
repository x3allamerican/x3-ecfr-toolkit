import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseCitation, findCitations, formatCitation, ecfrUrl, parseSectionXml, parseDocumentXml, diffSections, createClient, xmlText,
} from '../src/index.ts';

const fx = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('parseCitation reads the common ways a CFR citation is written', () => {
  assert.deepEqual(parseCitation('49 CFR 395.3(a)(3)(ii)'), { title: 49, part: '395', section: '395.3', paragraph: ['a', '3', 'ii'], raw: '49 CFR 395.3(a)(3)(ii)' });
  assert.equal(parseCitation('29 C.F.R. § 1910.147(c)(4)')?.section, '1910.147');
  assert.equal(parseCitation('see 49 C.F.R. Part 192 for details')?.section, undefined);
  assert.equal(parseCitation('see 49 C.F.R. Part 192 for details')?.part, '192');
  assert.equal(parseCitation('§ 192.605(b)', 49)?.title, 49);
  assert.equal(parseCitation('46 CFR 15.705')?.section, '15.705');
  assert.equal(parseCitation('no citation here'), null);
});

test('findCitations pulls every cross reference out of regulation text', () => {
  const found = findCitations('as required by § 1904.7(b)(4), 49 CFR 382.305 and 40 CFR Part 112', 29);
  assert.deepEqual(found.map(formatCitation), ['29 CFR 1904.7(b)(4)', '49 CFR 382.305', '40 CFR Part 112']);
});

test('ecfrUrl links to the section and paragraph, current or as of a date', () => {
  assert.equal(ecfrUrl(parseCitation('49 CFR 395.3(a)(2)')!), 'https://www.ecfr.gov/current/title-49/section-395.3#p-395.3(a)(2)');
  assert.equal(ecfrUrl(parseCitation('49 CFR Part 192')!, '2024-01-01'), 'https://www.ecfr.gov/on/2024-01-01/title-49/part-192');
  assert.throws(() => ecfrUrl(parseCitation('§ 395.3')!), /title number/);
});

test('parseSectionXml: 49 CFR 395.3 heading, notes and nested labels', () => {
  const s = parseSectionXml(fx('49-395.3.xml'));
  assert.equal(s.citation, '49 CFR 395.3');
  assert.equal(s.title, 49);
  assert.match(s.heading, /Maximum driving time for property-carrying vehicles/);
  assert.deepEqual(s.paragraphs.map((p) => p.label), ['(a)', '(a)(1)', '(a)(2)', '(a)(3)(i)', '(a)(3)(ii)', '(b)', '(b)(1)', '(b)(2)', '(c)(1)', '(c)(2)']);
  const p = s.paragraphs.find((x) => x.label === '(a)(2)')!;
  assert.equal(p.citation, '49 CFR 395.3(a)(2)');
  assert.match(p.text, /^\(2\) 14-hour period\. A driver may not drive after a period of 14 consecutive hours/);
  assert.equal(s.notes.length, 1);
  assert.ok(!s.text.includes('<'));
});

test('parseSectionXml: 29 CFR 1904.7 four levels deep, inline first child and capital-letter (I)', () => {
  const s = parseSectionXml(fx('29-1904.7.xml'));
  const labels = s.paragraphs.map((p) => p.label);
  assert.equal(labels[1], '(b)(1)'); // "(b) Implementation—(1) ..." on one line
  assert.ok(labels.includes('(b)(4)(i)(B)'));
  assert.ok(labels.includes('(b)(5)(ii)(I)')); // capital I is a level-4 letter, not a roman numeral
  assert.ok(labels.includes('(b)(5)(ii)(N)'));
  assert.ok(labels.includes('(b)(4)(xi)'));
  assert.equal(labels.at(-2), '(b)(7)');
});

test('letter (i) after (h) is a top-level paragraph; roman (i) after (1) is a child', () => {
  const xml = `<DIV8 N="1.1" TYPE="SECTION"><HEAD>§ 1.1 Test.</HEAD>
    <P>(g) G.</P><P>(h) H.</P><P>(1) H one.</P><P>(i) roman under h1.</P><P>(ii) next roman.</P><P>(i) letter i after (h)? no, roman continues</P>
    </DIV8>`;
  const s = parseSectionXml(xml, 1);
  assert.deepEqual(s.paragraphs.map((p) => p.label).slice(0, 5), ['(g)', '(h)', '(h)(1)', '(h)(1)(i)', '(h)(1)(ii)']);
  const xml2 = `<DIV8 N="1.2" TYPE="SECTION"><HEAD>§ 1.2 Test.</HEAD><P>(h) H.</P><P>(i) I.</P><P>(j) J.</P><P>(u) U.</P><P>(v) V.</P></DIV8>`;
  assert.deepEqual(parseSectionXml(xml2, 1).paragraphs.map((p) => p.label), ['(h)', '(i)', '(j)', '(u)', '(v)']);
});

test('parseDocumentXml splits a subpart into its sections', () => {
  const all = parseDocumentXml(fx('29-1904-C.xml'));
  assert.deepEqual(all.slice(0, 4).map((s) => s.identifier), ['1904.4', '1904.5', '1904.6', '1904.7']);
  assert.ok(all.every((s) => s.title === 29));
});

test('diffSections reports changed, added and removed paragraphs', () => {
  const a = parseSectionXml(fx('49-395.3.xml'));
  const xml = fx('49-395.3.xml').replace('14 consecutive hours', '15 consecutive hours').replace(/<P>\(2\) Having been on duty 70[\s\S]*?<\/P>/, '');
  const b = parseSectionXml(xml.replace('</DIV8>', '<P>(d) A new paragraph.</P></DIV8>'));
  const d = diffSections(a, b);
  assert.deepEqual(d.map((x) => `${x.kind} ${x.citation}`), ['changed 49 CFR 395.3(a)(2)', 'removed 49 CFR 395.3(b)(2)', 'added 49 CFR 395.3(d)']);
  assert.match(d[0].after!, /15 consecutive hours/);
  assert.deepEqual(diffSections(a, a), []);
});

test('xmlText decodes entities and strips tags', () => {
  assert.equal(xmlText('<P>A &amp; B&#8212;<I>C</I> &#x2019;s</P>'), 'A & B—C ’s');
});

// --- client, with a fake fetch ------------------------------------------------------------------

function fakeFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const f = (async (url: string) => {
    calls.push(url);
    const hit = Object.keys(routes).find((k) => url.includes(k));
    if (!hit) return new Response('not found', { status: 404 });
    const body = routes[hit];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const TITLES = { titles: [{ number: 49, name: 'Transportation', latest_amended_on: '2026-10-01', latest_issue_date: '2026-11-10', up_to_date_as_of: '2026-11-12', reserved: false }] };

test('client.section uses the latest published date and the part from the section number', async () => {
  const { f, calls } = fakeFetch({ 'titles.json': TITLES, '/full/2026-11-12/title-49.xml': fx('49-395.3.xml') });
  const c = createClient({ fetch: f });
  const s = await c.section(49, '395.3');
  assert.equal(s.identifier, '395.3');
  assert.equal(calls[1], 'https://www.ecfr.gov/api/versioner/v1/full/2026-11-12/title-49.xml?part=395&section=395.3');
});

test('client.cite returns only the cited paragraph and its children', async () => {
  const { f } = fakeFetch({ 'titles.json': TITLES, '/full/': fx('49-395.3.xml') });
  const r = await createClient({ fetch: f }).cite('49 CFR 395.3(a)(3)');
  assert.deepEqual(r.paragraphs.map((p) => p.label), ['(a)(3)(i)', '(a)(3)(ii)']);
  await assert.rejects(createClient({ fetch: f }).cite('§ 395.3'), /title/);
});

test('client.changes groups substantive amendments by day, newest first', async () => {
  const v = (date: string, identifier: string, substantive = true) => ({ date, amendment_date: date, issue_date: date, identifier, name: `§ ${identifier}`, part: '395', substantive, removed: false, subpart: 'A', title: '49', type: 'section' });
  const { f } = fakeFetch({ 'versions/title-49.json': { content_versions: [v('2019-01-01', '395.1'), v('2020-09-29', '395.1'), v('2020-09-29', '395.3'), v('2021-01-01', '395.8', false), v('2020-09-29', '395.1')] } });
  const days = await createClient({ fetch: f }).changes(49, { since: '2020-01-01', part: '395' });
  assert.deepEqual(days.map((d) => [d.date, d.sections.map((s) => s.identifier)]), [['2020-09-29', ['395.1', '395.3']]]);
  assert.equal(days[0].sections[1].url, 'https://www.ecfr.gov/on/2020-09-29/title-49/section-395.3');
});

test('client.search adds a citation and link to each result', async () => {
  const { f, calls } = fakeFetch({ '/search/v1/results': { meta: { total_count: 1 }, results: [{ starts_on: '2017-01-01', ends_on: null, type: 'Section', hierarchy: { title: '29', part: '1904', section: '1904.7' }, hierarchy_headings: {}, headings: {}, full_text_excerpt: 'x', score: 1, removed: false }] } });
  const r = await createClient({ fetch: f }).search('medical treatment', { title: 29, part: '1904' });
  assert.equal(r.total, 1);
  assert.equal(r.results[0].citation, '29 CFR 1904.7');
  assert.match(calls[0], /hierarchy%5Btitle%5D=29&hierarchy%5Bpart%5D=1904/);
});

test('client errors name the URL', async () => {
  const { f } = fakeFetch({});
  await assert.rejects(createClient({ fetch: f }).titles(), /eCFR 404 for https:\/\/www\.ecfr\.gov\/api\/versioner\/v1\/titles\.json/);
});

test('live eCFR (set ECFR_LIVE=1)', { skip: !process.env.ECFR_LIVE }, async () => {
  const c = createClient({ userAgent: 'x3-ecfr-toolkit tests' });
  const r = await c.cite('49 CFR 395.3(a)(2)');
  assert.match(r.paragraphs[0].text, /14 consecutive hours/);
  const s = await c.search('sleeper berth', { title: 49, perPage: 3 });
  assert.ok(s.results.length > 0);
});
