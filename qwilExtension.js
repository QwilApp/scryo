const assert = require('assert').strict;
const walk = require('acorn-walk');
const { parseCallee, nodeIsFunction, isTestOrDescribeIdentifier, SUPPORTED_HOOKS, getPropertyKey, isSkip, isOnly,
  isDescribeIdentifier, inferTestName
} = require('./parseUtils');

const SCENARIO_PREFIX = "expectStandardScenariosFor";
const SCENARIO_FN_SUFFIX = "Fn";

/** Qwil extension to detect cy calls within expectStandardScenariosFor* test factories **/
function runQwilExtension(ast, helpers) {
  const scenarios = [];
  const errors = [];

  if (ast) {
    walk.ancestor(ast, {
      CallExpression: function(node, ancestors) {
        const dottedName = parseCallee(node);
        if (!dottedName) {
          return; // ignore calls without name identifiers e.g. [].push(...)
        }

        if (dottedName === "describe") {
          validateDescribeMembers(node).forEach(e => errors.push(e));
        } else if (dottedName.startsWith(SCENARIO_PREFIX)) {
          const output = parseScenario(node, ancestors, helpers);
          if (output.errors) {
            output.errors.forEach(function(e) {errors.push(e)});
          }
          if (output.scenario) {
            scenarios.push(output.scenario);
          }
        }
      },
    });
  }

  return { scenarios, errors };
}

function validateDescribeMembers(node) {
  const errors = [];

  assert(
    node.type === "CallExpression" && node.callee.name === "describe",
    "This method should only be called for 'describe' CallExpression"
  );

  if (node.arguments.length < 2) {
    errors.push({
      message: "'describe' has insufficient number of arguments",
      loc: node.start,
    })
    return errors;
  }

  if (node.arguments[0].type !== 'Literal') {
    errors.push({
      message: `[MAYBE FACTORY] 'describe' has non-literal name. Assuming this is a test factory. Some checks disabled.`,
      loc: node.start,
    })
    return errors;
  }

  const implNode = node.arguments[1];
  if (!nodeIsFunction(implNode)) {
    errors.push({
      message: `function expected, but found ${implNode.type}`,
      loc: implNode.start,
    })
    return errors;
  }

  // for each top-level statement in func body
  implNode.body.body.forEach(function(n) {
    if (n.type === "ExpressionStatement" && n.expression.type === "CallExpression") {
      const dottedName = parseCallee(n.expression);
      if (!dottedName) {
        return; // ignore calls without name identifiers e.g. [].push(...)
      }
      // allow tests and describes and hooks
      if (isTestOrDescribeIdentifier(dottedName) || SUPPORTED_HOOKS.has(dottedName)) {
        return;
      }

      // allow scenario factories
      if (dottedName.startsWith(SCENARIO_PREFIX)) {
        return;
      }

      // everything else banned
      errors.push({
        message: `[PURE DESCRIBE] 'describe' should only call tests or hooks. Found '${dottedName}`,
        loc: n.start,
      })
    }
  });

  return errors;
}

function parseScenario(node, ancestors, helpers) {
  const name = parseCallee(node);
  const errors = [];

  assert(
    node.type === "CallExpression" && node.callee.name.startsWith(SCENARIO_PREFIX),
    "This method should only be called for CallExpression with SCENARIO_PREFIX"
  );

  if (node.arguments.length !== 1) {
    errors.push({
      message: `${name}: Scenario factory should have 1 argument. Found ${node.arguments.length}.`,
      loc: node.start,
    })
    return { errors };
  }

  const argNode = node.arguments[0];
  if (argNode.type !== "ObjectExpression") {
    errors.push({
      message: `${name}: ObjectExpression expected as argument. Found ${argNode.type}.`,
      loc: node.start,
    })
    return { errors };
  }

  let scopeNodes = ancestors
    .filter((n) => n.type === "CallExpression")
    .map((n) => ({node: n, dotted: parseCallee(n)}))
    .filter((o) => o.dotted && isDescribeIdentifier(o.dotted));

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

  const scenario = {
    name,
    scope,
    start: node.start,
    end: node.end,
    functions: [],
  };

  // Inspect top-level properly for object argument
  argNode.properties.forEach(function(propNode) {
    const propName = getPropertyKey(propNode);
    if (propName.endsWith(SCENARIO_FN_SUFFIX)) {
      if (propNode.shorthand) {
        errors.push({
          message: `${name}: Object prop shorthand not allowed for scenario factory - { ${propName} }`,
          loc: propNode.start,
        });
      } else if (!nodeIsFunction(propNode.value)) {
        errors.push({
          message: `${name}: '${propName}' prop value must be a function. Found ${propNode.value.type}`,
          loc: propNode.value.start,
        });
      } else {
        const funcNode = propNode.value;
        scenario.functions.push({
          name: propName,
          start: propNode.start,
          end: propNode.end,
          funcStart: funcNode.start,
          funcEnd: funcNode.end,
          cyMethodsUsed: helpers.findInnerCypressCalls(funcNode),
          otherFuncCalls: helpers.findInnerFuncCalls(funcNode),
        });
      }
    } else {
      if (nodeIsFunction(propNode.value)) {
        errors.push({
          message: `${name}: '${propName}' prop does not end with '*${SCENARIO_FN_SUFFIX}'. Must not reference a function`,
          loc: propNode.value.start,
        });
      }
    }

  });

  return { errors, scenario };
}

module.exports = {
  runQwilExtension,
}
