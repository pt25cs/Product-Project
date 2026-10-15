// Checks real text/background and control/boundary pairs against the CSS design tokens (WCAG 2.x contrast ratios).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/styles.css', import.meta.url), 'utf8');
const root = css.slice(css.indexOf(':root'), css.indexOf('}', css.indexOf(':root')));
const tok = Object.fromEntries([...root.matchAll(/--([\w-]+):\s*(#[0-9A-Fa-f]{6})/g)].map((m) => [m[1], m[2]]));
const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [foreground token, background token, minimum ratio, what it is]
const TEXT = [
  ['color-text', 'color-bg', 4.5, 'headings on canvas'], ['color-text', 'color-surface', 4.5, 'headings on cards'],
  ['color-text-secondary', 'color-surface', 4.5, 'body on cards'], ['color-text-secondary', 'color-bg', 4.5, 'body on canvas'], ['color-text-secondary', 'color-surface-subtle', 4.5, 'body on subtle'],
  ['color-text-muted', 'color-surface', 4.5, 'muted on cards'], ['color-text-muted', 'color-bg', 4.5, 'muted on canvas'], ['color-text-muted', 'color-surface-subtle', 4.5, 'muted on subtle'],
  ['color-on-primary', 'color-primary', 4.5, 'primary button label'], ['color-on-primary', 'color-primary-hover', 4.5, 'primary hover label'],
  ['color-primary', 'color-surface', 4.5, 'links on cards'], ['color-primary', 'color-bg', 4.5, 'links on canvas'], ['color-primary', 'color-primary-subtle', 4.5, 'selected nav / chips'],
  ['color-success', 'color-success-subtle', 4.5, 'success chip'], ['color-success', 'color-surface', 4.5, 'success text'],
  ['color-warning', 'color-warning-subtle', 4.5, 'warning chip'], ['color-danger', 'color-danger-subtle', 4.5, 'danger chip'], ['color-danger', 'color-surface', 4.5, 'danger text'],
  ['cat-quiet', 'cat-quiet-bg', 4.5, 'quiet event'], ['cat-away', 'cat-away-bg', 4.5, 'away event'], ['cat-guest', 'cat-guest-bg', 4.5, 'guest event'], ['cat-plans', 'cat-plans-bg', 4.5, 'plans event'],
];
// non-text: input / checkbox boundaries and focus ring need 3:1
const UI = [['color-control-border', 'color-surface', 3, 'input border'], ['color-control-border', 'color-bg', 3, 'control border on canvas'], ['color-focus', 'color-surface', 3, 'focus ring'], ['color-focus', 'color-bg', 3, 'focus ring on canvas'], ['color-primary', 'color-surface', 3, 'indigo accents']];

for (const [fg, bg, min, what] of [...TEXT, ...UI]) {
  test(`${what}: ${fg} on ${bg} ≥ ${min}:1`, () => {
    assert.ok(tok[fg] && tok[bg], `missing token ${fg} or ${bg}`);
    const r = ratio(tok[fg], tok[bg]);
    assert.ok(r >= min, `${tok[fg]} on ${tok[bg]} is ${r.toFixed(2)}:1`);
  });
}
test('required semantic tokens exist', () => {
  for (const t of ['color-bg', 'color-surface', 'color-text', 'color-text-secondary', 'color-text-muted', 'color-border', 'color-control-border', 'color-primary', 'color-primary-hover', 'color-primary-subtle', 'color-success', 'color-success-subtle', 'color-warning', 'color-warning-subtle', 'color-danger', 'color-danger-subtle', 'color-focus']) assert.ok(tok[t], t);
  assert.equal(tok['color-bg'], '#F8FAFC'); assert.equal(tok['color-primary'], '#4F46E5'); assert.equal(tok['color-text'], '#0F172A');
});
