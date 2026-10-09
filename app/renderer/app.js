/* global spinarr */
const $ = (s, el = document) => el.querySelector(s);

const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17l9-10"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  eject: '<svg viewBox="0 0 24 24"><path d="M5 15h14L12 6Z"/><path d="M5 19h14"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  reveal: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/></svg>',
  rip: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/></svg>',
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
};

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

// ---------- sources ----------
function renderSources() {
  const el = $('#sources');
  const { discs, hasDrive } = state.drives;
  let html = discs.map((d) => `
    <div class="source ${state.source === d.path ? 'active' : ''}" data-src="${esc(d.path)}">
      <div class="disc-ico"></div>
      <div class="meta"><div class="name">${esc(d.name)}</div><div class="sub">${d.kind === 'optical' ? (d.media === 'bluray' ? 'Blu-ray' : 'DVD') : d.kind === 'image' ? 'Disk image' : 'Volume'}${d.kind !== 'optical' && state.source !== d.path ? ' · click to scan' : ''}</div></div>
      <button class="icon-btn" data-eject="${esc(d.path)}" title="Eject">${ICON.eject}</button>
    </div>`).join('');
  if (state.source && !discs.some((d) => d.path === state.source)) {
    html += `
      <div class="source active" data-src="${esc(state.source)}">
        <div class="disc-ico"></div>
        <div class="meta"><div class="name">${esc(state.source.split('/').pop())}</div><div class="sub">Image / folder</div></div>
      </div>`;
  }
  if (!discs.length) html += `<div class="no-drive">${hasDrive ? 'Drive ready — no disc inserted.' : 'No DVD drive detected.'}</div>`;
  el.innerHTML = html;
}

// ---------- main ----------
function renderMain() {
  const main = $('#main');

  if (state.scanning) {
    main.innerHTML = `<div class="empty"><div class="big-disc spinning"></div><h1>Reading disc…</h1><p>Scanning titles, chapters and tracks.</p></div>`;
    return;
  }
  if (!state.disc) {
    main.innerHTML = `
      <div class="empty">
        <div class="big-disc"></div>
        <h1>Insert a DVD or Blu-ray</h1>
        <p>Spinarr copies titles to MKV losslessly — every audio track, subtitle and chapter, bit for bit.</p>
        <button class="primary-btn" data-action="open">${ICON.folder} Open image or folder</button>
        ${state.error ? `<div class="error-box">${esc(state.error)}</div>` : ''}
      </div>`;
    return;
  }

  const d = state.disc;
  const first = d.titles.find((t) => t.main) || d.titles[0];
  const longest = Math.max(...d.titles.map((t) => t.duration), 1);
  const titles = visibleTitles();
  const hidden = hiddenCount();

  main.innerHTML = `
    <div class="disc-head">
      <div class="big-disc"></div>
      <div class="disc-title">
        <input id="discName" value="${esc(state.discName)}" spellcheck="false" title="Used for file names and MKV title" />
        <div class="disc-meta">
          <span><b>${d.titles.length}</b> title${d.titles.length === 1 ? '' : 's'}</span>
          ${d.type === 'bluray' ? '<span class="badge main">Blu-ray</span>' : ''}
          ${first ? `<span>${[first.video.standard, first.video.codec, first.video.aspect].filter((x) => x && x !== '?').map(esc).join(' · ')}</span>` : ''}
          <span>Volume ${esc(d.label || '—')}</span>
        </div>
      </div>
    </div>
    <div class="toolbar">
      <span>${titles.length} shown${hidden ? ` · ${hidden} hidden` : ''}</span>
      <span class="spacer"></span>
      <label class="toggle"><input type="checkbox" data-toggle="showShort" ${state.showShort ? 'checked' : ''}/> Short titles</label>
      <label class="toggle"><input type="checkbox" data-toggle="showDups" ${state.showDups ? 'checked' : ''}/> Duplicates</label>
    </div>
    ${d.blocked ? `<div class="error-box banner">${esc(d.blocked)}</div>` : ''}
    <div class="titles">${titles.map((t) => titleRow(t, longest)).join('')}</div>
    ${actionBar()}`;
}

