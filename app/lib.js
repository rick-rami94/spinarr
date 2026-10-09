// Pure logic shared by the main process and the test suite. No Electron imports.
const fs = require('fs');
const path = require('path');

const MAX_TITLE = 999; // DVD titles stop at 99; Blu-ray lists can be longer

function prettyName(label) {
  if (typeof label !== 'string' || !label.trim()) return 'Untitled Disc';
  return label
    .replace(/[_.]+/g, ' ')
    .replace(/\b(DISC|DISK|D)\s*(\d)\b/i, 'Disc $2')
    .replace(/\s+(WS|FS|NTSC|PAL|DVD|R\d)\b/gi, '')
    .trim()
    .toLowerCase()
    .replace(/(^|\s)(\p{L})/gu, (_m, sp, c) => sp + c.toUpperCase())
    .replace(/\b(Se|Dc|Uk|Us|Tv|Hd|3d|Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii)\b/g, (w) => w.toUpperCase()) || 'Untitled Disc';
}

// Turn user/disc-supplied text into a single safe path component.
function safeFile(s) {
  const clean = String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s-]+/, '') // no hidden files, no "..", no leading dash
    .trim()
    .slice(0, 180)
    .replace(/[.\s]+$/, ''); // Windows drops trailing dots and spaces
  if (!clean) return 'Untitled';
  // Names Windows reserves for devices, with or without an extension.
  return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(clean) ? `${clean}_` : clean;
}

function uniquePath(p, exists = fs.existsSync) {
  if (!exists(p) && !exists(p + '.part')) return p;
  const { dir, name, ext } = path.parse(p);
  for (let i = 2; i < 10000; i++) {
    const c = path.join(dir, `${name} (${i})${ext}`);
    if (!exists(c) && !exists(c + '.part')) return c;
  }
  throw new Error('Too many files with the same name');
}

// Annotate dvdinfo output: duplicate detection and main-feature pick.
function analyzeTitles(json, source) {
  if (!json || !Array.isArray(json.titles)) throw new Error('Unreadable disc information');
  const label = typeof json.volume === 'string' && json.volume.trim()
    ? json.volume.trim()
    : path.basename(source).replace(/\.(iso|img)$/i, '');
  const titles = json.titles.map((t) => ({
    ...t,
    sig: `${Math.round(t.duration)}:${t.chapters.length}:${t.bytes}`,
  }));
  const seen = new Map();
  for (const t of titles) {
    if (t.duration <= 0) continue;
    if (seen.has(t.sig)) t.duplicateOf = seen.get(t.sig);
    else seen.set(t.sig, t.title);
  }
  // No real DVD title runs 12 hours; a longer one comes from corrupt cell times.
  const main = titles.filter((t) => !t.duplicateOf && t.duration > 0 && t.duration < 12 * 3600)
    .sort((a, b) => b.duration - a.duration)[0];
  if (main) main.main = true;
  return { source, label, name: prettyName(label), titles };
}

function ripArgs(job, outFile) {
  const maps = Array.isArray(job.streams) && job.streams.length
    ? job.streams.flatMap((i) => ['-map', `0:${i}`])
    : ['-map', '0:v:0', '-map', '0:a?', '-map', '0:s?'];
  return [
    '-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-y',
    '-f', 'dvdvideo', '-title', String(job.title),
    ...(job.accurateChapters ? ['-preindex', '1'] : []),
    '-i', job.source,
    ...maps,
    '-c', 'copy',
    '-metadata', `title=${job.displayName}`,
    '-progress', 'pipe:1', '-nostats',
    '-f', 'matroska', outFile,
  ];
}

