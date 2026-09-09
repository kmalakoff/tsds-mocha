import assert from 'assert';

it('preserves ESM module identity', () => {
  const [majorString, minorString] = process.versions.node.split('.');
  const major = +majorString;
  const minor = +minorString;
  const expectedRequireType = major < 12 || (major === 12 && minor < 17) ? 'function' : 'undefined';
  const requireType = typeof require;
  assert.equal(requireType, expectedRequireType);
});
