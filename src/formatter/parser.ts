import { CommandNode, Walker, isGreedy } from './commands';
import { Block, Concat, Execute, LINE_BREAK, Node, Pair, Text, Words } from './nodes';
import { FormatOptions, indentString } from './options';
import { LogicalLine } from './source';

/**
 * Commands whose trailing argument is free text; the number is how many ordinary arguments come first.
 * Only used when the command tree is not available.
 */
export const GREEDY_COMMANDS: Record<string, number> = {
    say: 0, me: 0, teammsg: 0, tm: 0, tell: 1, msg: 1, w: 1,
};

/** Selector arguments whose `{...}` value is a `key=value` map rather than NBT. */
const MAP_ARGUMENTS = new Set(['scores', 'advancements']);

interface Parsed<T extends Node = Node> {
    node: T;
    end: number;
}

const isSpace = (c: string | undefined) => c === ' ' || c === '\t';

/**
 * Splits a logical command into nodes. It only tracks quotes and brackets,
 * so any input parses; structures that do not close are left as plain text.
 *
 * A `{` or `[` is handled by what comes right before it:
 * - start of a word: a value of its own (`nbt.mode`);
 * - `@a` etc.: a selector (`selector.mode`, NBT inside included);
 * - any other character of the word: attached to it, e.g. block states, item components,
 *   block entity NBT and NBT paths (`attached.mode`);
 * - a separator inside brackets (`=`, `~`, `:`, `,`, `[`): inherits from the enclosing bracket.
 */
export class Parser {
    private readonly s: string;
    /** While set, NBT is kept on one line even if `nbt.mode` is `expand`. */
    private flatNbt = false;

    constructor(private readonly line: LogicalLine, private readonly opts: FormatOptions) {
        this.s = line.text;
    }

    parseCommand(p: number): Node {
        const s = this.s;
        if (p >= s.length) return new Text('');
        const first = this.readWord(p);
        const name = s.slice(p, first.end);
        // `execute` is split by subcommand only when the command tree for the pack's version is known.
        if (name === 'execute' && this.opts.commands) return this.parseExecute(p, first, this.opts.commands);
        return this.parsePlain(p, first);
    }

    /** A command as space separated words; free text (`say ...`) is left as written. */
    private parsePlain(p: number, first: Parsed): Node {
        const s = this.s;
        const name = s.slice(p, first.end);
        const words: Node[] = [first.node];
        const seps: string[] = [];
        const tree = this.opts.commands;
        // With the tree, free text is found from the argument types; without it, from a fixed list.
        const node = tree?.children?.[name];
        let walker = node ? new Walker(node) : null;
        const greedy = tree ? undefined : GREEDY_COMMANDS[name];
        const keep = this.opts.command.keepLineBreaks;
        /** The separator as written; a `\` line break in it is kept as one if asked to. */
        const gap = (end: number, start: number) =>
            keep && this.line.rawGap(end, start).includes('\n') ? LINE_BREAK : s.slice(end, start);
        let i = first.end;
        while (true) {
            const start = this.skipSpaces(i);
            if (start >= s.length) break;
            seps.push(gap(i, start));
            const next = walker?.peek(this.wordAt(start));
            if ((next && isGreedy(next)) || (greedy !== undefined && words.length > greedy)) {
                words.push(new Text(keep ? this.line.raw(start, s.length) : s.slice(start)));
                break;
            }
            if (name === 'return' && words.length === 1 && this.wordAt(start) === 'run') {
                words.push(new Text('run'));
                i = start + 3;
                const cmd = this.skipSpaces(i);
                if (cmd < s.length) {
                    seps.push(gap(i, cmd));
                    words.push(this.parseCommand(cmd));
                }
                break;
            }
            const word = this.readWord(start);
            if (walker && (!walker.feed(s.slice(start, word.end)) || walker.redirected)) walker = null;
            words.push(word.node);
            i = word.end;
        }
        return words.length === 1 ? words[0] : new Words(words, seps, indentString(this.opts, this.opts.indent.size));
    }