function titleRow(t, longest) {
  const sel = state.selected.has(t.title);
  const open = state.open.has(t.title);
  let acc = 0;
  const ticks = t.chapters.slice(0, -1).map((c) => {
    acc += c;
    return `<span class="tick" style="left:${(acc / longest) * 100}%"></span>`;
  }).join('');
  const audio = t.audio.map((a) => `<span class="chip">${langShort(a.lang)} ${esc(a.codec)} ${esc(chans(a.channels))}${a.commentary ? ' · Comm.' : ''}</span>`).join('');
  const subs = t.subtitles.map((s) => `<span class="chip sub">${langShort(s.lang)}</span>`).join('');

  return `
    <div class="title-row ${sel ? 'selected' : ''} ${open ? 'open' : ''} ${t.duplicateOf ? 'dim' : ''}" data-title="${t.title}">
      <div class="title-main" data-expand="${t.title}">
        <button class="cbox" data-select="${t.title}" aria-label="Select title">${ICON.check}</button>
        <div class="t-info">
          <div class="t-name">Title ${t.title}
            ${t.main ? '<span class="badge main">Main feature</span>' : ''}
            ${t.duplicateOf ? `<span class="badge dup">Same as ${t.duplicateOf}</span>` : ''}
          </div>
          <div class="t-sub">${t.chapters.length} chapter${t.chapters.length === 1 ? '' : 's'}${t.angles > 1 ? ` · ${t.angles} angles` : ''} · ${t.audio.length} audio · ${t.subtitles.length} subtitle${t.subtitles.length === 1 ? '' : 's'}</div>
          <div class="timeline"><div class="fill" style="width:${(t.duration / longest) * 100}%"></div>${ticks}</div>
          ${audio || subs ? `<div class="chips">${audio}${subs}</div>` : ''}
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
  if (!p || p.loading) tracks = `<div class="loading-line"><span class="mini-spin"></span> Reading tracks…</div>`;
  else if (p.error) tracks = `<div class="error-box">${esc(p.error)}</div>`;
  else {
    const chosen = state.tracks.get(t.title);
    const row = (s, label, meta) => `
      <label class="track"><input type="checkbox" data-track="${t.title}:${s.index}" ${chosen.has(s.index) ? 'checked' : ''}/>
      <span class="tk-lang">${label}</span><span class="tk-meta">${meta}</span></label>`;
    const audio = p.data.streams.filter((s) => s.type === 'audio')
      .map((s) => row(s, esc(langName(s.lang)), esc([`${codecLabel(s.codec)} ${chans(s.channels)}`, s.commentary && 'Commentary', s.impaired && 'Described'].filter(Boolean).join(' · ')))).join('') || '<div class="tk-meta">None</div>';
    const subs = p.data.streams.filter((s) => s.type === 'subtitle')
      .map((s) => row(s, esc(langName(s.lang)), esc([codecLabel(s.codec), s.viewport, s.forced && 'Forced'].filter(Boolean).join(' · ')))).join('') || '<div class="tk-meta">None</div>';
    tracks = `<div class="detail-grid"><div><div class="detail-label">Audio</div>${audio}</div><div><div class="detail-label">Subtitles</div>${subs}</div></div>`;
  }
  return `${tracks}
    <div class="file-field"><input data-filename="${t.title}" value="${esc(fileName(t))}" spellcheck="false"/><span class="ext">.mkv</span></div>`;
}

function actionBar() {
  const n = state.selected.size;
  const bytes = selectedBytes();
  const low = state.freeSpace != null && bytes > state.freeSpace;
  const blocked = !!state.disc?.blocked;
  return `
    <div class="actionbar">
      <div class="dest" data-action="output" title="Change output folder">
        ${ICON.folder}
        <div style="min-width:0">
          <div class="d-path">${esc(state.settings.outputDir.replace(/^\/Users\/[^/]+/, '~'))}</div>
          <div class="d-sub ${low ? 'warn' : ''}">${n ? `${fmtBytes(bytes)} needed` : 'Nothing selected'}${state.freeSpace != null ? ` · ${fmtBytes(state.freeSpace)} free` : ''}${low ? ' — not enough space' : ''}</div>
        </div>
      </div>
      <button class="primary-btn" data-action="rip" ${n && !low && !blocked ? '' : 'disabled'}>${ICON.rip} Rip ${n ? `${n} title${n === 1 ? '' : 's'}` : ''}</button>
    </div>`;
}

// ---------- queue ----------
function renderQueue() {
  const list = $('#queueList');
  $('#clearBtn').hidden = !state.queue.some((j) => !['queued', 'ripping'].includes(j.state));
  if (!state.queue.length) { list.innerHTML = `<div class="q-empty">Nothing ripping yet.</div>`; return; }
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
      ? `<button class="icon-btn" data-cancel="${esc(j.id)}" title="Cancel">${ICON.x}</button>`
      : j.state === 'done' ? `<button class="icon-btn" data-reveal="${esc(j.id)}" title="Show in Finder">${ICON.reveal}</button>` : '';
    return `
      <div class="job ${j.state}">
        <div class="job-top"><div class="job-name" title="${esc(j.fileName)}">${esc(j.fileName)}</div>${btn}</div>
        <div class="bar"><div style="width:${j.progress * 100}%"></div></div>
        <div class="job-state"><span>${status}</span><span>${right}</span></div>
        ${j.error ? `<div class="job-err">${esc(j.error)}</div>` : ''}
      </div>`;
  }).join('');
}

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
    const main = disc.titles.find((t) => t.main);
    if (main) { state.selected.add(main.title); probe(main.title); }
  } catch (e) {
    state.error = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
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
    state.probes.set(title, { error: e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
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
  if (bar) bar.outerHTML = actionBar();
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
  await spinarr.rip(jobs);
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-select],[data-expand],[data-src],[data-eject],[data-cancel],[data-reveal],[data-action]');
  if (!t) return;

  if (t.dataset.eject) {
    e.stopPropagation();
    if (state.source === t.dataset.eject) { state.source = null; state.disc = null; renderMain(); }
    await spinarr.eject(t.dataset.eject);
    return;
  }
  if (t.dataset.select) {
    e.stopPropagation();
    const n = +t.dataset.select;
    state.selected.has(n) ? state.selected.delete(n) : state.selected.add(n);
    if (state.selected.has(n)) probe(n);
    const row = t.closest('.title-row');
    row.classList.toggle('selected', state.selected.has(n));
    // default file names depend on the selection
    for (const input of document.querySelectorAll('[data-filename]')) {
      const tt = state.disc.titles.find((x) => x.title === +input.dataset.filename);
      if (!state.fileNames.has(tt.title)) input.value = fileName(tt);
    }
    rerenderActionBar();
    return;
  }
  if (t.dataset.expand) {
    const n = +t.dataset.expand;
    state.open.has(n) ? state.open.delete(n) : state.open.add(n);
    t.closest('.title-row').classList.toggle('open', state.open.has(n));
    if (state.open.has(n)) { rerenderDetail(n); probe(n); }
    return;
  }
  if (t.dataset.src) { if (t.dataset.src !== state.source || !state.disc) loadSource(t.dataset.src); return; }
  if (t.dataset.cancel) return spinarr.cancel(t.dataset.cancel);
  if (t.dataset.reveal) return spinarr.reveal(t.dataset.reveal);

  switch (t.dataset.action) {
    case 'open': { const p = await spinarr.pickSource(); if (p) loadSource(p); break; }
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
  if (el.id === 'discName') {
    state.discName = el.value;
    for (const input of document.querySelectorAll('[data-filename]')) {
      const tt = state.disc.titles.find((x) => x.title === +input.dataset.filename);
      if (!state.fileNames.has(tt.title)) input.value = fileName(tt);
    }
  }
  if (el.dataset.filename) state.fileNames.set(+el.dataset.filename, el.value);
});

$('#openBtn').addEventListener('click', async () => { const p = await spinarr.pickSource(); if (p) loadSource(p); });
$('#clearBtn').addEventListener('click', () => spinarr.clearFinished());

// settings dialog
$('#settingsBtn').addEventListener('click', () => {
  $('#setOutput').value = state.settings.outputDir;
  $('#setMin').value = state.settings.minMinutes;
  $('#setChapters').checked = state.settings.accurateChapters;
  $('#settingsDlg').showModal();
});
$('#setOutputBtn').addEventListener('click', async () => {
  state.settings = await spinarr.pickOutput();
  $('#setOutput').value = state.settings.outputDir;
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
  if (/\/VIDEO_TS\/?$/i.test(p)) p = p.replace(/\/VIDEO_TS\/?$/i, '');
  if (p) loadSource(p);
});

// main-process events
spinarr.on('queue', (q) => {
  state.queue = q;
  renderQueue();
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
  state.settings = await spinarr.getSettings();
  state.drives = await spinarr.drives();
  renderSources();
  renderMain();
  renderQueue();
  refreshFreeSpace();
  const optical = state.drives.discs.find((d) => d.kind === 'optical');
  if (optical) loadSource(optical.path);
})();
