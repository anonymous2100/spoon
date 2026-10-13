---
name: test-spoon
description: Test every feature of the Spoon Electron Git client and report what is broken. Runs the unit suite (main-process logic against real throwaway Git repos) and the Playwright end-to-end suite that drives the real Electron window, then maps each failure to a feature and tells known bugs (todo BUG-xx) apart from new regressions. Use this whenever the user asks to test Spoon, run the tests, check that nothing broke, do QA or a regression pass, verify a release / version bump, "probá todas las funciones", "testeá el soft", or after changing code in src/ before committing. Also use it when adding or changing a feature, to add the matching tests and keep tests/TEST_PLAN.md in sync.
---

# test-spoon

Spoon has a full automated suite. Your job is to run the right part of it, read the results
carefully and tell the user what is actually broken. Never weaken a test so it turns green.

Read `tests/TEST_PLAN.md` first. It has the feature → test map, the commands, and the table of
known bugs. Everything below assumes you know it.

## 1. Choose the scope

| Situation | Run |
|---|---|
| Quick check, or a change only under `src/main` or `src/shared` | `npm run test:unit` (~3 min) |
| Renderer / UI change, a release, or "test everything" | `npm test` (unit + E2E, ~17 min) |
| One area (e.g. stash, AI, history) | the matching file, see below |
| Styling / button changes | also `npm run test:visual` |

Run the long suites in the background and write the output to a log, so you can keep working
and read the log afterwards:

```bash
npm test > output/test-run.log 2>&1; echo "exit=$?" >> output/test-run.log
```

Targeted runs:

```bash
node --import ./tests/support/register.mjs --test tests/unit/<file>.test.ts
npm run build && node --test --test-name-pattern="<words from the test name>" tests/e2e/<file>.test.mjs
```

E2E tests run the built app in `out/`. Whenever `src/` changed since the last build, run
`npm run build` first (the `test:e2e` script already does this).

Run only one E2E file at a time. They drive real Electron windows, and two parallel runs
fight over focus and timing.

## 2. Read the results

In the log, `✔` means pass, `✖` means fail, and `# todo` marks a known bug.

1. **Failures (`✖`).** These are regressions or new problems. For each one:
   - Read the assertion message.
   - For E2E, open the screenshot `output/e2e/fail-<test name>.png` with Read. It usually shows
     the cause right away (a dialog still open, an error box, the wrong view).
   - Find the feature in `tests/TEST_PLAN.md`, then the code behind it.
   - Decide whether the **app** is wrong or the **test** is outdated. For example, the UI changed
     on purpose and a selector or label no longer exists. Check `git diff` and `git log` for
     intentional changes before calling something a bug.
2. **Todo tests.** These are the known bugs (`BUG-xx`). If a todo test now **passes**, that bug
   was fixed: say so, remove its `todo` option, and move the row out of the known-bugs table.
   That turns the test into a guard against the bug coming back.
3. **"no uncaught renderer errors" failures.** These list exceptions thrown in the UI. Known
   ones are filtered through `KNOWN_PAGE_ERRORS` in `tests/e2e/harness.mjs`. Any new message
   there is a real problem.

Don't rerun a failing test over and over hoping it passes. If you suspect flakiness, run that
single test twice. If it fails only sometimes, report it as flaky and include the evidence.

## 3. Report to the user

Answer in the user's language. Lead with the verdict, then give details:

- **Totals:** pass / fail / todo, unit and E2E separately.
- **New failures:** for each, the feature, what the user would see, the likely cause
  (`file:line`), and whether it is an app bug or an outdated test.
- **Fixed known bugs:** any todo tests that started passing.
- **Not run, and why:** for example, E2E was skipped because only `src/main` changed.

Don't paste whole logs. Quote the one assertion line that matters.

Fix code only if the user asks. When you fix a bug:
- Make its todo test pass.
- Remove the `todo` option.
- Update `tests/TEST_PLAN.md`.
- If the bug was listed in `KNOWN_PAGE_ERRORS`, remove that entry.

## 4. Keep the suite in sync when features change

When a feature is added or changed, add or adjust tests in the same change and update the
feature map in `tests/TEST_PLAN.md`. Put each test where its kind of behaviour lives:

| Behaviour | Test location |
|---|---|
| Git / main-process logic | `tests/unit/git-*.test.ts`, `store`, `ai`, `main-services` (uses `tests/support/repo.ts` for throwaway repos) |
| Pure helpers in `src/shared` | `tests/unit/shared.test.ts` |
| Anything the user clicks | `tests/e2e/<area>.test.mjs` |

Conventions that keep the suite reliable:

- **Assert on disk state.** Prove a click worked by checking Git (`git(...)`, `subjects(...)`,
  `ui.until(...)`), not by waiting a fixed time.
- **Native dialogs:** use the harness queues. Call `ui.confirmNext(true|false)` before an action
  that confirms. Use `ui.answer('open', [path])` for folder pickers. Use `ui.pickMenu(open, id)`
  for native context menus. Use `ui.expectError(/re/)` for error boxes.
- **Selectors:** prefer role and name, placeholders, and stable class names. Buttons that only
  show on hover need `.hover()` first.
- **Isolation:** never point a test at the user's real repos, home folder or AI accounts. The
  harness and `register.mjs` sandbox all of that, so keep using them.
- **New confirmed bugs:** write the test for the correct behaviour and mark it
  `{ todo: 'BUG-xx short reason' }`. Add the bug to the known-bugs table in `TEST_PLAN.md`.

## 5. Exploratory check (optional)

When the user wants a feature checked by hand, or the suite does not cover it, use the `run`
skill to launch the app and try the flow. If you find something, turn it into a test as
described in section 4, so it stays covered.
