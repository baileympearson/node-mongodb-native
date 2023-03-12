## Test tools and configuration

### Setup and Configuration

#### Contexts

Contains any custom JS contexts needed for special tests. Currently only used for testing `createIndex`
with objects created in separate contexts.

#### Fixtures

Contains any constant testing fixtures (constant template scripts, ect).

#### mongodb-mock

Contains the mongodb-mock server used for unit testing.

#### reporter

Contains a custom mocha reporter. The reporter supports output to stdout as well as reporting an xunit
file. Additionally, the custom mocha reporter is responsible for printing skip reasons (which are
defined when a test is skipped).

#### runner

The majority of our testing infrastructure lives here.

- `metadata_ui.js` contains a custom mocha UI (https://mochajs.org/#interfaces), that supports a
  metadata argument. This is primarily used to specify filter conditions for the test to run.
- `config.ts` contains the `TestConfiguration`. This class contains utilities for managing the current
  testing environment (i.e., "is serverless enabled?"), creating test clients and more.
- the `filters` directory contains filters that can skip tests based on test metadata.
- plugins contains a single mocha plugin, `deferred`. `deferred` allows specifying work to take place
  after a test has finished running (or later), commonly used for test cleanup. This has been superseded
  by `afterEach` or `after` hooks. Do not use.
- the `hooks` directory contains shared mocha before/after hooks. it also contains `configuration.js`.

##### configuration.js

The majority of the logic used to setup our integration test suite resides here. `configuration.js` contains a number of important hooks, but most importantly contains the following

- `initializeFilters` is used to initialize the filters used by tests. it is
  run once, meaning that each hook is instantiated a single time and shared
  across every test in the test suite.
- `testConfigBeforeHook` runs once, before all tests. this hook is responsible
  for initializing the filters with `initializeFilters`, as well as instantiating
  the `TestConfiguration` and attaching it as the `configuration` property on `this`.
- `testSkipBeforeEachHook` runs before each test and uses the filters and the
  current test's metadata to skip the test if all metadata conditions are not satisfied.

#### spec-runner

Contains the legacy spec test runner (the `TestRunnerContext`). Each legacy test suite directly instantiates
a `TestRunnerContext` when running the legacy tests.

No new tests using a `TestRunnerContext` should be written.

#### unified-spec-runner

Contains the unified test runner (the replacement for the legacy test runner).

#### . (current directory)

This directory contains a few misc scripts and tools.

- `uri_spec_runner.ts` contains the runner for uri unit tests
- `common.js` contains the `ReplSetFixture`, which is an abstraction that contains several mock servers
  running as a "replica set". This is primarily used for unit testing the Topology.
- `cmap_spec_runner.ts` contains the unit test runner for the cmap spec. There are also unified cmap tests, those
  are run by the unified test runner.
- `utils.ts` contains a collection of testing utilities. Many of these are obsolete.
