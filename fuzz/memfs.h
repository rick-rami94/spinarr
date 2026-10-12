/* memfs.h — a read-only, in-memory file table decoded from one fuzz input.
 * Built only for the fuzz harnesses; never shipped. Header-only, like engine/argv_utf8.h.
 *
 * Archive format (repeated records, little-endian):
 *   u8  path_len   1..64
 *   u8  path[path_len]   relative, e.g. "VIDEO_TS/VTS_01_0.IFO" or "BDMV/PLAYLIST/00800.mpls"
 *   u32 data_len
 *   u8  data[data_len]
 * Parsing stops at the first truncated or structurally invalid record (path_len 0 or
 * > 64). A record whose path breaks the path rules is skipped. Later duplicate paths
 * replace earlier ones. At most 64 files.
 *
 * Path rules: every byte in [A-Za-z0-9_./], no "..", no leading "/", and the path starts
 * with one of the harness's allowed prefixes. Entries point into the fuzz input (no
 * copies), and nothing here ever touches the real filesystem.
 */
#ifndef SPINARR_FUZZ_MEMFS_H
#define SPINARR_FUZZ_MEMFS_H

#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#define MEMFS_MAX_FILES 64
#define MEMFS_MAX_PATH 64

typedef struct {
    char path[MEMFS_MAX_PATH + 1];
    const uint8_t *data; /* borrowed from the fuzz input; valid for one run */
    size_t len;
} memfs_entry;

typedef struct {
    memfs_entry e[MEMFS_MAX_FILES];
    int n;
} memfs;

/* Byte-wise allow-list check plus prefix match; the only gate on untrusted paths. */
static int memfs_path_ok(const char *p, size_t n, const char *const *prefixes)
{
    if (n < 1 || n > MEMFS_MAX_PATH || p[0] == '/') return 0;
    for (size_t i = 0; i < n; i++) {
        char c = p[i];
        int ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
                 c == '_' || c == '.' || c == '/';
        if (!ok) return 0;
        if (c == '.' && i + 1 < n && p[i + 1] == '.') return 0;
    }
    for (; prefixes && *prefixes; prefixes++) {
        size_t k = strlen(*prefixes);
        if (n > k && memcmp(p, *prefixes, k) == 0) return 1;
    }
    return 0;
}

/* Exact-path lookup; NULL when absent. */
static memfs_entry *memfs_find(memfs *fs, const char *path)
{
    for (int i = 0; i < fs->n; i++)
        if (strcmp(fs->e[i].path, path) == 0) return &fs->e[i];
    return NULL;
}

/* Insert or replace; silently drops new paths once the table is full. path must be valid. */
static void memfs_put(memfs *fs, const char *path, const uint8_t *data, size_t len)
{
    memfs_entry *e = memfs_find(fs, path);
    if (!e) {
        if (fs->n >= MEMFS_MAX_FILES || strlen(path) > MEMFS_MAX_PATH) return;
        e = &fs->e[fs->n++];
        strcpy(e->path, path);
    }
    e->data = data;
    e->len = len;
}

/* Decode the archive into fs; returns the number of files in the table. */
static int memfs_parse(memfs *fs, const uint8_t *data, size_t size, const char *const *allowed_prefixes)
{
    size_t off = 0;
    fs->n = 0;
    while (off < size) {
        size_t plen = data[off];
        if (plen < 1 || plen > MEMFS_MAX_PATH) break;
        if (size - off - 1 < plen + 4) break; /* truncated path or length */
        const char *p = (const char *)data + off + 1;
        const uint8_t *l = data + off + 1 + plen;
        size_t dlen = (size_t)l[0] | (size_t)l[1] << 8 | (size_t)l[2] << 16 | (size_t)l[3] << 24;
        off += 1 + plen + 4;
        if (dlen > size - off) break; /* truncated data */
        if (memfs_path_ok(p, plen, allowed_prefixes)) {
            char path[MEMFS_MAX_PATH + 1];
            memcpy(path, p, plen);
            path[plen] = 0;
            memfs_put(fs, path, data + off, dlen);
        }
        off += dlen;
    }
    return fs->n;
}

