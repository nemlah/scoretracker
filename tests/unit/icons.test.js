import { test } from 'node:test';
import assert from 'node:assert/strict';
import { icon } from '../../js/icons.js';

// The least a document has to be for icon(): createElementNS, and elements with setAttribute and append.
function fakeDocument() {
  const make = (ns, tag) => ({
    ns, tag, attributes: {}, children: [],
    setAttribute(name, value) { this.attributes[name] = value; },
    append(...nodes) { this.children.push(...nodes); },
  });
  return { createElementNS: make };
}

for (const name of ['goal', 'save', 'excl', 'pen']) {
  test(`icon('${name}') is a hidden 24-grid svg with a 2 px round stroke and one path`, () => {
    const svg = icon(name, fakeDocument());
    assert.equal(svg.tag, 'svg');
    assert.equal(svg.ns, 'http://www.w3.org/2000/svg');
    assert.equal(svg.attributes['aria-hidden'], 'true');
    assert.equal(svg.attributes.viewBox, '0 0 24 24');
    assert.equal(svg.attributes['stroke-width'], '2');
    assert.equal(svg.attributes['stroke-linecap'], 'round');
    assert.equal(svg.attributes['stroke-linejoin'], 'round');
    assert.equal(svg.attributes.fill, 'none');
    assert.equal(svg.attributes.stroke, 'currentColor');
    assert.equal(svg.children.length, 1);
    assert.equal(svg.children[0].tag, 'path');
    assert.match(svg.children[0].attributes.d, /^M[\d.\- a-zA-Z,]+$/);
  });
}

test('the four icons draw four different paths', () => {
  const paths = ['goal', 'save', 'excl', 'pen'].map(name => icon(name, fakeDocument()).children[0].attributes.d);
  assert.equal(new Set(paths).size, 4);
});

test('an unknown name throws, including an inherited property name', () => {
  assert.throws(() => icon('trophy', fakeDocument()), /Unknown icon: trophy/);
  assert.throws(() => icon('constructor', fakeDocument()), /Unknown icon/);
});