    /**
     * Splits `execute` into subcommands by following the command tree: a subcommand starts at a
     * literal under `execute` and ends where the tree jumps back to `execute`. Words that do not fit
     * the tree mean the version or the command is not what we think: format it as a plain command.
     */
    private parseExecute(p: number, first: Parsed, tree: CommandNode): Node {
        const s = this.s;
        const execute = tree.children?.execute;
        if (!execute) return this.parsePlain(p, first);
        const words: Node[] = [first.node];
        const segmentStarts: number[] = [];
        const rawGaps: string[] = [];
        let command: Node | null = null;
        let walker: Walker | null = null;
        let i = first.end;
        while (true) {
            const start = this.skipSpaces(i);
            if (start >= s.length) break;
            rawGaps.push(this.line.rawGap(i, start));
            const word = this.readWord(start);
            const text = s.slice(start, word.end);
            if (!walker && text === 'run') {
                segmentStarts.push(words.length);
                words.push(word.node);
                i = word.end;
                const cmd = this.skipSpaces(i);
                if (cmd < s.length) {
                    rawGaps.push(this.line.rawGap(i, cmd));
                    command = this.parseCommand(cmd);
                }
                break;
            }
            if (!walker) {
                const subcommand = execute.children?.[text];
                if (subcommand?.type !== 'literal') return this.parsePlain(p, first);
                walker = new Walker(subcommand);
                segmentStarts.push(words.length);
            } else if (!walker.feed(text)) {
                return this.parsePlain(p, first);
            }
            if (walker.redirected) walker = null;
            words.push(word.node);
            i = word.end;
        }
        const { mode, threshold, indentSize } = this.opts.execute;
        return new Execute(words, segmentStarts, command, rawGaps, mode, threshold, indentString(this.opts, indentSize));
    }

    // ---- words ----

    /** Runs `fn` with NBT kept on one line (inside selectors and attached brackets that are not expanded). */
    private withFlatNbt<T>(flat: boolean, fn: () => T): T {
        const saved = this.flatNbt;
        this.flatNbt = saved || flat;
        try {
            return fn();
        } finally {
            this.flatNbt = saved;
        }
    }

    /** A `{...}` or `[...]` attached to the preceding characters of a word. */
    private parseAttached(p: number): Parsed | null {
        const mode = this.opts.attached.mode;
        const r = this.withFlatNbt(mode !== 'expand', () => (this.s[p] === '{' ? this.parseCompound(p) : this.parseGeneric(p)));
        if (r && mode === 'none') return { node: new Text(this.line.raw(p, r.end)), end: r.end };
        return r;
    }

    private readWord(p: number): Parsed {
        const s = this.s;
        const parts: Node[] = [];
        let buf = '';
        const flush = () => {
            if (buf) parts.push(new Text(buf));
            buf = '';
        };
        // A bracket that does not parse (unclosed, missing `:` ...) and everything after it
        // in the command is kept exactly as written, so formatting cannot make it worse.
        const keepRest = (from: number): Parsed => {
            flush();
            parts.push(new Text(this.line.raw(from, s.length)));
            return { node: parts.length === 1 ? parts[0] : new Concat(parts), end: s.length };
        };
        let i = p;
        while (i < s.length && !isSpace(s[i])) {
            const c = s[i];
            if (c === '"' || c === "'") {
                const end = this.readQuoted(i);
                buf += s.slice(i, end);
                i = end;
                continue;
            }
            if (c === '@' && /[a-z]/.test(s[i + 1] ?? '') && s[i + 2] === '[') {
                const sel = this.parseSelector(i + 2);
                if (!sel) return keepRest(i);
                buf += s.slice(i, i + 2);
                flush();
                parts.push(sel.node);
                i = sel.end;
                continue;
            }
            if (c === '{' || c === '[') {
                // At the start of a word: a compound, or a list (e.g. a text component array).
                // Anywhere else in the word: block states, item components, block entity NBT or an NBT path.
                const r = i > p
                    ? this.parseAttached(i)
                    : c === '{' ? this.parseCompound(i) : this.parseList(i) ?? this.parseGeneric(i);
                if (!r) return keepRest(i);
                flush();
                parts.push(r.node);
                i = r.end;
                continue;
            }
            buf += c;
            i++;
        }
        flush();
        return { node: parts.length === 1 ? parts[0] : new Concat(parts), end: i };
    }

    private wordAt(p: number): string {
        let i = p;
        while (i < this.s.length && !isSpace(this.s[i])) i++;
        return this.s.slice(p, i);
    }

    private skipSpaces(p: number): number {
        while (p < this.s.length && isSpace(this.s[p])) p++;
        return p;
    }

