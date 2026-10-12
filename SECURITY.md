# Security policy

Spinarr parses untrusted data: the structure of any disc or disk image you open. We take memory-safety and sandbox-escape bugs seriously.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through GitHub's **Security → Report a vulnerability** on this repository. If you can't use GitHub's private reporting, email **rickramirez94@gmail.com** instead (not a public issue) with the same details. Include:

- The Spinarr version or commit, and your operating system and version.
- A minimal reproducer, ideally just the `VIDEO_TS/*.IFO` files (a few KB) rather than a whole disc.
- What happens (crash, sanitizer trace, sandbox escape, file written outside the output folder…).

We aim to acknowledge reports within 3 days and ship a fix or mitigation within 30 days. Bugs in libdvdread, libdvdnav or ffmpeg are reported upstream as well, with credit to you unless you'd rather stay anonymous.

## Supported versions

Only the latest release gets security fixes.

## How Spinarr is hardened

The full threat model and test results are in [docs/SECURITY_TESTING.md](docs/SECURITY_TESTING.md). In short:

- **The engine runs in a sandbox** where the OS allows it. `dvdinfo`, `bdinfo`, `ffprobe` and `ffmpeg` get:
  - no network
  - no reading user data except the chosen source
  - writes only to the output folder and the decryption libraries' caches
  - a minimal environment

  On **macOS** this is a sandbox profile (`app/lib.js`), which also blocks fork/exec. On **Linux** it's bubblewrap (`app/platform.js`): new user, PID, network, IPC and mount namespaces, with `/usr` and the source read-only and all capabilities dropped. If bubblewrap isn't installed, the engine runs unsandboxed, **Settings → System** says so, and Spinarr asks before every scan. **Windows** has no engine sandbox yet. Settings says that too, and Spinarr asks before every scan.
- **Patched, fuzzed parsers.** libdvdread is built from pinned, checksum-verified source with Spinarr's memory-safety patches (`engine/patches/`). The patches came from AddressSanitizer fuzzing, and the crash corpus runs as a regression suite (`test/fixtures/malicious/`).
- **A locked-down UI process.** It runs with:
  - the Electron sandbox and context isolation, and no Node.js
  - a strict CSP on a dedicated `app://` origin
  - navigation and window opening blocked
  - every IPC argument validated in the main process
- **No unsandboxed auto-scan.**
  - Physical discs scan automatically only when the engine sandbox is on.
  - Where it's off (Windows today, Linux without bubblewrap, or a dev run with `SPINARR_NO_SANDBOX`), Spinarr asks before every scan and never remembers the answer.
    - A yes covers only that disc or image as it was when you scanned it. If it is ejected, swapped for another disc in the same drive or folder, or the image file has changed since, Spinarr refuses to probe or rip it until you scan again. A queued rip whose disc changed fails instead of running.
    - For a disc folder, Spinarr checks the size, file ID and modification time of every file in the folders the disc readers use. For a DVD, that is the folder's top level plus VIDEO_TS and the other DVD folders libdvdread looks in. For a Blu-ray, it is BDMV (including BACKUP), AACS, CERTIFICATE and BDSVM. A folder it can't fully list or read is refused, not trusted.
    - Hidden system files such as .DS_Store and ._ files are ignored, and so are Thumbs.db and desktop.ini in DVD folders, so they don't cause false refusals.
  - Disk images and folders are never scanned without a click.

  The limit: the prompt and the same-disc check are enforced in the main process, which refuses to probe or rip a disc that hasn't been scanned or has changed since. "The same disc" is judged from file-system details (volume serial or device, file IDs, sizes, timestamps), not a hash of the contents. A disc built to copy those details exactly could pass. A disc whose checked folders hold more than 20,000 entries in total is refused. On disks that ignore letter case (the macOS and Windows defaults), a DVD's folders can be counted twice, so the practical DVD limit there is about 10,000. This check also runs when the sandbox is on. Ejecting or changing the disc normally clears the answer. But on Windows, Spinarr checks drives every few seconds, so a quick swap can be missed. That is why, before every probe or rip, Spinarr also checks that the disc's files still match what was scanned.

  **Known limit: the same-disc check is a best-effort guard, not a sandbox.** Anyone who can write to a folder or image you said yes to can still influence the unsandboxed engine:
  - The check runs before each probe or rip starts. The engine keeps opening files for the whole rip, so a file changed after it starts is read as changed.
  - A crafted Blu-ray playlist can name clip files the check skips, for example hidden dot-names.
  - A file rewritten at the same size, with its timestamps restored, looks unchanged.

  Full protection comes from the engine sandbox on every OS. Windows has none today. That work is tracked as SF-1. All of this protects against app bugs, not against a UI process that is already compromised.
