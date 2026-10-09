/* global spinarr */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17l9-10"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  eject: '<svg viewBox="0 0 24 24"><path d="M5 15h14L12 6Z"/><path d="M5 19h14"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  file: '<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  reveal: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg>',
  rip: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg>',
  okCircle: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.7 2.5L16 9.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>',
  slash: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m6 18 12-12"/></svg>',
  layers: '<svg viewBox="0 0 24 24"><path d="m12 3 9 5-9 5-9-5Z"/><path d="m3 13 9 5 9-5"/></svg>',
  wave: '<svg viewBox="0 0 24 24"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z"/><path d="m9 12 2 2 4-4"/></svg>',
};

const state = {
  settings: null,
  drives: { discs: [], hasDrive: false },
  source: null,
  scanning: false,
  error: null,
  disc: null,
  discName: '',
  selected: new Set(),
  open: new Set(),
  probes: new Map(), // title -> { loading, data, error }
  tracks: new Map(), // title -> Set(stream index)
  fileNames: new Map(), // title -> user-edited name
  showShort: false,
  showDups: false,
  queue: [],
  freeSpace: null,
  system: null, // { platform, sandbox, dvdcss: { installed, command?, url?, canPick? }, bwrapHelp }
  fresh: false, // animate the title list in once, right after a scan
};

const OS = spinarr.platform;
const IS_MAC = OS === 'darwin';
// Shortcut labels in each platform's own notation: ⌘O on macOS, Ctrl+O elsewhere.
const keys = (k) => (IS_MAC ? k : k.replace('⇧⌘', 'Ctrl+Shift+').replace('⌘', 'Ctrl+').replace('↩', 'Enter'));
const REVEAL = IS_MAC ? 'Show in Finder' : OS === 'win32' ? 'Show in Explorer' : 'Show in folder';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const cleanErr = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const tilde = (p) => p.replace(/^\/(Users|home)\/[^/]+/, '~');
const baseName = (p) => p.split(/[\\/]/).filter(Boolean).pop() || p;

// ---------- derived ----------
function visibleTitles() {
  if (!state.disc) return [];
  const min = (state.settings.minMinutes || 0) * 60;
  return state.disc.titles.filter((t) =>
    (state.showShort || t.duration >= min || t.main) && (state.showDups || !t.duplicateOf || state.selected.has(t.title)));
}
const hiddenCount = () => (state.disc ? state.disc.titles.length - visibleTitles().length : 0);

function defaultFileName(t) {
  const name = state.discName || 'Untitled Disc';
  const sel = [...state.selected];
  return t.main && (sel.length <= 1 || sel.every((n) => n === t.title)) ? name : `${name} - Title ${t.title}`;
}
const fileName = (t) => state.fileNames.get(t.title) ?? defaultFileName(t);

function selectedBytes() {
  return state.disc ? state.disc.titles.filter((t) => state.selected.has(t.title)).reduce((a, t) => a + t.bytes, 0) : 0;
}

// Latest queue entry for a title of the disc on screen (cancelled ones don't count).
function jobFor(title) {
  for (let i = state.queue.length - 1; i >= 0; i--) {
    const j = state.queue[i];
    if (j.source === state.source && j.title === title && j.state !== 'cancelled') return j;
  }
  return null;
}
const isBluray = (d) => d?.media === 'bluray' || d?.type === 'bluray';

// ---------- sources ----------
function renderSources() {
  const el = $('#sources');
  const { discs, hasDrive } = state.drives;
  const discIco = (bd, active) => `<div class="disc mini ${bd ? 'bd' : ''} ${active && state.scanning ? 'spin' : ''}"></div>`;
  let html = discs.map((d) => {
    const active = state.source === d.path;
    return `
    <div class="source ${active ? 'active' : ''}" data-src="${esc(d.path)}" role="listitem" tabindex="0">
      ${discIco(isBluray(d) || (active && isBluray(state.disc)), active)}
      <div class="meta"><div class="name">${esc(d.name)}</div><div class="sub">${d.kind === 'optical' ? (d.media === 'bluray' ? 'Blu-ray' : 'DVD') : d.kind === 'image' ? 'Disk image' : 'Volume'}${d.kind !== 'optical' && !active ? ' · click to scan' : ''}</div></div>
      <button class="icon-btn" data-eject="${esc(d.path)}" title="Eject" aria-label="Eject ${esc(d.name)}">${ICON.eject}</button>
    </div>`;
  }).join('');
  if (state.source && !discs.some((d) => d.path === state.source)) {
    html += `
      <div class="source active" data-src="${esc(state.source)}" role="listitem" tabindex="0">
        ${discIco(isBluray(state.disc), true)}
        <div class="meta"><div class="name">${esc(baseName(state.source))}</div><div class="sub">${state.disc ? (isBluray(state.disc) ? 'Blu-ray' : 'DVD') + ' · ' : ''}Image / folder</div></div>
      </div>`;
  }
  if (!discs.length) html += `<div class="no-drive"><span class="slot"></span>${hasDrive ? 'Drive empty' : 'No disc drive found'}</div>`;
  el.innerHTML = html;
}