/* Normalize a library-supplied path ("/", "//VIDEO_TS/", "BDMV\\PLAYLIST") to the table's
 * form: no leading, trailing or doubled separators, "." components dropped. Returns -1 on
 * ".." or overflow so such lookups simply fail. Root is "". */
static int memfs_norm(const char *in, char *out, size_t cap)
{
    size_t o = 0;
    while (*in) {
        while (*in == '/' || *in == '\\') in++;
        if (!*in) break;
        const char *s = in;
        while (*in && *in != '/' && *in != '\\') in++;
        size_t k = (size_t)(in - s);
        if (k == 1 && s[0] == '.') continue;
        if (k == 2 && s[0] == '.' && s[1] == '.') return -1;
        if (o + (o ? 1 : 0) + k + 1 > cap) return -1;
        if (o) out[o++] = '/';
        memcpy(out + o, s, k);
        o += k;
    }
    out[o] = 0;
    return 0;
}

/* A directory exists when it is the root or some file lives under it. */
static int memfs_is_dir(memfs *fs, const char *dir)
{
    size_t k = strlen(dir);
    if (k == 0) return 1;
    for (int i = 0; i < fs->n; i++)
        if (strncmp(fs->e[i].path, dir, k) == 0 && fs->e[i].path[k] == '/') return 1;
    return 0;
}

/* Directory snapshot: the unique direct children of one directory. */
typedef struct {
    char name[MEMFS_MAX_FILES][MEMFS_MAX_PATH + 1];
    int n, pos;
} memfs_dir;

/* Heap-allocated listing of dir (normalized); NULL when dir does not exist. */
static memfs_dir *memfs_list(memfs *fs, const char *dir)
{
    if (!memfs_is_dir(fs, dir)) return NULL;
    memfs_dir *d = calloc(1, sizeof *d);
    if (!d) return NULL;
    size_t k = strlen(dir);
    for (int i = 0; i < fs->n; i++) {
        const char *p = fs->e[i].path;
        if (k) {
            if (strncmp(p, dir, k) != 0 || p[k] != '/') continue;
            p += k + 1;
        }
        size_t c = strcspn(p, "/");
        if (c == 0) continue;
        int dup = 0;
        for (int j = 0; j < d->n && !dup; j++)
            dup = strlen(d->name[j]) == c && memcmp(d->name[j], p, c) == 0;
        if (dup || d->n >= MEMFS_MAX_FILES) continue;
        memcpy(d->name[d->n], p, c);
        d->name[d->n][c] = 0;
        d->n++;
    }
    return d;
}

/* Read cursor over one entry; reads never go past len. */
typedef struct {
    const uint8_t *data;
    size_t len;
    int64_t pos;
} memfs_cursor;

static memfs_cursor *memfs_open(memfs_entry *e)
{
    memfs_cursor *c = calloc(1, sizeof *c);
    if (!c) return NULL;
    c->data = e->data;
    c->len = e->len;
    return c;
}

static int64_t memfs_read(memfs_cursor *c, void *buf, int64_t size)
{
    if (size <= 0 || c->pos < 0 || (uint64_t)c->pos >= c->len) return 0;
    uint64_t left = c->len - (uint64_t)c->pos;
    uint64_t n = (uint64_t)size < left ? (uint64_t)size : left;
    memcpy(buf, c->data + c->pos, (size_t)n);
    c->pos += (int64_t)n;
    return (int64_t)n;
}

/* SEEK_SET/CUR/END (0/1/2); a past-the-end position is allowed and reads 0 bytes,
 * like a real file. Negative or overflowing results return -1 and leave pos alone. */
static int64_t memfs_seek(memfs_cursor *c, int64_t off, int whence)
{
    int64_t base = whence == 0 ? 0 : whence == 1 ? c->pos : whence == 2 ? (int64_t)c->len : -1;
    if (base < 0) return -1;
    if (off > 0 && base > INT64_MAX - off) return -1;
    if (base + off < 0) return -1;
    c->pos = base + off;
    return c->pos;
}

#endif /* SPINARR_FUZZ_MEMFS_H */
