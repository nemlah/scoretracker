import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = path => readFileSync(join(root, path), 'utf8');

// PNG header: 8 signature bytes, 4 length, 4 "IHDR", then width and height as 32-bit big-endian.
function pngSize(path) {
  const bytes = readFileSync(join(root, path));
  assert.equal(bytes.subarray(1, 4).toString('latin1'), 'PNG', `${path} is a PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test('icons exist at their sizes', () => {
  assert.deepEqual(pngSize('img/icon-180.png'), [180, 180]);
  assert.deepEqual(pngSize('img/icon-192.png'), [192, 192]);
  assert.deepEqual(pngSize('img/icon-512.png'), [512, 512]);
  assert.deepEqual(pngSize('img/og.png'), [1200, 630]);
});

test('manifest is valid', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.name, 'ANOG live score');
  assert.equal(manifest.short_name, 'ANOG');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.theme_color, '#0B1320');
  assert.equal(manifest.background_color, '#F4F6F8');
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(i => i.src === `img/icon-${size}.png`);
    assert.ok(icon, `manifest lists img/icon-${size}.png`);
    assert.equal(icon.sizes, `${size}x${size}`);
    assert.equal(icon.type, 'image/png');
  }
});

test('pages link the icons', () => {
  const index = read('index.html');
  const track = read('track.html');
  const touch = '<link rel="apple-touch-icon" href="img/icon-180.png">';
  assert.ok(index.includes(touch), 'index.html has the apple-touch-icon');
  assert.ok(track.includes(touch), 'track.html has the apple-touch-icon');
  assert.ok(index.includes('<link rel="manifest" href="manifest.webmanifest">'));
  assert.ok(index.includes('<meta property="og:title" content="ANOG live score">'));
  assert.ok(index.includes('<meta property="og:description" content="Every game, goal by goal">'));
  assert.ok(index.includes('<meta property="og:image" content="https://nemlah.github.io/scoretracker/img/og.png">'));
});

test('cache name is v2', () => {
  assert.ok(read('sw.js').includes('wp-shell-v2::'));
});

test('shell lists the manifest and icons', () => {
  const sw = read('sw.js');
  const shell = sw.slice(sw.indexOf('// SHELL-START'), sw.indexOf('// SHELL-END'));
  for (const file of ['manifest.webmanifest', 'img/icon-180.png', 'img/icon-192.png', 'img/icon-512.png']) {
    assert.ok(shell.includes(`'./${file}'`), `SHELL lists ./${file}`);
  }
  assert.ok(!shell.includes('og.png'), 'og.png stays out of the shell');
});
