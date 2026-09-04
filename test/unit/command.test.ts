import assert from 'assert';
import fs from 'fs';
import Module from 'module';
import * as resolve from 'resolve';

import { mochaBin, selectMochaBin } from '../../src/command.ts';

const resolveSync = (resolve.default ?? resolve).sync;

// Extracts the leading major.minor from an engines.node range string for floor comparisons.
function floorMajorMinor(range: string): [number, number] {
  const match = range.match(/(\d+)\.(\d+)/);
  return match ? [+match[1], +match[2]] : [0, 0];
}

describe('selectMochaBin', () => {
  describe('Node version selection', () => {
    it('returns mocha-compat-3 below Node 12.17', () => {
      assert.equal(selectMochaBin(10, 0, false, false), 'mocha-compat-3');
      assert.equal(selectMochaBin(11, 0, false, false), 'mocha-compat-3');
      assert.equal(selectMochaBin(0, 10, false, false), 'mocha-compat-3');
      assert.equal(selectMochaBin(12, 16, false, false), 'mocha-compat-3');
    });

    it('returns mocha-compat-10 for Node 12.17+ without require_module', () => {
      assert.equal(selectMochaBin(12, 17, false, false), 'mocha-compat-10');
      assert.equal(selectMochaBin(14, 0, false, false), 'mocha-compat-10');
      assert.equal(selectMochaBin(16, 0, false, false), 'mocha-compat-10');
      assert.equal(selectMochaBin(18, 0, false, false), 'mocha-compat-10');
      assert.equal(selectMochaBin(20, 0, false, false), 'mocha-compat-10');
    });

    it('returns mocha-compat-10 for require_module without registerHooks', () => {
      assert.equal(selectMochaBin(20, 19, true, false), 'mocha-compat-10');
      assert.equal(selectMochaBin(20, 20, true, false), 'mocha-compat-10');
      assert.equal(selectMochaBin(22, 12, true, false), 'mocha-compat-10');
      assert.equal(selectMochaBin(22, 14, true, false), 'mocha-compat-10');
    });

    it('returns mocha once registerHooks joins require_module', () => {
      assert.equal(selectMochaBin(22, 15, true, true), 'mocha');
      assert.equal(selectMochaBin(24, 0, true, true), 'mocha');
      assert.equal(selectMochaBin(26, 0, true, true), 'mocha');
    });
  });
});

describe('mochaBin (runtime export)', () => {
  it('exports a string', () => {
    assert.equal(typeof mochaBin, 'string');
  });

  it('is one of the valid mocha binaries', () => {
    const validBinaries = ['mocha-compat-3', 'mocha-compat-10', 'mocha'];
    assert.ok(validBinaries.indexOf(mochaBin) >= 0, `mochaBin "${mochaBin}" should be one of ${validBinaries.join(', ')}`);
  });

  it('matches selectMochaBin with current runtime values', () => {
    const [majorStr, minorStr] = process.versions.node.split('.');
    const major = +majorStr;
    const minor = +minorStr;
    const hasRequireModule = !!process.features?.require_module;
    const hasRegisterHooks = typeof (Module as { registerHooks?: unknown }).registerHooks === 'function';

    const expected = selectMochaBin(major, minor, hasRequireModule, hasRegisterHooks);
    assert.equal(mochaBin, expected, `Runtime mochaBin should match selectMochaBin(${major}, ${minor}, ${hasRequireModule}, ${hasRegisterHooks})`);
  });
});

