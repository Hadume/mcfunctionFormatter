import { describe, expect, it } from 'vitest';
import { CommandNode, PartialOptions, formatLines, formatText, resolveOptions, resourceIdFromPath } from '../src/formatter';
import commands26 from './fixtures/commands-26.3.json';

/**
 * Most tests were written for the `nested` indent style; `signs` tests ask for it explicitly.
 * They run with the 26.3 command tree from misode/mcmeta unless they pass `commands: undefined`.
 */
const options = (partial: PartialOptions = {}) =>
    resolveOptions({ commands: commands26 as CommandNode, ...partial, indent: { style: 'nested', ...partial.indent } });

const fmt = (input: string[], partial: PartialOptions = {}, resourceId?: string) =>
    formatText(input.join('\n'), options(partial), resourceId).split('\n');

const flatAll: PartialOptions = {
    execute: { mode: 'format' },
    selector: { mode: 'format' },
    nbt: { mode: 'format' },
};

/** The layout agreed in the spec, before the defaults were changed. */
const expandAll: PartialOptions = {
    selector: { mode: 'expand', equalsSpaces: 1 },
    nbt: { quoteKeys: true },
};

describe('# indentation', () => {
    it('indents by comment level and dedents on blank lines', () => {
        expect(fmt([
            '#> foo:bar',
            '# description',
            '',
            '# init',
            'say a',
            '## sub',
            'say b',
            '',
            'say c',
            '',
            '# next',
            '  say d',
        ])).toEqual([
            '#> foo:bar',
            '# description',
            '',
            '# init',
            '    say a',
            '    ## sub',
            '        say b',
            '',
            '    say c',
            '',
            '# next',
            '    say d',
        ]);
    });

    it('treats #define-like lines as commands and ignores comments without a space', () => {
        expect(fmt(['# a', '#define foo', '#comment', 'say x'])).toEqual(['# a', '    #define foo', '    #comment', '    say x']);
    });

    it('keeps original indentation when disabled', () => {
        expect(fmt(['# a', '  say x', 'say y'], { indent: { enabled: false } })).toEqual(['# a', '  say x', 'say y']);
    });

    it('follows the editor unit at -1 and a fixed size otherwise', () => {
        expect(fmt(['# a', 'say x'], { indentUnit: '\t' })).toEqual(['# a', '\tsay x']);
        expect(fmt(['# a', 'say x'], { indentUnit: '\t', indent: { size: 2 } })).toEqual(['# a', '  say x']);
    });
});

describe('command tree', () => {
    it('follows argument counts instead of keywords', () => {
        expect(fmt(['execute if score @s run matches 1 positioned ~ ~1 ~ as @a run say hi'])).toEqual([
            'execute \\',
            '    if score @s run matches 1 \\',
            '    positioned ~ ~1 ~ \\',
            '    as @a \\',
            '    run say hi',
        ]);
    });

    it('finds free text from the argument types', () => {
        expect(fmt(['kick @s {not:nbt}', 'tellraw @a {text:"a"}'], { nbt: { mode: 'format' } })).toEqual(['kick @s {not:nbt}', 'tellraw @a {text: "a"}']);
    });

    it('formats execute as a plain command when the words do not fit the tree', () => {
        expect(fmt(['execute foo @s run say hi', '$execute positioned $(pos) run say hi'])).toEqual([
            'execute foo @s run say hi',
            '$execute positioned $(pos) run say hi',
        ]);
    });

    it('keeps line breaks written between the words of a plain command', () => {
        expect(fmt(['data modify storage a:b x \\', '        set value 1', 'say a \\', '   b'])).toEqual([
            'data modify storage a:b x \\',
            '    set value 1',
            'say a \\',
            '   b',
        ]);
        expect(fmt(['execute as @a \\', 'run say hi'], { commands: undefined })).toEqual(['execute as @a \\', '    run say hi']);
        expect(fmt(['data modify storage a:b x \\', 'set value 1'], { command: { keepLineBreaks: false } })).toEqual([
            'data modify storage a:b x set value 1',
        ]);
    });

    it('formats execute as a plain command without the tree, but NBT as usual', () => {
        expect(fmt(['execute as @a run data merge storage a:b {a:1}', 'say {a:1}'], { commands: undefined })).toEqual([
            'execute as @a run data merge storage a:b { \\',
            '    a: 1 \\',
            '}',
            'say {a:1}',
        ]);
    });
});

