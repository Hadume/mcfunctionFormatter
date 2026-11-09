import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { chooseVersion, packFormatRange } from '../src/mcmeta';

const versions = [
    { id: '26.4-snapshot-1', type: 'snapshot', data_pack_version: 122, data_pack_version_minor: 0 },
    { id: '26.3', type: 'release', data_pack_version: 121, data_pack_version_minor: 0 },
    { id: '26.3-rc1', type: 'snapshot', data_pack_version: 121, data_pack_version_minor: 0 },
    { id: '26.2', type: 'release', data_pack_version: 107, data_pack_version_minor: 1 },
    { id: '1.21.1', type: 'release', data_pack_version: 48 },
    { id: '1.21', type: 'release', data_pack_version: 48 },
];

function pack(mcmeta: object): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcf-'));
    fs.writeFileSync(path.join(root, 'pack.mcmeta'), JSON.stringify({ pack: mcmeta }));
    const dir = path.join(root, 'data', 'foo', 'function');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'a.mcfunction');
}

describe('version from pack.mcmeta', () => {
    it('uses pack_format', async () => {
        const range = await packFormatRange(pack({ pack_format: 48 }));
        expect(chooseVersion(versions, range!)?.id).toBe('1.21.1');
    });

    it('uses min_format / max_format, taking the newest release in range', async () => {
        const range = await packFormatRange(pack({ min_format: 48, max_format: [107, 1] }));
        expect(chooseVersion(versions, range!)?.id).toBe('26.2');
        const open = await packFormatRange(pack({ min_format: 48, max_format: 999 }));
        expect(chooseVersion(versions, open!)?.id).toBe('26.3');
    });

    it('falls back to a snapshot when no release is in range', async () => {
        const range = await packFormatRange(pack({ pack_format: 122 }));
        expect(chooseVersion(versions, range!)?.id).toBe('26.4-snapshot-1');
    });

    it('gives nothing without a pack.mcmeta or a known format', async () => {
        expect(await packFormatRange(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mcf-')), 'a.mcfunction'))).toBeUndefined();
        expect(chooseVersion(versions, (await packFormatRange(pack({ pack_format: 10 })))!)).toBeUndefined();
    });
});
