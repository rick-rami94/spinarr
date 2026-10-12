#!/usr/bin/env python3
"""Convert the committed malicious corpus into seeds for the libFuzzer harnesses.

Each case folder becomes one memfs archive (format in fuzz/memfs.h):
  test/fixtures/malicious/<case>     -> <out>/fuzz_dvd_ifo/<case>.bin       (VIDEO_TS/*.IFO only;
                                        the harness mirrors IFO -> BUP itself)
  test/fixtures/malicious-bd/<case>  -> <out>/fuzz_bd_mpls_clpi/<case>.bin  (every file under
                                        BDMV/ and CERTIFICATE/)

  make_seeds.py --out DIR            write seed folders
  make_seeds.py --out DIR --zip DIR  also write <name>_seed_corpus.zip (the names ClusterFuzzLite
                                     picks up from $OUT)

Output is deterministic: sorted traversal and fixed zip timestamps."""
import argparse, os, re, struct, sys, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, '..', 'test', 'fixtures')
MAX_FILES = 64
MAX_PATH = 64
PATH_RE = re.compile(r'^[A-Za-z0-9_./]+$')
ZIP_TIME = (1980, 1, 1, 0, 0, 0)

TARGETS = [
    # name, corpus dir, allowed prefixes, file filter
    ('fuzz_dvd_ifo', 'malicious', ('VIDEO_TS/',), lambda rel: rel.upper().endswith('.IFO')),
    ('fuzz_bd_mpls_clpi', 'malicious-bd', ('BDMV/', 'CERTIFICATE/'), lambda rel: True),
]


def path_ok(rel, prefixes):
    """Mirror of memfs_path_ok() in fuzz/memfs.h."""
    return (0 < len(rel) <= MAX_PATH and not rel.startswith('/') and '..' not in rel
            and PATH_RE.match(rel) is not None
            and any(rel.startswith(p) and len(rel) > len(p) for p in prefixes))


def case_files(case_dir):
    """Every regular file under case_dir as a sorted list of '/'-separated relative paths."""
    out = []
    for root, dirs, files in os.walk(case_dir):
        dirs.sort()
        for f in sorted(files):
            out.append(os.path.relpath(os.path.join(root, f), case_dir).replace(os.sep, '/'))
    return sorted(out)


def archive(case_dir, prefixes, keep):
    recs, n = [], 0
    for rel in case_files(case_dir):
        if rel == 'info.json' or not keep(rel):
            continue
        if not any(rel.startswith(p) for p in prefixes):
            continue  # outside the tree this harness serves (e.g. a BUP mirror)
        if not path_ok(rel, prefixes):
            print(f'warning: {case_dir}: skipping {rel!r} (breaks the harness path rules)', file=sys.stderr)
            continue
        if n >= MAX_FILES:
            print(f'warning: {case_dir}: skipping {rel!r} (more than {MAX_FILES} files)', file=sys.stderr)
            continue
        with open(os.path.join(case_dir, rel), 'rb') as fh:
            data = fh.read()
        p = rel.encode('ascii')
        recs.append(struct.pack('<B', len(p)) + p + struct.pack('<I', len(data)) + data)
        n += 1
    return b''.join(recs)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', required=True, help='seed folder root')
    ap.add_argument('--zip', help='also write <name>_seed_corpus.zip files here')
    args = ap.parse_args()

    for name, corpus, prefixes, keep in TARGETS:
        src = os.path.join(FIXTURES, corpus)
        dst = os.path.join(args.out, name)
        os.makedirs(dst, exist_ok=True)
        seeds = []
        for case in sorted(os.listdir(src)):
            case_dir = os.path.join(src, case)
            if case.startswith('.') or not os.path.isdir(case_dir):
                continue
            blob = archive(case_dir, prefixes, keep)
            with open(os.path.join(dst, case + '.bin'), 'wb') as fh:
                fh.write(blob)
            seeds.append((case + '.bin', blob))
        print(f'{name}: {len(seeds)} seeds -> {dst}')
        if args.zip:
            os.makedirs(args.zip, exist_ok=True)
            zpath = os.path.join(args.zip, name + '_seed_corpus.zip')
            with zipfile.ZipFile(zpath, 'w', zipfile.ZIP_DEFLATED) as z:
                for fname, blob in seeds:
                    info = zipfile.ZipInfo(fname, date_time=ZIP_TIME)
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o644 << 16
                    z.writestr(info, blob)
            print(f'{name}: {zpath}')


if __name__ == '__main__':
    main()