describe('signs indentation', () => {
    const signs: PartialOptions = { indent: { style: 'signs' } };

    it('is the default', () => {
        expect(formatText('## A\nsay a', resolveOptions())).toBe('## A\n    say a');
    });

    it('sets the level from the number of # and treats a single # as a plain comment', () => {
        expect(fmt([
            '#> foo:bar',
            '# desc',
            '## A',
            'say a',
            '',
            'say b',
            '### B',
            'say c',
            '# note',
            'say d',
            '## C',
            'say e',
        ], signs)).toEqual([
            '#> foo:bar',
            '# desc',
            '',
            '## A',
            '    say a',
            '',
            'say b',
            '## B',
            '    say c',
            '    # note',
            '    say d',
            '',
            '## C',
            '    say e',
        ]);
    });

    it('is idempotent', () => {
        const once = fmt(['## A', 'say a', '#### B', 'say b', '### C', 'say c', '## D', 'say d', '# about E', '', '', '## E', '#> x:y', 'say e'], signs);
        expect(fmt(once, signs)).toEqual(once);
    });

    it('cuts headings that skip levels down to one level deeper', () => {
        expect(fmt(['#### A', 'say a', '## B', '##### C', 'say c'], signs)).toEqual([
            '## A',
            '    say a',
            '',
            '## B',
            '    ### C',
            '        say c',
        ]);
    });

    it('puts exactly the blank lines a heading needs before it', () => {
        expect(fmt(['## A', 'say a', '', '', '### B', 'say b', '', '', '', '## C', '### D', 'say d', '#> x:y'], signs)).toEqual([
            '## A',
            '    say a',
            '    ### B',
            '        say b',
            '',
            '',
            '## C',
            '    ### D',
            '        say d',
            '',
            '',
            '#> x:y',
        ]);
    });

    it('adds a blank line before a same-level heading', () => {
        expect(fmt(['## A', 'say a', '## B', 'say b'], signs)).toEqual(['## A', '    say a', '', '## B', '    say b']);
    });

    it('keeps comments right above a heading with it', () => {
        expect(fmt(['## A', 'say a', '# about B', '#flat', '## B', 'say b', '# loose', '', '## C'], signs)).toEqual([
            '## A',
            '    say a',
            '',
            '# about B',
            '#flat',
            '## B',
            '    say b',
            '    # loose',
            '',
            '## C',
        ]);
        expect(fmt(['#> x:y', '# desc', '## A'], signs)).toEqual(['#> x:y', '# desc', '', '## A']);
    });

    it('goes back one indentation level per blank line', () => {
        expect(fmt(['## A', '### B', 'say b', '', 'say c', '', 'say d'], signs)).toEqual([
            '## A',
            '    ### B',
            '        say b',
            '',
            '    say c',
            '',
            'say d',
        ]);
    });

    it('closes one level per blank line', () => {
        expect(fmt(['## A', 'say a', '### B', 'say b', '', 'say c', '', 'say d'], signs)).toEqual([
            '## A',
            '    say a',
            '    ### B',
            '        say b',
            '',
            '    say c',
            '',
            'say d',
        ]);
    });

    it('scopes -section to the heading, excluding deeper headings', () => {
        expect(fmt([
            '## A',
            '#expand-section:execute',
            'execute as @a run say 1',
            '### B',
            'execute as @a run say 2',
            '## C',
            'execute as @a run say 3',
        ], { ...signs, ...flatAll })).toEqual([
            '## A',
            '    #expand-section:execute',
            '    execute \\',
            '        as @a \\',
            '        run say 1',
            '    ### B',
            '        execute as @a run say 2',
            '',
            '',
            '## C',
            '    execute as @a run say 3',
        ]);
    });

    it('does not add blank lines when indentation is disabled', () => {
        expect(fmt(['### A', 'say a', '## B'], { indent: { style: 'signs', enabled: false } })).toEqual(['### A', 'say a', '## B']);
    });
});

