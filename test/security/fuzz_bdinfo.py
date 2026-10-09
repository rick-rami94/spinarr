#!/usr/bin/env python3
"""Mutation fuzzer for Spinarr's bdinfo (ASan+UBSan build of bdinfo + libbluray).

Mutates the Blu-ray structure files libbluray parses (index.bdmv, MovieObject.bdmv,
PLAYLIST/*.mpls, CLIPINF/*.clpi), mirrored into BDMV/BACKUP so the backup fallback
can't mask a mutation. Stream files are symlinked, not copied. Records crashes, hangs
and invalid-JSON outputs.

Usage: BDINFO_BIN=/path/to/asan/bdinfo python3 fuzz_bdinfo.py <iterations> <seed>
Env:   FUZZ_SEED (BDMV disc folder), FUZZ_OUT (findings), FUZZ_WORK (scratch)
"""
import json, os, random, shutil, struct, subprocess, sys, time
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.environ.get('BDINFO_BIN', os.path.join(HERE, 'bdinfo_asan'))
SEED = os.environ.get('FUZZ_SEED', os.path.join(HERE, '..', 'fixtures', 'out', 'bd_movie'))
OUT = os.environ.get('FUZZ_OUT', os.path.join(HERE, 'findings-bd'))
WORK = os.environ.get('FUZZ_WORK', os.path.join(HERE, 'work-bd'))
ENV = dict(os.environ, ASAN_OPTIONS='detect_leaks=0:abort_on_error=0:symbolize=1:allocator_may_return_null=1',
           UBSAN_OPTIONS='print_stacktrace=1:halt_on_error=1')
TIMEOUT = 8

TARGETS = ['index.bdmv', 'MovieObject.bdmv'] + \
    ['PLAYLIST/' + f for f in sorted(os.listdir(os.path.join(SEED, 'BDMV', 'PLAYLIST')))] + \
    ['CLIPINF/' + f for f in sorted(os.listdir(os.path.join(SEED, 'BDMV', 'CLIPINF')))]
ORIG = {t: open(os.path.join(SEED, 'BDMV', t), 'rb').read() for t in TARGETS}
INTEREST16 = [0, 1, 0x7f, 0x80, 0xff, 0x100, 0x7fff, 0x8000, 0xffff]
INTEREST32 = [0, 1, 0x7fffffff, 0x80000000, 0xffffffff, 0x10000, 0xfffffff0]


def mutate(data, rng):
    d = bytearray(data)
    for _ in range(rng.choice([1, 1, 2, 3, 5, 8])):
        if not d:
            break
        op = rng.random()
        i = rng.randrange(len(d))
        if op < 0.25:
            d[i] ^= 1 << rng.randrange(8)
        elif op < 0.45:
            d[i] = rng.choice([0, 0xff, 0x7f, 0x80, rng.randrange(256)])
        elif op < 0.65 and i + 2 <= len(d):
            d[i:i + 2] = struct.pack('>H', rng.choice(INTEREST16))
        elif op < 0.85 and i + 4 <= len(d):
            d[i:i + 4] = struct.pack('>I', rng.choice(INTEREST32))
        elif op < 0.93:
            del d[rng.randrange(len(d)):]          # truncate
        else:
            d += bytes(rng.randrange(256) for _ in range(rng.randrange(1, 64)))
    return bytes(d)


def setup_workdir(wd):
    if os.path.exists(wd):
        shutil.rmtree(wd)
    bd = os.path.join(wd, 'BDMV')
    for sub in ['PLAYLIST', 'CLIPINF', 'STREAM', 'BACKUP/PLAYLIST', 'BACKUP/CLIPINF']:
        os.makedirs(os.path.join(bd, sub))
    for f in os.listdir(os.path.join(SEED, 'BDMV', 'STREAM')):
        os.symlink(os.path.realpath(os.path.join(SEED, 'BDMV', 'STREAM', f)), os.path.join(bd, 'STREAM', f))
    return wd


def run_one(i):
    seed = int(sys.argv[2]) * 1000003 + i
    rng = random.Random(seed)
    wd = os.path.join(WORK, f'w{os.getpid()}')
    if not os.path.exists(wd):
        setup_workdir(wd)
    chosen = rng.sample(TARGETS, rng.choice([1, 1, 1, 2]))
    for t in TARGETS:
        data = mutate(ORIG[t], rng) if t in chosen else ORIG[t]
        for p in (os.path.join(wd, 'BDMV', t), os.path.join(wd, 'BDMV', 'BACKUP', t)):
            with open(p, 'wb') as f:
                f.write(data)
    t0 = time.time()
    try:
        p = subprocess.run([BIN, wd], capture_output=True, timeout=TIMEOUT, env=ENV)
    except subprocess.TimeoutExpired:
        return save(i, seed, chosen, wd, 'hang', '', '')
    err = p.stderr.decode('utf8', 'replace')
    if p.returncode < 0 or 'ERROR: AddressSanitizer' in err or 'runtime error' in err:
        site = next((l for l in err.splitlines() if l.startswith('SUMMARY')), '') or \
            next((l for l in err.splitlines() if 'runtime error' in l), f'signal {p.returncode}')
        return save(i, seed, chosen, wd, 'crash', site, err)
    try:
        json.loads(p.stdout)
    except Exception:
        return save(i, seed, chosen, wd, 'badjson', p.stdout[:200].decode('utf8', 'replace'), err)
    return ('ok', None)


def save(i, seed, chosen, wd, kind, site, err):
    d = os.path.join(OUT, kind, f'{seed}')
    os.makedirs(d, exist_ok=True)
    shutil.copytree(os.path.join(wd, 'BDMV'), os.path.join(d, 'BDMV'), symlinks=True,
                    ignore=shutil.ignore_patterns('STREAM'))
    with open(os.path.join(d, 'info.json'), 'w') as f:
        json.dump({'seed': seed, 'files': chosen, 'kind': kind, 'site': site, 'stderr': err[-4000:]}, f, indent=1)
    return (kind, site)


if __name__ == '__main__':
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    os.makedirs(WORK, exist_ok=True)
    t0 = time.time()
    stats, sites = {'ok': 0, 'crash': 0, 'hang': 0, 'badjson': 0}, {}
    with Pool(os.cpu_count()) as pool:
        for kind, site in pool.imap_unordered(run_one, range(n), chunksize=8):
            stats[kind] += 1
            if site:
                sites[(kind, site)] = sites.get((kind, site), 0) + 1
    print(json.dumps(stats), f'{time.time() - t0:.0f}s')
    for (kind, site), c in sorted(sites.items(), key=lambda x: -x[1]):
        print(c, kind, site)