// Incremental parser for `ffmpeg -progress` key=value output. Progress is the further of
// two signals: output timestamps (N/A whenever any mapped stream is empty, e.g. an audio
// track the IFO declares but the title never uses) and video frames written.
function progressParser(duration, onUpdate, fps = 29.97) {
  let buf = '';
  // timed: ffmpeg reported real output timestamps (frame counts are only an estimate,
  // since film DVDs flagged 29.97 fps really hold 23.976 fps of frames).
  const st = { progress: 0, speed: null, bytes: 0, timed: false };
  const bump = (p) => { if (duration > 0 && p > st.progress) st.progress = Math.min(0.999, p); };
  return (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const i = line.indexOf('=');
      if (i < 0) continue;
      const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
      if (k === 'out_time_us' && +v > 0) { st.timed = true; bump(+v / 1e6 / duration); }
      else if (k === 'frame' && +v > 0 && fps > 0) bump(+v / fps / duration);
      else if (k === 'speed' && parseFloat(v) > 0) st.speed = parseFloat(v);
      else if (k === 'total_size' && +v >= 0) st.bytes = +v;
    }
    onUpdate(st);
    return st;
  };
}

// Decide whether a finished ffmpeg run produced a complete rip, with a human error if not.
// ffmpeg can exit 0 after a read error, so the exit code alone is not trusted, and progress
// counters aren't either (out_time stalls at the last subtitle; frame counts depend on the
// real frame rate). Completeness is judged from the finished file's own video duration.
function ripVerdict({ code, signal = null, stderr = '', videoSeconds = null, duration = 0 }) {
  if (signal) return { ok: false, error: 'The disc data is damaged or not supported, so the engine stopped safely.' };
  const read = /Error reading from DVD|Unable to read next block|Input\/output error/i.test(stderr);
  if (/css|dvdcss|decrypt|aacs/i.test(stderr) && code !== 0) {
    return { ok: false, error: 'Could not decrypt this disc. Install the decryption library for it (Settings → System shows how).' };
  }
  if (read) return { ok: false, error: 'Could not read part of the disc. It may be scratched or dirty: clean it and try again.' };
  if (code !== 0) return { ok: false, error: stderr.trim().split('\n').slice(-2).join(' ') || `ffmpeg exited with code ${code}` };
  if (!Number.isFinite(videoSeconds)) return { ok: false, error: 'Could not verify the ripped file.' };
  if (duration > 0 && videoSeconds < 0.9 * duration) {
    return { ok: false, error: `Rip stopped early (${Math.round((videoSeconds / duration) * 100)}% of the title was copied).` };
  }
  return { ok: true };
}

// Seconds of video in a finished MKV, from \`ffprobe -show_entries stream=codec_type:stream_tags=DURATION\`.
// The matroska muxer records each track's exact duration as "HH:MM:SS.fffffffff".
function outputVideoSeconds(probe) {
  const v = (probe?.streams || []).find((s) => s.codec_type === 'video');
  const m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(v?.tags?.DURATION || '');
  return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null;
}

// ---------- engine sandbox ----------
// Engine processes parse untrusted disc data with C libraries, so each one runs under
// a macOS sandbox profile: no network, no fork/exec, no reading user data other than
// the source, and writes only to the output folder and libdvdcss's key cache.
// Paths are passed as -D parameters (never spliced into the profile text).
const SANDBOX_PROFILE = `(version 1)
(allow default)
(deny network*)
(deny process-fork)
(deny process-exec*)
(allow process-exec (literal (param "BIN")))
(deny file-read-data (subpath "/Users") (subpath "/Volumes") (subpath "/private/var/folders"))
(allow file-read-data (subpath (param "ENGINE")) (subpath (param "SOURCE")) (subpath (param "OUT")) (subpath (param "CSSCACHE"))
  (subpath (param "AACS_CONF")) (subpath (param "BDPLUS_CONF")) (subpath (param "AACS_CACHE")) (subpath (param "BDPLUS_CACHE")))
(deny file-write* (subpath "/"))
(allow file-write* (subpath (param "OUT")) (subpath (param "CSSCACHE")) (subpath (param "AACS_CACHE")) (subpath (param "BDPLUS_CACHE"))
  (literal "/dev/null") (literal "/dev/dtracehelper"))
`;

