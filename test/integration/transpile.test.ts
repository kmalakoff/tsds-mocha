// remove NODE_OPTIONS to not interfere with tests
delete process.env.NODE_OPTIONS;

import assert from 'assert';
import fs from 'fs';
import { safeRmSync } from 'fs-remove-compat';
import { unlink } from 'link-unlink';
import Module from 'module';
import path from 'path';
import mocha from 'tsds-mocha';
import url from 'url';

const requireModule = typeof require === 'undefined' ? Module.createRequire(import.meta.url) : require;

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

  it('preserves ESM module identity', (done) => {
    mocha(['test/esm-identity.test-test.ts'], { cwd: fixture, stdio: 'inherit' }, (err?: Error | null): void => {
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

describe('link restoration', () => {
  const LOADER_FAILURE_STATUS = 17;
  const cases = [
    { name: 'removes an initially absent target after a passing test', target: 'absent', fail: false, relocate: false },
    { name: 'restores the exact file target after a passing test', target: 'file', fail: false, relocate: false },
    { name: 'restores the exact directory target after a failing test', target: 'directory', fail: true, relocate: false },
    { name: 'reports cleanup-only failure and retains the exact backup', target: 'file', fail: false, relocate: true },
    { name: 'reports operation and cleanup failures in order', target: 'file', fail: true, relocate: true },
  ];

  function field(value: unknown, name: string): unknown {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return descriptor && descriptor.value;
  }

  function exists(filename: string): boolean {
    try {
      fs.lstatSync(filename);
      return true;
    } catch (error) {
      if (field(error, 'code') === 'ENOENT') return false;
      throw error;
    }
  }

  function sameNode(filename: string, original: fs.Stats): void {
    const current = fs.lstatSync(filename);
    assert.strictEqual(current.dev, original.dev, 'owned node device changed');
    assert.strictEqual(current.ino, original.ino, 'owned node inode changed');
    assert.strictEqual(current.isDirectory(), original.isDirectory(), 'owned node kind changed');
    assert.strictEqual(current.isSymbolicLink(), original.isSymbolicLink(), 'owned node became a link');
  }

  function operationError(error: unknown): void {
    assert.ok(error instanceof Error, 'real failing test must return an Error');
    assert.strictEqual(field(error, 'status'), LOADER_FAILURE_STATUS, 'real failing test must preserve ts-swc failure status');
    assert.strictEqual(field(error, 'signal'), null, 'real failing test must not be signalled');
    assert.ok(String(field(error, 'stdout')).indexOf('RESTORATION_FAILURE') !== -1, 'missing real assertion output');
    assert.ok(String(field(error, 'stderr')).indexOf('RESTORATION_STDERR') !== -1, 'missing child stderr');
  }

  cases.forEach((testCase) => {
    it(testCase.name, (done) => {
      const packageRoot = path.resolve(__dirname, '..', '..');
      const scratch = path.join(packageRoot, '.tmp');
      if (!exists(scratch)) fs.mkdirSync(scratch);
      assert.ok(!fs.lstatSync(scratch).isSymbolicLink(), 'scratch root must not be a link');
      const root = path.join(scratch, `mocha-restoration-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
      let rootStat: fs.Stats | undefined;
      let rootReal: string | undefined;
      const parent = path.join(root, 'owned-links');
      const retained = path.join(root, 'retained-links');
      const target = path.join(parent, 'fixture-target');
      let parentStat: fs.Stats;
      let original: fs.Stats | undefined;
      let invoked = false;
      let callbackCount = 0;
      let callbackOutcome: unknown;
      let settlementQueued = false;
      let recoveryStarted = false;
      let notificationQueued = false;
      let completed = false;
      const failures: unknown[] = [];

      function checkRoot(): void {
        if (!rootStat || rootReal === undefined) throw new Error('owned root identity unavailable; retain root');
        sameNode(root, rootStat);
        assert.strictEqual(fs.realpathSync(root), rootReal, 'owned root ancestry changed');
        assert.strictEqual(path.dirname(rootReal), fs.realpathSync(scratch), 'owned root escaped scratch');
      }

      function checkOriginal(filename: string): void {
        assert.ok(original, 'missing original target identity');
        if (!original) throw new Error('missing original target identity');
        sameNode(filename, original);
        if (testCase.target === 'directory') {
          assert.deepEqual(fs.readdirSync(filename), ['survivor.txt']);
          assert.strictEqual(fs.readFileSync(path.join(filename, 'survivor.txt'), 'utf8'), 'owned survivor');
        } else assert.strictEqual(fs.readFileSync(filename, 'utf8'), 'owned survivor');
      }

      function checkRestored(): void {
        sameNode(parent, parentStat);
        if (testCase.target === 'absent') assert.deepEqual(fs.readdirSync(parent), []);
        else {
          assert.deepEqual(fs.readdirSync(parent), ['fixture-target']);
          checkOriginal(target);
        }
      }

      function recoverAndFinish(): void {
        if (recoveryStarted || completed) return;
        recoveryStarted = true;
        let mayRemove = !invoked;
        try {
          checkRoot();
          if (invoked) {
            const receipt = JSON.parse(fs.readFileSync(path.join(root, 'receipt.json'), 'utf8'));
            assert.strictEqual(receipt.childBodyCompleted, true, 'child did not complete its fixture body');
            if (testCase.relocate) {
              assert.strictEqual(exists(parent), false, 'original link parent must remain absent');
              sameNode(retained, parentStat);
              assert.ok(typeof receipt.backup === 'string' && path.basename(receipt.backup) === receipt.backup && receipt.backup.indexOf('fixture-target.') === 0, 'backup must be an owned sibling');
              assert.deepEqual(fs.readdirSync(retained).sort(), ['fixture-target', receipt.backup].sort());
              const retainedTarget = path.join(retained, 'fixture-target');
              const retainedLink = fs.lstatSync(retainedTarget);
              assert.ok(retainedLink.isSymbolicLink(), 'owned link lost');
              assert.strictEqual(retainedLink.dev, receipt.linkDevice, 'owned link device changed');
              assert.strictEqual(retainedLink.ino, receipt.linkInode, 'owned link inode changed');
              assert.strictEqual(fs.readlinkSync(retainedTarget), receipt.linkDestination, 'owned link text changed');
              assert.strictEqual(fs.realpathSync(retainedTarget), rootReal, 'owned link target changed');
              checkOriginal(path.join(retained, receipt.backup));
              fs.renameSync(retained, parent);
              unlink(target, (recoveryError) => {
                if (recoveryError !== null && recoveryError !== undefined) failures.push(recoveryError);
                try {
                  checkRestored();
                  mayRemove = true;
                } catch (error) {
                  failures.push(error);
                }
                finish();
              });
              return;
            }
            checkRestored();
            mayRemove = true;
          }
        } catch (error) {
          failures.push(error);
        }
        finish();

        function finish(): void {
          if (notificationQueued || completed) return;
          notificationQueued = true;
          process.nextTick(() => {
            let retainedRoot = !mayRemove;
            if (mayRemove) {
              try {
                checkRoot();
                safeRmSync(root);
                assert.strictEqual(exists(root), false, 'owned scratch cleanup incomplete');
              } catch (error) {
                failures.push(error);
                retainedRoot = true;
              }
            }
            if (retainedRoot) {
              try {
                console.error('RESTORATION_RETAINED_ROOT', root);
              } catch (error) {
                failures.push(error);
              }
            }
            const outcomes = failures.slice();
            if (outcomes.length && callbackCount && callbackOutcome !== undefined && callbackOutcome !== null) outcomes.unshift(callbackOutcome);
            completed = true;
            if (outcomes.length === 0) return done();
            if (outcomes.length === 1 && outcomes[0] instanceof Error) return done(outcomes[0]);
            const error = new Error('restoration assertion or recovery failed');
            Object.defineProperty(error, 'errors', { value: outcomes, enumerable: true });
            done(error);
          });
        }
      }

      function settle(): void {
        if (settlementQueued || recoveryStarted || completed) return;
        settlementQueued = true;
        process.nextTick(() => {
          if (callbackCount) {
            const error = callbackOutcome;
            try {
              assert.strictEqual(callbackCount, 1, 'public command callback must notify once');
              const receipt = JSON.parse(fs.readFileSync(path.join(root, 'receipt.json'), 'utf8'));
              assert.strictEqual(receipt.childBodyCompleted, true);
              assert.strictEqual(receipt.relocated, testCase.relocate);
              assert.strictEqual(receipt.originalDevice, original && original.dev);
              assert.strictEqual(receipt.originalInode, original && original.ino);
              if (testCase.relocate && testCase.fail) {
                const errors = field(error, 'errors');
                assert.ok(Array.isArray(errors), 'both failures must be exposed');
                if (!Array.isArray(errors)) throw new Error('both failures must be exposed');
                assert.strictEqual(errors.length, 2, 'operation and cleanup errors must remain distinct');
                operationError(errors[0]);
                assert.ok(errors[1] instanceof Error, 'cleanup failure must be an Error');
                assert.strictEqual(field(errors[1], 'code'), 'ENOENT');
              } else if (testCase.relocate) {
                assert.ok(error instanceof Error, 'cleanup-only failure must not disappear');
                assert.strictEqual(field(error, 'code'), 'ENOENT');
              } else if (testCase.fail) operationError(error);
              else assert.ok(error === undefined || error === null, 'passing test must complete successfully');
            } catch (assertionError) {
              failures.push(assertionError);
            }
          }
          recoverAndFinish();
        });
      }

      try {
        fs.mkdirSync(root);
        rootStat = fs.lstatSync(root);
        rootReal = fs.realpathSync(root);
        fs.mkdirSync(parent);
        parentStat = fs.lstatSync(parent);
        if (testCase.target === 'directory') {
          fs.mkdirSync(target);
          fs.writeFileSync(path.join(target, 'survivor.txt'), 'owned survivor');
        } else if (testCase.target === 'file') fs.writeFileSync(target, 'owned survivor');
        if (testCase.target !== 'absent') original = fs.lstatSync(target);
        fs.mkdirSync(path.join(root, 'test'));
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'restoration-fixture', version: '0.0.0', private: true, type: 'module' }));
        fs.writeFileSync(path.join(root, 'tsconfig.json'), fs.readFileSync(path.join(__dirname, '..', 'data', 'generics', 'tsconfig.json')));
        fs.writeFileSync(path.join(root, 'test', 'restoration.test-test.ts'), fs.readFileSync(path.join(__dirname, '..', 'data', 'restoration', 'test', 'restoration.test-test.ts')));
        fs.writeFileSync(path.join(root, 'plan.json'), JSON.stringify({ targetKind: testCase.target, fail: testCase.fail, relocate: testCase.relocate, parentDevice: parentStat.dev, parentInode: parentStat.ino, originalDevice: original && original.dev, originalInode: original && original.ino }));
        invoked = true;
        mocha(['test/restoration.test-test.ts'], { cwd: root, installPath: target, stdio: 'pipe', encoding: 'utf8' }, (error) => {
          callbackCount++;
          if (completed) {
            throw new Error('public command callback repeated after completion');
          }
          if (callbackCount > 1) {
            failures.push(new Error('public command callback repeated'));
            if (error !== undefined && error !== null) failures.push(error);
            return;
          }
          callbackOutcome = error;
          settle();
        });
      } catch (error) {
        failures.push(error);
        settle();
      }
    });
  });
});

describe('setup restoration', () => {
  it('restores the original target when bin resolution throws after linking', (done) => {
    const packageRoot = path.resolve(__dirname, '..', '..');
    const scratch = path.join(packageRoot, '.tmp');
    if (!fs.existsSync(scratch)) fs.mkdirSync(scratch);
    const root = path.join(scratch, `mocha-setup-${process.pid}-${Date.now()}`);
    const modules = path.join(root, 'node_modules');
    const target = path.join(root, 'fixture-target');
    let callbackCount = 0;
    let completed = false;
    fs.mkdirSync(root);
    try {
      fs.mkdirSync(modules);
      fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'commonjs' }));
      fs.writeFileSync(target, 'original setup target');
      const original = fs.lstatSync(target);
      fs.writeFileSync(path.join(root, 'command.js'), fs.readFileSync(path.join(packageRoot, 'dist', 'cjs', 'command.js')));
      const dependencies = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).dependencies;
      Object.keys(dependencies).forEach((name) => {
        const installed = path.dirname(requireModule.resolve(`${name}/package.json`));
        const owned = path.join(modules, name);
        if (name !== 'resolve-bin-sync' && name !== 'ts-swc-loaders') {
          fs.symlinkSync(installed, owned, 'junction');
          return;
        }
        fs.mkdirSync(owned);
        const manifest = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
        if (name === 'ts-swc-loaders') {
          // Only this disposable manifest lacks a bin; capabilities still load the real library.
          delete manifest.bin;
          fs.symlinkSync(path.join(installed, 'dist'), path.join(owned, 'dist'), 'junction');
          fs.writeFileSync(path.join(owned, 'capabilities.js'), fs.readFileSync(path.join(installed, 'capabilities.js')));
        } else {
          fs.mkdirSync(path.join(owned, 'dist'));
          fs.mkdirSync(path.join(owned, 'dist', 'cjs'));
          fs.writeFileSync(path.join(owned, 'dist', 'cjs', 'package.json'), JSON.stringify({ type: 'commonjs' }));
          fs.writeFileSync(path.join(owned, 'dist', 'cjs', 'index.js'), fs.readFileSync(path.join(installed, 'dist', 'cjs', 'index.js')));
        }
        fs.writeFileSync(path.join(owned, 'package.json'), JSON.stringify(manifest));
      });
      const isolatedCommand = requireModule(path.join(root, 'command.js'));
      isolatedCommand([], { cwd: root, installPath: target }, (error: Error | undefined) => {
        callbackCount++;
        if (completed) throw new Error('setup callback repeated after completion');
        process.nextTick(() => {
          if (completed) return;
          completed = true;
          let failure: unknown;
          try {
            assert.strictEqual(callbackCount, 1, 'setup failure must notify once');
            assert.ok(error instanceof Error, 'bin resolution failure must be reported');
            assert.ok(error && error.message.indexOf('missing bin for ts-swc-loaders') !== -1, 'expected the actual bin resolution exception');
            const restored = fs.lstatSync(target);
            assert.strictEqual(restored.dev, original.dev);
            assert.strictEqual(restored.ino, original.ino);
            assert.strictEqual(restored.isSymbolicLink(), false);
            assert.strictEqual(fs.readFileSync(target, 'utf8'), 'original setup target');
            assert.deepEqual(
              fs.readdirSync(root).filter((name) => name.indexOf('fixture-target.') === 0),
              []
            );
          } catch (assertionError) {
            failure = assertionError;
          }
          try {
            safeRmSync(root);
          } catch (cleanupError) {
            if (failure) return done(new Error(`${String(failure)}; fixture cleanup failed: ${String(cleanupError)}`));
            failure = cleanupError;
          }
          done(failure);
        });
      });
    } catch (error) {
      safeRmSync(root);
      done(error);
    }
  });
});