describe('header', () => {
    it('derives the id from the path', () => {
        expect(resourceIdFromPath('C:\\pack\\data\\foo\\function\\a\\b.mcfunction')).toBe('foo:a/b');
        expect(resourceIdFromPath('/pack/data/foo/functions/a.mcfunction')).toBeUndefined();
    });

    it('inserts a header with a blank line', () => {
        expect(fmt(['say hi'], {}, 'foo:bar')).toEqual(['#> foo:bar', '', 'say hi']);
    });

    it('overwrites a header with the wrong path', () => {
        expect(fmt(['#> foo:old', '', 'say hi'], {}, 'foo:bar')).toEqual(['#> foo:bar', '', 'say hi']);
    });

    it('can be disabled', () => {
        expect(fmt(['say hi'], { header: { enabled: false } }, 'foo:bar')).toEqual(['say hi']);
    });
});

describe('defaults', () => {
    it('expands execute and NBT but only tidies selectors', () => {
        expect(fmt(['execute as @e[type = zombie, tag=a] run data merge entity @s {a:1,"b" : 2}'])).toEqual([
            'execute \\',
            '    as @e[type=zombie, tag=a] \\',
            '    run data merge entity @s { \\',
            '        a: 1, \\',
            '        "b": 2 \\',
            '    }',
        ]);
    });
});

describe('expand', () => {
    const input = [
        '#> foo:bar',
        '',
        '# init',
        'execute as @e[type=zombie,tag=a,scores={hp=..10}] at @s run tellraw @s {text:"hi",color:"red"}',
        'function foo:macro {name:"a",list:[1,2]}',
    ];
    const expected = [
        '#> foo:bar',
        '',
        '# init',
        '    execute \\',
        '        as @e[ \\',
        '            type = zombie, \\',
        '            tag = a, \\',
        '            scores = { \\',
        '                hp = ..10 \\',
        '            } \\',
        '        ] \\',
        '        at @s \\',
        '        run tellraw @s { \\',
        '            "text": "hi", \\',
        '            "color": "red" \\',
        '        }',
        '    function foo:macro { \\',
        '        "name": "a", \\',
        '        "list": [ \\',
        '            1, \\',
        '            2 \\',
        '        ] \\',
        '    }',
    ];

    it('formats the spec example', () => {
        expect(fmt(input, expandAll)).toEqual(expected);
    });

    it('is idempotent', () => {
        expect(fmt(expected, expandAll)).toEqual(expected);
    });

    it('indents nested execute one level deeper', () => {
        expect(fmt(['execute as @a run execute at @s run say hi'])).toEqual([
            'execute \\',
            '    as @a \\',
            '    run execute \\',
            '        at @s \\',
            '        run say hi',
        ]);
    });

    it('keeps multi-word subcommands together', () => {
        expect(fmt(['execute positioned as @s rotated as @p facing entity @s eyes if score @s a matches 1.. store result score @s b run return 1'])).toEqual([
            'execute \\',
            '    positioned as @s \\',
            '    rotated as @p \\',
            '    facing entity @s eyes \\',
            '    if score @s a matches 1.. \\',
            '    store result score @s b \\',
            '    run return 1',
        ]);
    });

    it('expands a single-argument selector and negation', () => {
        expect(fmt(['kill @e[tag=!a]'], expandAll)).toEqual(['kill @e[ \\', '    tag = !a \\', ']']);
    });

    it('expands typed arrays and nested NBT', () => {
        expect(fmt(['data merge entity @s {UUID:[I;1,2],Tags:["a"],empty:{}}'])).toEqual([
            'data merge entity @s { \\',
            '    UUID: [I; \\',
            '        1, \\',
            '        2 \\',
            '    ], \\',
            '    Tags: [ \\',
            '        "a" \\',
            '    ], \\',
            '    empty: {} \\',
            '}',
        ]);
    });

    it('expands text component arrays', () => {
        expect(fmt(['tellraw @a ["",{text:"a"}]'])).toEqual([
            'tellraw @a [ \\',
            '    "", \\',
            '    { \\',
            '        text: "a" \\',
            '    } \\',
            ']',
        ]);
    });

    it('handles macro lines', () => {
        expect(fmt(['$execute as $(who) run function foo:bar {id:$(id)}'])).toEqual([
            '$execute \\',
            '    as $(who) \\',
            '    run function foo:bar { \\',
            '        id: $(id) \\',
            '    }',
        ]);
    });

    it('uses a separate indent size per kind', () => {
        expect(fmt(['execute as @a run data merge entity @s {a:1}'], { indentUnit: '\t', execute: { indentSize: 2 }, nbt: { indentSize: 3 } })).toEqual([
            'execute \\',
            '  as @a \\',
            '  run data merge entity @s { \\',
            '     a: 1 \\',
            '  }',
        ]);
    });
});

