# scryo
Cypress test parser that can extract test structure, and Cypress Command definitions and usage.


## Usage

### Looking for Cypress command
```
scryo find <command_name> <files_or_dirs>
```
This will parse js file(s) in the given files/directories, and print out the locations where:
1. The command was defined i.e. `Cypress.Command.add("cmdName", ...)`
2. The command was called i.e. `cy.cmdName(...)` or even `cy.anotherCmd(...).cmdName(...)`.

**Example Usage:**
```
[me@home]$ npx scryo find expectErrorSnackbar ./cypress

👀 Found definition of Cypress command "expectErrorSnackbar":
    at (/Users/shawn/app/cypress/support/assertions.js:63:1)

🔍 Found 2 place(s) where cy.expectErrorSnackbar was used:
  🔗 cy.navigateToLogin().goOffline().submitLogin().expectErrorSnackbar()
        at (/Users/shawn/app/cypress/e2e/login/basicLogin.js:28:8)
  🔗 cy.navigateToLogin().patchNetworkResponse().submitLogin().expectErrorSnackbar()
        at (/Users/shawn/app/cypress/e2e/login/basicLogin.js:789:8)
```

### Get details of tests and Cypress Commands as JSON

```
scryo dump <files_or_dirs>
```

This will parse js file(s) in the given files/directories and emit the parsed content as JSON to stdout. 
This output will allow one to write reasonably complex validation rules without having to worry about source parsing.

Examples of validations than can be implemented with minimal effort:
* Detecting duplicate command definitions
* Identifying (and auto-deleting) unused cypress commands
* Enforcing test naming and organisation conventions
* e.t.c.


The output will be in the following format, with an entry for every parsed file:
```text
{
  "path/to/file.js": {
    "used": [],  // Array of CommmandUseObj (see definition below)
    "added": [], // Array of CommmandAddObj (see definition below)
    "tests": []  // Array of TestObj (see definition below)
    "hooks": {
      "before": [],      // Array of HookObj (see definition below)
      "beforeEach": [],  // Array of HookObj (see definition below)
      "after": [],       // Array of HookObj (see definition below)
      "afterEach": []    // Array of HookObj (see definition below)
    }
  }
}
```

* `"used"` will list out all the Cypress commands used in that file
* `"added"` will list out all the Cypress commands added in that file
* `"tests"` will list out all the Cypress tests defined in that file

**`CommmandUseObj`:**
```text
{
  "name": String,  // name of the cy command used
  "start": Number, // char offset in file where usage started
  "end": Number,   // char offset in file where usage ended
  "arguments": Array[CommandArgObj],  // type and char offsets for command arguments 
  "chain": Array[String], // chain of cy calls leading to this. 
                          // e.g cy.a().b().c() will result in {"chain": ["a", "b"], "name": "c"}
}
```

**`CommandArgObj`:**
```text
{
  "type": String,  // node type for the argument, e.g. "ObjectExpression", "ArrowFunctionExpression", etc
  "start": Number, // char offset in file where that argument started
  "end": Number,   // char offset in file where that argument ended
}
```

**`FuncCallObj`:**
```text
{
  "name": String, // name of non-cy function call
  "start": Number, // char offset in file where function call started. For dotted or chained calls, this points to
                   // beginning of the func identifier i.e. in the case of "hello.kitty()", start would point to "k"
  "rootStart": Number, // this points to actual start i.e. in the case of "hello.kitty()", start would point to "h"
  "end": Number,   // char offset in file where function call ended
  "arguments": Array[CommandArgObj],  // type and char offsets for function call arguments 
}
```

**`CommmandAddObj`:**
```text
{
  "name": String,  // name of the Cypress command added
  "start": Number, // char offset in file where definition started
  "end": Number,   // char offset in file where definition ended
  "cyMethodsUsed": Array[CommmandUseObj],  // cy methods used within the implementation of this command
  "otherFuncCalls": Array[FuncCallObj],  // function calls (excluding cy.*) within the implementation of this command
}
```

**`TestObj`:**
```text
{
  "scope": Array[ScopeObj], // Describes nesting scope
  "start": Number, // char offset in file where definition started
  "end": Number,   // char offset in file where definition ended
  "funcStart": Number, // char offset in file where definition of test implementation function started
  "funcEnd": Number, // char offset in file where definition of test implementation function ended
  "cyMethodsUsed": Array[CommmandUseObj],  // cy methods used within the implementation of this test
  "otherFuncCalls": Array[FuncCallObj],  // function calls (excluding cy.*) within the implementation of this command
  "skip"?: Boolean, // If this test was effectively skipped, either by it.skip or describe.skip on parent scope
  "only"?: Boolean, // If this test was effectively set to "only", either by it.only or describe.only on parent scope
}
```

