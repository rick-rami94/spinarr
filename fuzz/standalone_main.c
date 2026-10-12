/*
 * standalone_main.c — a main() for running a libFuzzer harness without libFuzzer.
 * Apple clang ships no libFuzzer runtime, so local ASan/UBSan smoke runs link this
 * instead. Each file argument, and each regular file directly inside a directory
 * argument, is read into memory and passed to LLVMFuzzerTestOneInput once.
 *
 * Built only for fuzzing; never shipped.
 */
#include <dirent.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

int LLVMFuzzerTestOneInput(const uint8_t *data, size_t size);
/* Optional hook. Both Spinarr harnesses define it; a harness that does not needs
 * -Wl,-U,_LLVMFuzzerInitialize on macOS, where weak undefined symbols must be declared. */
int LLVMFuzzerInitialize(int *argc, char ***argv) __attribute__((weak));

static int run_file(const char *path)
{
    FILE *f = fopen(path, "rb");
    if (!f) { fprintf(stderr, "cannot open %s\n", path); return -1; }
    size_t cap = 1 << 16, len = 0;
    uint8_t *buf = malloc(cap);
    for (;;) {
        if (!buf) { fclose(f); fprintf(stderr, "out of memory\n"); return -1; }
        len += fread(buf + len, 1, cap - len, f);
        if (len < cap) break;
        uint8_t *bigger = realloc(buf, cap * 2);
        if (!bigger) free(buf);
        buf = bigger;
        cap *= 2;
    }
    int err = ferror(f);
    fclose(f);
    if (err) { free(buf); fprintf(stderr, "read error %s\n", path); return -1; }
    /* Exact-size copy so ASan catches any read past the input's end. */
    uint8_t *exact = malloc(len ? len : 1);
    if (!exact) { free(buf); return -1; }
    memcpy(exact, buf, len);
    free(buf);
    LLVMFuzzerTestOneInput(exact, len);
    free(exact);
    return 0;
}

static int cmp_str(const void *a, const void *b)
{
    return strcmp(*(char *const *)a, *(char *const *)b);
}

int main(int argc, char **argv)
{
    if (LLVMFuzzerInitialize) LLVMFuzzerInitialize(&argc, &argv);
    int ran = 0, failed = 0;
    for (int i = 1; i < argc; i++) {
        struct stat st;
        if (stat(argv[i], &st) != 0) { fprintf(stderr, "cannot stat %s\n", argv[i]); failed++; continue; }
        if (!S_ISDIR(st.st_mode)) { if (run_file(argv[i]) == 0) ran++; else failed++; continue; }

        DIR *d = opendir(argv[i]);
        if (!d) { fprintf(stderr, "cannot open dir %s\n", argv[i]); failed++; continue; }
        char **names = NULL;
        size_t n = 0, cap = 0;
        struct dirent *de;
        while ((de = readdir(d))) {
            if (de->d_name[0] == '.') continue;
            if (n == cap) {
                cap = cap ? cap * 2 : 64;
                char **more = realloc(names, cap * sizeof *names);
                if (!more) break;
                names = more;
            }
            names[n] = strdup(de->d_name);
            if (names[n]) n++;
        }
        closedir(d);
        qsort(names, n, sizeof *names, cmp_str); /* deterministic order */
        for (size_t j = 0; j < n; j++) {
            char path[4096];
            snprintf(path, sizeof path, "%s/%s", argv[i], names[j]);
            if (stat(path, &st) == 0 && S_ISREG(st.st_mode)) {
                if (run_file(path) == 0) ran++; else failed++;
            }
            free(names[j]);
        }
        free(names);
    }
    fprintf(stderr, "ran %d inputs\n", ran);
    return failed ? 1 : 0;
}