// ---------- main ----------
function renderMain() {
  const main = $('#main');
  const keepFocus = focusKey();
  const prevScroll = $('.scroll', main)?.scrollTop || 0;

  if (state.scanning) {
    const name = state.source ? baseName(state.source) : 'disc';
    main.innerHTML = `
      <div class="empty" aria-busy="true">
        <div class="disc xl spin"></div>
        <h1>Reading disc…</h1>
        <p>Finding titles, chapters and tracks on <b>${esc(name)}</b>.</p>
        <div class="indeterminate" role="progressbar" aria-label="Scanning"></div>
      </div>`;
    return;
  }
  if (!state.disc) {
    main.innerHTML = `
      <div class="empty">
        <div class="disc xl"></div>
        <h1>Insert a DVD or Blu-ray</h1>
        <p>Spinarr copies titles to MKV losslessly — every audio track, subtitle and chapter, bit for bit.</p>
        ${state.error ? `<div class="error-box" role="alert">${ICON.alert}<div><b>Couldn't read this source</b><span>${esc(state.error)}</span></div></div>` : ''}
        <div class="cta">
          ${IS_MAC ? `<button class="primary-btn" data-action="open">${ICON.folder} Open image or folder <kbd>${keys('⌘O')}</kbd></button>`
            : `<div class="cta-row"><button class="primary-btn" data-action="open">${ICON.rip} Open disc image <kbd>${keys('⌘O')}</kbd></button>
               <button class="ghost-btn tall" data-action="open-folder">${ICON.folder} Open folder</button></div>`}
          <small>or drop an ISO, VIDEO_TS or BDMV folder anywhere</small>
        </div>
        <ul class="features">
          <li>${ICON.layers}<b>Bit for bit</b><span>A straight remux to MKV. Nothing is re-encoded.</span></li>
          <li>${ICON.wave}<b>Every track</b><span>All audio, subtitles and chapters, with languages kept.</span></li>
          ${state.system?.sandbox === 'none'
            ? `<li>${ICON.shield}<b>Hardened</b><span>Discs are parsed by patched, fuzz-tested libraries.</span></li>`
            : `<li>${ICON.shield}<b>Sandboxed</b><span>Discs are parsed by a hardened, locked-down engine.</span></li>`}
        </ul>
      </div>`;
    return;
  }

  const d = state.disc;
  const first = d.titles.find((t) => t.main) || d.titles[0];
  const mainT = d.titles.find((t) => t.main);
  const longest = Math.max(...d.titles.map((t) => t.duration), 1);
  const titles = visibleTitles();
  const hidden = hiddenCount();
  const bd = d.type === 'bluray';
  const pip = `<span class="pip">${ICON.check}</span>`;

  main.innerHTML = `
    <div class="scroll">
      <header class="disc-head">
        <div class="disc ${bd ? 'bd' : ''}"></div>
        <div class="disc-title">
          <input id="discName" value="${esc(state.discName)}" spellcheck="false" title="Used for file names and the MKV title" aria-label="Disc name" />
          <div class="disc-meta">
            <span class="badge fmt ${bd ? 'bd' : ''}">${bd ? 'Blu-ray' : 'DVD'}</span>
            ${first ? `<span class="spec">${[first.video.standard, first.video.codec, first.video.aspect].filter((x) => x && x !== '?').map(esc).join(' · ')}</span>` : ''}
            <span class="vol" title="Volume label">${esc(d.label || '—')}</span>
          </div>
        </div>
        <div class="hero-stats">
          <div><span class="k">Titles</span><span class="v">${d.titles.length}</span></div>
          ${mainT ? `<div><span class="k">Main feature</span><span class="v">${fmtDur(mainT.duration)}</span></div>` : ''}
        </div>
      </header>
      <div class="toolbar">
        <h2>Titles</h2>
        <span class="shown">${titles.length} shown${hidden ? ` · ${hidden} hidden` : ''}</span>
        <span class="spacer"></span>
        <label class="pill"><input type="checkbox" data-toggle="showShort" ${state.showShort ? 'checked' : ''}/>${pip}Short titles</label>
        <label class="pill"><input type="checkbox" data-toggle="showDups" ${state.showDups ? 'checked' : ''}/>${pip}Duplicates</label>
      </div>
      ${d.blocked ? `<div class="error-box banner" role="alert">${ICON.alert}<div><b>This disc can't be ripped</b><span>${esc(d.blocked)}</span></div></div>` : ''}
      <div class="titles ${state.fresh ? 'fresh' : ''}" role="list">${titles.map((t, i) => titleRow(t, longest, i)).join('')}</div>
    </div>
    ${actionBar()}`;
  state.fresh = false;

  const scroll = $('.scroll', main);
  const bar = $('.toolbar', main);
  scroll.scrollTop = prevScroll;
  const stick = () => bar.classList.toggle('stuck', scroll.scrollTop > bar.offsetTop - 1);
  scroll.addEventListener('scroll', stick, { passive: true });
  stick();
  updateRipStates();
  restoreFocus(keepFocus);
}

function titleRow(t, longest, i) {
  const sel = state.selected.has(t.title);
  const open = state.open.has(t.title);
  let acc = 0;
  const ticks = t.chapters.slice(0, -1).map((c) => {
    acc += c;
    return `<span class="tick" style="left:${(acc / longest) * 100}%"></span>`;
  }).join('');
  const audio = t.audio.map((a) => `<span class="chip"><b>${langShort(a.lang)}</b> ${esc(a.codec)} ${esc(chans(a.channels))}${a.commentary ? ' · Comm.' : ''}</span>`).join('');
  const subs = t.subtitles.map((s) => `<span class="chip sub">${langShort(s.lang)}</span>`).join('');

  return `
    <div class="title-row ${sel ? 'selected' : ''} ${open ? 'open' : ''} ${t.duplicateOf ? 'dim' : ''}" data-title="${t.title}" role="listitem" style="--i:${i}">
      <div class="title-main" data-expand="${t.title}" tabindex="0" role="button" aria-expanded="${open}" aria-label="Title ${t.title}, ${fmtDur(t.duration)}">
        <button class="cbox" data-select="${t.title}" role="checkbox" aria-checked="${sel}" aria-label="Rip title ${t.title}" tabindex="-1">${ICON.check}</button>
        <div class="t-info">
          <div class="t-name">Title ${t.title}
            ${t.main ? '<span class="badge feat">Main feature</span>' : ''}
            ${t.duplicateOf ? `<span class="badge dup">Same as ${t.duplicateOf}</span>` : ''}
            <span class="rip-state"></span>
          </div>
          <div class="t-sub">${plural(t.chapters.length, 'chapter')}${t.angles > 1 ? ` · ${t.angles} angles` : ''} · ${t.audio.length} audio · ${plural(t.subtitles.length, 'subtitle')}</div>
          <div class="timeline"><div class="fill" style="width:${(t.duration / longest) * 100}%"><div class="prog"></div></div>${ticks}</div>
          ${audio || subs ? `<div class="chips">${audio}${audio && subs ? '<span class="chip-gap"></span>' : ''}${subs}</div>` : ''}
        </div>
        <div class="t-dur"><div class="time">${fmtDur(t.duration)}</div><div class="size">${fmtBytes(t.bytes)}</div></div>
        <div class="chev">${ICON.chev}</div>
      </div>
      <div class="t-detail">${open ? detail(t) : ''}</div>
    </div>`;
}

function detail(t) {
  const p = state.probes.get(t.title);
  let tracks;
  if (!p || p.loading) tracks = `<div class="loading-line"><span class="mini-spin"></span> Reading tracks…</div><div class="skeleton" style="width:60%"></div><div class="skeleton" style="width:42%"></div>`;
  else if (p.error) tracks = `<div class="error-box" role="alert">${ICON.alert}<div><b>Couldn't read the tracks</b><span>${esc(p.error)}</span></div></div>`;
  else {
    const chosen = state.tracks.get(t.title);
    const row = (s, label, meta) => `
      <label class="track"><input type="checkbox" class="check" data-track="${t.title}:${s.index}" ${chosen.has(s.index) ? 'checked' : ''}/>
      <span class="tk-lang">${label}</span><span class="tk-meta">${meta}</span></label>`;
    const audio = p.data.streams.filter((s) => s.type === 'audio')
      .map((s) => row(s, esc(langName(s.lang)), esc([`${codecLabel(s.codec)} ${chans(s.channels)}`, s.commentary && 'Commentary', s.impaired && 'Described'].filter(Boolean).join(' · ')))).join('') || '<div class="tk-none">None</div>';
    const subs = p.data.streams.filter((s) => s.type === 'subtitle')
      .map((s) => row(s, esc(langName(s.lang)), esc([codecLabel(s.codec), s.viewport, s.forced && 'Forced'].filter(Boolean).join(' · ')))).join('') || '<div class="tk-none">None</div>';
    tracks = `<div class="detail-grid"><div><div class="detail-label">Audio</div>${audio}</div><div><div class="detail-label">Subtitles</div>${subs}</div></div>`;
  }
  return `${tracks}
    <div class="file-field">
      <div class="detail-label">Save as</div>
      <div class="ff">${ICON.file}<input data-filename="${t.title}" value="${esc(fileName(t))}" spellcheck="false" aria-label="File name for title ${t.title}"/><span class="ext">.mkv</span></div>
    </div>`;
}

function actionBar() {
  const n = state.selected.size;
  const bytes = selectedBytes();
  const free = state.freeSpace;
  const low = free != null && bytes > free;
  const blocked = !!state.disc?.blocked;
  const dir = tilde(state.settings.outputDir);
  const folder = dir.split('/').filter(Boolean).pop() || dir;
  const pct = free ? Math.min(100, (bytes / free) * 100) : 0;
  return `
    <div class="actionbar">
      <button class="dest" data-action="output" title="Change output folder">
        <span class="dest-ico">${ICON.folder}</span>
        <span class="dest-text"><span class="d-path">${esc(folder)}</span><span class="d-full">&lrm;${esc(dir)}&lrm;</span></span>
      </button>
      <div class="capacity ${low ? 'warn' : ''}">
        ${low ? `<div class="d-warn">${ICON.alert} There's not enough space here</div>`
          : free != null ? `<div class="cap-bar" title="Share of free space this rip needs"><div style="width:${pct}%"></div></div>` : ''}
        <div class="d-sub">${n ? `${fmtBytes(bytes)} needed` : 'Nothing selected'}${free != null ? ` · ${fmtBytes(free)} free` : ''}</div>
      </div>
      <button class="primary-btn" data-action="rip" ${n && !low && !blocked ? '' : 'disabled'}>${ICON.rip} Rip ${n ? plural(n, 'title') : ''} <kbd>${keys('⌘↩')}</kbd></button>
    </div>`;
}

// Live rip status inside each title card, updated in place so focus and typing survive.
function updateRipStates() {
  for (const row of $$('.title-row')) {
    const j = jobFor(+row.dataset.title);
    const st = j?.state;
    row.classList.toggle('ripping', st === 'ripping');
    row.classList.toggle('ripped', st === 'done');
    const badge = !j ? ''
      : st === 'ripping' ? `<span class="badge live">${Math.floor(j.progress * 100)}%</span>`
      : st === 'queued' ? '<span class="badge waiting">Waiting</span>'
      : st === 'done' ? '<span class="badge ripped">Ripped</span>'
      : st === 'failed' ? '<span class="badge failed">Failed</span>' : '';
    const slot = $('.rip-state', row);
    if (slot && slot.innerHTML !== badge) slot.innerHTML = badge;
    const prog = $('.prog', row);
    if (prog) prog.style.width = st === 'ripping' ? `${j.progress * 100}%` : '0';
  }
}

// ---------- queue ----------
const ring = (p) => {
  const c = 2 * Math.PI * 7.5;
  return `<svg class="ring" viewBox="0 0 20 20"><circle class="rt" cx="10" cy="10" r="7.5" stroke-width="2.5"/><circle class="val" cx="10" cy="10" r="7.5" stroke-width="2.5" stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - p)).toFixed(2)}"/></svg>`;
};
const JOB_ICON = {
  queued: `<span class="job-ico" style="color:var(--text-3)">${ICON.clock}</span>`,
  done: `<span class="job-ico" style="color:var(--ok)">${ICON.okCircle}</span>`,
  failed: `<span class="job-ico" style="color:var(--bad)">${ICON.alert}</span>`,
  cancelled: `<span class="job-ico" style="color:var(--text-3)">${ICON.slash}</span>`,
};

