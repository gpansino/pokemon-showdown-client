"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = _default;

var util = _interopRequireWildcard(require("./util"));

function _getRequireWildcardCache() { if (typeof WeakMap !== "function") return null; var cache = new WeakMap(); _getRequireWildcardCache = function () { return cache; }; return cache; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }

const convertSourceMap = require("convert-source-map");

const sourceMap = require("source-map");

const slash = require("slash");

const path = require("path");

const fs = require("fs");

async function _default({
  cliOptions,
  babelOptions
}) {
  function buildResult(fileResults) {
    const map = new sourceMap.SourceMapGenerator({
      file: cliOptions.sourceMapTarget || path.basename(cliOptions.outFile || "") || "stdout",
      sourceRoot: babelOptions.sourceRoot
    });
    let code = "";
    let offset = 0;

    for (const result of fileResults) {
      if (!result) continue;
      code += result.code + "\n";

      if (result.map) {
        const consumer = new sourceMap.SourceMapConsumer(result.map);
        const sources = new Set();
        consumer.eachMapping(function (mapping) {
          if (mapping.source != null) sources.add(mapping.source);
          map.addMapping({
            generated: {
              line: mapping.generatedLine + offset,
              column: mapping.generatedColumn
            },
            source: mapping.source,
            original: mapping.source == null ? null : {
              line: mapping.originalLine,
              column: mapping.originalColumn
            }
          });
        });
        sources.forEach(source => {
          const content = consumer.sourceContentFor(source, true);

          if (content !== null) {
            map.setSourceContent(source, content);
          }
        });
        offset = code.split("\n").length - 1;
      }
    }

    if (babelOptions.sourceMaps === "inline" || !cliOptions.outFile && babelOptions.sourceMaps) {
      code += "\n" + convertSourceMap.fromObject(map).toComment();
    }

    return {
      map: map,
      code: code
    };
  }

  function output(fileResults) {
    const result = buildResult(fileResults);

    if (cliOptions.outFile) {
      fs.mkdirSync(path.dirname(cliOptions.outFile), {
        recursive: true
      });

      if (babelOptions.sourceMaps && babelOptions.sourceMaps !== "inline") {
        const mapLoc = cliOptions.outFile + ".map";
        result.code = util.addSourceMappingUrl(result.code, mapLoc);
        fs.writeFileSync(mapLoc, JSON.stringify(result.map));
      }

      fs.writeFileSync(cliOptions.outFile, result.code);
    } else {
      process.stdout.write(result.code + "\n");
    }
  }

  function readStdin() {
    return new Promise((resolve, reject) => {
      let code = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("readable", function () {
        const chunk = process.stdin.read();
        if (chunk !== null) code += chunk;
      });
      process.stdin.on("end", function () {
        resolve(code);
      });
      process.stdin.on("error", reject);
    });
  }

  async function stdin() {
    const code = await readStdin();
    const res = await util.transform(cliOptions.filename, code, Object.assign({}, babelOptions, {
      sourceFileName: "stdin"
    }));
    output([res]);
  }

  async function walk(filenames) {
    const _filenames = [];
    filenames.forEach(function (filename) {
      if (!fs.existsSync(filename)) return;
      const stat = fs.statSync(filename);

      if (stat.isDirectory()) {
        const dirname = filename;
        util.readdirForCompilable(filename, cliOptions.includeDotfiles, cliOptions.extensions).forEach(function (filename) {
          _filenames.push(path.join(dirname, filename));
        });
      } else {
        _filenames.push(filename);
      }
    });
    const results = await Promise.all(_filenames.map(async function (filename) {
      let sourceFilename = filename;

      if (cliOptions.outFile) {
        sourceFilename = path.relative(path.dirname(cliOptions.outFile), sourceFilename);
      }

      sourceFilename = slash(sourceFilename);

      try {
        return await util.compile(filename, Object.assign({}, babelOptions, {
          sourceFileName: sourceFilename,
          sourceMaps: babelOptions.sourceMaps === "inline" ? true : babelOptions.sourceMaps
        }));
      } catch (err) {
        if (!cliOptions.watch) {
          throw err;
        }

        console.error(err);
        return null;
      }
    }));
    output(results);
  }

  async function files(filenames) {
    if (!cliOptions.skipInitialBuild) {
      await walk(filenames);
    }

    if (cliOptions.watch) {
      const chokidar = util.requireChokidar();
      chokidar.watch(filenames, {
        disableGlobbing: true,
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 50,
          pollInterval: 10
        }
      }).on("all", function (type, filename) {
        if (!util.isCompilableExtension(filename, cliOptions.extensions) && !filenames.includes(filename)) {
          return;
        }

        if (type === "add" || type === "change") {
          if (cliOptions.verbose) {
            console.log(type + " " + filename);
          }

          walk(filenames).catch(err => {
            console.error(err);
          });
        }
      });
    }
  }

  if (cliOptions.filenames.length) {
    await files(cliOptions.filenames);
  } else {
    await stdin();
  }
}