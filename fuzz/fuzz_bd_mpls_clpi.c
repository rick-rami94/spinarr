/*
 * fuzz_bd_mpls_clpi — libFuzzer harness for libbluray index/MPLS/CLPI parsing through
 * bdinfo's own code.
 *
 * The input is a memfs archive (see memfs.h) describing a BDMV (and optional CERTIFICATE)
 * tree. It is served to libbluray through bd_open_files with in-memory callbacks, then the
 * shipped scanner body bdinfo_print() (engine/bdinfo.c, compiled with -DSPINARR_FUZZ)
 * runs on it. index.bdmv, MovieObject.bdmv and the PLAYLIST and CLIPINF files are mirrored into
 * BDMV/BACKUP/ when the input has no backup copy, so a mutation is not masked by an
 * untouched fallback.
 *
 * Built only for fuzzing; never shipped.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <libbluray/bluray.h>
#include <libbluray/filesystem.h>
#include <libbluray/log_control.h>
#include "memfs.h"

int bdinfo_print(BLURAY *bd);

static const char *const PREFIXES[] = { "BDMV/", "CERTIFICATE/", NULL };
static memfs table; /* one run at a time; entries borrow the current input */

static void file_close(BD_FILE_H *f) { free(f->internal); free(f); }

static int64_t file_seek(BD_FILE_H *f, int64_t offset, int32_t origin)
{
    return memfs_seek(f->internal, offset, origin);
}

static int64_t file_tell(BD_FILE_H *f) { return ((memfs_cursor *)f->internal)->pos; }

static int file_eof(BD_FILE_H *f)
{
    memfs_cursor *c = f->internal;
    return c->pos >= 0 && (uint64_t)c->pos >= c->len;
}

static int64_t file_read(BD_FILE_H *f, uint8_t *buf, int64_t size)
{
    return memfs_read(f->internal, buf, size);
}

static int64_t file_write(BD_FILE_H *f, const uint8_t *buf, int64_t size)
{
    (void)f; (void)buf; (void)size;
    return -1; /* read-only disc */
}

static BD_FILE_H *open_file(void *handle, const char *rel_path)
{
    char p[MEMFS_MAX_PATH * 2];
    if (!rel_path || memfs_norm(rel_path, p, sizeof p) < 0) return NULL;
    memfs_entry *e = memfs_find(handle, p);
    if (!e) return NULL;
    BD_FILE_H *f = calloc(1, sizeof *f);
    if (!f) return NULL;
    f->internal = memfs_open(e);
    if (!f->internal) { free(f); return NULL; }
    f->close = file_close;
    f->seek = file_seek;
    f->tell = file_tell;
    f->eof = file_eof;
    f->read = file_read;
    f->write = file_write;
    return f;
}

static void dir_close(BD_DIR_H *d) { free(d->internal); free(d); }

/* 0 = entry filled, 1 = end of directory (libbluray's contract). */
static int dir_read(BD_DIR_H *d, BD_DIRENT *entry)
{
    memfs_dir *m = d->internal;
    if (m->pos >= m->n) return 1;
    snprintf(entry->d_name, sizeof entry->d_name, "%s", m->name[m->pos++]);
    return 0;
}

static BD_DIR_H *open_dir(void *handle, const char *rel_path)
{
    char p[MEMFS_MAX_PATH * 2];
    if (!rel_path || memfs_norm(rel_path, p, sizeof p) < 0) return NULL;
    memfs_dir *m = memfs_list(handle, p);
    if (!m) return NULL;
    BD_DIR_H *d = calloc(1, sizeof *d);
    if (!d) { free(m); return NULL; }
    d->internal = m;
    d->close = dir_close;
    d->read = dir_read;
    return d;
}

/* Serve BDMV/<rest> as BDMV/BACKUP/<rest> when the input carries no backup of its own. */
static void mirror_backups(void)
{
    int n = table.n;
    for (int i = 0; i < n; i++) {
        const char *p = table.e[i].path;
        const char *rest = p + 5; /* past "BDMV/" */
        if (strncmp(p, "BDMV/", 5) != 0) continue;
        if (strcmp(rest, "index.bdmv") != 0 && strcmp(rest, "MovieObject.bdmv") != 0 &&
            strncmp(rest, "PLAYLIST/", 9) != 0 && strncmp(rest, "CLIPINF/", 8) != 0) continue;
        char bak[MEMFS_MAX_PATH * 2];
        snprintf(bak, sizeof bak, "BDMV/BACKUP/%s", rest);
        if (strlen(bak) > MEMFS_MAX_PATH || memfs_find(&table, bak)) continue;
        memfs_put(&table, bak, table.e[i].data, table.e[i].len);
    }
}

int LLVMFuzzerInitialize(int *argc, char ***argv)
{
    (void)argc; (void)argv;
    bd_set_debug_mask(0);
    if (!freopen("/dev/null", "w", stdout)) return 0; /* scanner JSON is noise here */
    return 0;
}

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
    memfs_parse(&table, data, size, PREFIXES);
    mirror_backups();

    BLURAY *bd = bd_init();
    if (!bd) return 0;
    if (bd_open_files(bd, &table, open_dir, open_file))
        bdinfo_print(bd);
    bd_close(bd);
    fflush(stdout);
    return 0;
}