const seenJobs = new Set(); // only newly added jobs animate in; the list re-renders every 250 ms
function renderQueue() {
  const list = $('#queueList');
  const active = state.queue.filter((j) => ['queued', 'ripping'].includes(j.state)).length;
  $('#queueCount').textContent = active ? `· ${active} active` : '';
  $('#clearBtn').hidden = !state.queue.some((j) => !['queued', 'ripping'].includes(j.state));
  if (!state.queue.length) { list.innerHTML = `<div class="q-empty">Titles you rip will appear here, with progress and a link to the finished file.</div>`; return; }
  list.innerHTML = state.queue.map((j) => {
    let status = '', right = '';
    if (j.state === 'queued') status = 'Waiting';
    if (j.state === 'ripping') {
      const pct = Math.floor(j.progress * 100);
      const elapsed = (Date.now() - j.startedAt) / 1000;
      status = `${pct}%${j.speed ? ` · ${j.speed.toFixed(1)}×` : ''}`;
      right = j.progress > 0.01 ? `${fmtEta((elapsed * (1 - j.progress)) / j.progress)} left` : 'Starting…';
    }
    if (j.state === 'done') { status = 'Done'; right = fmtBytes(j.bytes); }
    if (j.state === 'cancelled') status = 'Cancelled';
    if (j.state === 'failed') status = 'Failed';
    const btn = ['queued', 'ripping'].includes(j.state)
      ? `<button class="icon-btn" data-cancel="${esc(j.id)}" title="Cancel" aria-label="Cancel ${esc(j.fileName)}">${ICON.x}</button>`
      : j.state === 'done' ? `<button class="icon-btn" data-reveal="${esc(j.id)}" title="${REVEAL}" aria-label="${REVEAL}: ${esc(j.fileName)}">${ICON.reveal}</button>` : '';
    const ico = j.state === 'ripping' ? `<span class="job-ico">${ring(j.progress)}</span>` : JOB_ICON[j.state] || '';
    return `
      <div class="job ${j.state}${seenJobs.has(j.id) ? '' : ' enter'}">
        <div class="job-top">${ico}<div class="job-name" title="${esc(j.fileName)}">${esc(j.fileName)}</div>${btn}</div>
        <div class="bar"><div style="width:${j.progress * 100}%"></div></div>
        <div class="job-state"><span>${status}</span><span>${right}</span></div>
        ${j.error ? `<div class="job-err">${esc(j.error)}</div>` : ''}
      </div>`;
  }).join('');
  for (const j of state.queue) seenJobs.add(j.id);
}

