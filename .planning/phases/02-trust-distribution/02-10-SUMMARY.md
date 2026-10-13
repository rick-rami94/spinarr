---
phase: 02-trust-distribution
plan: 10
subsystem: fuzzing
tags: [fuzzing, clusterfuzzlite, ci, github-actions, security-advisories, SAFE-10, D-09, D-10, D-11]
requires:
  - "02-04: environment fuzz, private repo rick-rami94/spinarr-fuzz-corpus, fuzz credential = GitHub App"
  - "02-08: .clusterfuzzlite build, scripts/fuzz-run.sh (exit 3 = crash, log-only output)"
provides:
  - "scripts/fuzz-report.js: parseSanitizerLog, crashSignature, advisoryPayload, report; CLI --crashes --corpus-repo --mode pr|nightly|fork"
  - ".github/workflows/fuzz-pr.yml: 10-minute code-change fuzzing on PRs touching parsers or fuzz setup"
  - ".github/workflows/fuzz-cron.yml: nightly batch (1 h/target), weekly prune + coverage summary, workflow_dispatch"
  - "test/unit/fuzz-workflows.test.js: static privacy and pinning invariants for fuzz-*.yml"
affects: [02-13]
tech-stack:
  added:
    - "actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 (v3.2.0)"
    - "google/clusterfuzzlite/actions/build_fuzzers@884713a6c30a92e5e8544c39945cd7cb630abcd1 (v1)"
  patterns:
    - "Fuzz step stores its exit status in a step output; crash handling runs, then a final Result step fails the job"
    - "One App token minted right before each use, scoped to one repo and one permission"
    - "git auth via -c http.https://github.com/.extraheader with the base64 value ::add-mask::ed first"
key-files:
  created:
    - scripts/fuzz-report.js
    - test/unit/fuzz-report.test.js
    - .github/workflows/fuzz-pr.yml
    - .github/workflows/fuzz-cron.yml
    - test/unit/fuzz-workflows.test.js
  modified: []
decisions:
  - "Advisory and web URLs are built only from the constant rick-rami94/spinarr and a ghsa_id that matches /^GHSA(-[0-9a-z]{4}){3}$/; the response's html_url is never echoed"
  - "The reproducer and sanitizer.log are written to the private repo before the advisory POST, so a failed API call still keeps the evidence; advisory.json is written only on success, so the next run retries the advisory"
  - "PR runs push only crashes/ to the private repo, never the PR's grown corpus"
  - "Advisory token is scoped with permission-repository-advisories: write (not in the action's generated input list, but the action reads every permission-* input)"
  - "Prune runs that crash go through the same private report path as nightly batch"
  - "client-id input is used (app-id is deprecated in v3); vars.FUZZ_APP_ID may hold the App ID or the Client ID, since both are valid JWT issuers"
metrics:
  duration: "~40 min"
  completed: 2026-10-12
  tasks: 2
  files: 5
---

# Phase 2 Plan 10: CI fuzzing with private crash handling Summary

Fuzzing now runs on PRs, nightly and weekly in the public repo. Every crash goes to the private corpus repo and a private draft advisory. The public log carries one advisory link per crash and nothing else.

## Task 1: scripts/fuzz-report.js (TDD: 3d0e5a1 RED, 2425660 GREEN)

- `parseSanitizerLog` takes the bug type from `ERROR: AddressSanitizer: <type>`. Otherwise it returns `oom`, `timeout`, `ubsan` (`runtime error:`) or `deadly-signal`. Frames come from the first stack only. It stops when the frame number restarts, which skips "freed by" stacks. It drops `__asan*`, `__sanitizer*`, `__interceptor*`, `__ubsan*`, `__lsan*`, `fuzzer::*`, `LLVMFuzzerTestOneInput`, `main` and libc start frames. C++ parameter lists are stripped.
- `crashSignature` = sha256(target + "\n" + the top three frames). Addresses do not affect it.
- `advisoryPayload` uses a code fence longer than any backtick run in the log, so the log cannot break out of the fence.
- `report`:
  - **New signature:** stores `reproducer` and `sanitizer.log`, makes one POST, then writes `advisory.json` = `{ ghsa_id, html_url, created_at }`.
  - **Known signature:** no POST. The output links the existing advisory.
  - **Fork mode:** writes nothing and prints one fixed line.
