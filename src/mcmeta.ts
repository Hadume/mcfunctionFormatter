import * as fs from 'fs/promises';
import * as https from 'https';
import * as path from 'path';
import type { CommandNode } from './formatter';

/**
 * Game data from misode/mcmeta (https://github.com/misode/mcmeta), generated from Minecraft's
 * data generator. Downloads are kept in the extension's storage and reused.
 */
const BASE = 'https://raw.githubusercontent.com/misode/mcmeta';
const VERSIONS_URL = `${BASE}/refs/heads/summary/versions/data.min.json`;
const commandsUrl = (id: string) => `${BASE}/${encodeURIComponent(id)}-summary/commands/data.min.json`;
/** The version list grows with every snapshot; the command tree of a version never changes. */
const VERSIONS_MAX_AGE = 24 * 60 * 60 * 1000;
/** After a failed download (e.g. offline), wait this long before trying again. */
const RETRY_AFTER = 60 * 1000;
const TIMEOUT = 8000;

interface VersionInfo {
    id: string;
    type: string;
    data_pack_version: number;
    data_pack_version_minor?: number;
}

/** A data pack format, `[major, minor]`. */
type Format = [number, number];

const compare = (a: Format, b: Format) => a[0] - b[0] || a[1] - b[1];

function fetchJson(url: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { timeout: TIMEOUT }, res => {
            if (res.statusCode !== 200) {
                res.resume();
                reject(new Error(`${url}: HTTP ${res.statusCode}`));
                return;
            }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => (body += chunk));
            res.on('end', () => {
                try {
                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('timeout', () => req.destroy(new Error(`${url}: timed out`)));
        req.on('error', reject);
    });
}

async function readJson(file: string): Promise<unknown> {
    return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^﻿/, ''));
}

/** `pack_format` 48 → [48, 0] as a lower bound, [48, ∞] as an upper one; `[94, 1]` as written. */
function toFormat(value: unknown, upper: boolean): Format | undefined {
    if (typeof value === 'number') return [value, upper ? Infinity : 0];
    if (Array.isArray(value) && typeof value[0] === 'number') {
        return [value[0], typeof value[1] === 'number' ? value[1] : upper ? Infinity : 0];
    }
    return undefined;
}

/** The formats the data pack containing `file` supports, from its `pack.mcmeta`. */
export async function packFormatRange(file: string): Promise<{ min: Format; max: Format } | undefined> {
    let dir = path.dirname(file);
    while (true) {
        const mcmeta = path.join(dir, 'pack.mcmeta');
        try {
            const pack = ((await readJson(mcmeta)) as { pack?: Record<string, unknown> }).pack ?? {};
            const min = toFormat(pack.min_format ?? pack.pack_format, false);
            const max = toFormat(pack.max_format ?? pack.pack_format, true);
            if (!min && !max) return undefined;
            return { min: min ?? [0, 0], max: max ?? [Infinity, Infinity] };
        } catch {
            // No (readable) pack.mcmeta here: look further up.
        }
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
    }
}

/** The newest release in the range, or the newest snapshot if no release is. */
export function chooseVersion(versions: VersionInfo[], range: { min: Format; max: Format }): VersionInfo | undefined {
    const inRange = versions.filter(v => {
        const f: Format = [v.data_pack_version, v.data_pack_version_minor ?? 0];
        return compare(f, range.min) >= 0 && compare(f, range.max) <= 0;
    });
    return inRange.find(v => v.type === 'release') ?? inRange[0];
}

export class Mcmeta {
    private versions?: VersionInfo[];
    private readonly trees = new Map<string, CommandNode>();
    private failedAt = 0;

    constructor(private readonly storage: string) {}

    /** The command tree for the game version of the data pack containing `file`, if it can be had. */
    async commandsFor(file: string): Promise<CommandNode | undefined> {
        const range = await packFormatRange(file);
        if (!range) return undefined;
        const versions = await this.getVersions();
        const version = versions && chooseVersion(versions, range);
        return version && this.getTree(version.id);
    }

    private async getVersions(): Promise<VersionInfo[] | undefined> {
        if (this.versions) return this.versions;
        const file = path.join(this.storage, 'versions.json');
        const age = await fs.stat(file).then(s => Date.now() - s.mtimeMs, () => Infinity);
        if (age > VERSIONS_MAX_AGE) {
            const fetched = await this.download(VERSIONS_URL, file);
            if (fetched) return (this.versions = fetched as VersionInfo[]);
        }
        // Fresh, or stale but the download failed: better than nothing.
        return (this.versions = (await readJson(file).catch(() => undefined)) as VersionInfo[] | undefined);
    }

    private async getTree(id: string): Promise<CommandNode | undefined> {
        const cached = this.trees.get(id);
        if (cached) return cached;
        const file = path.join(this.storage, 'commands', `${id.replace(/[^\w.-]/g, '_')}.json`);
        const tree = ((await readJson(file).catch(() => undefined)) ?? (await this.download(commandsUrl(id), file))) as CommandNode | undefined;
        if (tree) this.trees.set(id, tree);
        return tree;
    }

    private async download(url: string, file: string): Promise<unknown> {
        if (Date.now() - this.failedAt < RETRY_AFTER) return undefined;
        try {
            const data = await fetchJson(url);
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, JSON.stringify(data));
            return data;
        } catch {
            this.failedAt = Date.now();
            return undefined;
        }
    }
}