// ---------- toasts ----------
function toast(kind, html, action) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
  el.innerHTML = `${kind === 'ok' ? ICON.okCircle : kind === 'bad' ? ICON.alert : ICON.rip}<div class="msg">${html}</div>${action || ''}`;
  $('#toasts').append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, kind === 'bad' ? 7000 : 4500);
}

// ---------- system setup (sandbox, libdvdcss) ----------
function renderSystem() {
  const sys = state.system;
  if (!sys) return;
  const ok = (b) => `<span class="status ${b ? 'ok' : 'warn'}">${b ? ICON.okCircle : ICON.alert}</span>`;
  const sandboxText = { macos: 'On · macOS sandbox', bubblewrap: 'On · bubblewrap', none: 'Off' }[sys.sandbox];
  const sandboxNote = sys.sandbox !== 'none'
    ? 'Disc parsing runs with no network and no access to your files beyond the disc and output folder.'
    : sys.platform === 'win32'
      ? 'Windows has no sandbox Spinarr can use yet. Discs are still read by patched, fuzz-tested parsers.'
      : 'Install bubblewrap to run disc parsing with no network and no access to your files.';
  const cmd = (c) => `<div class="cmd"><code>${esc(c)}</code><button type="button" class="link-btn" data-action="copy" data-copy="${esc(c)}">Copy</button></div>`;
  const d = sys.dvdcss;
  const dvdcssBody = d.installed
    ? 'Encrypted DVDs can be read.'
    : d.canPick
      ? `Needed for most commercial DVDs. Download <b>libdvdcss-2.dll</b> (64-bit) from VideoLAN, then choose it here.
         <div class="row-btns"><button type="button" class="ghost-btn" data-action="dvdcss-page">Open VideoLAN download</button>
         <button type="button" class="ghost-btn" data-action="dvdcss-pick">Choose DLL…</button></div>`
      : `Needed for most commercial DVDs. Spinarr doesn't ship it. Install it with:${cmd(d.command)}`;
  $('#systemGroup').innerHTML = `
    <div class="group-row top">${ok(sys.sandbox !== 'none' || sys.platform === 'win32')}
      <div class="gr-text"><b>Engine sandbox <span class="pill-state">${sandboxText}</span></b><small>${sandboxNote}</small>
      ${sys.bwrapHelp ? cmd(sys.bwrapHelp) : ''}</div></div>
    <div class="group-row top">${ok(d.installed)}
      <div class="gr-text"><b>DVD decryption <span class="pill-state">${d.installed ? 'libdvdcss installed' : 'Not installed'}</span></b><small>${dvdcssBody}</small></div></div>`;
  $('#setupBtn').hidden = d.installed && !sys.bwrapHelp;
}

