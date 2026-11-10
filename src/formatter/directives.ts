import { FormatOptions, Mode } from './options';

/**
 * Comment directives that override the settings: `#<key>[-<scope>][:<kinds>]`.
 *
 * - key: `ignore` (leave as written), `expand`, `flat` (one line, tidied only)
 * - scope: none (the next command), `section` (the rest of this `#` section, not its
 *   child sections), `all` (this section and its child sections)
 * - kinds: `execute`, `selector`, `nbt`, `attached`, comma separated; all when omitted
 *
 * e.g. `#ignore`, `#flat-section`, `#expand-all: nbt, selector`
 */
const DIRECTIVE = /^#(ignore|expand|flat)(?:-(section|all))?(?:\s*:\s*([a-z]+(?:\s*,\s*[a-z]+)*))?\s*$/i;

const KINDS = ['execute', 'selector', 'nbt', 'attached'] as const;
type Kind = (typeof KINDS)[number];

/** What a directive changes; unset fields fall through to the next layer. */
export interface Overrides extends Partial<Record<Kind, Mode>> {
    /** Leave the whole command (or comment) exactly as written. */
    verbatim?: boolean;
}

export interface Directive {
    scope: 'command' | 'section' | 'all';
    overrides: Overrides;
}

export function parseDirective(trimmed: string): Directive | undefined {
    const m = DIRECTIVE.exec(trimmed);
    if (!m) return undefined;
    const key = m[1].toLowerCase();
    const scope = (m[2]?.toLowerCase() ?? 'command') as Directive['scope'];
    const mode: Mode = key === 'ignore' ? 'none' : key === 'expand' ? 'expand' : 'format';
    const overrides: Overrides = {};
    if (m[3]) {
        const kinds = m[3].toLowerCase().split(',').map(k => k.trim());
        if (!kinds.every((k): k is Kind => (KINDS as readonly string[]).includes(k))) return undefined;
        for (const kind of kinds) overrides[kind] = mode;
    } else if (key === 'ignore') {
        overrides.verbatim = true;
    } else {
        overrides.verbatim = false;
        for (const kind of KINDS) overrides[kind] = mode;
    }
    return { scope, overrides };
}

/** The first layer that sets a field wins, so pass the nearest layer first. */
export function resolveOverrides(layers: Overrides[]): Overrides {
    const out: Overrides = {};
    for (const layer of layers.slice().reverse()) Object.assign(out, layer);
    return out;
}

export function applyOverrides(opts: FormatOptions, o: Overrides): FormatOptions {
    return {
        ...opts,
        execute: { ...opts.execute, mode: o.execute ?? opts.execute.mode },
        selector: { ...opts.selector, mode: o.selector ?? opts.selector.mode },
        nbt: { ...opts.nbt, mode: o.nbt ?? opts.nbt.mode },
        attached: { ...opts.attached, mode: o.attached ?? opts.attached.mode },
    };
}
