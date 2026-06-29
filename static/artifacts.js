// ── Hermes WebUI Artifact System ───────────────────────────────────────────────
// Claude-style artifact panel. Artifacts appear in a right-side resizable panel
// with code/preview toggle, tabs, file loading, and fullscreen.
//
// Behavior (Claude-like):
//   - New artifact from agent → panel opens automatically
//   - User closes panel → stays closed until next new artifact
//   - Old artifacts re-detected on re-render → ignored (sessionStorage dedup)
//   - Click star ⭐ button → toggle panel manually
//
// Tag formats:
//   ARTIFACT:id|type|title              — inline content in fenced block
//   ARTIFACT:id|type|title|file:/path   — loads from local file via /api/media
//   ARTIFACT:id|type|title|https://...  — loads from URL
// ─────────────────────────────────────────────────────────────────────────────────

(function() {
  'use strict';

  // ── Persistent tracking (survives re-renders within session) ────────────────
  var STORAGE_KEY_ACK = 'hermes-artifact-ack';
  var STORAGE_KEY_DISMISSED = 'hermes-artifact-dismissed';

  function _getAcked() {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY_ACK) || '[]'); } catch(_) { return []; }
  }
  function _setAcked(ids) {
    try { sessionStorage.setItem(STORAGE_KEY_ACK, JSON.stringify(ids)); } catch(_) {}
  }
  function _isDismissed() {
    try { return sessionStorage.getItem(STORAGE_KEY_DISMISSED) === '1'; } catch(_) { return false; }
  }
  function _setDismissed(v) {
    try { sessionStorage.setItem(STORAGE_KEY_DISMISSED, v ? '1' : '0'); } catch(_) {}
  }

  // ── State ────────────────────────────────────────────────────────────────────
  var _artifacts = {};
  var _artifactOrder = [];
  var _activeArtifactId = null;
  var _artifactViewMode = 'preview';
  var _panelVisible = false;
  var _panelWidth = 420;

  // ── DOM ──────────────────────────────────────────────────────────────────────
  function _panel()  { return document.getElementById('artifactPanel'); }
  function _tabs()   { return document.getElementById('artifactTabs'); }
  function _body()   { return document.getElementById('artifactBody'); }
  function _codeV()  { return document.getElementById('artifactCodeView'); }
  function _prevV()  { return document.getElementById('artifactPreviewView'); }

  function _loadWidth() {
    try { var v = localStorage.getItem('hermes-artifact-panel-width'); if (v && !isNaN(v)) _panelWidth = Math.max(280, Math.min(900, +v)); } catch(_) {}
  }
  function _saveWidth() {
    try { localStorage.setItem('hermes-artifact-panel-width', String(_panelWidth)); } catch(_) {}
  }

  // ── Visibility ───────────────────────────────────────────────────────────────
  function showArtifactPanel() {
    if (_panelVisible) return;
    _panelVisible = true;
    _setDismissed(false);
    var p = _panel(); if (!p) return;
    p.style.display = 'flex';
    p.style.width = _panelWidth + 'px';
    _updateToggleBtn();
    if (_activeArtifactId) _renderActiveContent();
  }

  function hideArtifactPanel() {
    _panelVisible = false;
    _setDismissed(true);
    var p = _panel(); if (!p) return;
    p.style.display = 'none';
    _updateToggleBtn();
  }

  function toggleArtifactPanel() {
    if (_panelVisible) hideArtifactPanel(); else showArtifactPanel();
  }

  function _updateToggleBtn() {
    var btn = document.getElementById('btnArtifactPanelToggle');
    if (!btn) return;
    var hasAny = Object.keys(_artifacts).length > 0;
    btn.style.display = hasAny ? '' : 'none';
    if (_panelVisible) { btn.setAttribute('aria-pressed', 'true'); btn.classList.add('active'); }
    else { btn.setAttribute('aria-pressed', 'false'); btn.classList.remove('active'); }
  }

  // ── Artifact CRUD ────────────────────────────────────────────────────────────
  function createArtifact(id, type, title, content, src) {
    var acked = _getAcked();
    var isNew = !_artifacts[id] && acked.indexOf(id) === -1;

    _artifacts[id] = { type: type || 'code', title: title || id, content: content || '', src: src || null, loading: !!src };

    if (_artifactOrder.indexOf(id) === -1) {
      _artifactOrder.push(id);
    }

    _renderTabs();

    // Claude-like: auto-show only for BRAND NEW artifacts
    if (isNew && !_isDismissed()) {
      switchArtifactTab(id);
      showArtifactPanel();
    } else if (_activeArtifactId === id && _panelVisible) {
      _renderActiveContent();
    }

    _updateToggleBtn();

    // Load from file if src is provided
    if (src) _loadArtifactSrc(id, src);

    // Mark as acknowledged so re-renders don't re-trigger
    if (isNew) {
      acked.push(id);
      _setAcked(acked);
    }
  }

  function _loadArtifactSrc(id, src) {
    var url = src;
    // Convert local file path to /api/media endpoint
    if (src.indexOf('://') === -1 && src.charAt(0) === '/') {
      url = 'api/media?path=' + encodeURIComponent(src) + '&inline=1';
    }
    fetch(url, { credentials: 'include' })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function(text) {
        var a = _artifacts[id]; if (!a) return;
        a.content = text;
        a.loading = false;
        if (_activeArtifactId === id && _panelVisible) _renderActiveContent();
      })
      .catch(function(err) {
        var a = _artifacts[id]; if (!a) return;
        a.content = '/* Failed to load ' + src + ' — ' + err.message + ' */';
        a.loading = false;
        if (_activeArtifactId === id && _panelVisible) _renderActiveContent();
      });
  }

  function closeArtifact(id) {
    delete _artifacts[id];
    var idx = _artifactOrder.indexOf(id); if (idx >= -1) _artifactOrder.splice(idx, 1);
    if (_activeArtifactId === id) {
      var next = _artifactOrder[Math.min(idx, _artifactOrder.length - 1)];
      if (next) switchArtifactTab(next);
      else { _activeArtifactId = null; _renderEmpty(); hideArtifactPanel(); }
    }
    _renderTabs();
    _updateToggleBtn();
  }

  function switchArtifactTab(id) {
    _activeArtifactId = id;
    _renderTabs();
    if (_panelVisible) _renderActiveContent();
  }

  function switchArtifactView(mode) {
    _artifactViewMode = mode || (_artifactViewMode === 'preview' ? 'code' : _artifactViewMode === 'code' ? 'split' : 'preview');
    if (_panelVisible) _renderActiveContent();
  }

  // ── Rendering ────────────────────────────────────────────────────────────────
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function _renderTabs() {
    var t = _tabs(); if (!t) return;
    var h = '';
    for (var i = 0; i < _artifactOrder.length; i++) {
      var id = _artifactOrder[i], a = _artifacts[id]; if (!a) continue;
      var cls = id === _activeArtifactId ? ' active' : '';
      var load = a.loading ? ' (loading...)' : '';
      h += '<button class="artifact-tab' + cls + '" onclick="switchArtifactTab(\'' + esc(id) + '\')" title="' + esc(a.title) + '">';
      h += esc(a.title) + load;
      h += '<span class="artifact-tab-close" onclick="event.stopPropagation();closeArtifact(\'' + esc(id) + '\')">×</span>';
      h += '</button>';
    }
    t.innerHTML = h;
  }

  function _renderEmpty() {
    var b = _body(), cv = _codeV(), pv = _prevV(), emp = document.getElementById('artifactEmpty');
    if (emp) emp.style.display = 'flex';
    if (b) b.style.display = 'none';
    if (cv) cv.innerHTML = ''; if (pv) pv.innerHTML = '';
  }

  function _renderActiveContent() {
    var id = _activeArtifactId, a = id ? _artifacts[id] : null;
    var b = _body(), cv = _codeV(), pv = _prevV(), emp = document.getElementById('artifactEmpty');
    if (!a) { _renderEmpty(); return; }
    if (emp) emp.style.display = 'none';
    if (b) { b.style.display = ''; b.className = 'artifact-body view-' + _artifactViewMode; }

    var content = a.content || '', type = a.type || 'code';
    if (a.loading) content = '';

    var vb = document.getElementById('btnArtifactViewToggle');
    if (vb) vb.textContent = _artifactViewMode === 'preview' ? 'Code' : _artifactViewMode === 'code' ? 'Preview' : 'Code';

    if (_artifactViewMode === 'code') {
      if (cv) { cv.style.display = ''; _setCode(cv, a.loading ? 'Loading...' : content, type); }
      if (pv) { pv.style.display = 'none'; _preview(pv, '', type); }
    } else {
      if (cv) { cv.style.display = 'none'; _setCode(cv, '', type); }
      if (pv) { pv.style.display = ''; _preview(pv, a.loading ? 'Loading...' : content, type); }
    }
  }

  function _setCode(el, content, type) {
    var lang = {html:'html',react:'jsx',svg:'xml',mermaid:'mermaid',markdown:'md',javascript:'js'}[type] || '';
    el.innerHTML = '<pre class="artifact-code-pre"><code class="' + (lang?'language-'+lang:'') + '">' + esc(content) + '</code></pre>';
    if (typeof Prism !== 'undefined' && Prism.highlightElement) {
      var c = el.querySelector('code'); if (c) try { Prism.highlightElement(c); } catch(_) {}
    }
  }

  function _preview(el, content, type) {
    if (!content) { el.innerHTML = '<div class="artifact-preview-placeholder">' + (_activeArtifactId && _artifacts[_activeArtifactId] && _artifacts[_activeArtifactId].loading ? 'Loading...' : 'No content') + '</div>'; return; }
    switch (type) {
      case 'html': case 'react': _html(el, content); break;
      case 'svg': _svg(el, content); break;
      case 'mermaid': _mermaid(el, content); break;
      case 'markdown': el.innerHTML = typeof renderMd === 'function' ? renderMd(content) : '<pre class="artifact-preview-text">' + esc(content) + '</pre>'; break;
      default: el.innerHTML = '<pre class="artifact-code-pre"><code>' + esc(content) + '</code></pre>'; if (typeof Prism !== 'undefined' && Prism.highlightElement) { var c2 = el.querySelector('code'); if (c2) try { Prism.highlightElement(c2); } catch(_) {} } break;
    }
  }

  function _html(el, content) {
    var iframe = document.createElement('iframe');
    iframe.className = 'artifact-preview-iframe';
    iframe.sandbox = 'allow-scripts allow-same-origin';
    iframe.srcdoc = content;
    el.innerHTML = '';
    el.appendChild(iframe);
  }

  function _svg(el, content) {
    if (content.indexOf('```') === 0) content = content.replace(/^```.*?\n/, '').replace(/\n```$/, '');
    el.innerHTML = '<div class="artifact-preview-svg">' + content + '</div>';
  }

  function _mermaid(el, content) {
    var mid = 'm-' + Math.random().toString(36).slice(2,8);
    el.innerHTML = '<div class="mermaid-block" data-mermaid-id="' + mid + '">' + esc(content) + '</div>';
    if (typeof mermaid !== 'undefined') try { mermaid.run({nodes:[el.querySelector('.mermaid-block')]}); } catch(_) {}
  }

  // ── Fullscreen / Download ────────────────────────────────────────────────────
  function artifactFullscreen() {
    var a = _activeArtifactId ? _artifacts[_activeArtifactId] : null; if (!a) return;
    var ov = document.createElement('div');
    ov.className = 'artifact-fullscreen-overlay';
    ov.id = 'artifactFullscreenOverlay';
    ov.innerHTML = '<div class="artifact-fullscreen-header">' +
      '<span class="artifact-fullscreen-title">' + esc(a.title) + '</span>' +
      '<span class="artifact-fullscreen-type">' + esc(a.type) + '</span>' +
      '<div class="artifact-fullscreen-actions">' +
        '<button onclick="switchArtifactView(\'code\')\" class="artifact-fullscreen-btn">Code</button>' +
        '<button onclick="switchArtifactView(\'preview\')\" class="artifact-fullscreen-btn">Preview</button>' +
        '<button onclick="downloadArtifact()" class="artifact-fullscreen-btn">Download</button>' +
        '<button onclick="closeArtifactFullscreen()" class="artifact-fullscreen-btn artifact-fullscreen-close">×</button>' +
      '</div></div><div class="artifact-fullscreen-body" id="artifactFullscreenBody"></div>';
    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    var fb = document.getElementById('artifactFullscreenBody');
    if (fb) _preview(fb, a.content, a.type);
    document.addEventListener('keydown', function escFn(e) { if (e.key === 'Escape') { closeArtifactFullscreen(); document.removeEventListener('keydown', escFn); } });
  }
  function closeArtifactFullscreen() {
    var ov = document.getElementById('artifactFullscreenOverlay'); if (ov) ov.remove();
    document.body.style.overflow = '';
    if (_panelVisible) _renderActiveContent();
  }
  function downloadArtifact() {
    var a = _activeArtifactId ? _artifacts[_activeArtifactId] : null; if (!a) return;
    var ext = {html:'.html',react:'.jsx',svg:'.svg',mermaid:'.mmd',markdown:'.md',javascript:'.js'}[a.type] || '.txt';
    var blob = new Blob([a.content], {type:'text/plain'});
    var url = URL.createObjectURL(blob);
    var lnk = document.createElement('a'); lnk.href = url; lnk.download = (a.title||'artifact').replace(/[^a-zA-Z0-9_-]/g,'_') + ext; lnk.click();
    URL.revokeObjectURL(url);
  }

  // ── ARTIFACT: Tag Parser ─────────────────────────────────────────────────────
  var _RE_BLOCK = /ARTIFACT:([a-zA-Z0-9_-]+)\|([a-zA-Z0-9_-]+)\|([^\n|]+)(?:\|(file:\/[^\n]+|https?:\/\/[^\n]+))?\n*```(\w*)\n([\s\S]*?)```/g;
  var _RE_INLINE = /ARTIFACT:([a-zA-Z0-9_-]+)\|([a-zA-Z0-9_-]+)\|([^\n|]+)(?:\|(file:\/[^\n]+|https?:\/\/[^\n]+))?\n([\s\S]*?)(?=\nARTIFACT:|$)/g;

  function extractArtifactsFromText(text) {
    var seen = {};
    text = text.replace(_RE_BLOCK, function(m, id, type, title, srcRaw, lang, content) {
      var src = srcRaw ? srcRaw.replace(/^file:/,'') : null;
      createArtifact(id, type || lang || 'code', title, content.trim(), src);
      seen[id] = true;
      return '';
    });
    text = text.replace(_RE_INLINE, function(m, id, type, title, srcRaw, content) {
      if (seen[id]) return '';
      createArtifact(id, type, title, (content||'').trim(), srcRaw ? srcRaw.replace(/^file:/,'') : null);
      seen[id] = true;
      return '';
    });
    return text;
  }

  // ── Streaming ────────────────────────────────────────────────────────────────
  function streamArtifactChunk(id, chunk) {
    var a = _artifacts[id]; if (!a) return;
    a.content = (a.content||'') + chunk;
    a.loading = false;
    if (_activeArtifactId === id && _panelVisible) _renderActiveContent();
  }
  function finalizeArtifact(id) {
    if (_activeArtifactId === id && _panelVisible) _renderActiveContent();
  }

  // ── Resize (simplified — right-edge drag, no rAF overhead) ───────────────────
  (function() {
    var resizing = false, startX = 0, startW = 0;
    document.addEventListener('mousedown', function(e) {
      if (!e.target || e.target.id !== 'artifactResize') return;
      resizing = true; startX = e.clientX; startW = _panelWidth;
      document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (!resizing) return;
      // Drag left = smaller, drag right = larger
      _panelWidth = Math.max(280, Math.min(900, startW + (e.clientX - startX)));
      var p = _panel(); if (p) p.style.width = _panelWidth + 'px';
    });
    document.addEventListener('mouseup', function() {
      if (!resizing) return;
      resizing = false;
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      _saveWidth();
    });
  })();

  // ── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    _loadWidth();
    window.createArtifact = createArtifact;
    window.closeArtifact = closeArtifact;
    window.switchArtifactTab = switchArtifactTab;
    window.switchArtifactView = switchArtifactView;
    window.toggleArtifactPanel = toggleArtifactPanel;
    window.showArtifactPanel = showArtifactPanel;
    window.hideArtifactPanel = hideArtifactPanel;
    window.artifactFullscreen = artifactFullscreen;
    window.closeArtifactFullscreen = closeArtifactFullscreen;
    window.downloadArtifact = downloadArtifact;
    window.streamArtifactChunk = streamArtifactChunk;
    window.finalizeArtifact = finalizeArtifact;
    window.extractArtifactsFromText = extractArtifactsFromText;
    window.updateArtifactContent = function(id, c, app) { var a = _artifacts[id]; if (!a) return; a.content = app ? (a.content||'') + c : c; a.loading = false; if (_activeArtifactId === id && _panelVisible) _renderActiveContent(); };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
