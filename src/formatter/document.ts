import { Overrides, applyOverrides, parseDirective, resolveOverrides } from './directives';
import { FormatOptions, indentString } from './options';
import { GREEDY_COMMANDS, Parser } from './parser';
import { LogicalLine } from './source';

/** Formatted output for the physical lines [start, end] of the input. */
export interface Unit {
    start: number;
    end: number;
    lines: string[];
}

type LineType = 'none' | 'blank' | 'comment' | 'command';

/** `namespace:path` for a file at `.../data/<namespace>/function/<path>.mcfunction`, or undefined. */
export function resourceIdFromPath(filePath: string): string | undefined {
    const m = /^.*\/data\/([^/]+)\/function\/(.+)\.mcfunction$/i.exec(filePath.replace(/\\/g, '/'));
    return m ? `${m[1]}:${m[2]}` : undefined;
}

function isHeader(trimmed: string): boolean {
    return trimmed.startsWith('#>') && (trimmed.length === 2 || trimmed[2] === ' ');
}

/** Inserts `#> <id>` at the top, or overwrites the first line if it is already a `#>` header. */
export function applyHeader(lines: string[], resourceId: string): string[] {
    const header = `#> ${resourceId}`;
    const first = lines.findIndex(l => l.trim() !== '');
    if (first !== -1 && isHeader(lines[first].trim())) {
        const out = lines.slice();
        out[first] = header;
        return out;
    }
    if (lines[0]?.trim() === '') return [header, ...lines];
    return [header, '', ...lines];
}

const endsWithContinuation = (line: string) => line.trimEnd().endsWith('\\');

/**
 * How many `{` / `[` are still open at the end of `group`, ignoring quoted text.
 * Null if a bracket closes that was never opened. Greedy commands (`say {`) count as closed.
 */
function openBrackets(group: string[]): number | null {
    const text = group.map(l => l.trim().replace(/\\$/, '')).join(' ').replace(/^\$/, '');
    if (GREEDY_COMMANDS[text.split(/[ \t]/)[0]] !== undefined) return 0;
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"' || c === "'") {
            for (i++; i < text.length && text[i] !== c; i++) if (text[i] === '\\') i++;
        } else if (c === '{' || c === '[') {
            depth++;
        } else if (c === '}' || c === ']') {
            if (--depth < 0) return null;
        }
    }
    return depth;
}

/**
 * The last line of the command starting at `start`. Lines ending with `\` continue it, and so do
 * lines after one that forgot its `\` while brackets are still open, as long as they close
 * before a blank line, a comment or the end of the file.
 */
function commandEnd(lines: string[], start: number): number {
    const follow = (from: number) => {
        let end = from;
        while (end < lines.length - 1 && endsWithContinuation(lines[end])) end++;
        return end;
    };
    const end = follow(start);
    let extended = end;
    while ((openBrackets(lines.slice(start, extended + 1)) ?? 0) > 0) {
        const next = lines[extended + 1]?.trim();
        if (!next || next.startsWith('#')) return end;
        extended = follow(extended + 1);
    }
    return extended;
}

function formatCommand(group: string[], base: string, opts: FormatOptions): string[] {
    const source = group
        .map((l, k) => {
            const text = (k === 0 ? l.replace(/^[ \t]+/, '') : l).trimEnd();
            // Restore a `\` that was forgotten inside brackets (see commandEnd).
            return k < group.length - 1 && !text.endsWith('\\') ? text + ' \\' : text;
        })
        .join('\n');
    const line = new LogicalLine(source);
    let p = 0;
    let prefix = '';
    if (line.text.startsWith('$')) {
        prefix = '$';
        p = 1;
    }
    const rendered = new Parser(line, opts).parseCommand(p).render('');
    return rendered
        .map((l, k) => base + (k === 0 ? prefix : l.indent) + l.text + (k < rendered.length - 1 ? ' \\' : ''))
        .flatMap(l => l.split('\n'));
}

/** One `#` indentation level, with the section directives written in it. */
interface Section {
    signs: number;
    /** Level of the lines under it (`signs` style only). */
    level: number;
    section: Overrides;
    all: Overrides;
}

