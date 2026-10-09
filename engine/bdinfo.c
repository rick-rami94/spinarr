/*
 * bdinfo — dump a Blu-ray's playlists as JSON (same shape as dvdinfo, plus Blu-ray fields).
 * Usage: bdinfo <device | ISO | folder containing BDMV>
 *
 * Decryption is never attempted here beyond what libbluray does on open: libaacs and
 * libbdplus are only used if the user installed them. The output reports what was found.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include "argv_utf8.h"
#include <libbluray/bluray.h>
#include <libbluray/log_control.h>

#define MAX_TITLES 999

static void json_str(const char *s)
{
    putchar('"');
    for (; s && *s; s++) {
        unsigned char c = (unsigned char)*s;
        if (c == '"' || c == '\\') { putchar('\\'); putchar(c); }
        else if (c >= 0x20) putchar(c);
    }
    putchar('"');
}

/* Language codes come from the disc: emit only a-z, else "". */
static void json_lang(const uint8_t lang[4])
{
    char out[4] = "";
    for (int i = 0; i < 3; i++) {
        if (lang[i] < 'a' || lang[i] > 'z') { out[0] = 0; break; }
        out[i] = (char)lang[i];
    }
    out[3] = 0;
    json_str(out);
}

static const char *video_codec(uint8_t t)
{
    switch (t) {
    case BLURAY_STREAM_TYPE_VIDEO_MPEG1: return "MPEG-1";
    case BLURAY_STREAM_TYPE_VIDEO_MPEG2: return "MPEG-2";
    case BLURAY_STREAM_TYPE_VIDEO_H264:  return "H.264";
    case BLURAY_STREAM_TYPE_VIDEO_HEVC:  return "HEVC";
    case BLURAY_STREAM_TYPE_VIDEO_VC1:   return "VC-1";
    default: return "?";
    }
}

static const char *video_format(uint8_t f)
{
    switch (f) {
    case BLURAY_VIDEO_FORMAT_480I:  return "480i";
    case BLURAY_VIDEO_FORMAT_576I:  return "576i";
    case BLURAY_VIDEO_FORMAT_480P:  return "480p";
    case BLURAY_VIDEO_FORMAT_1080I: return "1080i";
    case BLURAY_VIDEO_FORMAT_720P:  return "720p";
    case BLURAY_VIDEO_FORMAT_1080P: return "1080p";
    case BLURAY_VIDEO_FORMAT_576P:  return "576p";
    case BLURAY_VIDEO_FORMAT_2160P: return "2160p";
    default: return "?";
    }
}

static const char *audio_codec(uint8_t t)
{
    switch (t) {
    case BLURAY_STREAM_TYPE_AUDIO_MPEG1:
    case BLURAY_STREAM_TYPE_AUDIO_MPEG2:        return "MPEG";
    case BLURAY_STREAM_TYPE_AUDIO_LPCM:         return "LPCM";
    case BLURAY_STREAM_TYPE_AUDIO_AC3:          return "AC3";
    case BLURAY_STREAM_TYPE_AUDIO_DTS:          return "DTS";
    case BLURAY_STREAM_TYPE_AUDIO_TRUHD:        return "TrueHD";
    case BLURAY_STREAM_TYPE_AUDIO_AC3PLUS:      return "E-AC3";
    case BLURAY_STREAM_TYPE_AUDIO_DTSHD:        return "DTS-HD";
    case BLURAY_STREAM_TYPE_AUDIO_DTSHD_MASTER: return "DTS-HD MA";
    default: return "?";
    }
}

static int audio_channels(uint8_t f)
{
    switch (f) {
    case BLURAY_AUDIO_FORMAT_MONO:   return 1;
    case BLURAY_AUDIO_FORMAT_STEREO: return 2;
    case BLURAY_AUDIO_FORMAT_MULTI_CHAN:
    case BLURAY_AUDIO_FORMAT_COMBO:  return 6;
    default: return 0;
    }
}

struct order { uint32_t idx, playlist; };

static int by_playlist(const void *a, const void *b)
{
    uint32_t x = ((const struct order *)a)->playlist, y = ((const struct order *)b)->playlist;
    return x < y ? -1 : x > y;
}

