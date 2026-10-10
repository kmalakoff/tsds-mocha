import spawn from 'cross-spawn-cb';
import getopts from 'getopts-compat';
import { link, unlink } from 'link-unlink';
import Queue from 'queue-cb';
import resolveBin from 'resolve-bin-sync';
import { supportsRequireTypeScript } from 'ts-swc-loaders/capabilities';
import type { CommandCallback, CommandOptions } from 'tsds-lib';
import { installPath } from 'tsds-lib';

// Every slot except 'mocha' is pinned exactly and listed in .ncurc.json reject; only 'mocha' floats.
// Each slot name doubles as its npm alias and bin name, so resolution is resolveBin(mochaBin, mochaBin).
export function selectMochaBin(major: number, minor: number, loaderSupportsRequireTypeScript: boolean): 'mocha-compat-3' | 'mocha-compat-10' | 'mocha' {
  if (major < 12 || (major === 12 && minor < 17)) return 'mocha-compat-3';
  // Mocha 12 loads test files through require(); use the loader capability because Node's
  // require_module flag says nothing about whether the loader can transform TypeScript there.
  return loaderSupportsRequireTypeScript ? 'mocha' : 'mocha-compat-10';
}

const [majorStr, minorStr] = process.versions.node.split('.');
const major = +majorStr;
const minor = +minorStr;

/** The mocha binary selected for the current Node version */
export const mochaBin = selectMochaBin(major, minor, supportsRequireTypeScript);

function commandError(failures: unknown[]): Error | undefined {
  if (failures.length === 0) return undefined;
  if (failures.length === 1 && failures[0] instanceof Error) return failures[0];
  const error: Error & { errors?: unknown[] } = new Error('Mocha command or restoration failed');
  error.errors = failures;
  return error;
}

export default function command(args: string[], options: CommandOptions, callback: CommandCallback) {
  const cwd: string = (options.cwd as string) || process.cwd();
  const opts = getopts(args, { stopEarly: true, alias: { 'dry-run': 'd' }, boolean: ['dry-run'] });
  const filteredArgs = args.filter((arg) => arg !== '--dry-run' && arg !== '-d');

  if (opts['dry-run']) {
    console.log('Dry-run: would run tests with mocha');
    return callback();
  }

  link(cwd, installPath(options), (err, restore) => {
    if (err !== undefined && err !== null) return callback(commandError([err]));
    if (!restore) return callback(new Error('link did not return restore path'));
    const acquiredTarget = restore;

    let cleanupStarted = false;
    function finish(operationFailed: boolean, operationError: unknown): void {
      if (cleanupStarted) return;
      cleanupStarted = true;
      let completed = false;
      function complete(cleanupFailed: boolean, cleanupError: unknown): void {
        if (completed) return;
        completed = true;
        const failures: unknown[] = [];
        if (operationFailed) failures.push(operationError);
        if (cleanupFailed) failures.push(cleanupError);
        callback(commandError(failures));
      }
      try {
        unlink(acquiredTarget, (error: unknown) => complete(error !== undefined && error !== null, error));
      } catch (error: unknown) {
        if (completed) throw error;
        complete(true, error);
      }
    }

    try {
      const loader = resolveBin('ts-swc-loaders', 'ts-swc');
      const mocha = resolveBin(mochaBin, mochaBin);

      // Per slot: mocha 3.x only knows --watch-extensions (watch monitoring), 10/12 only know
      // --extension (discovery). Passing the wrong one is inert, and on mocha 12 it also warns.
      const spawnArgs = mochaBin === 'mocha-compat-3' ? [mocha, '--watch-extensions', 'ts,tsx'] : [mocha, '--extension', 'ts,tsx'];
      Array.prototype.push.apply(spawnArgs, filteredArgs);
      if (opts._.length === 0) Array.prototype.push.apply(spawnArgs, ['test/**/*.test.*']);

      const queue = new Queue(1);
      let operationFailed = false;
      let operationError: unknown;
      queue.defer((cb) =>
        spawn(loader, spawnArgs, options, (error: unknown) => {
          operationFailed = error !== undefined && error !== null;
          operationError = error;
          // This one-task queue owns completion; retain errors before its truthy classification.
          cb();
        })
      );
      queue.await(() => finish(operationFailed, operationError));
    } catch (error: unknown) {
      if (cleanupStarted) throw error;
      finish(true, error);
    }
  });
}
