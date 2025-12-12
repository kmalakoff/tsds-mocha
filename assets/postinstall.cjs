"use strict";
var exit = require('exit-compat');
var fs = require('fs');
var path = require('path');
var Queue = require('queue-cb');
var resolve = require('resolve');
var unixify = require('unixify');
var MOCHAS = [
    'mocha-no-node-protocol',
    'mocha-no-register-hooks',
    'mocha'
];
function patch(name, callback) {
    try {
        var mochaCompat = path.dirname(resolve.sync('mocha-compat/package.json'));
        var sourcePath = fs.realpathSync(path.join(mochaCompat, 'vendor', 'glob'));
        var patchPath = path.dirname(resolve.sync("".concat(name, "/package.json")));
        var queue = new Queue();
        queue.defer(function(cb) {
            var filePath = fs.realpathSync(path.join(patchPath, 'lib', 'cli', 'lookup-files.js'));
            var find = "require('glob')";
            var replace = "require('".concat(unixify(path.relative(path.dirname(filePath), sourcePath)), "')");
            fs.readFile(filePath, 'utf8', function(err, contents) {
                if (err) return cb(err);
                var newContents = contents.replace(find, replace);
                if (contents === newContents) return cb(); // no change
                fs.writeFile(filePath, newContents, 'utf8', function(writeErr) {
                    if (writeErr) return cb(writeErr);
                    console.log("Patched glob in: ".concat(filePath));
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
            queue.defer(function(cb) {
                var filePath = path.join(patchPath, 'lib', 'nodejs', 'esm-utils.js');
                if (!fs.existsSync(filePath)) return cb(); // skip if file doesn't exist (older mocha)
                // Use regex with global flag to replace all occurrences (tryImportAndRequire and requireModule)
                var find = /if \(path\.extname\(file\) === '\.mjs'\)/g;
                var replace = 'if (/\\.(mjs|[cm]?ts|tsx)$/.test(file))';
                fs.readFile(filePath, 'utf8', function(err, contents) {
                    if (err) return cb(err);
                    var newContents = contents.replace(find, replace);
                    if (contents === newContents) return cb(); // no change
                    fs.writeFile(filePath, newContents, 'utf8', function(writeErr) {
                        if (writeErr) return cb(writeErr);
                        console.log("Patched esm-utils in: ".concat(filePath));
                        cb();
                    });
                });
            });
        }
        if (name !== 'mocha') {
            queue.defer(function(cb) {
                var filePath = path.join(patchPath, 'package.json');
                var pkg = require(filePath);
                if (pkg.bin[name] !== undefined) return cb();
                pkg.bin[name] = pkg.bin.mocha;
                fs.writeFile(filePath, JSON.stringify(pkg, null, 2), 'utf8', function(writeErr) {
                    if (writeErr) return cb(writeErr);
                    console.log("Patched bin in: ".concat(filePath));
                    cb();
                });
            });
        }
        queue.await(callback);
    } catch (err) {
        callback(err);
    }
}
// run patches
var queue = new Queue();
MOCHAS.forEach(function(name) {
    queue.defer(patch.bind(null, name));
});
queue.await(function(err) {
    if (err) {
        console.log("postinstall failed. Error: ".concat(err.message));
        exit(-1);
    } else {
        console.log('postinstall succeeded');
        exit(0);
    }
});
/* CJS INTEROP */ if (exports.__esModule && exports.default) { try { Object.defineProperty(exports.default, '__esModule', { value: true }); for (var key in exports) { exports.default[key] = exports[key]; } } catch (_) {}; module.exports = exports.default; }