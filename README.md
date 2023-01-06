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
  "chain": Array[String], // chain of cy calls leading to this. 
                          // e.g cy.a().b().c() will result in {"chain": ["a", "b"], "name": "c"}
}
```

**`CommmandAddObj`:**
```text
{
  "name": String,  // name of the Cypress command added
  "start": Number, // char offset in file where definition started
  "end": Number,   // char offset in file where definition ended
  "cyMethodsUsed": Array[CommmandUseObj],  // cy methods used within the implementation of this command
}
```

**`TestObj`:**
```text
{
  "name": Array[String], // Test descriptions.
                         // e.g. describe("a", () => { it("b", () => {...}) }) results in {"name": ["a", "b"]}
  "scope": Array[ScopeObj], // Describes nesting scope
  "start": Number, // char offset in file where definition started
  "end": Number,   // char offset in file where definition ended
  "funcStart": Number, // char offset in file where definition of test implementation function started
  "funcEnd": Number, // char offset in file where definition of test implementation function ended
  "cyMethodsUsed": Array[CommmandUseObj],  // cy methods used within the implementation of this test
  "skip"?: Boolean, // If this test was effectively skipped, either by it.skip or describe.skip on parent scope
  "only"?: Boolean, // If this test was effectively set to "only", either by it.only or describe.only on parent scope
}
```

**`ScopeObj`:**
```text
{
  "func":  "it" | "it.only" | "it.skip" |  "describe" | "describe.only" | "describe.skip",
  "start": Number, // char offset in file where definition started
  "end": Number,   // char offset in file where definition ended
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
    it("should show error snackbar on submit if offline", () => {
      cy.navigateToLogin()
        .goOffline()
        .submitLogin({username: "bob", password: "builder"})
        .expectErrorSnackbar();
    })
  })
})
```

We expected to get:
```json
{
  "cypress/e2e/login/errorConditions.js": {
    "tests": [
      {
        "name": [
          "Login",
          "Error conditions",
          "should show error snackbar on submit if offline"
        ],
        "scope": [
          {
            "func": "describe",
            "start": 0,
            "end": 286
          },
          {
            "func": "describe",
            "start": 28,
            "end": 283
          },
          {
            "func": "it",
            "start": 69,
            "end": 278
          }
        ],
        "start": 69,
        "end": 278,
        "funcStart": 123,
        "funcEnd": 277,
        "cyMethodsUsed": [
          {
            "name": "navigateToLogin",
            "start": 140,
            "end": 157,
            "chain": []
          },
          {
            "name": "goOffline",
            "start": 167,
            "end": 178,
            "chain": [
              "navigateToLogin"
            ]
          },
          {
            "name": "submitLogin",
            "start": 188,
            "end": 239,
            "chain": [
              "navigateToLogin",
              "goOffline"
            ]
          },
          {
            "name": "expectErrorSnackbar",
            "start": 249,
            "end": 270,
            "chain": [
              "navigateToLogin",
              "goOffline",
              "submitLogin"
            ]
          }
        ]
      }
    ],
    "added": [],
    "used": [
      {
        "name": "navigateToLogin",
        "start": 140,
        "end": 157,
        "chain": []
      },
      {
        "name": "goOffline",
        "start": 167,
        "end": 178,
        "chain": [
          "navigateToLogin"
        ]
      },
      {
        "name": "submitLogin",
        "start": 188,
        "end": 239,
        "chain": [
          "navigateToLogin",
          "goOffline"
        ]
      },
      {
        "name": "expectErrorSnackbar",
        "start": 249,
        "end": 270,
        "chain": [
          "navigateToLogin",
          "goOffline",
          "submitLogin"
        ]
      }
    ]
  }
}


```
