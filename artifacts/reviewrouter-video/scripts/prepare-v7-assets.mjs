/**
 * Prepare V7's own audio cues and product fonts.
 * The fonts are copied from existing apps/web/app/fonts (SIL OFL 1.1).
 * Do not commit the copies or redistribute font binaries with the video.
 * All SFX are originally synthesized here, deterministic and royalty-free.
 */
import {copyFileSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fontSrc = resolve(root, '../../apps/web/app/fonts');
const fontDst = resolve(root, 'public/v7-fonts');
mkdirSync(fontDst, {recursive: true});
for (const name of ['space-grotesk-latin-variable.woff2', 'jetbrains-mono-latin-variable.woff2']) {
  const original = resolve(fontSrc, name);
  if (!existsSync(original)) {
    throw new Error('Missing product font (must run from monorepo checkout): ' + original);
  }
  copyFileSync(original, resolve(fontDst, name));
}
const waveDir = resolve(root, 'public/v7-sfx');
mkdirSync(waveDir, {recursive: true});
const SR = 48000;
const clamp = (v) => Math.max(-1, Math.min(1, v));
const pi2 = Math.PI * 2;
const wave = (name, secs, synth) => {
  const size = Math.round(secs * SR);
  const data = Buffer.alloc(size * 2);
  for (let i = 0; i < size; i++) {
    const t = i / SR;
    data.writeInt16LE(Math.round(clamp(synth(t, secs)) * 28000), i * 2);
  }
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4);
  b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(SR, 24); b.writeUInt32LE(SR * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(data.length, 40);
  writeFileSync(resolve(waveDir, name), Buffer.concat([b, data]));
};
const pulse = (t, start, dur, freq) => {
  const q = (t - start) / dur;
  return q < 0 || q > 1 ? 0 : Math.sin(Math.PI * q) ** 1.25 * Math.sin(pi2 * freq * (t - start));
};
wave('click.wav', .23, t => .16 * pulse(t, 0, .08, 960) + .11 * pulse(t, .012, .065, 490));
wave('success.wav', .62, t => .18 * pulse(t, 0, .22, 610) + .13 * pulse(t, .13, .24, 835) + .10 * pulse(t, .27, .29, 1170));
wave('finding.wav', .63, t => .17 * pulse(t, 0, .2, 420) + .11 * pulse(t, .1, .42, 610));
console.log('[V7 assets] Product fonts copied locally; 3 original SFX written.');