// ---------- focus helpers (re-renders replace DOM nodes) ----------
function focusKey() {
  const a = document.activeElement;
  if (!a || a === document.body) return null;
  for (const k of ['toggle', 'expand', 'track', 'filename']) if (a.dataset?.[k]) return `[data-${k}="${a.dataset[k]}"]`;
  return a.id ? `#${a.id}` : null;
}
function restoreFocus(sel) { if (sel) $(sel)?.focus({ preventScroll: true }); }

// ---------- actions ----------
async function loadSource(src) {
  state.source = src;
  state.scanning = true;
  state.error = null;
  state.disc = null;
  Object.assign(state, { selected: new Set(), open: new Set(), probes: new Map(), tracks: new Map(), fileNames: new Map() });
  renderSources(); renderMain();
  try {
    const disc = await spinarr.scan(src);
    if (state.source !== src) return;
    state.disc = disc;
    state.discName = disc.name;
    state.fresh = true;
    const main = disc.titles.find((t) => t.main);
    if (main) { state.selected.add(main.title); probe(main.title); }
  } catch (e) {
    state.error = cleanErr(e);
  }
  state.scanning = false;
  refreshFreeSpace();
  renderSources(); renderMain();
}

async function probe(title) {
  if (state.probes.has(title)) return;
  const src = state.source;
  state.probes.set(title, { loading: true });
  try {
    const data = await spinarr.probe(src, title);
    if (state.source !== src) return;
    state.probes.set(title, { data });
    state.tracks.set(title, new Set(data.streams.map((s) => s.index)));
  } catch (e) {
    state.probes.set(title, { error: cleanErr(e) });
  }
  if (state.open.has(title)) rerenderDetail(title);
}