int main(int argc, char **argv)
{
    if (argc < 2) { fprintf(stderr, "usage: bdinfo <device|iso|dir>\n"); return 2; }

    bd_set_debug_mask(0); /* keep libbluray's logging off stdout/stderr noise */

    BLURAY *bd = bd_open(arg_utf8(argc, argv, 1), NULL);
    if (!bd) { printf("{\"error\":\"Could not open disc\"}\n"); return 1; }

    const BLURAY_DISC_INFO *di = bd_get_disc_info(bd);
    if (!di || !di->bluray_detected) {
        printf("{\"error\":\"Not a Blu-ray disc (no BDMV)\"}\n");
        bd_close(bd);
        return 1;
    }

    printf("{\"type\":\"bluray\",\"volume\":");
    json_str(di->udf_volume_id ? di->udf_volume_id : "");
    printf(",\"encryption\":{\"aacs\":%s,\"libaacs\":%s,\"aacsHandled\":%s,\"aacsError\":%d,"
           "\"bdplus\":%s,\"libbdplus\":%s,\"bdplusHandled\":%s}",
           di->aacs_detected ? "true" : "false", di->libaacs_detected ? "true" : "false",
           di->aacs_handled ? "true" : "false", di->aacs_error_code,
           di->bdplus_detected ? "true" : "false", di->libbdplus_detected ? "true" : "false",
           di->bdplus_handled ? "true" : "false");
    printf(",\"titles\":[");

    uint32_t n = bd_get_titles(bd, TITLES_ALL, 0);
    if (n > MAX_TITLES) n = MAX_TITLES;
    int emitted = 0;

    /* libbluray lists playlists in directory order: sorted on macOS, arbitrary on Linux
     * filesystems. Emit them by playlist number so title numbers match on every OS. */
    static struct order ord[MAX_TITLES];
    uint32_t m = 0;
    for (uint32_t i = 0; i < n; i++) {
        BLURAY_TITLE_INFO *ti = bd_get_title_info(bd, i, 0);
        if (!ti) continue;
        ord[m].idx = i; ord[m].playlist = ti->playlist; m++;
        bd_free_title_info(ti);
    }
    qsort(ord, m, sizeof ord[0], by_playlist);

    for (uint32_t i = 0; i < m; i++) {
        BLURAY_TITLE_INFO *ti = bd_get_title_info(bd, ord[i].idx, 0);
        if (!ti) continue;

        uint64_t bytes = 0;
        for (uint32_t c = 0; ti->clips && c < ti->clip_count; c++)
            bytes += (uint64_t)ti->clips[c].pkt_count * 192;

        printf("%s{\"title\":%u,\"playlist\":%u,\"angles\":%u,\"chapters\":[",
               emitted++ ? "," : "", i + 1, ti->playlist, ti->angle_count);
        for (uint32_t c = 0; ti->chapters && c < ti->chapter_count; c++)
            printf("%s%.3f", c ? "," : "", ti->chapters[c].duration / 90000.0);
        printf("],\"duration\":%.3f,\"bytes\":%llu", ti->duration / 90000.0, (unsigned long long)bytes);

        const BLURAY_CLIP_INFO *clip = (ti->clips && ti->clip_count) ? &ti->clips[0] : NULL;
        const BLURAY_STREAM_INFO *v = (clip && clip->video_streams && clip->video_stream_count) ? &clip->video_streams[0] : NULL;
        printf(",\"video\":{\"standard\":\"%s\",\"aspect\":\"%s\",\"codec\":\"%s\"}",
               v ? video_format(v->format) : "?",
               v && v->aspect == BLURAY_ASPECT_RATIO_4_3 ? "4:3" : "16:9",
               v ? video_codec(v->coding_type) : "?");

        printf(",\"audio\":[");
        for (int a = 0; clip && clip->audio_streams && a < clip->audio_stream_count; a++) {
            const BLURAY_STREAM_INFO *s = &clip->audio_streams[a];
            printf("%s{\"index\":%d,\"pid\":%u,\"codec\":\"%s\",\"channels\":%d,\"lang\":", a ? "," : "", a,
                   s->pid, audio_codec(s->coding_type), audio_channels(s->format));
            json_lang(s->lang);
            printf(",\"commentary\":false}");
        }
        printf("],\"subtitles\":[");
        for (int p = 0; clip && clip->pg_streams && p < clip->pg_stream_count; p++) {
            printf("%s{\"index\":%d,\"pid\":%u,\"lang\":", p ? "," : "", p, clip->pg_streams[p].pid);
            json_lang(clip->pg_streams[p].lang);
            printf("}");
        }
        printf("]}");
        bd_free_title_info(ti);
    }
    printf("]}\n");

    bd_close(bd);
    return 0;
}
