/*
 * dvdinfo — dump a DVD-Video title table as JSON (one pass, IFO only).
 * Usage: dvdinfo <device | ISO | VIDEO_TS folder>
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <dvdread/dvd_reader.h>
#include <dvdread/ifo_types.h>
#include <dvdread/ifo_read.h>

/* Decode one BCD byte; -1 if either nibble isn't a decimal digit. */
static int bcd(uint8_t v)
{
    int hi = (v >> 4) & 0xf, lo = v & 0xf;
    return (hi > 9 || lo > 9) ? -1 : hi * 10 + lo;
}

/* Cell playback time in seconds, or 0 for an impossible (corrupt) timestamp. */
static double dvdtime(const dvd_time_t *t)
{
    double fps = ((t->frame_u & 0xc0) >> 6) == 1 ? 25.0 : 29.97;
    int h = bcd(t->hour), m = bcd(t->minute), s = bcd(t->second), f = bcd(t->frame_u & 0x3f);
    if (h < 0 || m < 0 || s < 0 || f < 0 || m > 59 || s > 59 || f >= 30) return 0;
    return h * 3600 + m * 60 + s + f / fps;
}

static void lang(uint16_t code, char out[3])
{
    out[0] = code >> 8; out[1] = code & 0xff; out[2] = 0;
    if (out[0] < 'a' || out[0] > 'z' || out[1] < 'a' || out[1] > 'z') out[0] = 0;
}

static const char *audio_codec(int fmt)
{
    switch (fmt) {
    case 0: return "AC3";
    case 2: case 3: return "MPEG";
    case 4: return "LPCM";
    case 6: return "DTS";
    default: return "?";
    }
}

static void json_str(const char *s)
{
    putchar('"');
    for (; *s; s++) {
        if (*s == '"' || *s == '\\') putchar('\\');
        if ((unsigned char)*s >= 0x20) putchar(*s);
    }
    putchar('"');
}

/* Sum cell durations/sectors for one program (chapter) of a PGC, skipping
 * non-first angle cells so multi-angle blocks are counted once. */
static void program_span(const pgc_t *pgc, int pgn, double *secs, uint64_t *sectors)
{
    if (!pgc || !pgc->program_map || !pgc->cell_playback || pgn < 1 || pgn > pgc->nr_of_programs) return;
    int first = pgc->program_map[pgn - 1];
    int last = pgn < pgc->nr_of_programs ? pgc->program_map[pgn] - 1 : pgc->nr_of_cells;
    if (first < 1 || first > pgc->nr_of_cells) return;
    if (last > pgc->nr_of_cells) last = pgc->nr_of_cells;
    for (int c = first; c <= last && c <= pgc->nr_of_cells; c++) {
        const cell_playback_t *cell = &pgc->cell_playback[c - 1];
        if (cell->block_type == 1 && cell->block_mode != 1) continue;
        *secs += dvdtime(&cell->playback_time);
        if (cell->last_sector >= cell->first_sector)
            *sectors += (uint64_t)(cell->last_sector - cell->first_sector + 1);
    }
}

