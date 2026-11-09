// Renders images/icon.svg to images/icon.png for the Marketplace (at least 128x128 is required).
import { readFileSync, writeFileSync } from 'fs';
import { Resvg } from '@resvg/resvg-js';

const size = 256;
const svg = readFileSync(new URL('../images/icon.svg', import.meta.url), 'utf8');
const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
writeFileSync(new URL('../images/icon.png', import.meta.url), png);
console.log(`images/icon.png (${size}x${size})`);
