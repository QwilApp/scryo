const acorn = require("acorn");
const walk = require("acorn-walk");
const fs = require("fs");
const assert = require('assert').strict;

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


function findCyStuff(ast, options) {
  const optionDefaults = {
    find: {
      added: true,
      used: true,
      tests: true
    },
    // should we include "cyMethodsUsed" when we find added Cypress Command
    includeCyMethodsUsed: true,
  }
  const _options = Object.assign(optionDefaults, options);
  const findAdded = Boolean(_options.find.added);
  const findUsed = Boolean(_options.find.used);
  const findTests = Boolean(_options.find.tests);

  let added = [];
  let used = [];
  let tests = [];

  if (ast) {
    walk.simple(ast, {
      CallExpression: function (node) {
        const dottedName = parseCallee(node);
        if (!dottedName) {
          // this call should be ignored. so do nothing.
        } else if (findAdded && dottedName === "Cypress.Commands.add") {
          const [nameNode, funcNode] = node.arguments;
          assert(nameNode.type === "Literal", "Cypress command name must be a literal string");

          // get cy methods used by this command
          added.push({
            name: nameNode.value,
            start: node.start,
            end: node.end,
            ...(_options.includeCyMethodsUsed && { cyMethodsUsed: findCyStuff(funcNode, { find: { used: true } }).used }),
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

          used.push({
            name: nameSegments.at(-1),
            start: node.callee.property.start,  // start at identifier in case this is chained
            end: node.end,  // end at the end of the full call, including params and inner func.
            chain: chain,
          })
        }
      }
    });
  }

  return {
    ...(findAdded && { added }),
    ...(findUsed && { used }),
    ...(findTests && { tests }),
  };
}

function IgnoreMe(node) {
  this.node = node;
}

function parseCallee(node) {
  /**
   * Returns string representation of a CallExpression's callees, e.g.
   *  - "Cypress.Commands.add"
   *  - "cy.funcA().funcB"
   */
  assert(node.type === "CallExpression", "This method should only be called on CallExpression nodes");
  try {
    return _traverse(node.callee);
  } catch (e) {
    if (e instanceof IgnoreMe) {
      return null;
    } else {
      throw e;
    }
  }

  function _traverse(_node, suffix = "") {
    switch (_node.type) {
      case "Identifier":
        return _node.name;
      case "MemberExpression":
        return _traverse(_node.object) + "." + _node.property.name + suffix;
      case "CallExpression":
        return _traverse(_node.callee, "()");
      default:
        /**
         * calls could be chained to many other types, e.g.:
         *  - ArrayExpression:  [...].sort(..)
         *  - Literal: "...".repeat(10)
         *  - TemplateLiteral: `...`.repeat(10)
         *  - NewExpression: new Blah()
         *  - ...
         *
         * We do not want to handle any of that for now, so we throw end recursion and caller will catch to handle this
         */
        throw new IgnoreMe(node);
    }
  }
}


module.exports = {
  findCyStuff,
  readFileAndParseAST,
}