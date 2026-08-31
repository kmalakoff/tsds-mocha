import assert from 'assert';
import mocha from 'tsds-mocha';

describe('exports .ts', () => {
  it('defaults', () => {
    assert.equal(typeof mocha, 'function');
  });
});
