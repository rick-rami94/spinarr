#!/usr/bin/env python3
"""Mutation fuzzer for Spinarr's dvdinfo (ASan+UBSan build).
Mutates VIDEO_TS.IFO and/or VTS_01_0.IFO (mirrored into .BUP so libdvdread's
backup fallback doesn't mask the mutation), runs dvdinfo, records crashes,
hangs and invalid-JSON outputs."""
import json, os, random, re, shutil, struct, subprocess, sys, time, hashlib
from multiprocessing import Pool

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.environ.get('DVDINFO_BIN', os.path.join(HERE, 'dvdinfo_asan'))
SEED = os.environ.get('FUZZ_SEED', os.path.join(HERE, '..', 'fixtures', 'out', 'ntsc_basic', 'VIDEO_TS'))
OUT = os.environ.get('FUZZ_OUT', os.path.join(HERE, 'findings'))
VOB = os.path.realpath(os.path.join(SEED, 'VTS_01_1.VOB'))
ENV = dict(os.environ, ASAN_OPTIONS='detect_leaks=0:abort_on_error=0:symbolize=1:allocator_may_return_null=1',
           UBSAN_OPTIONS='print_stacktrace=1:halt_on_error=1')
TIMEOUT = 5

VMG = open(os.path.join(SEED, 'VIDEO_TS.IFO'), 'rb').read()
VTS = open(os.path.join(SEED, 'VTS_01_0.IFO'), 'rb').read()

def u16(d, o): return struct.unpack('>H', d[o:o+2])[0]
def u32(d, o): return struct.unpack('>I', d[o:o+4])[0]

# Interesting regions
VMG_TT = (u32(VMG, 0xC4) * 2048, u32(VMG, 0xC4) * 2048 + 2048)
VTS_PTT = (u32(VTS, 0xC8) * 2048, u32(VTS, 0xC8) * 2048 + 2048)
PGCIT = u32(VTS, 0xCC) * 2048
VTS_PGCIT = (PGCIT, PGCIT + 2048)
# PGC field offsets (absolute) for semantic mutations
PGC_FIELDS = []
for i in range(u16(VTS, PGCIT)):
    pgc = PGCIT + u32(VTS, PGCIT + 8 + i * 8 + 4)
    pm = pgc + u16(VTS, pgc + 0xE6)
    cp = pgc + u16(VTS, pgc + 0xE8)
    npg, ncl = VTS[pgc + 2], VTS[pgc + 3]
    PGC_FIELDS.append(dict(pgc=pgc, pm=pm, cp=cp, npg=npg, ncl=ncl))

INTEREST8 = [0, 1, 2, 0x7f, 0x80, 0xff, 0xfe, 0x63, 0x64]

def mutate_bytes(d, regions, n):
    d = bytearray(d)
    for _ in range(n):
        r = random.random()
        if r < 0.6 and regions:
            lo, hi = random.choice(regions)
            hi = min(hi, len(d))
        else:
            lo, hi = 0, len(d)
        o = random.randrange(lo, hi)
        k = random.random()
        if k < 0.35: d[o] ^= 1 << random.randrange(8)
        elif k < 0.5: d[o] = 0
        elif k < 0.65: d[o] = 0xff
        elif k < 0.85: d[o] = random.choice(INTEREST8)
        else: d[o] = random.randrange(256)
    return d

def semantic_vts(d):
    d = bytearray(d)
    f = random.choice(PGC_FIELDS)
    k = random.randrange(6)
    if k == 0:  # program_map entry -> 0 or beyond nr_of_cells
        j = random.randrange(max(f['npg'], 1))
        d[f['pm'] + j] = random.choice([0, f['ncl'] + 1, 0xff])
    elif k == 1:  # nr_of_programs
        d[f['pgc'] + 2] = random.choice([0, f['npg'] + 1, 0xff, f['ncl'] + 1])
    elif k == 2:  # nr_of_cells
        d[f['pgc'] + 3] = random.choice([0, 1, f['ncl'] + 1, 0xff])
    elif k == 3:  # offsets
        o = random.choice([0xE6, 0xE8, 0xEA, 0xE4])
        d[f['pgc'] + o:f['pgc'] + o + 2] = struct.pack('>H', random.choice([0, 0xEC, 0xffff, 0x7ff, random.randrange(65536)]))
    elif k == 4:  # cell playback block_type / sectors
        c = f['cp'] + 24 * random.randrange(max(f['ncl'], 1))
        d[c] = random.randrange(256)
        if random.random() < 0.5:
            d[c + 8:c + 12] = struct.pack('>I', random.choice([0xffffffff, 0, 0x7fffffff]))
    else:  # ptt_srpt pgcn/pgn
        o = random.randrange(*VTS_PTT)
        d[o] = random.choice([0, 0xff, 1, 2, 3])
    return d

def semantic_vmg(d):
    d = bytearray(d)
    lo = VMG_TT[0]
    k = random.randrange(4)
    if k == 0:  # nr_of_srpts
        d[lo:lo + 2] = struct.pack('>H', random.choice([0, 1, 3, 99, 100, 0xffff]))
    elif k == 1:  # title entry fields: title_set_nr (byte 6), vts_ttn (byte 7), nr_of_angles (1), nr_of_ptts (2..3)
        e = lo + 8 + 12 * random.randrange(2)
        fld = random.choice([1, 2, 3, 6, 7])
        d[e + fld] = random.choice([0, 1, 2, 0xff, 99, 100])
    elif k == 2:  # vmg_nr_of_title_sets @0x3E
        d[0x3E:0x40] = struct.pack('>H', random.choice([0, 2, 99, 100, 0xffff]))
    else:  # last_byte of tt_srpt
        d[lo + 4:lo + 8] = struct.pack('>I', random.choice([0, 7, 0xffff, 0xffffffff]))
    return d

