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
/**
 * Parse one citation such as "49 CFR 395.3(a)(2)", "29 C.F.R. § 1910.147(c)(4)(i)", "40 CFR Part 112" or
 * "§ 192.605". Returns null if the text holds no citation.
 */
export declare function parseCitation(text: string, defaultTitle?: number): Citation | null;
/** Find every CFR citation in a block of text, e.g. the cross references inside a regulation. */
export declare function findCitations(text: string, defaultTitle?: number): Citation[];
/** "49 CFR 395.3(a)(2)" or "40 CFR Part 112". */
export declare function formatCitation(c: Pick<Citation, 'title' | 'part' | 'section' | 'paragraph'>): string;
/** Link to the citation on ecfr.gov, current or as of a date (YYYY-MM-DD). */
export declare function ecfrUrl(c: Pick<Citation, 'title' | 'part' | 'section' | 'paragraph'>, date?: string): string;
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
/** Strip tags, decode entities, collapse whitespace. */
export declare function xmlText(s: string): string;
/** Parse the XML for one section (a DIV8 element) from the eCFR full-text endpoint. */
export declare function parseSectionXml(xml: string, title?: number): Section;
/** Parse every section and appendix in a part, subpart or title XML document. */
export declare function parseDocumentXml(xml: string, title?: number): Section[];
export interface ParagraphChange {
    kind: 'added' | 'removed' | 'changed';
    citation: string;
    before?: string;
    after?: string;
}
/** Paragraph-level differences between two versions of the same section. */
export declare function diffSections(before: Section, after: Section): ParagraphChange[];
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
    sections: {
        identifier: string;
        name: string;
        removed: boolean;
        citation: string;
        url: string;
    }[];
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
    versions(title: number, filter?: {
        part?: string;
        subpart?: string;
        section?: string;
    }): Promise<ContentVersion[]>;
    structure(title: number, date?: string): Promise<StructureNode>;
    /** Raw XML for a section, subpart or part. */
    xml(title: number, where: {
        part?: string;
        subpart?: string;
        section?: string;
    }, date?: string): Promise<string>;
    section(title: number, section: string, date?: string): Promise<Section>;
    part(title: number, part: string, opts?: {
        subpart?: string;
        date?: string;
    }): Promise<Section[]>;
    /** Look up a citation such as "49 CFR 395.3(a)(2)" and return the section and the cited paragraphs. */
    cite(citation: string, date?: string): Promise<{
        section: Section;
        paragraphs: Paragraph[];
    }>;
    search(query: string, opts?: {
        title?: number;
        part?: string;
        date?: string;
        page?: number;
        perPage?: number;
    }): Promise<{
        results: SearchResult[];
        total: number;
    }>;
    /** Substantive amendments since a date, grouped by day, newest first. */
    changes(title: number, opts: {
        since: string;
        part?: string;
        section?: string;
        includeEditorial?: boolean;
    }): Promise<ChangeDay[]>;
    /** What changed in a section between two dates. */
    compare(title: number, section: string, from: string, to?: string): Promise<{
        from: string;
        to: string;
        changes: ParagraphChange[];
    }>;
}
export declare function createClient(options?: ClientOptions): EcfrClient;
