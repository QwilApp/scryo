#!/usr/bin/env node
const path = require("path");
const fs = require("fs");
const glob = require("glob");
const assert = require('assert').strict;
const { Command } = require('commander');
const { findCyStuff, readFileAndParseAST } = require('./parser');
const pjs =  require("./package.json");


const binName = pjs.name;

async function main() {
  const program = new Command();
  program
    .name(binName)
    .description("Parse and identify Cypress tests and commands")
    .version(pjs.version) // TODO: take this from package.json when packaged as standalone

  program.command('dump')
    .description("Dump parse results to stdout as JSON")
    .addHelpText("after", `
Examples:

  ${binName} dump ./cypress  # look for all *.js files under ./cypress dir
  ${binName} dump ./cypress/tests ./cypress/support  # specify multiple dirs
  ${binName} dump ./tests/a.js  # parse a single file
    `)
    .argument('<file_or_dir...>', 'files or dirs to parse')
    .action(async (paths) => {
      await doDump(paths);
    })

  program.command('find')
    .description("Find declaration and usage of a specific Cypress command")
    .addHelpText("after", `
Examples:

  ${binName} find navigateToLogin ./cypress  # look for "navigateToLogin" command in ./cypress dir
  ${binName} find navigateToLogin ./cypress/tests ./cypress/support  # look in  multiple dirs
    `)
    .argument('<cyCommand>', 'cyCommand to search for')
    .argument('<file_or_dir...>', 'files or dirs to parse')
    .action(async (cyCommand, paths) => {
      await doFind(cyCommand, paths);
    })

  program.parse();
}


async function doDump(paths) {
  const filenames = await resolvePaths(paths);
  let out = {};
  for (const filename of filenames) {
    out[filename] = findCyStuff(
      await readFileAndParseAST(path.resolve(filename))
    );
  }
  console.log(JSON.stringify(out, null, 2));
}


async function doFind(command, paths) {
  const filenames = await resolvePaths(paths);
  const added = [];
  const used = [];

  for (const filename of filenames) {
    let result = findCyStuff(
      await readFileAndParseAST(path.resolve(filename)),
      {
        find: { used: true, added: true },
        includeCyMethodsUsed: false, // we don't care about cy methods used in definition of commands
      }
    );

    result.added.forEach((cmd) => {
      if (cmd.name === command) {
        added.push({
          filename,
          ...cmd,
        })
      }
    })

    result.used.forEach((cmd) => {
      if (cmd.name === command) {
        used.push({
          filename,
          ...cmd,
        })
      }
    })
  }

  console.log("");

  if (!(added.length + used.length)) {
    console.log(`🤷 Could not find definition or usage of "${command}".\n`)
    return;
  }

  if (added.length === 0) {
    console.log(`😿 Could not find where Cypress command "${command}" was defined!\n`);
  } else if (added.length === 1) {
    console.log(`👀 Found definition of Cypress command "${command}":`);
    console.log(`    at (${formatMatchLocation(added[0])})`);
    console.log("");
  } else {
    console.log(`😲 Found MULTIPLE definitions of Cypress command "${command}":`);
    added.forEach((found) => {
      console.log(`    at (${formatMatchLocation(found)})`);
    })
    console.log("");
  }


  if (used.length === 0) {
    console.log(`😿 Cypress command "${command}" never used!\n`);
  } else {
    console.log(`🔍 Found ${used.length} place(s) where cy.${command} was used:`);
    used.forEach((found) => {
      console.log(`  🔗 cy.${found.chain.map((s) => s + '().').join("")}${command}()`);
      console.log(`        at (${formatMatchLocation(found)})`);
    })
  }
  console.log("");
}

function formatMatchLocation(match) {
  const loc = mapCharIndexToLineno(match.filename, match.start);
  return `${path.resolve(match.filename)}:${loc.line}:${loc.col}`;
}

function _cachedGetFileLineInfo() {
  let cache = {};
  return (filename) => {
    if (!(filename in cache)) {
      let content = fs.readFileSync(filename, { encoding: "utf8", flag: 'r' });
      cache[filename] = {
        size: content.length,
        lineLengths: content.split("\n").map((line) => line.length + 1),  // +1 to account for stripped "\n"
      }
    }
    return cache[filename];
  }
}

const getFileLineInfo = _cachedGetFileLineInfo();

function mapCharIndexToLineno(filename, index) {
  /**
   * returns {line: X, col: Y} where X and Y are integers starting from 1 (not 0).
   */

  const info = getFileLineInfo(filename);
  assert(index <= info.size, "index exceeds file size");

  let runningSum = 0;
  for (let i = 0; i < info.lineLengths.length; i++) {
    let currentLineLength = info.lineLengths[i];
    if (runningSum + currentLineLength > index) {
      return {
        line: i + 1,
        col: index - runningSum + 1,
      }
    } else {
      runningSum += currentLineLength;
    }
  }

}

function quit(message) {
  console.error(message);
  process.exit(1);
}


async function resolvePaths(paths) {
  let resolved = new Set();
  for (const p of new Set(paths)) {
    if (!fs.existsSync(p)) {
      quit(`ERROR: "${p}" does not exist`);
    }
    let stat = fs.lstatSync(p);
    if (stat.isFile()) {
      if (p.endsWith(".js") || p.endsWith(".ts")) {
        resolved.add(p);
      } else {
        quit(`ERROR: unsupported file "${p}". Expecting *.js or *.ts`)
      }
    } else if (stat.isDirectory()) {
      glob.sync("**/*.js", { cwd: p }).forEach((f) => {
        resolved.add(path.join(p, f));
      })
    } else {
      quit(`ERROR: "${p}" is neither a file nor a directory`);
    }
  }
  return Array.from(resolved).sort();
}


main().catch(e => {
  console.error(e);
  process.exit(1);
});