describe('threshold', () => {
    it('packs execute subcommands up to the width', () => {
        expect(fmt(['execute as @a at @s run say hello'], { execute: { threshold: 12 } })).toEqual([
            'execute \\',
            '    as @a at @s \\',
            '    run say hello',
        ]);
    });

    it('keeps the whole command on one line when it fits', () => {
        expect(fmt(['execute as @a run say hi'], { execute: { threshold: 24 } })).toEqual(['execute as @a run say hi']);
        expect(fmt(['execute as @a run say hi'], { execute: { threshold: 23 } })).toEqual([
            'execute \\',
            '    as @a run say hi',
        ]);
    });

    it('packs NBT and selector items, starting a new line after a multi-line item', () => {
        expect(fmt(['data merge entity @s {a:1,b:2,c:{d:1,e:2,f:3},g:3}'], { nbt: { threshold: 12 } })).toEqual([
            'data merge entity @s { \\',
            '    a: 1, b: 2, \\',
            '    c: { \\',
            '        d: 1, e: 2, \\',
            '        f: 3 \\',
            '    }, \\',
            '    g: 3 \\',
            '}',
        ]);
        expect(fmt(['kill @e[type=pig,tag=a,tag=b]'], { selector: { mode: 'expand', threshold: 16 } })).toEqual([
            'kill @e[ \\',
            '    type=pig, tag=a, \\',
            '    tag=b \\',
            ']',
        ]);
    });
});

describe('NBT kept on one line', () => {
    it('inside selectors unless selectors expand', () => {
        expect(fmt(['kill @e[nbt={Tags:["a"]}]'])).toEqual(['kill @e[nbt={Tags: ["a"]}]']);
        expect(fmt(['kill @e[nbt={a:1}]'], { selector: { mode: 'expand' } })).toEqual([
            'kill @e[ \\',
            '    nbt={ \\',
            '        a: 1 \\',
            '    } \\',
            ']',
        ]);
    });

    it('when attached to a word, unless attached.mode is expand', () => {
        expect(fmt(['setblock ~ ~ ~ chest{Items:[{a:1}]}', 'clear @s stone[custom_data~{"remove":true}]'])).toEqual([
            'setblock ~ ~ ~ chest{Items: [{a: 1}]}',
            'clear @s stone[custom_data~{"remove": true}]',
        ]);
        expect(fmt(['setblock ~ ~ ~ chest{Items:[1]}'], { attached: { mode: 'expand' } })).toEqual([
            'setblock ~ ~ ~ chest{ \\',
            '    Items: [ \\',
            '        1 \\',
            '    ] \\',
            '}',
        ]);
        expect(fmt(['clear @s stone[custom_data ~ {a:1}]', 'data get storage a:b x{y :1}'], { attached: { mode: 'none' }, selector: { equalsSpaces: 1 } }))
            .toEqual(['clear @s stone[custom_data ~ {a:1}]', 'data get storage a:b x{y :1}']);
    });

    it('in NBT paths', () => {
        expect(fmt([
            'data get storage test: A[{B:true}]',
            'data remove entity @s Inventory[{Slot:0b}]',
            'data modify block ~ ~ ~ Items[{id:"stone"}].count set from storage a:b x{y:1}',
            'function foo:bar with storage a:b list[{c:1}]',
        ])).toEqual([
            'data get storage test: A[{B: true}]',
            'data remove entity @s Inventory[{Slot: 0b}]',
            'data modify block ~ ~ ~ Items[{id: "stone"}].count set from storage a:b x{y: 1}',
            'function foo:bar with storage a:b list[{c: 1}]',
        ]);
        expect(fmt(['execute if data storage a:b A[{B:true}] store result storage a:b C{D:1} int 1 run say hi'], { execute: { mode: 'format' } }))
            .toEqual(['execute if data storage a:b A[{B: true}] store result storage a:b C{D: 1} int 1 run say hi']);
    });

    it('but still expands NBT values', () => {
        expect(fmt(['data merge storage a:b {a:1}', 'data modify storage a:b x set value {a:1}'])).toEqual([
            'data merge storage a:b { \\',
            '    a: 1 \\',
            '}',
            'data modify storage a:b x set value { \\',
            '    a: 1 \\',
            '}',
        ]);
    });
});