// Returns [command, args] that run `binPath args` inside the sandbox. All paths must
// already be canonical (fs.realpathSync), or the kernel's path checks won't match.
// keyDirs: the user's own libaacs/libbdplus config (read: KEYDB.cfg) and cache (write) folders.
function sandboxed(binPath, args, { engineDir, source, outDir, cssCache, keyDirs = {} }) {
  const k = { aacsConf: cssCache, bdplusConf: cssCache, aacsCache: cssCache, bdplusCache: cssCache, ...keyDirs };
  for (const p of [binPath, engineDir, source, outDir, cssCache, k.aacsConf, k.bdplusConf, k.aacsCache, k.bdplusCache]) {
    if (typeof p !== 'string' || !path.isAbsolute(p) || /[\0\n]/.test(p)) throw new Error('Invalid sandbox path');
  }
  return ['/usr/bin/sandbox-exec', [
    '-D', `BIN=${binPath}`, '-D', `ENGINE=${engineDir}`, '-D', `SOURCE=${source}`,
    '-D', `OUT=${outDir}`, '-D', `CSSCACHE=${cssCache}`,
    '-D', `AACS_CONF=${k.aacsConf}`, '-D', `BDPLUS_CONF=${k.bdplusConf}`,
    '-D', `AACS_CACHE=${k.aacsCache}`, '-D', `BDPLUS_CACHE=${k.bdplusCache}`,
    '-p', SANDBOX_PROFILE, binPath, ...args,
  ]];
}

// Classify a mounted volume from `diskutil info -plist` output.
function volumeKind(plist) {
  if (typeof plist !== 'string') return 'other';
  if (/<key>OpticalMediaType<\/key>|<key>OpticalDeviceType<\/key>/.test(plist)) return 'optical';
  if (/<key>BusProtocol<\/key>\s*<string>Disk Image<\/string>/.test(plist)) return 'image';
  return 'other';
}

// ---------- input validation (everything from the renderer is untrusted) ----------
const isInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;

function validateSource(p, { stat = fs.statSync } = {}) {
  if (typeof p !== 'string' || !path.isAbsolute(p) || p.length > 4096 || /[\0\n\r]/.test(p)) throw new Error('Invalid source');
  let norm = path.normalize(p);
  const root = path.parse(norm).root;
  if (norm.length > root.length) norm = norm.replace(/[\\/]+$/, ''); // keep "/" and "D:\\" as they are
  if (['VIDEO_TS', 'BDMV'].includes(path.basename(norm).toUpperCase())) norm = path.dirname(norm);
  let st;
  try { st = stat(norm); } catch { throw new Error('Source not found'); }
  if (st.isDirectory()) {
    if (!sourceKind(norm, { stat })) throw new Error('Folder has no VIDEO_TS or BDMV');
  } else if (!st.isFile() || !/\.(iso|img)$/i.test(norm)) {
    throw new Error('Not a disc image or folder');
  }
  return norm;
}

// 'dvd' or 'bluray' for a disc folder; null for anything else (images are probed by content).
function sourceKind(dir, { stat = fs.statSync } = {}) {
  const isDir = (p) => { try { return stat(p).isDirectory(); } catch { return false; } };
  if (isDir(path.join(dir, 'BDMV'))) return 'bluray';
  if (isDir(path.join(dir, 'VIDEO_TS'))) return 'dvd';
  return null;
}

// Why an encrypted Blu-ray can't be ripped (from bdinfo's encryption report), or null if it
// can. aacsError is libbluray's BD_AACS_* code, so the message says what's actually wrong.
function blurayBlocker(enc, keydbPath, installCommand = 'brew install libaacs') {
  if (!enc) return null;
  if (enc.aacs && !enc.aacsHandled) {
    if (!enc.libaacs) return `This Blu-ray is encrypted (AACS). Install libaacs (${installCommand}), then add your own KEYDB.cfg key file in Settings → System.`;
    switch (enc.aacsError) {
      case -1: return 'This Blu-ray is encrypted (AACS), and its AACS files couldn\'t be read. The disc may be damaged or dirty.';
      case -2: return `This Blu-ray is encrypted (AACS). libaacs is installed but found no KEYDB.cfg key file. It looks for one at ${keydbPath}. Choose yours in Settings → System.`;
      case -4: return 'This Blu-ray is encrypted (AACS) and your KEYDB.cfg has no host certificate, which libaacs needs for this disc.';
      case -5: return 'This Blu-ray is encrypted (AACS) and it revokes the host certificates in your KEYDB.cfg.';
      case -6: return 'This Blu-ray is encrypted (AACS) and the drive refused the AACS handshake.';
      default: return `This Blu-ray is encrypted (AACS) and your KEYDB.cfg (${keydbPath}) has no key that opens it.`;
    }
  }
  if (enc.bdplus && !enc.bdplusHandled) return 'This Blu-ray uses BD+ protection, which Spinarr can\'t remove.';
  return null;
}