function rerenderDetail(title) {
  const row = document.querySelector(`.title-row[data-title="${title}"] .t-detail`);
  const t = state.disc?.titles.find((x) => x.title === title);
  if (row && t) row.innerHTML = detail(t);
}

async function refreshFreeSpace() {
  state.freeSpace = await spinarr.freeSpace();
  rerenderActionBar();
}

function rerenderActionBar() {
  const bar = $('.actionbar');
  if (!bar) return;
  const focused = bar.contains(document.activeElement) && document.activeElement.dataset.action;
  bar.outerHTML = actionBar();
  // the dock animates in once; don't replay it on every update
  $('.actionbar').style.animation = 'none';
  if (focused) $(`.actionbar [data-action="${focused}"]`)?.focus();
}

function toggleSelect(n) {
  state.selected.has(n) ? state.selected.delete(n) : state.selected.add(n);
  if (state.selected.has(n)) probe(n);
  const row = $(`.title-row[data-title="${n}"]`);
  if (row) {
    row.classList.toggle('selected', state.selected.has(n));
    $('.cbox', row).setAttribute('aria-checked', state.selected.has(n));
  }
  refreshFileNames();
  rerenderActionBar();
}

function toggleOpen(n, force) {
  const open = force ?? !state.open.has(n);
  open ? state.open.add(n) : state.open.delete(n);
  const row = $(`.title-row[data-title="${n}"]`);
  row.classList.toggle('open', open);
  $('.title-main', row).setAttribute('aria-expanded', open);
  if (open) { rerenderDetail(n); probe(n); }
}

// default file names depend on the selection and the disc name
function refreshFileNames() {
  for (const input of $$('[data-filename]')) {
    const tt = state.disc.titles.find((x) => x.title === +input.dataset.filename);
    if (!state.fileNames.has(tt.title)) input.value = fileName(tt);
  }
}

