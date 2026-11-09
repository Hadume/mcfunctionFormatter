import type { CommandNode } from './commands';

export type Mode = 'expand' | 'format' | 'none';
export type IndentStyle = 'signs' | 'nested';

export interface FormatOptions {
    /** The editor's indentation unit (e.g. 4 spaces or a tab), used when an `indentSize` is -1. */
    indentUnit: string;
    /**
     * `signs`: `##` and deeper headings set the level from their number of `#`; `#` is a plain comment.
     * `nested`: MC-Datapack-Utility style; any `#` comment opens a level and blank lines close one.
     */
    indent: { enabled: boolean; size: number; style: IndentStyle };
    header: { enabled: boolean };
    /** Commands other than a split `execute`: keep the `\` line breaks written between their words. */
    command: { keepLineBreaks: boolean };
    execute: { mode: Mode; threshold: number; indentSize: number };
    /** Applies to selector arguments and to `scores` / `advancements` maps inside them. */
    selector: { mode: Mode; threshold: number; indentSize: number; equalsSpaces: number; commaSpaces: number };
    nbt: { mode: Mode; threshold: number; indentSize: number; quoteKeys: boolean; colonSpaces: number; commaSpaces: number };
    /** `{...}` / `[...]` attached to a word: block states, item components, block entity NBT, NBT paths. */
    attached: { mode: Mode };
    /**
     * The command tree of the pack's game version. Without it, version dependent formatting
     * (splitting `execute` into subcommands) is skipped and those commands are formatted as plain ones.
     */
    commands?: CommandNode;
}

export type PartialOptions = {
    [K in Exclude<keyof FormatOptions, 'commands'>]?: FormatOptions[K] extends object ? Partial<FormatOptions[K]> : FormatOptions[K];
} & { commands?: CommandNode };

export const defaultOptions: FormatOptions = {
    indentUnit: '    ',
    indent: { enabled: true, size: -1, style: 'signs' },
    header: { enabled: true },
    command: { keepLineBreaks: true },
    execute: { mode: 'expand', threshold: 0, indentSize: -1 },
    selector: { mode: 'format', threshold: 0, indentSize: -1, equalsSpaces: 0, commaSpaces: 1 },
    nbt: { mode: 'expand', threshold: 0, indentSize: -1, quoteKeys: false, colonSpaces: 1, commaSpaces: 1 },
    attached: { mode: 'format' },
};

/** Indentation string for an `indentSize` setting: -1 follows the editor. */
export function indentString(opts: FormatOptions, size: number): string {
    return size < 0 ? opts.indentUnit : ' '.repeat(size);
}

/** Drops undefined values so they fall back to the defaults. */
function defined<T extends object>(obj: T | undefined): Partial<T> {
    return Object.fromEntries(Object.entries(obj ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function resolveOptions(partial: PartialOptions = {}): FormatOptions {
    return {
        indentUnit: partial.indentUnit ?? defaultOptions.indentUnit,
        indent: { ...defaultOptions.indent, ...defined(partial.indent) },
        header: { ...defaultOptions.header, ...defined(partial.header) },
        command: { ...defaultOptions.command, ...defined(partial.command) },
        execute: { ...defaultOptions.execute, ...defined(partial.execute) },
        selector: { ...defaultOptions.selector, ...defined(partial.selector) },
        nbt: { ...defaultOptions.nbt, ...defined(partial.nbt) },
        attached: { ...defaultOptions.attached, ...defined(partial.attached) },
        commands: partial.commands,
    };
}
