import assert from 'assert';

// Mocha's require() rescues any top-level error via its import() fallback, so a raw generic must
// sit inside the it body — evaluated only when mocha calls it — to actually exercise that path.
it('transpiles a call-site generic used inside the test body', () => {
  const xs = [1].map<number>((n) => n);
  assert.equal(xs[0], 1);
});