async function startRip() {
  const jobs = state.disc.titles.filter((t) => state.selected.has(t.title)).map((t) => {
    const p = state.probes.get(t.title);
    const tracks = p?.data ? [...state.tracks.get(t.title)].sort((a, b) => a - b) : null;
    return {
      source: state.source,
      title: t.title,
      duration: t.duration,
      streams: tracks,
      fileName: fileName(t),
      displayName: state.discName,
      accurateChapters: state.settings.accurateChapters,
      fps: t.video?.standard === 'PAL' ? 25 : 29.97,
    };
  });
  try {
    await spinarr.rip(jobs);
    toast('info', `Added <b>${plural(jobs.length, 'title')}</b> to Rips`);
  } catch (e) {
    toast('bad', `<b>Couldn't start the rip.</b> ${esc(cleanErr(e))}`);
  }
}

async function openPicker(kind = IS_MAC ? 'any' : 'file') { const p = await spinarr.pickSource(kind); if (p) loadSource(p); }

function openSettings() {
  if ($('#settingsDlg').open) return;
  $('#setOutput').value = tilde(state.settings.outputDir);
  $('#setMin').value = state.settings.minMinutes;
  $('#setChapters').checked = state.settings.accurateChapters;
  renderSystem();
  $('#settingsDlg').showModal();
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-select],[data-expand],[data-src],[data-eject],[data-cancel],[data-reveal],[data-action],[data-step]');
  if (!t) return;

  if (t.dataset.eject) {
    e.stopPropagation();
    if (state.source === t.dataset.eject) { state.source = null; state.disc = null; renderMain(); }
    await spinarr.eject(t.dataset.eject);
    return;
  }
  if (t.dataset.select) { e.stopPropagation(); toggleSelect(+t.dataset.select); return; }
  if (t.dataset.expand) { toggleOpen(+t.dataset.expand); return; }
  if (t.dataset.src) { if (t.dataset.src !== state.source || !state.disc) loadSource(t.dataset.src); return; }
  if (t.dataset.cancel) return spinarr.cancel(t.dataset.cancel);
  if (t.dataset.reveal) return spinarr.reveal(t.dataset.reveal);
  if (t.dataset.step) {
    const i = $('#setMin');
    i.value = Math.min(60, Math.max(0, (+i.value || 0) + +t.dataset.step));
    return;
  }

  switch (t.dataset.action) {
    case 'open': openPicker(); break;
    case 'open-folder': openPicker('folder'); break;
    case 'dvdcss-page': spinarr.openDvdcssPage(); break;
    case 'dvdcss-pick':
      try { state.system = await spinarr.installDvdcss(); renderSystem(); if (state.system.dvdcss.installed) toast('ok', '<b>libdvdcss installed.</b> Encrypted DVDs can now be read.'); }
      catch (err) { toast('bad', esc(cleanErr(err))); }
      break;
    case 'copy': navigator.clipboard.writeText(t.dataset.copy || ''); t.textContent = 'Copied'; setTimeout(() => { t.textContent = 'Copy'; }, 1500); break;
    case 'output': {
      state.settings = await spinarr.pickOutput();
      refreshFreeSpace();
      break;
    }
    case 'rip': startRip(); break;
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.toggle) { state[el.dataset.toggle] = el.checked; renderMain(); }
  if (el.dataset.track) {
    const [title, idx] = el.dataset.track.split(':').map(Number);
    const set = state.tracks.get(title);
    el.checked ? set.add(idx) : set.delete(idx);
  }
});

document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.id === 'discName') { state.discName = el.value; refreshFileNames(); }
  if (el.dataset.filename) state.fileNames.set(+el.dataset.filename, el.value);
});

// Keyboard: ⌘O open · ⌘, settings · ⌘↩ rip · ⌘A select all · ↑↓ move · Space select · ↩/→/← expand
document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  const typing = e.target.matches('input:not([type=checkbox]), textarea');
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openPicker(e.shiftKey ? 'folder' : undefined); return; }
  if (mod && e.key === ',') { e.preventDefault(); openSettings(); return; }
  if ($('#settingsDlg').open) return;
  if (mod && e.key === 'Enter') {
    e.preventDefault();
    const b = $('[data-action="rip"]');
    if (b && !b.disabled) startRip();
    return;
  }
  if (typing) {
    if (e.key === 'Enter' || e.key === 'Escape') e.target.blur();
    return;
  }
  if (mod && e.key.toLowerCase() === 'a' && state.disc) {
    e.preventDefault();
    const vis = visibleTitles().map((t) => t.title);
    const all = vis.every((n) => state.selected.has(n));
    for (const n of vis) if (all === state.selected.has(n)) toggleSelect(n);
    return;
  }

  const src = e.target.closest?.('[data-src]');
  if (src && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); src.click(); return; }

  const rows = $$('.title-main');
  if (!rows.length) return;
  const cur = e.target.closest?.('.title-main');
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const i = rows.indexOf(cur);
    const next = rows[Math.max(0, Math.min(rows.length - 1, i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)))];
    next.focus();
    next.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (!cur) return;
  const n = +cur.dataset.expand;
  if (e.key === ' ') { e.preventDefault(); toggleSelect(n); }
  else if (e.key === 'Enter') { e.preventDefault(); toggleOpen(n); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); toggleOpen(n, true); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); toggleOpen(n, false); }
});