describe('item components and block states', () => {
    it('space `=` and `~` like selectors', () => {
        expect(fmt(['clear @s stone[custom_data~{"remove":true},damage = 1]'], { selector: { equalsSpaces: 1 }, nbt: { mode: 'format' } }))
            .toEqual(['clear @s stone[custom_data ~ {"remove": true},damage = 1]']);
        expect(fmt(['setblock ~ ~ ~ stone[facing = north]'])).toEqual(['setblock ~ ~ ~ stone[facing=north]']);
        expect(fmt(['clear @s stone[custom_data ~{a:1}]'], { selector: { equalsSpaces: -1 }, nbt: { mode: 'format' } }))
            .toEqual(['clear @s stone[custom_data ~{a: 1}]']);
    });
});

describe('spacing', () => {
    it('uses the given number of spaces', () => {
        expect(fmt(['tp @e[type=pig] {a:1}'], { ...flatAll, selector: { mode: 'format', equalsSpaces: 2 }, nbt: { mode: 'format', colonSpaces: 0 } }))
            .toEqual(['tp @e[type  =  pig] {a:1}']);
    });

    it('sets the spaces after commas', () => {
        expect(fmt(['kill @e[type=pig,tag=a]', 'data merge storage a:b {a:[1,2],b:2}'], { selector: { commaSpaces: 0 }, nbt: { mode: 'format', commaSpaces: 2 } }))
            .toEqual(['kill @e[type=pig,tag=a]', 'data merge storage a:b {a: [1,  2],  b: 2}']);
        expect(fmt(['kill @e[type=pig ,tag=a,  tag=b]', 'data merge storage a:b {a:1 ,b:2}'], { selector: { commaSpaces: -1 }, nbt: { mode: 'format', commaSpaces: -1 } }))
            .toEqual(['kill @e[type=pig ,tag=a,  tag=b]', 'data merge storage a:b {a: 1 ,b: 2}']);
        expect(fmt(['data merge storage a:b {a:1,b:2,c:3}'], { nbt: { threshold: 20, commaSpaces: 0 } })).toEqual(['data merge storage a:b {a: 1,b: 2,c: 3}']);
        expect(fmt(['data merge storage a:b {a:1,b:2,c:3}'], { nbt: { threshold: 10, commaSpaces: 0 } })).toEqual([
            'data merge storage a:b { \\',
            '    a: 1,b: 2, \\',
            '    c: 3 \\',
            '}',
        ]);
    });

    it('keeps the written spacing at -1', () => {
        expect(fmt(['tp @e[type =pig,tag= ! a] {a :1,b:  2}'], { ...flatAll, selector: { mode: 'format', equalsSpaces: -1 }, nbt: { mode: 'format', colonSpaces: -1 } }))
            .toEqual(['tp @e[type =pig, tag= ! a] {a :1, b:  2}']);
    });
});