describe('selected mocha packages', () => {
  // The alias set is a version-routing table: every slot is pinned except 'mocha', which floats to
  // latest. A pinned slot that ships ESM-only is unparseable on the Nodes routed to it.
  it('routes Node that cannot transform the require() path to a CommonJS mocha', () => {
    const cases = [
      { major: 12, minor: 17, hasRequireModule: false, hasRegisterHooks: false },
      { major: 14, minor: 0, hasRequireModule: false, hasRegisterHooks: false },
      { major: 16, minor: 0, hasRequireModule: false, hasRegisterHooks: false },
      { major: 18, minor: 0, hasRequireModule: false, hasRegisterHooks: false },
      { major: 20, minor: 0, hasRequireModule: false, hasRegisterHooks: false },
      { major: 20, minor: 19, hasRequireModule: true, hasRegisterHooks: false },
      { major: 22, minor: 12, hasRequireModule: true, hasRegisterHooks: false },
    ];

    for (let i = 0; i < cases.length; i++) {
      const { major, minor, hasRequireModule, hasRegisterHooks } = cases[i];
      const bin = selectMochaBin(major, minor, hasRequireModule, hasRegisterHooks);
      const pkg = JSON.parse(fs.readFileSync(resolveSync(`${bin}/package.json`), 'utf8'));
      assert.notEqual(pkg.type, 'module', `Node ${major}.${minor} routes to ${bin}@${pkg.version}, which is ESM-only and cannot be parsed there`);
    }
  });

  it('routes below Node 12.17 to a mocha-compat-3 with no ESM type and an engines floor at or below 12.17', () => {
    const bin = selectMochaBin(12, 16, false, false);
    assert.equal(bin, 'mocha-compat-3');
    const pkg = JSON.parse(fs.readFileSync(resolveSync(`${bin}/package.json`), 'utf8'));
    assert.notEqual(pkg.type, 'module');
    assert.equal(typeof pkg.engines.node, 'string');
    const [floorMajor, floorMinor] = floorMajorMinor(pkg.engines.node);
    assert.ok(floorMajor < 12 || (floorMajor === 12 && floorMinor <= 16), `mocha-compat-3@${pkg.version} declares engines.node "${pkg.engines.node}", above the 12.16 floor Node 12.16 is routed to it at`);
  });

  it('routes Node 12.17 to mocha-compat-10 with an engines floor at or below 12.17', () => {
    const bin = selectMochaBin(12, 17, false, false);
    assert.equal(bin, 'mocha-compat-10');
    const pkg = JSON.parse(fs.readFileSync(resolveSync(`${bin}/package.json`), 'utf8'));
    assert.notEqual(pkg.type, 'module');
    assert.equal(typeof pkg.engines.node, 'string');
    const [floorMajor, floorMinor] = floorMajorMinor(pkg.engines.node);
    assert.ok(floorMajor < 12 || (floorMajor === 12 && floorMinor <= 17), `mocha-compat-10@${pkg.version} declares engines.node "${pkg.engines.node}", above the 12.17 floor Node 12.17 is routed to it at`);
  });

  it('resolves the floating mocha slot to a package with an engines.node string', () => {
    const bin = selectMochaBin(22, 15, true, true);
    const pkg = JSON.parse(fs.readFileSync(resolveSync(`${bin}/package.json`), 'utf8'));
    assert.equal(typeof pkg.engines.node, 'string');
  });

  it('resolves each pinned slot to the mocha-compat fork at exactly the version its alias pins, with its own bin name', () => {
    // Reading the pin from package.json rather than repeating it keeps the spec honest across
    // version bumps: what it proves is that an exact alias resolves to exactly that version.
    const deps = JSON.parse(fs.readFileSync(resolveSync('tsds-mocha/package.json'), 'utf8')).dependencies;

    for (const slot of ['mocha-compat-3', 'mocha-compat-10']) {
      const pinned = deps[slot].replace('npm:mocha-compat@', '');
      assert.ok(/^\d+\.\d+\.\d+$/.test(pinned), `${slot} must pin an exact version, found "${deps[slot]}"`);

      const pkg = JSON.parse(fs.readFileSync(resolveSync(`${slot}/package.json`), 'utf8'));
      assert.equal(pkg.name, 'mocha-compat');
      assert.equal(pkg.version, pinned, `${slot} pins ${pinned} but resolved ${pkg.version}`);
      assert.ok(pkg.bin[slot], `${slot} should declare a bin named ${slot}`);
    }
  });
});