def make_case(rng_seed):
    random.seed(rng_seed)
    vmg, vts = VMG, VTS
    which = random.random()
    nmut = random.choice([1, 1, 2, 3, 4, 8, 16, 32])
    if which < 0.35:
        vmg = semantic_vmg(vmg) if random.random() < 0.4 else mutate_bytes(vmg, [VMG_TT, (0, 0x400)], nmut)
    elif which < 0.85:
        vts = semantic_vts(vts) if random.random() < 0.4 else mutate_bytes(vts, [VTS_PTT, VTS_PGCIT, (0, 0x400)], nmut)
        if random.random() < 0.3: vts = semantic_vts(vts)
    else:
        vmg = mutate_bytes(vmg, [VMG_TT], nmut)
        vts = mutate_bytes(vts, [VTS_PTT, VTS_PGCIT], nmut)
    return bytes(vmg), bytes(vts)

FRAME = re.compile(r'#(\d+) 0x[0-9a-f]+ in (\S+) (\S+)')

def classify(stderr):
    frames = FRAME.findall(stderr)
    m = re.search(r'(ERROR: AddressSanitizer: [\w-]+|runtime error: [^\n]+|AddressSanitizer:DEADLYSIGNAL)', stderr)
    kind = m.group(1) if m else 'signal'
    ours = [f for f in frames if 'dvdinfo.c' in f[2]]
    top = frames[0] if frames else ('?', '?', '?')
    site = f'{top[1]} {os.path.basename(top[2])}'
    origin = 'dvdinfo.c' if frames and 'dvdinfo.c' in top[2] else ('libdvdread' if frames else 'unknown')
    if 'runtime error' in kind:
        um = re.search(r'(dvdinfo\.c:\d+:\d+): runtime error', stderr)
        if um: site, origin = um.group(1), 'dvdinfo.c'
    return kind, site, origin

def run_one(i):
    seed = (int(sys.argv[2]) if len(sys.argv) > 2 else 1) * 1000003 + i
    vmg, vts = make_case(seed)
    wd = os.path.join(os.environ.get('FUZZ_WORK', os.path.join(HERE, 'work')), f'w{os.getpid()}')
    vt = os.path.join(wd, 'VIDEO_TS')
    os.makedirs(vt, exist_ok=True)
    for n, d in (('VIDEO_TS', vmg), ('VTS_01_0', vts)):
        for ext in ('IFO', 'BUP'):
            with open(os.path.join(vt, f'{n}.{ext}'), 'wb') as fh: fh.write(d)
    vobl = os.path.join(vt, 'VTS_01_1.VOB')
    if not os.path.exists(vobl): os.symlink(VOB, vobl)
    t0 = time.time()
    try:
        p = subprocess.run([BIN, wd], capture_output=True, timeout=TIMEOUT, env=ENV)
    except subprocess.TimeoutExpired:
        return dict(i=i, seed=seed, status='hang', vmg=vmg, vts=vts)
    err = p.stderr.decode('utf8', 'replace')
    res = dict(i=i, seed=seed, rc=p.returncode, dt=time.time() - t0)
    crashed = p.returncode < 0 or 'AddressSanitizer' in err or 'runtime error' in err or p.returncode not in (0, 1)
    if crashed:
        kind, site, origin = classify(err)
        res.update(status='crash', kind=kind, site=site, origin=origin, stderr=err, vmg=vmg, vts=vts)
        return res
    try:
        json.loads(p.stdout)  # bytes -> must be valid UTF-8 JSON
        res['status'] = 'ok'
    except Exception as e:
        res.update(status='badjson', why=str(e), stdout=p.stdout[:4000].decode('utf8', 'replace'), vmg=vmg, vts=vts)
    return res

def save(r):
    key = r.get('site', r.get('why', 'hang'))
    h = hashlib.sha1(key.encode()).hexdigest()[:8]
    d = os.path.join(OUT, r['status'], f"{h}_{r['seed']}")
    os.makedirs(os.path.join(d, 'VIDEO_TS'), exist_ok=True)
    for n, data in (('VIDEO_TS', r['vmg']), ('VTS_01_0', r['vts'])):
        for ext in ('IFO', 'BUP'):
            open(os.path.join(d, 'VIDEO_TS', f'{n}.{ext}'), 'wb').write(data)
    os.symlink(VOB, os.path.join(d, 'VIDEO_TS', 'VTS_01_1.VOB'))
    meta = {k: v for k, v in r.items() if k not in ('vmg', 'vts')}
    open(os.path.join(d, 'info.json'), 'w').write(json.dumps(meta, indent=1))
    return d

if __name__ == '__main__':
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()
    stats = {'ok': 0, 'crash': 0, 'hang': 0, 'badjson': 0}
    sites, saved_per = {}, {}
    with Pool(6) as pool:
        for r in pool.imap_unordered(run_one, range(n), chunksize=4):
            stats[r['status']] += 1
            if r['status'] != 'ok':
                key = (r['status'], r.get('origin', ''), r.get('kind', ''), r.get('site', r.get('why', '')[:60]))
                sites[key] = sites.get(key, 0) + 1
                if saved_per.get(key, 0) < 3:
                    saved_per[key] = saved_per.get(key, 0) + 1
                    save(r)
    print(json.dumps(stats), f'{time.time() - t0:.0f}s')
    for k, v in sorted(sites.items(), key=lambda x: -x[1]):
        print(v, k)
