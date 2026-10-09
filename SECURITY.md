# Security policy

Spinarr parses untrusted data: the structure of any disc or disk image you open. We take memory-safety and sandbox-escape bugs seriously.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub's **Security → Report a vulnerability** on this repository. Include:

- The Spinarr version or commit, and your macOS version.
- A minimal reproducer, ideally just the `VIDEO_TS/*.IFO` files (a few KB) rather than a whole disc.
- What happens (crash, sanitizer trace, sandbox escape, file written outside the output folder…).

We aim to acknowledge reports within 3 days and ship a fix or mitigation within 30 days. Bugs in libdvdread, libdvdnav or ffmpeg are reported upstream as well, with credit to you unless you'd rather stay anonymous.

## Supported versions

Only the latest release gets security fixes.

## How Spinarr is hardened

The full threat model and test results are in [docs/SECURITY_TESTING.md](docs/SECURITY_TESTING.md). In short:

- **The engine runs in a sandbox.** `dvdinfo`, `ffprobe` and `ffmpeg` run under a macOS sandbox profile:
  - no network, no fork/exec
  - no reading user data except the chosen source
  - writes only to the output folder and libdvdcss's key cache
  - a minimal environment
- **Patched, fuzzed parsers.** libdvdread is built from pinned, checksum-verified source with Spinarr's memory-safety patches (`engine/patches/`). The patches came from AddressSanitizer fuzzing, and the crash corpus runs as a regression suite (`test/fixtures/malicious/`).
- **A locked-down UI process.** It runs with:
  - the Electron sandbox and context isolation, and no Node.js
  - a strict CSP on a dedicated `app://` origin
  - navigation and window opening blocked
  - every IPC argument validated in the main process
- **No auto-scan of downloaded images.** Only physical optical discs scan automatically.