**`HookObj`:**
```text
{
  "scope": Array[ScopeObj], // Describes nesting scope
  "start": Number, // char offset in file where definition started
  "end": Number,   // char offset in file where definition ended
  "funcStart": Number, // char offset in file where definition of test implementation function started
  "funcEnd": Number, // char offset in file where definition of test implementation function ended
  "cyMethodsUsed": Array[CommmandUseObj],  // cy methods used within the implementation of this test
  "otherFuncCalls": Array[FuncCallObj],  // function calls (excluding cy.*) within the implementation of this command
}
```

**`ScopeObj`:**
```text
{
  "func":  "it" | "it.only" | "it.skip" |  "describe" | "describe.only" | "describe.skip",
  "name": String,   // Text description 
  "start": Number,  // char offset in file where definition started
  "end": Number,    // char offset in file where definition ended
  "skip"?: Boolean, // If .skip
  "only"?: Boolean, // If .only
}
```

**Example Usage:**
```
[me@home]$ npx scryo dump cypress/e2e/login/errorConditions.js
```

Where the file contains:
```javascript
describe("Login", () => {
  describe("Error conditions", () => {
    beforeEach(() => {
      const params = utils.getNavParams();
      cy.navigateToLogin(params);
    })

    it("should show error snackbar on submit if offline", () => {
      cy.goOffline()
        .submitLogin({ username: "bob", password: "builder" })
        .expectErrorSnackbar();
    })
  })
})
```

We expected to get:
```json
{
  "test.js": {
    "added": [],
    "used": [
      {
        "name": "navigateToLogin",
        "start": 140,
        "end": 163,
        "arguments": [
          {
            "type": "Identifier",
            "start": 156,
            "end": 162
          }
        ],
        "chain": []
      },
      {
        "name": "goOffline",
        "start": 248,
        "end": 259,
        "arguments": [],
        "chain": []
      },
      {
        "name": "submitLogin",
        "start": 269,
        "end": 322,
        "arguments": [
          {
            "type": "ObjectExpression",
            "start": 281,
            "end": 321
          }
        ],
        "chain": [
          "goOffline"
        ]
      },
      {
        "name": "expectErrorSnackbar",
        "start": 332,
        "end": 353,
        "arguments": [],
        "chain": [
          "goOffline",
          "submitLogin"
        ]
      }
    ],
    "tests": [
      {
        "scope": [
          {
            "name": "Login",
            "func": "describe",
            "start": 0,
            "end": 369
          },
          {
            "name": "Error conditions",
            "func": "describe",
            "start": 28,
            "end": 366
          },
          {
            "name": "should show error snackbar on submit if offline",
            "func": "it",
            "start": 177,
            "end": 361
          }
        ],
        "start": 177,
        "end": 361,
        "funcStart": 231,
        "funcEnd": 360,
        "cyMethodsUsed": [
          {
            "name": "goOffline",
            "start": 248,
            "end": 259,
            "arguments": [],
            "chain": []
          },
          {
            "name": "submitLogin",
            "start": 269,
            "end": 322,
            "arguments": [
              {
                "type": "ObjectExpression",
                "start": 281,
                "end": 321
              }
            ],
            "chain": [
              "goOffline"
            ]
          },
          {
            "name": "expectErrorSnackbar",
            "start": 332,
            "end": 353,
            "arguments": [],
            "chain": [
              "goOffline",
              "submitLogin"
            ]
          }
        ],
        "otherFuncCalls": []
      }
    ],
    "hooks": {
      "before": [],
      "beforeEach": [
        {
          "scope": [
            {
              "name": "Login",
              "func": "describe",
              "start": 0,
              "end": 369
            },
            {
              "name": "Error conditions",
              "func": "describe",
              "start": 28,
              "end": 366
            }
          ],
          "start": 69,
          "end": 171,
          "funcStart": 80,
          "funcEnd": 170,
          "cyMethodsUsed": [
            {
              "name": "navigateToLogin",
              "start": 140,
              "end": 163,
              "arguments": [
                {
                  "type": "Identifier",
                  "start": 156,
                  "end": 162
                }
              ],
              "chain": []
            }
          ],
          "otherFuncCalls": [
            {
              "name": "utils.getNavParams",
              "start": 115,
              "rootStart": 109,
              "end": 129,
              "arguments": []
            }
          ]
        }
      ],
      "after": [],
      "afterEach": []
    }
  }
}
```