- **Error handling:** API errors become `advisory creation failed (HTTP <status>)`. Network errors and malformed responses get their own fixed messages. The CLI prints only those fixed messages, and anything else becomes `internal error`. The token, request body and response body are never printed.
- **Tests:** 17 tests covering new, known, same-signature-twice, fork, no-crash, API failure, network error, malformed response, missing token, and the CLI exit codes 0, 1 and 2 (the CLI tests stub `fetch` through `node -r`). Every stdout check also confirms that `#0 `, `ERROR: AddressSanitizer`, `runtime error`, the reproducer marker and the token never appear.
- **Real-log check:** I rebuilt the unpatched ASan build-out from the local `spinarr-cflite` image and ran `fuzz-run.sh --mode batch --seconds 30`: exit 3, 2 crashes. fuzz-report.js, with a stubbed fetch, parsed the real CIFuzz `.summary` files into the right libdvdread and libbluray parser frames. It printed only two GHSA lines. A second run made no new POSTs (dedupe works). Everything stayed in the scratchpad, and nothing was committed (D-09).

## Task 2: workflows and static tests (75830cb)

**fuzz-pr.yml** runs on `pull_request` when these paths change: `engine/**`, `fuzz/**`, `.clusterfuzzlite/**`, `scripts/fuzz-*` and `.github/workflows/fuzz-*.yml`. It is one job `fuzz` with a 45-minute timeout and `environment: fuzz`. Steps:

1. checkout with `persist-credentials: false`.
2. `build_fuzzers` with `sanitizer: address`, `upload-build: false` and `keep-unaffected-fuzz-targets: true`.
3. For same-repo PRs only: mint a token and clone the private corpus.
4. `sysctl vm.mmap_rnd_bits=28`.
5. `fuzz-run.sh --mode code-change --seconds 300`. The exit status goes to a step output.
6. On exit 3, same-repo PRs mint an advisory token, run `fuzz-report.js --mode pr`, and push only `crashes/`. Fork PRs run `--mode fork` instead.
7. A final `Result` step fails the job with the plan's two messages.

Every credentialed step is gated on `head.repo.full_name == github.repository`.

**fuzz-cron.yml** has crons `17 3 * * *` (nightly) and `41 4 * * 0` (weekly), plus a `workflow_dispatch` input `mode` (batch, prune or coverage). Concurrency group `fuzz-corpus`, with `cancel-in-progress: false`.

- **batch** (180-minute timeout): runs 3600 s per target, pushes `corpus/` and `crashes/`, and reports crashes with `--mode nightly`.
- **prune** (60-minute timeout): runs 600 s per target and pushes the pruned corpus. A crash goes through the same report path.
- **coverage** (60-minute timeout): uses a separate `sanitizer: coverage` build and runs `--mode coverage --report`. It pushes only `coverage/<UTC date>/summary.txt`. The HTML report stays on the runner.

All pushes commit as `spinarr-fuzz-bot <noreply@github.com>`, with no trailers. A push is retried up to three times with `pull --rebase`, because PR and scheduled runs can push at the same time.

**Comments:** Both headers describe the D-09 model and contain the documented exception: `build_fuzzers` runs the floating `clusterfuzzlite-build-fuzzers:v1` image. The headers do not use the literal forbidden names, so the acceptance grep returns 0.

**test/unit/fuzz-workflows.test.js** (23 tests) checks each fuzz workflow for:
- no `upload-artifact`, `run_fuzzers`, `upload-sarif`, `output-sarif: true`, `pull_request_target` or download-artifact;
- every `uses:` matches `@<40 hex> # v\d`;
- every checkout has `persist-credentials: false`;
- no `${{` inside run scripts, with block scalars tracked by indentation;
- `fuzz.log` is never passed to cat, tee, head, tail, grep and similar commands;
- fuzzers run only through `fuzz-run.sh`;
- `mmap_rnd_bits=28` comes before the fuzz run;
- `contents: read` at the top level, every job has `timeout-minutes`, and every job that uses credentials has `environment: fuzz`;
- the advisory credential appears only in steps that call `fuzz-report.js`;
- the `add-mask` comes before `extraheader`;
- the bot identity is right and there are no Co-Authored-By trailers;
- App tokens are scoped to one repo with an explicit write permission.

It also checks the PR paths, the fork gating, both cron lines and the `fuzz-corpus` concurrency group.

### Verification

