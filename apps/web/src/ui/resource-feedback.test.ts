import { expect, it } from 'vitest';
import { resourceChange } from './ResourceMeter';

const before = { identity: 'hero:health', value: 30, maximum: 40, live: true };
it('only reports confirmed current-value changes for the same resource', () => {
  expect(resourceChange(before, { ...before, value: 22 })).toBe(-8);
  expect(resourceChange(before, { ...before, value: 35 })).toBe(5);
  expect(resourceChange(before, { ...before })).toBe(0);
});
it('does not label capacity changes, character switches or reconnect baselines as damage', () => {
  expect(resourceChange(before, { ...before, value: 22, maximum: 22 })).toBe(0);
  expect(resourceChange(before, { ...before, value: 22, identity: 'other:health' })).toBe(0);
  expect(resourceChange({ ...before, live: false }, { ...before, value: 22 })).toBe(0);
  expect(resourceChange(before, { ...before, value: 22, live: false })).toBe(0);
  expect(resourceChange(before, { ...before, value: NaN })).toBe(0);
});
