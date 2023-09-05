const acorn = require("acorn");
const walk = require("acorn-walk");
const fs = require("fs");
const { runQwilExtension } = require('./qwilExtension');
const assert = require('assert').strict;
const { interleaveArray } = require("./utils");
const { parseCallee, maybeGetLiteralValue, nodeIsFunction, isTestIdentifier, isTestOrDescribeIdentifier, isSkip,
  isOnly, SUPPORTED_HOOKS, inferTestName
} = require('./parseUtils');


function parse(source) {
  /**
   * Returns AST in ESTree format -- https://github.com/estree/estree/blob/master/es2020.md
   **/
  return acorn.parse(source, {
    ecmaVersion: 2020,
    sourceType: "module"
  });
}

async function readFileAndParseAST(filePath) {
  const content = (await fs.promises.readFile(filePath, "utf8")).toString();
  if (content.startsWith('#!')) {
    // Ignore nodeJS scripts that start with shabang
    return null;
  }
  try {
    return parse(content);
  } catch (e) {
    if (e instanceof SyntaxError) {
      const lineAtError = content.split("\n")[e.loc.line - 1];
      const arrow = ((e.loc.column > 0) ? ' '.repeat(e.loc.column) : '') + '^';
      console.error(`Syntax Error : ${e.message}

${lineAtError}
${arrow}

at (${filePath}:${e.loc.line}:${e.loc.column})
      `);
      process.exit(1);
    } else {
      throw e;
    }
  }

}

function findInnerCypressCalls(funcNode) {
  return findCyStuff(funcNode, { find: { used: true } }).used;
}

function findInnerFuncCalls(funcNode) {
  return findFuncCalls(funcNode, n => !n.startsWith('cy.'));
}

