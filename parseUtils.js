const { interleaveArray } = require('./utils');
const assert = require('assert').strict;

const SUPPORTED_HOOKS = new Set(["before", "beforeEach", "after", "afterEach"]);

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

function maybeGetLiteralValue(node) {
  if (node.type === 'Literal') {
    return node.value;
  } else if (node.type === 'ObjectExpression') {
    // Try to see if all values can be mapped to literals
    // WARN: this would probably go brrrrr if object has cyclic references
    const output = {};
    for (let i = 0; i < node.properties.length; i++) {
      let prop = node.properties[i];
      let key = getPropertyKey(prop);
      if (!key) {
        return undefined;
      }
      let value = maybeGetLiteralValue(prop.value);
      if (!value) {
        return undefined;
      }
      output[key] = value;
    }
    return output;
  } else if (node.type === 'ArrayExpression') {
    const output = [];
    for (let i = 0; i < node.elements.length; i++) {
      let value = maybeGetLiteralValue(node.elements[i]);
      if (!value) {
        return undefined;
      }
      output.push(value);
    }
    return output;
  }

  return undefined;
}

function getPropertyKey(propNode) {
  if (!propNode.key) {
    return undefined;
  } else if (propNode.key.type === 'Literal') {
    return propNode.key.value;
  } else if (propNode.key.type === 'Identifier') {
    return propNode.key.name;
  }
}

function inferTestName(testCallNode) {
  const node = testCallNode.arguments[0];

  if (node.type === "Literal") {
    return node.value;
  } else if (node.type === "TemplateLiteral") {
    let expressions = node.expressions.map((i) => `\${${i.name}}`);
    let quasis = node.quasis.map((q) => q.value.raw);
    return interleaveArray(quasis, expressions).join("");
  } else if (node.type === "Identifier") {
    return `\${${node.name}}`;
  } else {
    return `[Unparseable: ${node.type}]`
  }
}

function nodeIsFunction(node) {
  return ["FunctionExpression", "ArrowFunctionExpression"].includes(node.type);
}

function isTestOrDescribeIdentifier(ident) {
  return isTestIdentifier(ident) || isDescribeIdentifier(ident);
}

function isTestIdentifier(ident) {
  return ident === "it" || ident.startsWith("it.");
}

function isDescribeIdentifier(ident) {
  return ident === "describe" || ident.startsWith("describe.");
}

function isSkip(ident) {
  return ident.endsWith(".skip");
}

function isOnly(ident) {
  return ident.endsWith(".only");
}


module.exports = {
  SUPPORTED_HOOKS,
  parseCallee,
  getPropertyKey,
  maybeGetLiteralValue,
  inferTestName,
  nodeIsFunction,
  isTestIdentifier,
  isTestOrDescribeIdentifier,
  isDescribeIdentifier,
  isSkip,
  isOnly,
}