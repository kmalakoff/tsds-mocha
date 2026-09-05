// remove NODE_OPTIONS to not interfere with tests
delete process.env.NODE_OPTIONS;

import assert from 'assert';
import path from 'path';
import mocha from 'tsds-mocha';
import url from 'url';

const __dirname = path.dirname(typeof __filename !== 'undefined' ? __filename : url.fileURLToPath(import.meta.url));

// Proves the mocha this Node is routed to transpiles a test file whose raw form is valid JavaScript.
// stdio is inherited so a failure shows the fixture's own error, not just a non-zero exit code.
describe('transpile', () => {
  const fixture = path.join(__dirname, '..', 'data', 'generics');

  it('transpiles a call-site generic inside the it body', (done) => {
    mocha(['test/generic.test-test.ts'], { cwd: fixture, stdio: 'inherit' }, (err?: Error | null): void => {
      assert.ifError(err);
      done();
    });
  });

  it('transpiles a type annotation via the import() fallback', (done) => {
    mocha(['test/annotation.test-test.ts'], { cwd: fixture, stdio: 'inherit' }, (err?: Error | null): void => {
      assert.ifError(err);
      done();
    });
  });

  // Node's type stripper erases types without reading any tsconfig, so it cannot be the transpiler
  // for a library whose consumers choose their own target, paths, jsx and decorators.
  it('routes to a mocha whose transpiler honours the consumer tsconfig', (done) => {
    const semantics = path.join(__dirname, '..', 'data', 'tsconfig-semantics');
    mocha(['test/classFields.test-test.ts'], { cwd: semantics, stdio: 'inherit' }, (err?: Error | null): void => {
      assert.ifError(err);
      done();
    });
  });
});