| Check | Result |
|---|---|
| `node --test test/unit/fuzz-workflows.test.js test/unit/fuzz-report.test.js` | 40 pass, 0 fail |
| `npm run test:unit` | 168 tests, 166 pass, 0 fail (2 skipped, as before) |
| `grep -c 'upload-artifact\|run_fuzzers\|upload-sarif\|pull_request_target'` on both files | 0 and 0 |
| zizmor 1.30.1 (installed from `.github/requirements-audit.txt` with `--require-hashes`), `--min-severity medium .github/workflows` with online audits | No findings |
| zizmor `--persona pedantic` on the fuzz workflows | 4 info `anonymous-definition` (unnamed checkout steps, same as ci.yml) |
| `grep -c "console.log(.*body\|console.error(.*body" scripts/fuzz-report.js` | 0 |
| `grep -c security-advisories scripts/fuzz-report.js` | 1, built from the constant `rick-rami94/spinarr` |

## Pending (needs Rick; nothing was pushed)

1. **Create the GitHub App.** Set variable `FUZZ_APP_ID` (the App ID or Client ID) and secret `FUZZ_APP_PRIVATE_KEY` in environment `fuzz`. Install the App on `spinarr-fuzz-corpus` and `spinarr` with these repository permissions: Contents read/write and Repository security advisories read/write (Metadata read is implied). Until this is done, same-repo PR runs fail at the token step, and scheduled runs fail at their first step.
2. **Environment `fuzz` branch policy.** The PR job declares `environment: fuzz`. If the environment limits deployment branches to `main`, PR runs will be blocked. Allow all branches, or at least PR head branches. No required reviewers on this environment, or every PR run waits for approval.
3. **Live run acceptance (plan Task 2).** After the branch is pushed, the CI `audit` job (zizmor) should be green. A `fuzz-pr.yml` run on the open PR should complete green on the patched build with no artifacts: `gh api repos/rick-rami94/spinarr/actions/runs/<id>/artifacts --jq .total_count` should print 0. Not done here, because pushes are out of scope for this executor.
4. **fuzz-cron.yml first real run.** Schedules and dispatch run only from the default branch, so the first run happens after the Phase 2 merge, and plan 02-13 Task 3 verifies it. Here it passed the static tests and zizmor.
5. **Runner warning.** The runner will warn `Unexpected input 'permission-repository-advisories'` on the advisory-token step. This is expected (see decisions). If a live run shows the token lacks the advisory permission, drop that input and rely on the App's installation permissions plus the `repositories: spinarr` scope.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security] The advisory response is validated, not echoed**
- **Found during:** Task 1
- **Issue:** The plan writes `html_url` from the API response. A malformed or unexpected response could put arbitrary text in the public log, or a path into `advisory.json`.
- **Fix:** `ghsa_id` must match `/^GHSA(-[0-9a-z]{4}){3}$/`, and the URL is rebuilt from the constant base. Anything else raises `advisory creation failed (unexpected response)`.
- **Commit:** 2425660

**2. [Rule 2 - Security] Same-repo gate on every PR credential step**
- **Found during:** Task 2 (static test)
- The PR job's push-token and push steps were gated only by `steps.clone.outcome == 'success'`. That condition implies a same-repo PR, but only indirectly. I added the explicit `head.repo.full_name == github.repository` condition, and the static test now enforces it on every PR step that touches a secret or a minted token.
- **Commit:** 75830cb

**3. [Rule 1 - Bug] Header comments tripped the acceptance grep**
- The D-09 warning comments named the forbidden actions literally, so the `grep -c` acceptance check returned 2. I reworded them ("artifact uploads", "run-fuzzers action", "SARIF", "PR-target trigger"). The static test now checks the whole file, comments included.
- **Commit:** 75830cb

### Additions within scope

- I added `concurrency: fuzz-pr-<PR number>` with `cancel-in-progress: true` to the PR workflow, so a new push replaces an in-flight run.
- `keep-unaffected-fuzz-targets: true` and `upload-build: false` are set explicitly on every `build_fuzzers` call.
- The 02-04 SUMMARY does not exist yet, so the credential variant (GitHub App) comes from the orchestrator notes. Only the App variant is implemented. The PAT variant (`FUZZ_CORPUS_TOKEN` / `FUZZ_ADVISORY_TOKEN` secrets) was not written.

## TDD Gate Compliance

RED `3d0e5a1` (`test(02-10)`) → GREEN `2425660` (`feat(02-10)`). No refactor commit was needed.

## Threat Flags

None beyond the plan's register. T-02-28 to T-02-32 are mitigated as planned (static tests, fork gating, per-step scoped tokens, masked auth header, no expressions in run scripts, signature dedupe).

Accepted residual: same-repo PR code runs in the job that later mints App tokens. Only collaborators can push same-repo branches, and the tokens are minted after the build step and scoped to one repo each.

## Self-Check: PASSED

- All 5 key files exist.
- Commits 3d0e5a1, 2425660 and 75830cb are on worktree-agent-ad8a6e83381edaaba.
