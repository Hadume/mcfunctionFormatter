import { Mode } from './options';

/** A rendered line. The first line of a rendering is inline: its indent is ignored by the caller. */
export interface Line {
    indent: string;
    text: string;
}

export interface Node {
    render(indent: string): Line[];
}

/** Appends `b` to the last line of `a`. */
export function join(a: Line[], b: Line[], sep = ''): Line[] {
    const out = a.map(l => ({ ...l }));
    out[out.length - 1].text += sep + b[0].text;
    for (let k = 1; k < b.length; k++) out.push({ ...b[k] });
    return out;
}

/** Lays out pieces one per line at `indent`. */
function stack(lines: Line[], pieces: Line[][], indent: string): void {
    for (const piece of pieces) {
        piece[0] = { indent, text: piece[0].text };
        lines.push(...piece);
    }
}

export class Text implements Node {
    constructor(readonly value: string) {}
    render(indent: string): Line[] {
        return [{ indent, text: this.value }];
    }
}

export class Concat implements Node {
    constructor(readonly parts: Node[]) {}
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

    render(indent: string): Line[] {
        if (this.mode === 'none') return [{ indent, text: this.raw }];
        if (this.mode === 'expand' && this.items.length) {
            const inner = indent + this.unit;
            const lines: Line[] = [{ indent, text: this.open + this.prefix }];
            const pieces = this.items.map((item, k) => {
                const r = item.render(inner);
                if (k < this.items.length - 1) r[r.length - 1].text += ',';
                return r;
            });
            stack(lines, pieces, inner);
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
        readonly unit: string,
    ) {}

    private tokens(): Node[] {
        return this.command ? [...this.words, this.command] : this.words;
    }

    render(indent: string): Line[] {
        const tokens = this.tokens();
        if (this.mode === 'none') {
            let lines = tokens[0].render(indent);
            for (let k = 1; k < tokens.length; k++) lines = join(lines, tokens[k].render(indent), this.rawGaps[k - 1]);
            return lines;
        }
        if (this.mode === 'format' || this.segmentStarts.length === 0) {
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
        stack(lines, pieces, inner);
        return lines;
    }
}