    private readQuoted(p: number): number {
        const q = this.s[p];
        let i = p + 1;
        while (i < this.s.length) {
            if (this.s[i] === '\\') i += 2;
            else if (this.s[i] === q) return i + 1;
            else i++;
        }
        return this.s.length;
    }

    /** Reads an unquoted value up to whitespace or one of `stops`, keeping `(...)` together (macros, SNBT functions). */
    private readToken(p: number, stops: string): number {
        let depth = 0;
        let i = p;
        while (i < this.s.length) {
            const c = this.s[i];
            if (c === '(') depth++;
            else if (c === ')' && depth > 0) depth--;
            else if (depth === 0 && (isSpace(c) || stops.includes(c))) break;
            i++;
        }
        return i;
    }

    /**
     * `[...]` that is not a list or selector (block states, item components, NBT path indices):
     * kept as written except that `=` / `~` get `selector.equalsSpaces`, and NBT inside is formatted.
     */
    private parseGeneric(p: number): Parsed | null {
        const spaces = this.opts.selector.equalsSpaces;
        const s = this.s;
        const parts: Node[] = [];
        let buf = '[';
        const flush = () => {
            if (buf) parts.push(new Text(buf));
            buf = '';
        };
        let i = p + 1;
        while (i < s.length) {
            const c = s[i];
            if (c === ']') {
                buf += c;
                flush();
                return { node: new Concat(parts), end: i + 1 };
            }
            if (c === '"' || c === "'") {
                const end = this.readQuoted(i);
                buf += s.slice(i, end);
                i = end;
                continue;
            }
            const r = c === '{' ? this.parseCompound(i) : c === '[' ? this.parseGeneric(i) : null;
            if (r) {
                flush();
                parts.push(r.node);
                i = r.end;
                continue;
            }
            if ((c === '=' || c === '~') && spaces >= 0) {
                buf = buf.replace(/[ \t]+$/, '') + this.separator(c, spaces, true, c);
                i = this.skipSpaces(i + 1);
                continue;
            }
            buf += c;
            i++;
        }
        return null;
    }

    // ---- selectors ----

    /** `=` or `:` with `spaces` spaces after it (and before it if `both`); -1 keeps what was written. */
    private separator(symbol: string, spaces: number, both: boolean, written: string): string {
        if (spaces < 0) return written;
        const pad = ' '.repeat(spaces);
        return (both ? pad : '') + symbol + pad;
    }

    private parseSelector(p: number): Parsed | null {
        const flat = this.opts.selector.mode !== 'expand';
        return this.withFlatNbt(flat, () => this.parseKeyValues(p, ']', key => (MAP_ARGUMENTS.has(key) ? 'map' : 'nbt')));
    }

    private parseMap(p: number): Parsed | null {
        return this.parseKeyValues(p, '}', () => 'map');
    }

    /** `[key=value, ...]` or `{key=value, ...}`. `braces` decides what a `{` value is for each key. */
    private parseKeyValues(p: number, close: string, braces: (key: string) => 'map' | 'nbt'): Parsed | null {
        const { mode, threshold, indentSize, equalsSpaces, commaSpaces } = this.opts.selector;
        const s = this.s;
        const items: Node[] = [];
        const seps: string[] = [];
        let i = this.skipSpaces(p + 1);
        while (true) {
            if (i >= s.length) return null;
            if (s[i] === close) {
                i++;
                break;
            }
            const keyEnd = this.readToken(i, '=,' + close);
            const key = s.slice(i, keyEnd);
            i = this.skipSpaces(keyEnd);
            if (!key || s[i] !== '=') return null;
            i = this.skipSpaces(i + 1);
            const sep = this.separator('=', equalsSpaces, true, s.slice(keyEnd, i));
            let negate = '';
            if (s[i] === '!') {
                const bang = i;
                i = this.skipSpaces(i + 1);
                negate = equalsSpaces < 0 ? s.slice(bang, i) : '!';
            }
            let value: Parsed | null;
            if (s[i] === '{') {
                value = braces(key) === 'map' ? this.parseMap(i) : this.parseCompound(i);
            } else if (s[i] === '"' || s[i] === "'") {
                const end = this.readQuoted(i);
                value = { node: new Text(s.slice(i, end)), end };
            } else {
                const end = this.readToken(i, ',' + close);
                value = { node: new Text(s.slice(i, end)), end };
            }
            if (!value) return null;
            const node = negate ? new Concat([new Text(negate), value.node]) : value.node;
            items.push(new Pair(key, sep, node));
            i = this.skipSpaces(value.end);
            if (s[i] === ',') {
                i = this.skipSpaces(i + 1);
                seps.push(s.slice(value.end, i));
            }
            else if (s[i] !== close) return null;
        }
        const unit = indentString(this.opts, indentSize);
        return { node: new Block(s[p], '', items, close, this.line.raw(p, i), mode, threshold, unit, commaSpaces, seps), end: i };
    }