describe('format', () => {
    it('collapses to one line and normalises keys and spacing', () => {
        expect(fmt([
            'execute as @e[type=zombie,tag=a] \\',
            '    at @s run tellraw @s {text:"hi",\'col\':"red"}',
        ], { ...flatAll, nbt: { mode: 'format', quoteKeys: true } })).toEqual(['execute as @e[type=zombie, tag=a] at @s run tellraw @s {"text": "hi", "col": "red"}']);
    });

    it('leaves strings, block states and greedy text alone', () => {
        expect(fmt([
            'setblock ~ ~ ~ chest[facing=north]{Items:[]}',
            'say {not:nbt} @e[tag=x]',
            'give @s stone[custom_name=\'{"text":"a b"}\']',
        ], flatAll)).toEqual([
            'setblock ~ ~ ~ chest[facing=north]{Items: []}',
            'say {not:nbt} @e[tag=x]',
            'give @s stone[custom_name=\'{"text":"a b"}\']',
        ]);
    });

    it('leaves broken input as written', () => {
        expect(fmt(['tellraw @a {text:"a"', 'kill @e[type=', 'say "unterminated'], flatAll)).toEqual([
            'tellraw @a {text:"a"',
            'kill @e[type=',
            'say "unterminated',
        ]);
    });
});

describe('broken structure', () => {
    it('restores a `\\` forgotten inside brackets', () => {
        expect(fmt([
            'data modify storage test: A set value { \\',
            '    "a": true,',
            '    "b": 1 \\',
            '}',
            'say next',
        ])).toEqual([
            'data modify storage test: A set value { \\',
            '    "a": true, \\',
            '    "b": 1 \\',
            '}',
            'say next',
        ]);
        expect(fmt(['tellraw @a {', 'text:"a"', '}'])).toEqual(['tellraw @a { \\', '    text: "a" \\', '}']);
    });

    it('does not join when the brackets never close', () => {
        expect(fmt(['# a', 'tellraw @a {text:"a"', 'say b', '', 'say c'])).toEqual(['# a', '    tellraw @a {text:"a"', '    say b', '', 'say c']);
        expect(fmt(['tellraw @a {text:"a"', '# comment', '}'])).toEqual(['tellraw @a {text:"a"', '# comment', '    }']);
    });

    it('does not count brackets in free text', () => {
        expect(fmt(['say {', 'say }'])).toEqual(['say {', 'say }']);
    });

    it('leaves the part it cannot parse as written and formats the rest', () => {
        expect(fmt(['# a', 'data merge storage a:b { \\', '  a 1 \\', '}'])).toEqual(['# a', '    data merge storage a:b { \\', '  a 1 \\', '}']);
        expect(fmt(['execute as @e[type=pig \\', '  at @s run say hi'])).toEqual(['execute \\', '    as @e[type=pig \\', '  at @s run say hi']);
        expect(fmt(['execute as @a at @s run data merge storage a:b {a 1,b:{c:1}}'])).toEqual([
            'execute \\',
            '    as @a \\',
            '    at @s \\',
            '    run data merge storage a:b {a 1,b:{c:1}}',
        ]);
    });
});

describe('none', () => {
    it('keeps execute exactly as written, continuations included', () => {
        expect(fmt(['execute as @a \\', '  at @s run say hi'], { execute: { mode: 'none' } })).toEqual(['execute as @a \\', '  at @s run say hi']);
    });

    it('keeps NBT as written while the execute is expanded', () => {
        expect(fmt(['execute as @a run data merge entity @s {a:1, \\', '  b:2}'], { nbt: { mode: 'none' } })).toEqual([
            'execute \\',
            '    as @a \\',
            '    run data merge entity @s {a:1, \\',
            '  b:2}',
        ]);
    });

    it('keeps selectors and scores maps as written', () => {
        expect(fmt(['kill @e[type=pig , scores={a=1,b=2}]'], { selector: { mode: 'none' } })).toEqual(['kill @e[type=pig , scores={a=1,b=2}]']);
    });
});

