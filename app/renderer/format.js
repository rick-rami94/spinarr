// Formatting helpers. Loaded as a plain <script> in the renderer and require()d by tests.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDur = (s) => {
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
const fmtBytes = (b) => {
  if (b == null) return '';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; }
  return `${b.toFixed(i >= 3 ? 2 : i ? 1 : 0)} ${u[i]}`;
};
const fmtEta = (s) => (s < 60 ? `${Math.ceil(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`);
const chans = (n) => ({ 1: 'Mono', 2: 'Stereo', 3: '2.1', 6: '5.1', 7: '6.1', 8: '7.1' }[n] || (n ? `${n}ch` : ''));

const ISO3 = { eng: 'en', spa: 'es', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', jpn: 'ja', chi: 'zh', zho: 'zh', kor: 'ko', por: 'pt', rus: 'ru', dut: 'nl', nld: 'nl', swe: 'sv', nor: 'no', dan: 'da', fin: 'fi', pol: 'pl', cze: 'cs', ces: 'cs', hun: 'hu', gre: 'el', ell: 'el', tur: 'tr', heb: 'he', ara: 'ar', hin: 'hi', tha: 'th', ice: 'is', isl: 'is' };
let langNames;
try { langNames = new Intl.DisplayNames(['en'], { type: 'language' }); } catch {}
const langName = (code) => {
  if (!code || code === 'und') return 'Unknown';
  const c = ISO3[code] || code;
  try { return langNames?.of(c) || code; } catch { return code; }
};
const langShort = (code) => esc(code ? (ISO3[code] || code).slice(0, 2).toUpperCase() : '??');


const CODECS = { pcm_bluray: 'LPCM → FLAC', pcm_dvd: 'LPCM', truehd: 'TrueHD', dts: 'DTS', eac3: 'E-AC3', ac3: 'AC3', mp2: 'MPEG',
  dvd_subtitle: 'VobSub', hdmv_pgs_subtitle: 'PGS' };
const codecLabel = (c) => CODECS[c] || String(c || '').toUpperCase();

if (typeof module !== 'undefined') module.exports = { esc, fmtDur, fmtBytes, fmtEta, chans, langName, langShort, codecLabel };
