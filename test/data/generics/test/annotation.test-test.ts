import assert from 'assert';

// A type annotation is invalid raw JavaScript, so mocha can never run this file untransformed:
// it covers the other leg, the import() fallback below 22.18 and Node's own stripping above it.
it('transpiles a type annotation via the import() fallback', () => {
  const n: number = 1;
  assert.equal(n, 1);
});
