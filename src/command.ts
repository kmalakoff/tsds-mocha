import spawn from 'cross-spawn-cb';
import getopts from 'getopts-compat';
import { link, unlink } from 'link-unlink';
import Module from 'module';
import Queue from 'queue-cb';
import resolveBin from 'resolve-bin-sync';
import type { CommandCallback, CommandOptions } from 'tsds-lib';
import { installPath } from 'tsds-lib';

// Every slot except 'mocha' is pinned exactly and listed in .ncurc.json reject; only 'mocha' floats.
// Each slot name doubles as its npm alias and bin name, so resolution is resolveBin(mochaBin, mochaBin).
export function selectMochaBin(major: number, minor: number, hasRequireModule: boolean, hasRegisterHooks: boolean): 'mocha-compat-3' | 'mocha-compat-10' | 'mocha' {
  if (major < 12 || (major === 12 && minor < 17)) return 'mocha-compat-3';
  // mocha 12 require()s test files wherever require_module is on; ts-swc-loaders can only transform
  // that path where Module.registerHooks is too (22.15+). Between the two, mocha 10 import()s instead.
  if (!hasRequireModule || !hasRegisterHooks) return 'mocha-compat-10';
  return 'mocha';
}

const [majorStr, minorStr] = process.versions.node.split('.');
const major = +majorStr;
const minor = +minorStr;
const hasRequireModule = !!process.features?.require_module;
const hasRegisterHooks = typeof (Module as { registerHooks?: unknown }).registerHooks === 'function';

/** The mocha binary selected for the current Node version */
export const mochaBin = selectMochaBin(major, minor, hasRequireModule, hasRegisterHooks);

export default function command(args: string[], options: CommandOptions, callback: CommandCallback) {
  const cwd: string = (options.cwd as string) || process.cwd();
  const opts = getopts(args, { stopEarly: true, alias: { 'dry-run': 'd' }, boolean: ['dry-run'] });
  const filteredArgs = args.filter((arg) => arg !== '--dry-run' && arg !== '-d');

  if (opts['dry-run']) {
    console.log('Dry-run: would run tests with mocha');
    return callback();
  }

  link(cwd, installPath(options), (err, restore) => {
    if (err) return callback(err);
    if (!restore) return callback(new Error('link did not return restore path'));

    try {
      const loader = resolveBin('ts-swc-loaders', 'ts-swc');
      const mocha = resolveBin(mochaBin, mochaBin);

      // Per slot: mocha 3.x only knows --watch-extensions (watch monitoring), 10/12 only know
      // --extension (discovery). Passing the wrong one is inert, and on mocha 12 it also warns.
      const spawnArgs = mochaBin === 'mocha-compat-3' ? [mocha, '--watch-extensions', 'ts,tsx'] : [mocha, '--extension', 'ts,tsx'];
      Array.prototype.push.apply(spawnArgs, filteredArgs);
      if (opts._.length === 0) Array.prototype.push.apply(spawnArgs, ['test/**/*.test.*']);

      const queue = new Queue(1);
      queue.defer(spawn.bind(null, loader, spawnArgs, options));
      queue.await((err) => unlink(restore, callback.bind(null, err)));
    } catch (err) {
      console.log(err);
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
