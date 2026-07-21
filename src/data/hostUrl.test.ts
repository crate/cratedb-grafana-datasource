import { joinHostURL, splitHostURL } from './hostUrl';

describe('splitHostURL', () => {
  it.each([
    ['localhost:5432', { server: 'localhost', port: 5432 }],
    ['db.example.com:5433', { server: 'db.example.com', port: 5433 }],
    ['localhost', { server: 'localhost' }],
    ['', {}],
    ['   ', {}],
    // trailing colon while the user is still typing: keep everything as server
    ['localhost:', { server: 'localhost:' }],
    ['localhost:x', { server: 'localhost:x' }],
    ['localhost:99999', { server: 'localhost:99999' }],
    // IPv6, bracketed and raw
    ['[::1]:5432', { server: '::1', port: 5432 }],
    ['[2001:db8::1]', { server: '2001:db8::1' }],
    ['2001:db8::1', { server: '2001:db8::1' }],
    [':5432', { port: 5432 }],
  ])('%j → %j', (input, expected) => {
    expect(splitHostURL(input)).toEqual(expected);
  });
});

describe('joinHostURL', () => {
  it.each([
    [{ server: 'localhost', port: 5432 }, 'localhost:5432'],
    [{ server: 'localhost' }, 'localhost'],
    [{ port: 5432 }, ''],
    [{}, ''],
    [{ server: '::1', port: 5432 }, '[::1]:5432'],
    [{ server: '2001:db8::1' }, '[2001:db8::1]'],
  ])('%j → %j', (input, expected) => {
    expect(joinHostURL(input)).toBe(expected);
  });
});
