const exit = require('exit-compat');
const fs = require('fs');
const path = require('path');
const Queue = require('queue-cb');
const resolve = require('resolve');
const unixify = require('unixify');

const MOCHAS = ['mocha-no-node-protocol', 'mocha-no-register-hooks', 'mocha'];

type Callback = (err?: Error | null) => void;

function patch(name: string, callback: Callback) {
  try {
    const mochaCompat = path.dirname(resolve.sync('mocha-compat/package.json'));
    const sourcePath = fs.realpathSync(path.join(mochaCompat, 'vendor', 'glob'));

    const patchPath = path.dirname(resolve.sync(`${name}/package.json`));

    const queue = new Queue();
    queue.defer((cb: Callback) => {
      const filePath = fs.realpathSync(path.join(patchPath, 'lib', 'cli', 'lookup-files.js'));
      const find = "require('glob')";
      const replace = `require('${unixify(path.relative(path.dirname(filePath), sourcePath))}')`;

      fs.readFile(filePath, 'utf8', (err, contents) => {
        if (err) return cb(err);
        const newContents = contents.replace(find, replace);
        if (contents === newContents) return cb(); // no change
        fs.writeFile(filePath, newContents, 'utf8', (writeErr) => {
          if (writeErr) return cb(writeErr);
          console.log(`Patched glob in: ${filePath}`);
          cb();
        });
      });
    });
    // Patch esm-utils.js to force import() for TypeScript extensions
    // Only needed for mocha-no-register-hooks (Node 20.17+ with require(esm) but no registerHooks)
    // Node 22.15+ has registerHooks which properly supports require() with hooks
    // Related mocha issue for .mjs: https://github.com/mochajs/mocha/issues/5425
    // PR that fixed .mjs but not .ts: https://github.com/mochajs/mocha/pull/5429
    if (name === 'mocha-no-register-hooks') {
      queue.defer((cb: Callback) => {
        const filePath = path.join(patchPath, 'lib', 'nodejs', 'esm-utils.js');
        if (!fs.existsSync(filePath)) return cb(); // skip if file doesn't exist (older mocha)

        // Use regex with global flag to replace all occurrences (tryImportAndRequire and requireModule)
        const find = /if \(path\.extname\(file\) === '\.mjs'\)/g;
        const replace = 'if (/\\.(mjs|[cm]?ts|tsx)$/.test(file))';

        fs.readFile(filePath, 'utf8', (err, contents) => {
          if (err) return cb(err);
          const newContents = contents.replace(find, replace);
          if (contents === newContents) return cb(); // no change
          fs.writeFile(filePath, newContents, 'utf8', (writeErr) => {
            if (writeErr) return cb(writeErr);
            console.log(`Patched esm-utils in: ${filePath}`);
            cb();
          });
        });
      });
    }
    if (name !== 'mocha') {
      queue.defer((cb: Callback) => {
        const filePath = path.join(patchPath, 'package.json');
        const pkg = require(filePath);
        if (pkg.bin[name] !== undefined) return cb();
        pkg.bin[name] = pkg.bin.mocha;
        fs.writeFile(filePath, JSON.stringify(pkg, null, 2), 'utf8', (writeErr) => {
          if (writeErr) return cb(writeErr);
          console.log(`Patched bin in: ${filePath}`);
          cb();
        });
      });
    }
    queue.await(callback);
  } catch (err) {
    callback(err as Error);
  }
}

// run patches
const queue = new Queue();
MOCHAS.forEach((name) => {
  queue.defer(patch.bind(null, name));
});
queue.await((err: Error | null) => {
  if (err) {
    console.log(`postinstall failed. Error: ${err.message}`);
    exit(-1);
  } else {
    console.log('postinstall succeeded');
    exit(0);
  }
});