$('#openBtn').addEventListener('click', () => openPicker());
$('#openFolderBtn').addEventListener('click', () => openPicker('folder'));
$('#setupBtn').addEventListener('click', openSettings);
$('#clearBtn').addEventListener('click', () => spinarr.clearFinished());

// settings dialog
$('#settingsBtn').addEventListener('click', openSettings);
$('#setOutputBtn').addEventListener('click', async () => {
  state.settings = await spinarr.pickOutput();
  $('#setOutput').value = tilde(state.settings.outputDir);
});
$('#settingsDlg').addEventListener('close', async () => {
  state.settings = await spinarr.setSettings({
    minMinutes: Math.max(0, +$('#setMin').value || 0),
    accurateChapters: $('#setChapters').checked,
  });
  renderMain();
  refreshFreeSpace();
});

// drag and drop
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); if (++dragDepth === 1) document.body.classList.add('dragging'); });
window.addEventListener('dragleave', () => { if (--dragDepth === 0) document.body.classList.remove('dragging'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const f = e.dataTransfer.files[0];
  if (!f) return;
  let p = spinarr.pathForFile(f);
  p = p.replace(/[\\/](VIDEO_TS|BDMV)[\\/]?$/i, '');
  if (p) loadSource(p);
});

// main-process events
const lastState = new Map(); // job id -> state, to toast on transitions
spinarr.on('queue', (q) => {
  for (const j of q) {
    const prev = lastState.get(j.id);
    if (prev && prev !== j.state && document.hasFocus()) {
      if (j.state === 'done') toast('ok', `Ripped <b>${esc(j.fileName)}</b>`, `<button class="tbtn" data-reveal="${esc(j.id)}">Show</button>`);
      if (j.state === 'failed') toast('bad', `<b>${esc(j.fileName)}</b> failed. ${esc(j.error || '')}`);
    }
    lastState.set(j.id, j.state);
  }
  state.queue = q;
  renderQueue();
  updateRipStates();
});
spinarr.on('queue-idle', () => {
  const done = state.queue.filter((j) => j.state === 'done').length;
  if (done && !document.hasFocus()) new Notification('Spinarr', { body: `Finished ripping ${done} title${done === 1 ? '' : 's'}.` });
  refreshFreeSpace();
});
spinarr.on('drives-changed', (drives) => {
  const before = new Set(state.drives.discs.map((d) => d.path));
  state.drives = drives;
  // Only physical discs scan automatically; images and other volumes wait for a click.
  const inserted = drives.discs.find((d) => !before.has(d.path) && d.kind === 'optical');
  const sourceGone = state.source?.startsWith('/Volumes/') && !drives.discs.some((d) => d.path === state.source);
  if (sourceGone) { state.source = null; state.disc = null; renderMain(); }
  if (inserted && !state.scanning && !state.queue.some((j) => j.state === 'ripping')) loadSource(inserted.path);
  renderSources();
});

// boot
(async () => {
  document.body.classList.add(`os-${OS}`);
  for (const k of $$('[data-keys]')) k.textContent = keys(k.dataset.keys);
  if (!IS_MAC) {
    $('#openBtn span').textContent = 'Open disc image…';
    $('#openBtn').title = keys('⌘O');
    $('#openFolderBtn').title = keys('⇧⌘O');
    $('#openFolderBtn').hidden = false;
  }
  $('#settingsBtn').title = `Settings (${keys('⌘,')})`;
  state.settings = await spinarr.getSettings();
  state.system = await spinarr.system();
  renderSystem();
  state.drives = await spinarr.drives();
  renderSources();
  renderMain();
  renderQueue();
  refreshFreeSpace();
  const optical = state.drives.discs.find((d) => d.kind === 'optical');
  if (optical) loadSource(optical.path);
})();