// ffmetadata chapter list from per-chapter durations (seconds).
function chaptersMetadata(durations) {
  let t = 0;
  const out = [';FFMETADATA1'];
  durations.forEach((d, i) => {
    const start = Math.round(t * 1000);
    t += Math.max(0, +d || 0);
    out.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${start}`, `END=${Math.max(start, Math.round(t * 1000))}`, `title=Chapter ${i + 1}`);
  });
  return out.join('\n') + '\n';
}

// Blu-ray rip: copy everything except Blu-ray LPCM, which MKV can't hold and is converted
// to FLAC (lossless). Languages and chapters come from the playlist (bdinfo), since the
// transport stream doesn't carry them. streams: [{ index, codec, lang }] in output order.
function blurayRipArgs(job, streams, chaptersFile, outFile) {
  const args = [
    '-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-y',
    '-playlist', String(job.playlist), '-i', `bluray:${job.source}`,
    '-f', 'ffmetadata', '-i', chaptersFile,
  ];
  streams.forEach((s) => args.push('-map', `0:${s.index}`));
  args.push('-map_chapters', '1', '-map_metadata', '-1', '-c', 'copy');
  streams.forEach((s, k) => {
    if (s.codec === 'pcm_bluray') args.push(`-c:${k}`, 'flac');
    if (/^[a-z]{3}$/.test(s.lang || '')) args.push(`-metadata:s:${k}`, `language=${s.lang}`);
  });
  args.push('-metadata', `title=${job.displayName}`, '-progress', 'pipe:1', '-nostats', '-f', 'matroska', outFile);
  return args;
}

function validateTitle(n) {
  if (!isInt(n, 1, MAX_TITLE)) throw new Error('Invalid title number');
  return n;
}

function validateJob(j, opts) {
  if (!j || typeof j !== 'object') throw new Error('Invalid job');
  const streams = j.streams == null ? null : j.streams;
  if (streams !== null && (!Array.isArray(streams) || streams.length > 256 || !streams.every((i) => isInt(i, 0, 255)))) {
    throw new Error('Invalid stream selection');
  }
  return {
    source: validateSource(j.source, opts),
    title: validateTitle(j.title),
    streams: streams && [...new Set(streams)].sort((a, b) => a - b),
    duration: Number.isFinite(j.duration) && j.duration > 0 ? j.duration : 1,
    fileName: safeFile(j.fileName),
    displayName: String(j.displayName ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200),
    accurateChapters: j.accurateChapters === true,
    fps: j.fps === 25 ? 25 : 29.97,
  };
}

const SETTINGS_SCHEMA = {
  minMinutes: (v) => (Number.isFinite(v) ? Math.min(60, Math.max(0, Math.round(v))) : undefined),
  accurateChapters: (v) => (typeof v === 'boolean' ? v : undefined),
  skin: (v) => (['studio', 'pinstripe'].includes(v) ? v : undefined),
};

// outputDir is deliberately absent: it can only change through the native folder picker.
function sanitizeSettingsPatch(patch) {
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  for (const [k, fn] of Object.entries(SETTINGS_SCHEMA)) {
    if (k in patch) {
      const v = fn(patch[k]);
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

module.exports = {
  prettyName, safeFile, uniquePath, blurayBlocker, analyzeTitles, ripArgs, progressParser, ripVerdict,
  sourceKind, chaptersMetadata, blurayRipArgs, outputVideoSeconds,
  SANDBOX_PROFILE, sandboxed, volumeKind,
  validateSource, validateTitle, validateJob, sanitizeSettingsPatch,
};
