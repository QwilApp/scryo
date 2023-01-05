# scryo
Parses cypress test files to extract Command definition/usage and tests.

## Usage

### Looking for Cypress command
```
scryo find <command_name> <files_or_dirs>
```
This will parse js file(s) in the given files/directories, and print out the locations where:
1. The command was defined i.e. `Cypress.Command.add("cmdName", ...)`
2. The command was called i.e. `cy.cmdName(...)` or even `cy.anotherCmd(...).cmdName(...)`.

Example Usage:
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
