import * as vscode from 'vscode';
import { CommandNode, FormatOptions, IndentStyle, Mode, formatLines, formatText, resolveOptions, resourceIdFromPath } from './formatter';
import { Mcmeta } from './mcmeta';

let mcmeta: Mcmeta | undefined;

async function readOptions(document: vscode.TextDocument, formatting: vscode.FormattingOptions): Promise<FormatOptions> {
    const c = vscode.workspace.getConfiguration('mcfunctionFormatter', document.uri);
    let commands: CommandNode | undefined;
    if (mcmeta && document.uri.scheme === 'file') {
        commands = await mcmeta.commandsFor(document.uri.fsPath);
    }
    return resolveOptions({
        indentUnit: formatting.insertSpaces ? ' '.repeat(formatting.tabSize) : '\t',
        indent: {
            enabled: c.get<boolean>('indent.enabled'),
            size: c.get<number>('indent.size'),
            style: c.get<IndentStyle>('indent.style'),
        },
        header: { enabled: c.get<boolean>('header.enabled') },
        command: { keepLineBreaks: c.get<boolean>('command.keepLineBreaks') },
        execute: {
            mode: c.get<Mode>('execute.mode'),
            indentSize: c.get<number>('execute.indentSize'),
        },
        selector: {
            mode: c.get<Mode>('selector.mode'),
            indentSize: c.get<number>('selector.indentSize'),
            equalsSpaces: c.get<number>('selector.equalsSpaces'),
            commaSpaces: c.get<number>('selector.commaSpaces'),
        },
        nbt: {
            mode: c.get<Mode>('nbt.mode'),
            indentSize: c.get<number>('nbt.indentSize'),
            quoteKeys: c.get<boolean>('nbt.quoteKeys'),
            colonSpaces: c.get<number>('nbt.colonSpaces'),
            commaSpaces: c.get<number>('nbt.commaSpaces'),
        },
        attached: { mode: c.get<Mode>('attached.mode') },
        commands,
    });
}

function fullRange(document: vscode.TextDocument): vscode.Range {
    return new vscode.Range(0, 0, document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length);
}

const provider: vscode.DocumentFormattingEditProvider & vscode.DocumentRangeFormattingEditProvider = {
    async provideDocumentFormattingEdits(document, formatting) {
        const opts = await readOptions(document, formatting);
        const text = document.getText();
        const resourceId = document.uri.scheme === 'file' ? resourceIdFromPath(document.uri.fsPath) : undefined;
        const formatted = formatText(text, opts, resourceId);
        return formatted === text ? [] : [vscode.TextEdit.replace(fullRange(document), formatted)];
    },

    async provideDocumentRangeFormattingEdits(document, range, formatting) {
        const opts = await readOptions(document, formatting);
        // Indentation depends on everything above, so format the whole file and keep the units in range.
        const lines = Array.from({ length: document.lineCount }, (_, i) => document.lineAt(i).text);
        const units = formatLines(lines, opts).filter(u => u.end >= range.start.line && u.start <= range.end.line);
        if (units.length === 0) return [];
        const first = units[0];
        const last = units[units.length - 1];
        const target = new vscode.Range(first.start, 0, last.end, lines[last.end].length);
        const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
        const formatted = units.flatMap(u => u.lines).join(eol);
        return formatted === document.getText(target) ? [] : [vscode.TextEdit.replace(target, formatted)];
    },
};

export function activate(context: vscode.ExtensionContext): void {
    mcmeta = new Mcmeta(vscode.Uri.joinPath(context.globalStorageUri, 'mcmeta').fsPath);
    const selector: vscode.DocumentSelector = [{ language: 'mcfunction' }, { pattern: '**/*.mcfunction' }];
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(selector, provider),
        vscode.languages.registerDocumentRangeFormattingEditProvider(selector, provider),
    );
}

export function deactivate(): void {}
