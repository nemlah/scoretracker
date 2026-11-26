import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as strings from '../../js/strings.js';
import * as model from '../../js/model.js';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('release-2 compatibility exports are gone', () => {
  assert.equal('TIMELINE_SAVES' in strings, false);
  assert.equal('TIMELINE_SAVES' in model, false);
  assert.doesNotMatch(read('js/strings.js'), /TIMELINE_SAVES/);
  assert.doesNotMatch(read('js/model.js'), /TIMELINE_SAVES/);
});

test('unused string keys are gone and their -For siblings stay', () => {
  for (const key of ['evGoalie', 'homeHeading', 'goalPlain', 'scorerLabel', 'evDelete']) {
    assert.equal(strings.hasString(key), false, key);
    assert.doesNotMatch(read('js/strings.js'), new RegExp(`\\b${key}:`), key);
  }
  for (const key of ['evGoalieFor', 'evDeleteFor']) assert.equal(strings.hasString(key), true, key);
});

test('release-2 CSS is gone and the shared blocks stay', () => {
  const viewer = read('css/viewer.css');
  assert.doesNotMatch(viewer, /home-live-text-slots|home-live-gap/);
  const tracker = read('css/tracker.css');
  assert.doesNotMatch(tracker, /R2 tracker markup/);
  assert.doesNotMatch(tracker, /body\.sit-up \.live-top::after/);
  assert.doesNotMatch(tracker, /body\.on-live \.bar \{/);
  assert.match(tracker, /Shared by R2 and R3/);
  assert.match(tracker, /body\.on-live \.bar--team \{/);
  const base = read('css/base.css');
  assert.doesNotMatch(base, /\.small/);
  assert.match(base, /^small \{ font-size: 0\.875rem; \}$/m);
});
