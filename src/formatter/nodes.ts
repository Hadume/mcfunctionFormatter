import { Mode } from './options';

/** A rendered line. The first line of a rendering is inline: its indent is ignored by the caller. */
export interface Line {
    indent: string;
    text: string;
}

export interface Node {
    /** Everything on one line (only `none` parts keep their original text). Used for thresholds. */
    flat(): string;
    render(indent: string): Line[];
}

/** Appends `b` to the last line of `a`. */
export function join(a: Line[], b: Line[], sep = ''): Line[] {
    const out = a.map(l => ({ ...l }));
    out[out.length - 1].text += sep + b[0].text;
    for (let k = 1; k < b.length; k++) out.push({ ...b[k] });
    return out;
}

/**
 * Lays out pieces one per line at `indent`, except that single-line pieces are packed
 * onto the previous line while it stays within `threshold` characters (indentation excluded).
 */
function pack(lines: Line[], pieces: Line[][], indent: string, threshold: number, gap = ' '): void {
    let current: Line | null = null;
    for (const piece of pieces) {
        if (piece.length === 1 && current && current.text.length + gap.length + piece[0].text.length <= threshold) {
            current.text += gap + piece[0].text;
            continue;
        }
        piece[0] = { indent, text: piece[0].text };
        lines.push(...piece);
        current = piece.length === 1 ? lines[lines.length - 1] : null;
    }
}

export class Text implements Node {
    constructor(readonly value: string) {}
    flat(): string {
        return this.value;
    }
    render(indent: string): Line[] {
        return [{ indent, text: this.value }];
    }
}

export class Concat implements Node {
    constructor(readonly parts: Node[]) {}
    flat(): string {
        return this.parts.map(p => p.flat()).join('');
    }
    render(indent: string): Line[] {
        return this.parts.reduce<Line[]>((acc, p) => join(acc, p.render(indent)), [{ indent, text: '' }]);
    }
}

/** A separator in `Words` that is a line break written by the user. */
export const LINE_BREAK = '\n';

/** Words of a plain command, kept with their original separators. */
export class Words implements Node {
    constructor(
        readonly words: Node[],
        readonly seps: string[],
        /** Indentation added to lines continued at a `LINE_BREAK`. */
        readonly unit = '',
    ) {}
    flat(): string {
        return this.words.map((w, k) => (k ? this.sep(k) : '') + w.flat()).join('');
    }
    private sep(k: number): string {
        return this.seps[k - 1] === LINE_BREAK ? ' ' : this.seps[k - 1];
    }
    render(indent: string): Line[] {
        let lines = this.words[0].render(indent);
        for (let k = 1; k < this.words.length; k++) {
            if (this.seps[k - 1] === LINE_BREAK) {
                const next = this.words[k].render(indent + this.unit);
                lines = [...lines, { indent: indent + this.unit, text: next[0].text }, ...next.slice(1)];
            } else {
                lines = join(lines, this.words[k].render(indent), this.seps[k - 1]);
            }
        }
        return lines;
    }
}

/** `key=value` in selectors, `key: value` in NBT. */
export class Pair implements Node {
    constructor(readonly key: string, readonly sep: string, readonly value: Node) {}
    flat(): string {
        return this.key + this.sep + this.value.flat();
    }
    render(indent: string): Line[] {
        return join([{ indent, text: this.key + this.sep }], this.value.render(indent));
    }
}

/** A bracketed, comma separated structure: selector arguments, scores maps, NBT compounds and lists. */
export class Block implements Node {
    constructor(
        readonly open: string,
        /** Typed array prefix such as `I;`. */
        readonly prefix: string,
        readonly items: Node[],
        readonly close: string,
        readonly raw: string,
        readonly mode: Mode,
        readonly threshold: number,
        readonly unit: string,
        /** Spaces after each comma; -1 keeps `seps`. */
        readonly commaSpaces: number,
        /** Text between consecutive items as written, comma included. */
        readonly seps: string[],
    ) {}

    private head(): string {
        if (!this.prefix) return this.open;
        return this.open + this.prefix + (this.items.length ? ' ' : '');
    }

    /** Separator before item `k` (k >= 1) when items share a line. */
    private sep(k: number): string {
        return this.commaSpaces < 0 ? this.seps[k - 1] : ',' + ' '.repeat(this.commaSpaces);
    }

    flat(): string {
        if (this.mode === 'none') return this.raw;
        return this.head() + this.items.map((item, k) => (k ? this.sep(k) : '') + item.flat()).join('') + this.close;
    }

    render(indent: string): Line[] {
        if (this.mode === 'none') return [{ indent, text: this.raw }];
        if (this.mode === 'expand' && this.items.length && this.flat().length > this.threshold) {
            const inner = indent + this.unit;
            const lines: Line[] = [{ indent, text: this.open + this.prefix }];
            const pieces = this.items.map((item, k) => {
                const r = item.render(inner);
                if (k < this.items.length - 1) r[r.length - 1].text += ',';
                return r;
            });
            pack(lines, pieces, inner, this.threshold, ' '.repeat(this.commaSpaces < 0 ? 1 : this.commaSpaces));
            lines.push({ indent, text: this.close });
            return lines;
        }
        let lines: Line[] = [{ indent, text: this.head() }];
        this.items.forEach((item, k) => {
            lines = join(lines, item.render(indent), k ? this.sep(k) : '');
        });
        return join(lines, [{ indent, text: this.close }]);
    }
}

/** `execute` with its subcommands grouped into segments and an optional `run` command. */
export class Execute implements Node {
    constructor(
        /** `execute`, then every argument word, ending with `run` if present. */
        readonly words: Node[],
        /** Index into `words` where each subcommand segment starts. */
        readonly segmentStarts: number[],
        readonly command: Node | null,
        /** Original separators between consecutive tokens (words, then the command). */
        readonly rawGaps: string[],
        readonly mode: Mode,
        readonly threshold: number,
        readonly unit: string,
    ) {}

    private tokens(): Node[] {
        return this.command ? [...this.words, this.command] : this.words;
    }

    flat(): string {
        if (this.mode === 'none') return this.tokens().map((t, k) => (k ? this.rawGaps[k - 1] : '') + t.flat()).join('');
        return this.tokens().map(t => t.flat()).join(' ');
    }

    render(indent: string): Line[] {
        const tokens = this.tokens();
        if (this.mode === 'none') {
            let lines = tokens[0].render(indent);
            for (let k = 1; k < tokens.length; k++) lines = join(lines, tokens[k].render(indent), this.rawGaps[k - 1]);
            return lines;
        }
        if (this.mode === 'format' || this.segmentStarts.length === 0 || this.flat().length <= this.threshold) {
            let lines = tokens[0].render(indent);
            for (let k = 1; k < tokens.length; k++) lines = join(lines, tokens[k].render(indent), ' ');
            return lines;
        }
        const lines = this.words[0].render(indent);
        const inner = indent + this.unit;
        const pieces = this.segmentStarts.map((start, s) => {
            const end = s + 1 < this.segmentStarts.length ? this.segmentStarts[s + 1] : this.words.length;
            let seg = this.words[start].render(inner);
            for (let k = start + 1; k < end; k++) seg = join(seg, this.words[k].render(inner), ' ');
            if (end === this.words.length && this.command) seg = join(seg, this.command.render(inner), ' ');
            return seg;
        });
        pack(lines, pieces, inner, this.threshold);
        return lines;
    }
}
