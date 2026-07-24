import mermaid from '/vendor/mermaid/mermaid.esm.min.mjs';

mermaid.initialize({ startOnLoad: false, securityLevel: 'loose', theme: 'default' });

const els = {
  list: document.getElementById('project-list'),
  liveDot: document.getElementById('live-dot'),
  projectName: document.getElementById('project-name'),
  versionSelect: document.getElementById('version-select'),
  updatedNote: document.getElementById('updated-note'),
  toggleEditor: document.getElementById('toggle-editor'),
  save: document.getElementById('save'),
  saveNew: document.getElementById('save-new'),
  editorPane: document.getElementById('editor-pane'),
  editor: document.getElementById('editor'),
  diagram: document.getElementById('diagram'),
  renderError: document.getElementById('render-error'),
  newProject: document.getElementById('new-project'),
};

const state = {
  projects: [],
  current: null,        // project name
  version: 'latest',    // 'latest' or a number
  loadedVersion: null,  // actual version number currently shown
  dirty: false,
  renderSeq: 0,
};

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}

async function refreshProjects() {
  state.projects = await api('/api/projects');
  els.list.innerHTML = '';
  for (const p of state.projects) {
    const li = document.createElement('li');
    li.classList.toggle('active', p.name === state.current);
    const name = document.createElement('span');
    name.textContent = p.name;
    const ver = document.createElement('span');
    ver.className = 'ver';
    ver.textContent = `v${p.latestVersion}`;
    li.append(name, ver);
    li.onclick = () => selectProject(p.name);
    els.list.appendChild(li);
  }
  if (!state.current && state.projects.length) selectProject(state.projects[0].name);
}

function renderVersionOptions(project) {
  els.versionSelect.innerHTML = '';
  const latest = document.createElement('option');
  latest.value = 'latest';
  latest.textContent = `latest (v${project.latestVersion})`;
  els.versionSelect.appendChild(latest);
  for (const v of [...project.versions].reverse()) {
    const opt = document.createElement('option');
    opt.value = String(v);
    opt.textContent = `v${v}`;
    els.versionSelect.appendChild(opt);
  }
  els.versionSelect.value = String(state.version);
}

async function selectProject(name, version = 'latest') {
  state.current = name;
  state.version = version;
  state.dirty = false;
  await loadCurrent();
  await refreshProjects();
}

async function loadCurrent({ preserveEditor = false } = {}) {
  if (!state.current) return;
  const data = await api(`/api/projects/${encodeURIComponent(state.current)}/versions/${state.version}`);
  state.loadedVersion = data.version;
  els.projectName.textContent = state.current;
  const proj = state.projects.find((p) => p.name === state.current);
  if (proj) renderVersionOptions(proj);
  if (!preserveEditor) {
    els.editor.value = data.content;
    state.dirty = false;
  }
  els.updatedNote.textContent = state.dirty ? 'unsaved changes' : '';
  await renderDiagram(preserveEditor && state.dirty ? els.editor.value : data.content);
}

async function renderDiagram(source) {
  const seq = ++state.renderSeq;
  try {
    await mermaid.parse(source); // throws on bad syntax before we touch the DOM
    const { svg } = await mermaid.render(`d${seq}`, source);
    if (seq !== state.renderSeq) return; // a newer render finished after us
    els.diagram.innerHTML = svg;
    els.renderError.hidden = true;
    els.diagram.classList.remove('updated');
    void els.diagram.offsetWidth; // restart the flash animation
    els.diagram.classList.add('updated');
  } catch (err) {
    if (seq !== state.renderSeq) return;
    els.renderError.textContent = String(err.message || err);
    els.renderError.hidden = false;
  }
}

// ---- Live updates over SSE ----
function connectEvents() {
  const es = new EventSource('/api/events');
  es.onopen = () => els.liveDot.classList.add('live');
  es.onerror = () => els.liveDot.classList.remove('live');
  es.onmessage = async () => {
    await refreshProjects();
    if (!state.current) return;
    // Re-load the current diagram from disk. If the user has unsaved edits
    // in the editor, keep their text but refresh the version list.
    await loadCurrent({ preserveEditor: state.dirty });
  };
}

// ---- Editor ----
let previewTimer = null;
els.editor.addEventListener('input', () => {
  state.dirty = true;
  els.updatedNote.textContent = 'unsaved changes';
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => renderDiagram(els.editor.value), 250);
});

els.toggleEditor.onclick = () => {
  const show = els.editorPane.hidden;
  els.editorPane.hidden = !show;
  els.save.hidden = !show;
  els.saveNew.hidden = !show;
  els.toggleEditor.textContent = show ? 'Close editor' : 'Edit';
};

els.save.onclick = async () => {
  if (!state.current || state.loadedVersion == null) return;
  await api(`/api/projects/${encodeURIComponent(state.current)}/versions/${state.loadedVersion}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: els.editor.value }),
  });
  state.dirty = false;
  els.updatedNote.textContent = `saved v${state.loadedVersion}`;
};

els.saveNew.onclick = async () => {
  if (!state.current) return;
  const { version } = await api(`/api/projects/${encodeURIComponent(state.current)}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: els.editor.value }),
  });
  state.dirty = false;
  state.version = 'latest';
  els.updatedNote.textContent = `saved v${version}`;
};

els.versionSelect.onchange = () => {
  state.version = els.versionSelect.value === 'latest' ? 'latest' : Number(els.versionSelect.value);
  state.dirty = false;
  loadCurrent();
};

els.newProject.onclick = async () => {
  const name = prompt('Project name (letters, numbers, dashes):');
  if (!name) return;
  try {
    await api(`/api/projects/${encodeURIComponent(name)}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'flowchart TD\n    A[Start] --> B[End]\n' }),
    });
    await refreshProjects();
    selectProject(name);
  } catch (err) {
    alert(`Could not create project: ${err.message}`);
  }
};

refreshProjects();
connectEvents();
