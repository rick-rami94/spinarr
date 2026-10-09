/* On Windows, argv is in the ANSI code page, so a path like "Amélie – 日本語" arrives
 * mangled. Re-read the wide command line and convert the argument to UTF-8, which is
 * what libdvdread and libbluray expect on Windows. Elsewhere argv is already UTF-8. */
#ifndef SPINARR_ARGV_UTF8_H
#define SPINARR_ARGV_UTF8_H
#ifdef _WIN32
#include <windows.h>
#include <shellapi.h>
#include <stdlib.h>
static const char *arg_utf8(int argc, char **argv, int i)
{
    int n = 0;
    LPWSTR *w = CommandLineToArgvW(GetCommandLineW(), &n);
    if (!w || i >= n) return i < argc ? argv[i] : NULL;
    int len = WideCharToMultiByte(CP_UTF8, 0, w[i], -1, NULL, 0, NULL, NULL);
    char *s = len > 0 ? malloc((size_t)len) : NULL;
    if (s) WideCharToMultiByte(CP_UTF8, 0, w[i], -1, s, len, NULL, NULL);
    LocalFree(w);
    return s ? s : argv[i];
}
#else
#define arg_utf8(argc, argv, i) ((argv)[i])
#endif
#endif