    // ---- NBT ----

    private formatKey(key: string): string {
        if (!this.opts.nbt.quoteKeys || key.startsWith('"') || key.includes('$(')) return key;
        if (key.startsWith("'")) {
            let inner = '';
            const body = key.slice(1, key.endsWith("'") && key.length > 1 ? -1 : undefined);
            for (let k = 0; k < body.length; k++) {
                if (body[k] === '\\' && body[k + 1] === "'") {
                    inner += "'";
                    k++;
                } else if (body[k] === '\\') {
                    inner += body.slice(k, k + 2);
                    k++;
                } else if (body[k] === '"') {
                    inner += '\\"';
                } else {
                    inner += body[k];
                }
            }
            return `"${inner}"`;
        }
        return `"${key}"`;
    }

    private parseCompound(p: number): Parsed | null {
        const s = this.s;
        const items: Node[] = [];
        const seps: string[] = [];
        let i = this.skipSpaces(p + 1);
        while (true) {
            if (i >= s.length) return null;
            if (s[i] === '}') {
                i++;
                break;
            }
            const keyEnd = s[i] === '"' || s[i] === "'" ? this.readQuoted(i) : this.readToken(i, ':,{}[]');
            const key = s.slice(i, keyEnd);
            i = this.skipSpaces(keyEnd);
            if (!key || s[i] !== ':') return null;
            const valueStart = this.skipSpaces(i + 1);
            const sep = this.separator(':', this.opts.nbt.colonSpaces, false, s.slice(keyEnd, valueStart));
            const value = this.parseValue(valueStart, '}');
            if (!value) return null;
            items.push(new Pair(this.formatKey(key), sep, value.node));
            i = this.skipSpaces(value.end);
            if (s[i] === ',') {
                i = this.skipSpaces(i + 1);
                seps.push(s.slice(value.end, i));
            }
            else if (s[i] !== '}') return null;
        }
        return { node: this.nbtBlock('{', '', items, '}', p, i, seps), end: i };
    }

    private nbtBlock(open: string, prefix: string, items: Node[], close: string, start: number, end: number, seps: string[]): Block {
        const { threshold, indentSize } = this.opts.nbt;
        const mode = this.flatNbt && this.opts.nbt.mode === 'expand' ? 'format' : this.opts.nbt.mode;
        return new Block(open, prefix, items, close, this.line.raw(start, end), mode, threshold, indentString(this.opts, indentSize), this.opts.nbt.commaSpaces, seps);
    }

    private parseList(p: number): Parsed | null {
        const s = this.s;
        const items: Node[] = [];
        const seps: string[] = [];
        let prefix = '';
        let i = this.skipSpaces(p + 1);
        if (/[BIL]/.test(s[i] ?? '')) {
            const semi = this.skipSpaces(i + 1);
            if (s[semi] === ';') {
                prefix = s[i] + ';';
                i = this.skipSpaces(semi + 1);
            }
        }
        while (true) {
            if (i >= s.length) return null;
            if (s[i] === ']') {
                i++;
                break;
            }
            const value = this.parseValue(i, ']');
            if (!value) return null;
            items.push(value.node);
            i = this.skipSpaces(value.end);
            if (s[i] === ',') {
                i = this.skipSpaces(i + 1);
                seps.push(s.slice(value.end, i));
            }
            else if (s[i] !== ']') return null;
        }
        return { node: this.nbtBlock('[', prefix, items, ']', p, i, seps), end: i };
    }

    private parseValue(p: number, close: string): Parsed | null {
        const s = this.s;
        if (p >= s.length) return null;
        if (s[p] === '{') return this.parseCompound(p);
        if (s[p] === '[') return this.parseList(p);
        if (s[p] === '"' || s[p] === "'") {
            const end = this.readQuoted(p);
            return { node: new Text(s.slice(p, end)), end };
        }
        const end = this.readToken(p, ',' + close);
        if (end === p) return null;
        return { node: new Text(s.slice(p, end)), end };
    }
}
