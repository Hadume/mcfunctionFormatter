/**
 * A command as Minecraft sees it: physical lines joined at trailing `\`,
 * with the continuation line's leading whitespace removed.
 * Keeps a map back to the original source so untouched (`none`) parts can be
 * emitted exactly as written, continuations included.
 */
export class LogicalLine {
    readonly text: string;
    private readonly map: number[];

    constructor(readonly source: string) {
        let text = '';
        const map: number[] = [];
        for (let i = 0; i < source.length; i++) {
            if (source[i] === '\\' && source[i + 1] === '\n') {
                i += 2;
                while (i < source.length && (source[i] === ' ' || source[i] === '\t')) i++;
                i--;
                continue;
            }
            if (source[i] === '\\' && i === source.length - 1) continue;
            text += source[i];
            map.push(i);
        }
        this.text = text;
        this.map = map;
    }

    /** Original source of the logical range [start, end). */
    raw(start: number, end: number): string {
        if (start >= end) return '';
        return this.source.slice(this.map[start], this.map[end - 1] + 1);
    }

    /** Original source between the token ending at `end` (exclusive) and the one starting at `start`. */
    rawGap(end: number, start: number): string {
        const from = end > 0 ? this.map[end - 1] + 1 : 0;
        const to = start < this.map.length ? this.map[start] : this.source.length;
        return this.source.slice(from, to);
    }
}