describe('#ignore', () => {
    it('leaves the next command exactly as written', () => {
        expect(fmt([
            '# a',
            '#ignore',
            'execute as @a \\',
            '      run data merge entity @s {a:1}',
            'execute as @a run say hi',
        ])).toEqual([
            '# a',
            '    #ignore',
            'execute as @a \\',
            '      run data merge entity @s {a:1}',
            '    execute \\',
            '        as @a \\',
            '        run say hi',
        ]);
    });

    it('only applies to the line right after it', () => {
        expect(fmt(['#Ignore', '', 'execute as @a run say hi'], flatAll)).toEqual(['#Ignore', '', 'execute as @a run say hi']);
        expect(fmt(['#IGNORE', '  say  hi'], flatAll)).toEqual(['#IGNORE', '  say  hi']);
    });
});

describe('directives', () => {
    const section = [
        '# A',
        '#DIRECTIVE',
        'execute as @a run say 1',
        '## child',
        'execute as @a run say 2',
        '',
        'execute as @a run say 3',
        '',
        'execute as @a run say 4',
    ];
    const run = (directive: string) => fmt(section.map(l => (l === '#DIRECTIVE' ? directive : l)), flatAll);

    it('-section applies to the rest of the section, skipping child sections', () => {
        expect(run('#expand-section:execute')).toEqual([
            '# A',
            '    #expand-section:execute',
            '    execute \\',
            '        as @a \\',
            '        run say 1',
            '    ## child',
            '        execute as @a run say 2',
            '',
            '    execute \\',
            '        as @a \\',
            '        run say 3',
            '',
            'execute as @a run say 4',
        ]);
    });

    it('-deep also applies to child sections', () => {
        expect(run('#expand-deep: execute')).toEqual([
            '# A',
            '    #expand-deep: execute',
            '    execute \\',
            '        as @a \\',
            '        run say 1',
            '    ## child',
            '        execute \\',
            '            as @a \\',
            '            run say 2',
            '',
            '    execute \\',
            '        as @a \\',
            '        run say 3',
            '',
            'execute as @a run say 4',
        ]);
    });

    it('#ignore-deep leaves commands, comments and indentation as written', () => {
        expect(fmt(['# A', '#ignore-deep', ' say  1', '## child', 'say {a:1}', '', '', 'say 2'])).toEqual([
            '# A',
            '    #ignore-deep',
            ' say  1',
            '## child',
            'say {a:1}',
            '',
            '',
            'say 2',
        ]);
    });

    it('the nearest directive wins', () => {
        expect(fmt(['#ignore-section', 'kill @e[tag=a]', '#flat', 'data merge storage a:b {a:1}', 'data merge storage a:b {a:1}'])).toEqual([
            '#ignore-section',
            'kill @e[tag=a]',
            '#flat',
            'data merge storage a:b {a: 1}',
            'data merge storage a:b {a:1}',
        ]);
    });

    it('limits a directive to the listed kinds and stacks consecutive ones', () => {
        expect(fmt(['#expand: selector', '#flat:nbt', 'execute as @e[tag=a] run data merge storage a:b {a:1}'])).toEqual([
            '#expand: selector',
            '#flat:nbt',
            'execute \\',
            '    as @e[ \\',
            '        tag=a \\',
            '    ] \\',
            '    run data merge storage a:b {a: 1}',
        ]);
        expect(fmt(['#ignore:nbt', 'execute as @a run data merge storage a:b {a :1}'])).toEqual([
            '#ignore:nbt',
            'execute \\',
            '    as @a \\',
            '    run data merge storage a:b {a :1}',
        ]);
    });

    it('treats unknown keys and kinds as ordinary lines', () => {
        expect(fmt(['#expand:foo', '#ignored', 'execute as @a run say hi'], flatAll)).toEqual(['#expand:foo', '#ignored', 'execute as @a run say hi']);
    });
});

describe('range units', () => {
    it('groups continued lines into one unit', () => {
        const units = formatLines(['# a', 'execute as @a \\', '  run say hi', 'say b'], options(flatAll));
        expect(units.map(u => [u.start, u.end, u.lines])).toEqual([
            [0, 0, ['# a']],
            [1, 2, ['    execute as @a run say hi']],
            [3, 3, ['    say b']],
        ]);
    });
});

it('keeps CRLF line endings', () => {
    expect(formatText('# a\r\nsay x\r\n', options())).toBe('# a\r\n    say x\r\n');
});
