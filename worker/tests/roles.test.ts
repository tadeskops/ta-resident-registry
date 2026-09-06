import { describe, it, expect } from 'vitest';
import { HARD_CODED_ADMINS, isHardCodedAdmin, isValidEmail, normEmail, roleFor, isAtLeast } from '../src/lib/roles';

describe('roles', () => {
  it('has the two-email floor', () => {
    expect(HARD_CODED_ADMINS).toEqual(['samanasippa@gmail.com', 'ta.deskops@gmail.com']);
  });
  it('normalises email case + whitespace', () => {
    expect(normEmail('  Ta.Deskops@Gmail.com ')).toBe('ta.deskops@gmail.com');
  });
  it('identifies hard-coded admins', () => {
    expect(isHardCodedAdmin('ta.deskops@gmail.com')).toBe(true);
    expect(isHardCodedAdmin('someone@else.com')).toBe(false);
  });
  it('validates emails', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('nothing')).toBe(false);
  });
  it('roleFor returns ADMIN for floor even with empty roster', () => {
    expect(roleFor('samanasippa@gmail.com', { admins: [], managers: [] })).toBe('ADMIN');
  });
  it('roleFor promotes dynamic admins and managers', () => {
    const roster = { admins: [{ email: 'a@x.com' }], managers: [{ email: 'm@x.com' }] };
    expect(roleFor('a@x.com', roster)).toBe('ADMIN');
    expect(roleFor('m@x.com', roster)).toBe('MANAGER');
    expect(roleFor('r@x.com', roster)).toBe('RESIDENT');
  });
  it('roleFor returns UNKNOWN for empty email', () => {
    expect(roleFor('', { admins: [], managers: [] })).toBe('UNKNOWN');
  });
  it('isAtLeast respects the chain order', () => {
    expect(isAtLeast('ADMIN', 'RESIDENT')).toBe(true);
    expect(isAtLeast('MANAGER', 'ADMIN')).toBe(false);
    expect(isAtLeast('MANAGER', 'MANAGER')).toBe(true);
  });
});
