/*
 * fuzz_dvd_ifo — libFuzzer harness for libdvdread IFO parsing through dvdinfo's own code.
 *
 * The input is a memfs archive (see memfs.h) describing a VIDEO_TS folder. It is served
 * to libdvdread through DVDOpenFiles with in-memory callbacks, then the shipped scanner
 * body dvdinfo_print() (engine/dvdinfo.c, compiled with -DSPINARR_FUZZ) runs on it.
 * Every *.IFO is also served as its *.BUP so libdvdread's backup fallback cannot mask a
 * mutation (same as test/security/fuzz_dvdinfo.py).
 *
 * Built only for fuzzing; never shipped.
 */
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <dvdread/dvd_reader.h>
#include <dvdread/dvd_filesystem.h>
#include "memfs.h"

int dvdinfo_print(dvd_reader_t *dvd);

static const char *const PREFIXES[] = { "VIDEO_TS/", NULL };
static memfs table; /* one run at a time; entries borrow the current input */

static void quiet_log(void *priv, dvd_logger_level_t level, const char *fmt, va_list ap)
{
    (void)priv; (void)level; (void)fmt; (void)ap;
}

static memfs *fs_table(dvd_reader_filesystem_h *fs) { return (memfs *)fs->internal; }

static void fs_close(dvd_reader_filesystem_h *fs) { free(fs); }

static int fs_stat(dvd_reader_filesystem_h *fs, const char *path, dvdstat_t *st)
{
    char p[MEMFS_MAX_PATH * 2];
    if (!path || memfs_norm(path, p, sizeof p) < 0) return -1;
    memfs_entry *e = memfs_find(fs_table(fs), p);
    if (e) { st->size = e->len; st->st_mode = DVD_S_IFREG; return 0; }
    if (memfs_is_dir(fs_table(fs), p)) { st->size = 0; st->st_mode = DVD_S_IFDIR; return 0; }
    return -1;
}

static void *fs_dir_open(dvd_reader_filesystem_h *fs, const char *dirname)
{
    char p[MEMFS_MAX_PATH * 2];
    if (!dirname || memfs_norm(dirname, p, sizeof p) < 0) return NULL;
    return memfs_list(fs_table(fs), p);
}

/* 0 = entry filled, 1 = end of directory (libdvdread's contract). */
static int fs_dir_read(void *dir, dvd_dirent_t *entry)
{
    memfs_dir *d = dir;
    if (d->pos >= d->n) return 1;
    snprintf(entry->d_name, sizeof entry->d_name, "%s", d->name[d->pos++]);
    return 0;
}

static void fs_dir_close(void *dir) { free(dir); }

static void *fs_file_open(dvd_reader_filesystem_h *fs, const char *filename)
{
    char p[MEMFS_MAX_PATH * 2];
    if (!filename || memfs_norm(filename, p, sizeof p) < 0) return NULL;
    memfs_entry *e = memfs_find(fs_table(fs), p);
    return e ? memfs_open(e) : NULL;
}

static ssize_t fs_file_read(void *file, char *buf, size_t size)
{
    return (ssize_t)memfs_read(file, buf, size > INT64_MAX ? INT64_MAX : (int64_t)size);
}

static off64_t fs_file_seek(void *file, off64_t offset, int whence)
{
    return (off64_t)memfs_seek(file, (int64_t)offset, whence);
}

static int fs_file_close(void *file) { free(file); return 0; }

int LLVMFuzzerInitialize(int *argc, char ***argv)
{
    (void)argc; (void)argv;
    if (!freopen("/dev/null", "w", stdout)) return 0; /* scanner JSON is noise here */
    return 0;
}

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size)
{
    memfs_parse(&table, data, size, PREFIXES);

    /* Mirror every IFO into its BUP, overriding any BUP in the input. */
    int n = table.n;
    for (int i = 0; i < n; i++) {
        size_t k = strlen(table.e[i].path);
        if (k < 4 || strcmp(table.e[i].path + k - 4, ".IFO") != 0) continue;
        char bup[MEMFS_MAX_PATH + 1];
        memcpy(bup, table.e[i].path, k - 4);
        memcpy(bup + k - 4, ".BUP", 5);
        memfs_put(&table, bup, table.e[i].data, table.e[i].len);
    }

    dvd_reader_filesystem_h *fs = calloc(1, sizeof *fs);
    if (!fs) return 0;
    fs->internal = &table;
    fs->close = fs_close;
    fs->stat = fs_stat;
    fs->dir_open = fs_dir_open;
    fs->dir_read = fs_dir_read;
    fs->dir_close = fs_dir_close;
    fs->file_open = fs_file_open;
    fs->file_read = fs_file_read;
    fs->file_seek = fs_file_seek;
    fs->file_close = fs_file_close;

    dvd_logger_cb logcb = { quiet_log };
    dvd_reader_t *dvd = DVDOpenFiles(&table, &logcb, "/", fs);
    if (!dvd) { free(fs); return 0; } /* on failure the caller still owns fs */
    dvdinfo_print(dvd);
    DVDClose(dvd); /* closes fs through fs_close */
    fflush(stdout);
    return 0;
}