const newSection = (signs: number, level = 0): Section => ({ signs, level, section: {}, all: {} });

/**
 * Formats every line. How comments indent depends on `indent.style`:
 * - `signs`: a `##` (or deeper) heading puts the lines under it at (number of `#`) - 1 levels and
 *   a single `#` is a plain comment. A blank line goes back one indentation level. Headings are
 *   strict: one at most one level deeper than the line before it (more `#` are cut down), and
 *   exactly as many blank lines before it as it takes to come down from the line before it to its
 *   own level (none before a child heading, one before a same-level one, ...). Plain comments
 *   written right above a heading belong to it.
 * - `nested` (the reference McfunctionFormatter): a `#` comment opens a level (one per run of
 *   comments with the same number of `#`) and a blank line closes one.
 * In both, `#>` resets to the top.
 */
export function formatLines(lines: string[], opts: FormatOptions): Unit[] {
    const units: Unit[] = [];
    /** Open sections; `root` holds directives written outside any section. */
    const depth: Section[] = [];
    const root = newSection(0);
    const signsStyle = opts.indent.style === 'signs';
    /** `signs` headings rewrite `#` and blank lines; off when indentation is. */
    const strict = signsStyle && opts.indent.enabled;
    let last: LineType = 'none';
    /** Level of commands at this point (`signs` style); may sit between open sections after blank lines. */
    let signsLevel = 0;
    /** Right after `#>` and the comments directly under it: the first heading gets one blank line. */
    let afterHeader = false;
    let inHeaderBlock = false;
    /** Directives for the next command only. */
    let pending: Overrides = {};
    /** Strict mode holds blank lines, then the comments right after them, until the next line shows whether a heading follows. */
    let heldBlanks: number[] = [];
    /** `verbatim` is taken before the line itself (a directive) changes it. */
    let heldComments: { i: number; verbatim?: boolean }[] = [];
    const unit = indentString(opts, opts.indent.size);
    const indentFor = (level: number, original: string) => (opts.indent.enabled ? unit.repeat(level) : original);
    const current = () => depth[depth.length - 1] ?? root;
    const contentLevel = () => (signsStyle ? signsLevel : depth.length);
    /** Nearest first: this command, this section, then `-all` from here up to the root. */
    const overrides = (command: Overrides) =>
        resolveOverrides([command, current().section, ...[...depth].reverse().map(s => s.all), root.all]);
    const split = (raw: string) => {
        const trimmed = raw.replace(/^[ \t]+/, '');
        return { trimmed, original: raw.slice(0, raw.length - trimmed.length) };
    };
    const commentUnit = (i: number, verbatim: boolean | undefined, level: number, prefix: string[] = []): Unit => {
        const { trimmed, original } = split(lines[i]);
        const text = verbatim ? lines[i] : indentFor(level, original) + trimmed;
        return { start: i, end: i, lines: [...(verbatim ? [] : prefix), text] };
    };
    const blankLine = () => {
        if (signsStyle) {
            // One indentation level up; sections whose lines sit deeper than that are closed.
            signsLevel = Math.max(signsLevel - 1, 0);
            while (depth.length && current().level > signsLevel) depth.pop();
        } else {
            depth.pop();
        }
    };
    /** No heading follows: held lines are ordinary blank lines and comments. */
    const release = () => {
        for (const b of heldBlanks) {
            const verbatim = overrides({}).verbatim;
            blankLine();
            units.push({ start: b, end: b, lines: [verbatim ? lines[b] : ''] });
        }
        for (const c of heldComments) units.push(commentUnit(c.i, c.verbatim, signsLevel));
        heldBlanks = [];
        heldComments = [];
    };

    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const { trimmed, original } = split(raw);
        const verbatim = overrides({}).verbatim;

        if (trimmed.trim() === '') {
            pending = {};
            last = 'blank';
            inHeaderBlock = false;
            if (strict) {
                if (heldComments.length) release();
                heldBlanks.push(i);
                continue;
            }
            blankLine();
            units.push({ start: i, end: i, lines: [verbatim ? raw : ''] });
            continue;
        }

        if (trimmed.startsWith('#')) {
            const signs = /^#+/.exec(trimmed)![0].length;
            const tag = trimmed.slice(signs).split(' ')[0];
            const directive = parseDirective(trimmed);
            const isHeading = tag === '' && signsStyle && signs >= 2;

            if (strict && (tag === '>' || isHeading)) {
                // Level of the last line that is not held: blank lines before a heading are rewritten.
                const from = signsLevel;
                const fixed = tag === '>' || verbatim ? signs : Math.min(signs, from + 2);
                const level = tag === '>' ? 0 : fixed - 2;
                let blanks = Math.max(from - level, 0);
                if (afterHeader && tag !== '>' && blanks === 0) blanks = 1;
                if (verbatim) {
                    release();
                    units.push(commentUnit(i, true, 0));
                } else {
                    const prefix = Array<string>(blanks).fill('');
                    for (const b of heldBlanks) units.push({ start: b, end: b, lines: [] });
                    heldComments.forEach((c, k) => units.push(commentUnit(c.i, c.verbatim, level, k ? [] : prefix)));
                    const text = indentFor(level, original) + '#'.repeat(fixed) + trimmed.slice(signs);
                    units.push({ start: i, end: i, lines: [...(heldComments.length ? [] : prefix), text] });
                    heldBlanks = [];
                    heldComments = [];
                }
                if (tag === '>') {
                    depth.length = 0;
                    depth.push(newSection(signs));
                    signsLevel = 0;
                } else {
                    // Closes sections with as many `#` or more, then opens its own.
                    while (depth.length && current().signs >= fixed) depth.pop();
                    depth.push(newSection(fixed, level + 1));
                    signsLevel = level + 1;
                }
                afterHeader = inHeaderBlock = tag === '>';
                last = 'comment';
                pending = {};
                continue;
            }

            let level: number;
            if (directive) {
                // Indented like a command; does not end a run of comments.
                if (directive.scope === 'command') Object.assign(pending, directive.overrides);
                else Object.assign(current()[directive.scope], directive.overrides);
                level = contentLevel();
            } else if (tag === '>') {
                depth.length = 0;
                depth.push(newSection(signs));
                level = signsLevel = 0;
                last = 'comment';
                pending = {};
            } else if (isHeading) {
                // Only without strict mode (indentation off): levels are tracked, nothing is rewritten.
                while (depth.length && current().signs >= signs) depth.pop();
                depth.push(newSection(signs, signs - 1));
                level = signs - 2;
                signsLevel = signs - 1;
                last = 'comment';
                pending = {};
            } else if (tag === '' && !signsStyle) {
                if (!(last === 'comment' && depth[depth.length - 1]?.signs === signs)) depth.push(newSection(signs));
                level = Math.max(depth.length - 1, 0);
                last = 'comment';
                pending = {};
            } else {
                // A plain `#` comment (signs style) or one we do not recognise (e.g. `#define`):
                // indented like a command.
                level = contentLevel();
                last = 'command';
                pending = {};
            }
            if (strict && !inHeaderBlock) {
                // Might belong to a heading on a following line.
                heldComments.push({ i, verbatim });
                continue;
            }
            units.push(commentUnit(i, verbatim, level));
            continue;
        }

        if (strict) release();
        afterHeader = inHeaderBlock = false;
        const end = commandEnd(lines, i);
        const group = lines.slice(i, end + 1);
        const o = overrides(pending);
        pending = {};
        const out = o.verbatim ? group : formatCommand(group, indentFor(contentLevel(), original), applyOverrides(opts, o));
        units.push({ start: i, end, lines: out });
        last = 'command';
        i = end;
    }
    if (strict) release();
    return units;
}

export function formatText(text: string, opts: FormatOptions, resourceId?: string): string {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    let lines = text.split(/\r?\n/);
    if (opts.header.enabled && resourceId) lines = applyHeader(lines, resourceId);
    return formatLines(lines, opts)
        .flatMap(u => u.lines)
        .join(eol);
}