function findCyStuff(ast, options) {
  const optionDefaults = {
    find: {
      added: true,
      used: true,
      tests: true,
      hooks: true
    },
    // should we include "cyMethodsUsed" when we find added Cypress Command
    includeCyMethodsUsed: true,
    // should we also gather other function calls in Cypress Command implementation?
    includeOtherFuncCalls: true,
    // extra parsing explicit to Qwil use case
    enableQwilExtension: false,
  }

  const _options = Object.assign(optionDefaults, options);
  const findAdded = Boolean(_options.find.added);
  const findUsed = Boolean(_options.find.used);
  const findTests = Boolean(_options.find.tests);
  const findHooks = Boolean(_options.find.hooks);
  const qwilExtension = Boolean(_options.enableQwilExtension);

  const added = [];
  const used = [];
  const tests = [];
  const hooks = Object.fromEntries(Array.from(SUPPORTED_HOOKS).map((hook) => [hook, []]));
  const errors = [];

  if (ast) {
    walk.ancestor(ast, {
      CallExpression: function (node, _, ancestors) {
        const dottedName = parseCallee(node);
        if (!dottedName) {
          // this call should be ignored. so do nothing.
        } else if (findAdded && dottedName === "Cypress.Commands.add") {
          const nameNode = node.arguments[0];
          const funcNode = node.arguments.at(-1);  // Not [1] because there could be optional "options" arg there
          assert(nameNode.type === "Literal", "Cypress command name must be a literal string");

          // get cy methods used by this command
          added.push({
            name: nameNode.value,
            start: node.start,
            end: node.end,
            ...(_options.includeCyMethodsUsed && { cyMethodsUsed: findInnerCypressCalls(funcNode) }),
            ...(_options.includeOtherFuncCalls && { otherFuncCalls: findInnerFuncCalls(funcNode) }),
          });

        } else if (findUsed && dottedName.startsWith("cy.")) {
          const nameSegments = dottedName.split('.');
          const parentCalls = nameSegments.slice(1, -1);

          for (const c of parentCalls) {
            if (!c.endsWith("()")) {
              // this is not a chained call e.g. cy.a().b(). It could be cy.context.scenarioId.toString() or some other
              // call on a property of cy.
              return;
            }
          }

          const chain = parentCalls.map(function (s) {
            return s.slice(0, -2);
          });

          const arguments = node.arguments.map(a => {
            return {  // simply return type and position of each argument so caller can target and parse if required
              type: a.type,
              start: a.start,
              end: a.end,
            }
          });

          const literalArguments = {};
          let hasLiteralArguments = false;
          node.arguments.forEach((a, i) => {
            const value = maybeGetLiteralValue(a);
            if (value) {
              hasLiteralArguments = true;
              literalArguments[i] = value;
            }
          });

          used.push({
            name: nameSegments.at(-1),
            start: node.callee.property.start,  // start at identifier in case this is chained
            end: node.end,  // end at the end of the full call, including params and inner func.
            arguments: arguments,
            ...(hasLiteralArguments ? { literalArguments } : null),
            chain: chain,
          })
        } else if (findTests && isTestIdentifier(dottedName)) {
          if (node.arguments.length < 2) {
            errors.push({
              message: `'${dottedName}' has insufficient number of arguments`,
              loc: node.start,
            })
            console.log(node);
            return;
          }

          let funcNode = node.arguments[1];
          if (!nodeIsFunction(funcNode)) {
            errors.push({
              message: `function expected, but found ${funcNode.type}`,
              loc: funcNode.start,
            })
            console.log(node);
            return;
          }

          let scopeNodes = ancestors
            .filter((n) => n.type === "CallExpression")
            .map((n) => ({node: n, dotted: parseCallee(n)}))
            .filter((o) => o.dotted && isTestOrDescribeIdentifier(o.dotted));

          let scope = scopeNodes.map((o) => {
            return {
              name: inferTestName(o.node),
              func: o.dotted,
              start: o.node.start,
              end: o.node.end,
              ...(isSkip(o.dotted) && {skip: true}),
              ...(isOnly(o.dotted) && {only: true}),
            }
          });

          tests.push({
            scope: scope,
            start: node.start,
            end: node.end,
            funcStart: funcNode.start,
            funcEnd: funcNode.end,
            ...(_options.includeCyMethodsUsed && { cyMethodsUsed: findInnerCypressCalls(funcNode) }),
            ...(_options.includeOtherFuncCalls && { otherFuncCalls: findInnerFuncCalls(funcNode) }),
            ...(scope.some((n) => n.skip) && { skip: true}),
            ...(scope.some((n) => n.only) && { only: true}),
          })
        } else if (findHooks && SUPPORTED_HOOKS.has(dottedName)) {
          // Watch out for false positives. If wrong number or params, or is not function, assume this is not a hook.
          if (node.arguments.length !== 1) {
            return;
          }
          let funcNode = node.arguments[0];
          if (!nodeIsFunction(funcNode)) {
            return
          }

          let scopeNodes = ancestors
            .filter((n) => n.type === "CallExpression")
            .map((n) => ({node: n, dotted: parseCallee(n)}))
            .filter((o) => o.dotted && isTestOrDescribeIdentifier(o.dotted));

          // also exclude calls to hooks if within it() scope
          if (scopeNodes.some((o) => isTestIdentifier(o.dotted))) {
            return;
          }

          let scope = scopeNodes.map((o) => {
            return {
              name: inferTestName(o.node),
              func: o.dotted,
              start: o.node.start,
              end: o.node.end,
              ...(isSkip(o.dotted) && {skip: true}),
              ...(isOnly(o.dotted) && {only: true}),
            }
          });

          hooks[dottedName].push({
            scope: scope,
            start: node.start,
            end: node.end,
            funcStart: funcNode.start,
            funcEnd: funcNode.end,
            ...(_options.includeCyMethodsUsed && { cyMethodsUsed: findInnerCypressCalls(funcNode) }),
            ...(_options.includeOtherFuncCalls && { otherFuncCalls: findInnerFuncCalls(funcNode) }),
          })
        }
      }
    });
  }

  const extensions = {};
  if (qwilExtension) {
    const output = runQwilExtension(ast, { findInnerCypressCalls, findInnerFuncCalls });
    if (output.errors) {
      output.errors.forEach(function(e) {errors.push(e)});
      delete output.errors;
    }
    Object.assign(extensions, output)
  }

  return {
    ...(findAdded && { added }),
    ...(findUsed && { used }),
    ...(findTests && { tests }),
    ...(findHooks && { hooks }),
    ...extensions,
    errors,
  };
}

function findFuncCalls(ast, nameFilter) {
  let calls = [];
  walk.simple(ast, {
    CallExpression: function (node) {
      const dottedName = parseCallee(node);
      if (!dottedName || (nameFilter && !nameFilter(dottedName))) {
        // this call should be ignored. so do nothing.
      } else {
        const arguments = node.arguments.map(a => {
          return {  // simply return type and position of each argument so caller can target and parse if required
            type: a.type,
            start: a.start,
            end: a.end,
          }
        });

        const literalArguments = {};
        let hasLiteralArguments = false;
        node.arguments.forEach((a, i) => {
          const value = maybeGetLiteralValue(a);
          if (value) {
            hasLiteralArguments = true;
            literalArguments[i] = value;
          }
        });

        calls.push({
          name: dottedName,
          start: node.callee.property ? node.callee.property.start : node.start,
          rootStart: node.start, // if chained calls, this != start
          end: node.end,  // end at the end of the full call, including params and inner func.
          arguments: arguments,
          ...(hasLiteralArguments ? { literalArguments } : null),
        })
      }
    },
  });
  return calls;
}

module.exports = {
  parse,
  findCyStuff,
  readFileAndParseAST,
}