int main(int argc, char **argv)
{
    if (argc < 2) { fprintf(stderr, "usage: dvdinfo <device|iso|dir>\n"); return 2; }

    dvd_reader_t *dvd = DVDOpen(argv[1]);
    if (!dvd) { printf("{\"error\":\"Could not open disc\"}\n"); return 1; }

    ifo_handle_t *vmg = ifoOpen(dvd, 0);
    if (!vmg || !vmg->tt_srpt || !vmg->tt_srpt->title || !vmg->vmgi_mat) {
        printf("{\"error\":\"Not a DVD-Video disc (no VIDEO_TS.IFO)\"}\n");
        DVDClose(dvd);
        return 1;
    }

    char volid[33] = "";
    unsigned char setid[128];
    if (DVDUDFVolumeInfo(dvd, volid, sizeof volid, setid, sizeof setid) < 0)
        DVDISOVolumeInfo(dvd, volid, sizeof volid, setid, sizeof setid);
    volid[sizeof volid - 1] = 0;

    int nvts = vmg->vmgi_mat->vmg_nr_of_title_sets;
    ifo_handle_t **vts = calloc(nvts + 1, sizeof *vts);
    if (!vts) { printf("{\"error\":\"Out of memory\"}\n"); return 1; }

    printf("{\"volume\":"); json_str(volid);
    printf(",\"titles\":[");

    tt_srpt_t *tt = vmg->tt_srpt;
    int emitted = 0;
    for (int t = 0; t < tt->nr_of_srpts; t++) {
        title_info_t *ti = &tt->title[t];
        int set = ti->title_set_nr;
        if (set < 1 || set > nvts) continue;
        if (!vts[set]) vts[set] = ifoOpen(dvd, set);
        ifo_handle_t *v = vts[set];
        if (!v || !v->vtsi_mat || !v->vts_ptt_srpt || !v->vts_ptt_srpt->title || !v->vts_pgcit ||
            !v->vts_pgcit->pgci_srp || ti->vts_ttn < 1 || ti->vts_ttn > v->vts_ptt_srpt->nr_of_srpts) continue;

        ttu_t *ttu = &v->vts_ptt_srpt->title[ti->vts_ttn - 1];
        pgcit_t *pgcit = v->vts_pgcit;

        if (!ttu->ptt && ttu->nr_of_ptts) continue;
        if (t + 1 > 99) break; /* ffmpeg's dvdvideo demuxer only addresses titles 1-99 */
        printf("%s{\"title\":%d,\"vts\":%d,\"angles\":%d,\"chapters\":[",
               emitted++ ? "," : "", t + 1, set, ti->nr_of_angles);

        double total = 0; uint64_t total_sectors = 0; int nch = 0;
        int first_pgcn = 0;
        for (int p = 0; p < ttu->nr_of_ptts; p++) {
            int pgcn = ttu->ptt[p].pgcn, pgn = ttu->ptt[p].pgn;
            if (pgcn < 1 || pgcn > pgcit->nr_of_pgci_srp) continue;
            if (!first_pgcn) first_pgcn = pgcn;
            double secs = 0; uint64_t sec = 0;
            program_span(pgcit->pgci_srp[pgcn - 1].pgc, pgn, &secs, &sec);
            printf("%s%.3f", nch++ ? "," : "", secs);
            total += secs; total_sectors += sec;
        }
        printf("],\"duration\":%.3f,\"bytes\":%llu", total,
               (unsigned long long)total_sectors * 2048ULL);

        vtsi_mat_t *m = v->vtsi_mat;
        video_attr_t *va = &m->vts_video_attr;
        printf(",\"video\":{\"standard\":\"%s\",\"aspect\":\"%s\",\"mpeg\":%d}",
               va->video_format ? "PAL" : "NTSC",
               va->display_aspect_ratio == 3 ? "16:9" : "4:3",
               va->mpeg_version + 1);

        pgc_t *pgc = first_pgcn ? pgcit->pgci_srp[first_pgcn - 1].pgc : NULL;
        char lc[3];

        printf(",\"audio\":[");
        int n = 0;
        for (int a = 0; pgc && a < 8 && a < m->nr_of_vts_audio_streams; a++) {
            if (!(pgc->audio_control[a] & 0x8000)) continue;
            audio_attr_t *aa = &m->vts_audio_attr[a];
            lang(aa->lang_code, lc);
            printf("%s{\"index\":%d,\"codec\":\"%s\",\"channels\":%d,\"lang\":\"%s\",\"commentary\":%s}",
                   n++ ? "," : "", a, audio_codec(aa->audio_format), aa->channels + 1, lc,
                   (aa->code_extension == 3 || aa->code_extension == 4) ? "true" : "false");
        }
        printf("],\"subtitles\":[");
        n = 0;
        for (int s = 0; pgc && s < 32 && s < m->nr_of_vts_subp_streams; s++) {
            if (!(pgc->subp_control[s] & 0x80000000)) continue;
            lang(m->vts_subp_attr[s].lang_code, lc);
            printf("%s{\"index\":%d,\"lang\":\"%s\"}", n++ ? "," : "", s, lc);
        }
        printf("]}");
    }
    printf("]}\n");

    for (int i = 1; i <= nvts; i++) if (vts[i]) ifoClose(vts[i]);
    free(vts);
    ifoClose(vmg);
    DVDClose(dvd);
    return 0;
}
