# Encrypted DVDs and Blu-rays

Most discs you buy in a store are encrypted.

Spinarr can read them, but it doesn't ship the libraries or keys that do the decrypting. You install those yourself, once. This guide shows how.

**The short version:** open **Settings → System**. It shows what's installed, what's missing, and the exact command for your computer.

---

## Do I need this?

| Disc | Encryption | What you need |
|---|---|---|
| Home-made DVD, disc image (ISO) or folder | Usually none | Nothing. It just works. |
| Store-bought DVD | CSS | **libdvdcss** (a one-time install) |
| Store-bought Blu-ray | AACS | **libaacs**, plus **your own `KEYDB.cfg`** key file |
| Blu-ray with BD+ | BD+ | Not supported |
| 4K Ultra HD Blu-ray | AACS 2.0 | Not supported |

Unsure? Insert the disc. If Spinarr needs something, it says what.

---

## DVDs: install libdvdcss

libdvdcss is the open-source library VLC uses to play DVDs. Install it with the command for your system:

| System | Command |
|---|---|
| macOS | `brew install libdvdcss` |
| Ubuntu, Debian, Mint | `sudo apt install libdvd-pkg && sudo dpkg-reconfigure libdvd-pkg` |
| Fedora | `sudo dnf install libdvdcss` (from RPM Fusion "tainted") |
| Arch | `sudo pacman -S libdvdcss` |
| openSUSE | `sudo zypper install libdvdcss2` (from Packman) |

**Windows:** download the 64-bit `libdvdcss-2.dll` from [VideoLAN](https://download.videolan.org/pub/libdvdcss/1.2.11/win64/). Then go to **Settings → System → Choose DLL…** and pick it. Spinarr checks it's a valid 64-bit DLL and puts it where the engine looks.

Then reopen Spinarr. **Settings → System** should say **libdvdcss installed**, and the **Finish setup** reminder in the sidebar disappears.

---

## Blu-rays: libaacs and your key file

Blu-ray encryption needs two things:

1. **libaacs**, the open-source library that does the decrypting.
2. **A `KEYDB.cfg` key file**, a text file of keys for specific discs.

Spinarr includes neither. It never downloads keys or links to them. The key file is yours to supply.

### Step 1: install libaacs

| System | Command |
|---|---|
| macOS | `brew install libaacs` |
| Ubuntu, Debian, Mint | `sudo apt install libaacs0` |
| Fedora | `sudo dnf install libaacs` |
| Arch | `sudo pacman -S libaacs` |
| openSUSE | `sudo zypper install libaacs0` |
| Windows | Put `libaacs.dll` in `%APPDATA%\Spinarr\lib` |

### Step 2: add your key file

1. Open **Settings → System**.
2. Under **Blu-ray decryption**, click **Choose KEYDB.cfg…**
3. Pick your `KEYDB.cfg`.

That's it. Spinarr checks the file really is a key file, then copies it to where libaacs looks. Only your user account can read the copy. If a Blu-ray is already open, Spinarr scans it again straight away.

The same button appears on the red **This disc can't be ripped** banner whenever a key file would fix the problem.

**If your key file is zipped,** unzip it first and choose the `.cfg` file inside. Spinarr won't accept the zip.

### Where the key file goes

Spinarr does this for you. Here's where it puts it, if you'd rather do it by hand:

| System | Location |
|---|---|
| macOS | `~/Library/Preferences/aacs/KEYDB.cfg` |
| Linux | `~/.config/aacs/KEYDB.cfg` |
| Windows | `%APPDATA%\aacs\KEYDB.cfg` |

To update it later, click **Replace KEYDB.cfg…** in the same place.

---

## What the messages mean

| Spinarr says | What it means | What to do |
|---|---|---|
| *Could not decrypt this disc. Install the decryption library for it…* | A DVD needs libdvdcss, which isn't installed | [Install libdvdcss](#dvds-install-libdvdcss) |
| *…Install libaacs…* | libaacs isn't installed | [Step 1](#step-1-install-libaacs) |
| *…found no KEYDB.cfg key file…* | libaacs is installed, but there's no key file | [Step 2](#step-2-add-your-key-file) |
| *…your KEYDB.cfg has no key that opens it* | Your key file doesn't cover this disc | Use a key file that includes this disc, then **Replace KEYDB.cfg…** |
| *…has no host certificate…* | This disc needs a certificate your key file lacks | Use a more complete key file |
| *…revokes the host certificates in your KEYDB.cfg* | The disc blocks the certificates you have | Use a key file with a newer certificate |
| *…its AACS files couldn't be read…* | The disc's encryption data is unreadable | Clean the disc and try again |
| *…the drive refused the AACS handshake* | The drive won't cooperate with libaacs | Try another drive. Some drives' firmware refuses. |
| *…uses BD+ protection, which Spinarr can't remove* | BD+ isn't supported | None in Spinarr |

---

## Is this safe?

Decryption happens inside Spinarr's engine, the same as everything else.

- **Nothing leaves your computer.** The engine is built with no network code, and your key file is never uploaded or shared.
- **On macOS and Linux,** the engine also runs in a sandbox. It can read your key file but not change it, it has no network access at all, and it can only write to your output folder and the decryption caches.
- **On Windows,** there's no engine sandbox yet. **Settings → System** says so.

More detail: [SECURITY.md](../SECURITY.md).

---

## The legal part

Spinarr is for backing up discs you own.

Getting around copy protection is restricted in some countries, for example by the DMCA in the US. That's why Spinarr ships no decryption libraries or keys, and doesn't tell you where to find keys. Whether you install them is your call. Check the law where you live.

The software stays neutral. The choice stays yours.
