/**
 * Brigadier command tree as published by misode/mcmeta (`<version>-summary/commands/data.json`).
 * Used to tell which words of `execute` start a subcommand and where an argument is free text.
 */
export interface CommandNode {
    type: 'root' | 'literal' | 'argument';
    children?: Record<string, CommandNode>;
    redirect?: string[];
    executable?: boolean;
    parser?: string;
    properties?: Record<string, unknown>;
}

/** How many space separated words an argument takes. */
function arity(node: CommandNode): number {
    switch (node.parser) {
        case 'minecraft:vec3':
        case 'minecraft:block_pos':
            return 3;
        case 'minecraft:vec2':
        case 'minecraft:rotation':
        case 'minecraft:column_pos':
            return 2;
        default:
            return 1;
    }
}

/** An argument that takes the rest of the command as text (`say`, `tell`, ...). */
export function isGreedy(node: CommandNode): boolean {
    return node.parser === 'minecraft:message' || (node.parser === 'brigadier:string' && node.properties?.type === 'greedy');
}

/** The child a word goes to: a literal with that name, otherwise the first argument. */
function pick(node: CommandNode, word: string): CommandNode | undefined {
    const children = node.children ?? {};
    const literal = children[word];
    if (literal?.type === 'literal') return literal;
    return Object.values(children).find(c => c.type === 'argument');
}

/** Follows a command's words down the tree, one word at a time. */
export class Walker {
    /** Words still to come for a multi-word argument (coordinates). */
    private pending = 0;

    constructor(private node: CommandNode) {}

    /** The node the next word would match, without consuming it. */
    peek(word: string): CommandNode | undefined {
        return this.pending > 0 ? this.node : pick(this.node, word);
    }

    /** Consumes a word; false when it does not fit the tree. */
    feed(word: string): boolean {
        if (this.pending > 0) {
            this.pending--;
            return true;
        }
        const next = pick(this.node, word);
        if (!next) return false;
        const words = next.type === 'argument' ? arity(next) : 1;
        // A macro could stand for several words; the count can no longer be trusted.
        if (words > 1 && word.includes('$(')) return false;
        this.node = next;
        this.pending = words - 1;
        return true;
    }

    /** The words so far complete a node that jumps elsewhere (back to `execute`, or to the root). */
    get redirected(): boolean {
        return this.pending === 0 && !!this.node.redirect;
    }
}
