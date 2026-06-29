// ── Hermes WebUI Artifact System ───────────────────────────────────────────────
// Claude-style artifact panel with code/preview toggle, multiple tabs,
// streaming content updates, file loading, and fullscreen support.
//
// Tag formats:
//   ARTIFACT:id|type|title              — inline content follows in fenced block
//   ARTIFACT:id|type|title|file:/path   — loads content from local file
//   ARTIFACT:id|type|title|https://...  — loads content from URL
//
// Supported types: html, react, svg, mermaid, markdown, javascript, code, text
// ─────────────────────────────────────────────────────────────────────────────────

(function() {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────────
  const _artifacts = {};
  const _artifactOrder = [];
  let _activeArtifactId = null;
  let _artifactViewMode = 'preview';
  let _panelVisible = false;
  let _panelWidth = 420;

  // ── DOM refs ─────────────────────────────────────────────────────────────────
  function _panel() { return document.getElementById('artifactPanel'); }
  function _tabs() { return document.getElementById('artifactTabs'); }
  function _body() { return document.getElementById('artifactBody'); }
  function _codeView() { return document.getElementById('artifactCodeView'); }
  function _previewView() { return document.getElementById('artifactPreviewView'); }

  function _loadWidth() {
    try { var v = localStorage.getItem('hermes-artifact-panel-width'); if (v && !isNaN(v)) _panelWidth = Math.max(280, Math.min(900, parseInt(v))); } catch (_) {}
  }
  function _saveWidth() {
    try { localStorage.setItem('hermes-artifact-panel-width', String(_panelWidth)); } catch (_) {}
  }

  // ── Panel visibility ─────────────────────────────────────────────────────────
  function showArtifactPanel() {
    if (_panelVisible) return;
    _panelVisible = true;
    var p = _panel(); if (!p) return;
    p.style.display = 'flex'; p.style.width = _panelWidth + 'px';
    _updateToggleBtn();
  }
  function hideArtifactPanel() {
    if (!_panelVisible) return;
    _panelVisible = false;
    var p = _panel(); if (!p) return;
    p.style.display = 'none';
    _updateToggleBtn();
  }
  function toggleArtifactPanel() {
    if (_panelVisible) hideArtifactPanel(); else showArtifactPanel();
  }
  function _updateToggleBtn() {
    var btn = document.getElementById('btnArtifactPanelToggle'); if (!btn) return;
    if (Object.keys(_artifacts).length === 0) { btn.style.display = 'none'; return; }
    btn.style.display = '';
    btn.setAttribute('aria-pressed', _panelVisible ? 'true' : 'false');
    if (_panelVisible) btn.classList.add('active'); else btn.classList.remove('active');
  }

  // ── Artifact CRUD ────────────────────────────────────────────────────────────
  function createArtifact(id, type, title, content, src) {
    var existing = _artifacts[id];
    _artifacts[id] = { type: type || 'code', title: title || id, content: content || '', src: src || null };
    if (!existing) {
      _artifactOrder.push(id);
      _renderTabs();
      // Don't auto-show — user opens panel manually via star button
      if (_activeArtifactId) _renderTabs();
    } else if (_activeArtifactId === id) {
      _renderActiveContent();
    }
    if (existing && _activeArtifactId === id) { _renderTabs(); }
    _updateToggleBtn();

    // If src is set, load content asynchronously
    if (src) _loadArtifactSrc(id, src);
  }

  function _loadArtifactSrc(id, src) {
    // Convert local file path to api/media endpoint
    var url = src;
    if (src.indexOf('://') === -1 && src.indexOf('/') === 0) {
      url = 'api/media?path=' + encodeURIComponent(src) + '&inline=1';
    }
    fetch(url).then(function(r) {
      if (!r.ok) throw new Error('Failed to load');
      return r.text();
    }).then(function(text) {
      _artifacts[id].content = text;
      if (_activeArtifactId === id) _renderActiveContent();
    }).catch(function(err) {
      _artifacts[id].content = '/* Failed to load: ' + src + ' — ' + err.message + ' */';
      if (_activeArtifactId === id) _renderActiveContent();
    });
  }

  function updateArtifactContent(id, content, append) {
    var a = _artifacts[id]; if (!a) return;
    a.content = append ? (a.content + content) : content;
    if (_activeArtifactId === id) _renderActiveContent();
  }

  function closeArtifact(id) {
    delete _artifacts[id];
    var idx = _artifactOrder.indexOf(id); if (idx >= 0) _artifactOrder.splice(idx, 1);
    if (_activeArtifactId === id) {
      var nextId = _artifactOrder[Math.min(idx, _artifactOrder.length - 1)];
      if (nextId) switchArtifactTab(nextId);
      else { _activeArtifactId = null; _renderEmpty(); hideArtifactPanel(); }
    }
    _renderTabs(); _updateToggleBtn();
  }

  function switchArtifactTab(id) {
    _activeArtifactId = id; _renderTabs(); _renderActiveContent();
    if (!_panelVisible) showArtifactPanel();
  }

  function switchArtifactView(mode) {
    if (mode) { _artifactViewMode = mode; }
    else { _artifactViewMode = _artifactViewMode === 'preview' ? 'code' : _artifactViewMode === 'code' ? 'split' : 'preview'; }
    _renderActiveContent();
  }

  // ── Rendering ────────────────────────────────────────────────────────────────
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function _renderTabs() {
    var t = _tabs(); if (!t) return;
    var html = '';
    for (var i = 0; i < _artifactOrder.length; i++) {
      var id = _artifactOrder[i], a = _artifacts[id]; if (!a) continue;
      var active = id === _activeArtifactId ? ' active' : '';
      html += '<button class="artifact-tab' + active + '" onclick="switchArtifactTab(\'' + esc(id) + '\')" title="' + esc(a.title) + '">';
      html += '<span class="artifact-tab-title">' + esc(a.title) + '</span>';
      html += '<span class="artifact-tab-close" onclick="event.stopPropagation();closeArtifact(\'' + esc(id) + '\')" title="Close">&times;</span>';
      html += '</button>';
    }
    t.innerHTML = html;
  }

  function _renderEmpty() {
    var b = _body(), cv = _codeView(), pv = _previewView(), emp = document.getElementById('artifactEmpty');
    if (emp) emp.style.display = 'flex';
    if (b) b.style.display = 'none';
    if (cv) cv.innerHTML = ''; if (pv) pv.innerHTML = '';
  }

  function _renderActiveContent() {
    var id = _activeArtifactId, a = id ? _artifacts[id] : null;
    var b = _body(), cv = _codeView(), pv = _previewView(), emp = document.getElementById('artifactEmpty');
    if (!a) { _renderEmpty(); return; }
    if (emp) emp.style.display = 'none';
    if (b) { b.style.display = ''; b.className = 'artifact-body view-' + _artifactViewMode; }

    var content = a.content || '', type = a.type || 'code';
    var loading = a.src && !content;

    var viewBtn = document.getElementById('btnArtifactViewToggle');
    if (viewBtn) viewBtn.textContent = _artifactViewMode === 'preview' ? 'Code' : _artifactViewMode === 'code' ? 'Preview' : 'Code';

    if (_artifactViewMode === 'code') {
      if (cv) { cv.style.display = ''; _setCodeContent(cv, loading ? 'Loading...' : content, type); }
      if (pv) { pv.style.display = 'none'; _setPreviewContent(pv, '', type); }
    } else if (_artifactViewMode === 'preview') {
      if (cv) { cv.style.display = 'none'; _setCodeContent(cv, '', type); }
      if (pv) { pv.style.display = ''; _setPreviewContent(pv, loading ? 'Loading...' : content, type); }
    } else {
      if (cv) { cv.style.display = ''; _setCodeContent(cv, loading ? 'Loading...' : content, type); }
      if (pv) { pv.style.display = ''; _setPreviewContent(pv, loading ? 'Loading...' : content, type); }
    }
  }

  function _setCodeContent(el, content, type) {
    var langMap = { html: 'html', react: 'jsx', svg: 'xml', mermaid: 'mermaid', markdown: 'md', javascript: 'js', code: '', text: '' };
    var lang = langMap[type] || '';
    el.innerHTML = '<pre class="artifact-code-pre"><code class="' + (lang ? 'language-' + lang : '') + '">' + esc(content) + '</code></pre>';
    if (typeof Prism !== 'undefined' && Prism.highlightElement) {
      var codeEl = el.querySelector('code'); if (codeEl) try { Prism.highlightElement(codeEl); } catch (_) {}
    }
  }

  function _setPreviewContent(el, content, type) {
    if (!content) { el.innerHTML = '<div class="artifact-preview-placeholder">Loading...</div>'; return; }
    switch (type) {
      case 'html': case 'react': _renderHtmlPreview(el, content); break;
      case 'svg': _renderSvgPreview(el, content); break;
      case 'mermaid': _renderMermaidPreview(el, content); break;
      case 'markdown': _renderMarkdownPreview(el, content); break;
      default: _renderTextPreview(el, content, type); break;
    }
  }

  function _renderHtmlPreview(el, content) {
    var iframe = document.createElement('iframe');
    iframe.className = 'artifact-preview-iframe';
    iframe.sandbox = 'allow-scripts allow-same-origin';
    iframe.srcdoc = content;
    iframe.title = 'Artifact preview';
    el.innerHTML = ''; el.appendChild(iframe);
  }

  function _renderSvgPreview(el, content) {
    var svg = content;
    if (svg.indexOf('```') === 0) svg = svg.replace(/^```.*?\n/, '').replace(/\n```$/, '');
    el.innerHTML = '<div class="artifact-preview-svg">' + svg + '</div>';
  }

  function _renderMermaidPreview(el, content) {
    var id = 'mermaid-' + Math.random().toString(36).slice(2, 10);
    el.innerHTML = '<div class="mermaid-block" data-mermaid-id="' + id + '">' + esc(content) + '</div>';
    if (typeof mermaid !== 'undefined') try { mermaid.run({ nodes: [el.querySelector('.mermaid-block')] }); } catch (_) {}
  }

  function _renderMarkdownPreview(el, content) {
    el.innerHTML = typeof renderMd === 'function' ? renderMd(content) : '<pre class="artifact-preview-text">' + esc(content) + '</pre>';
  }

  function _renderTextPreview(el, content, type) {
    var langMap = { javascript: 'js', code: '' }, lang = langMap[type] || '';
    el.innerHTML = '<pre class="artifact-code-pre"><code class="' + (lang ? 'language-' + lang : '') + '">' + esc(content) + '</code></pre>';
    if (typeof Prism !== 'undefined' && Prism.highlightElement) {
      var codeEl = el.querySelector('code'); if (codeEl) try { Prism.highlightElement(codeEl); } catch (_) {}
    }
  }

  // ── Fullscreen / Download ────────────────────────────────────────────────────
  function artifactFullscreen() {
    var id = _activeArtifactId, a = id ? _artifacts[id] : null; if (!a) return;
    var overlay = document.createElement('div');
    overlay.className = 'artifact-fullscreen-overlay';
    overlay.id = 'artifactFullscreenOverlay';
    overlay.innerHTML = '<div class="artifact-fullscreen-header">' +
      '<span class="artifact-fullscreen-title">' + esc(a.title) + '</span>' +
      '<span class="artifact-fullscreen-type">' + esc(a.type) + '</span>' +
      '<div class="artifact-fullscreen-actions">' +
        '<button onclick="switchArtifactView(\'code\')\" class="artifact-fullscreen-btn">Code</button>' +
        '<button onclick="switchArtifactView(\'preview\')\" class="artifact-fullscreen-btn">Preview</button>' +
        '<button onclick="switchArtifactView(\'split\')\" class="artifact-fullscreen-btn">Split</button>' +
        '<button onclick="downloadArtifact()" class="artifact-fullscreen-btn">Download</button>' +
        '<button onclick="closeArtifactFullscreen()" class="artifact-fullscreen-btn artifact-fullscreen-close">&times;</button>' +
      '</div></div>' +
      '<div class="artifact-fullscreen-body view-preview" id="artifactFullscreenBody"></div>';
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    var fsBody = document.getElementById('artifactFullscreenBody');
    if (fsBody) _setPreviewContent(fsBody, a.content, a.type);
    document.addEventListener('keydown', function onKey(e) { if (e.key === 'Escape') { closeArtifactFullscreen(); document.removeEventListener('keydown', onKey); } });
  }
  function closeArtifactFullscreen() {
    var overlay = document.getElementById('artifactFullscreenOverlay'); if (overlay) overlay.remove();
    document.body.style.overflow = ''; _renderActiveContent();
  }
  function downloadArtifact() {
    var id = _activeArtifactId, a = id ? _artifacts[id] : null; if (!a) return;
    var extMap = { html: '.html', react: '.jsx', svg: '.svg', mermaid: '.mmd', markdown: '.md', javascript: '.js', code: '.txt', text: '.txt' };
    var filename = (a.title || id).replace(/[^a-zA-Z0-9_-]/g, '_') + (extMap[a.type] || '.txt');
    var blob = new Blob([a.content], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    URL.revokeObjectURL(url);
  }

  // ── ARTIFACT: Tag Parser ─────────────────────────────────────────────────────
  var _ARTIFACT_BLOCK_RE = /ARTIFACT:([a-zA-Z0-9_-]+)\|([a-zA-Z0-9_-]+)\|([^\n|]+)(?:\|(file:\/[^\n]+|https?:\/\/[^\n]+))?\n*```(\w*)\n([\s\S]*?)```/g;
  var _ARTIFACT_INLINE_RE = /ARTIFACT:([a-zA-Z0-9_-]+)\|([a-zA-Z0-9_-]+)\|([^\n|]+)(?:\|(file:\/[^\n]+|https?:\/\/[^\n]+))?\n([\s\S]*?)(?=\nARTIFACT:|$)/g;

  function extractArtifactsFromText(text) {
    var seen = {};
    // Block format: ARTIFACT: tag + fenced block
    text = text.replace(_ARTIFACT_BLOCK_RE, function(m, id, type, title, srcRaw, lang, content) {
      var src = srcRaw ? srcRaw.replace(/^file:/, '') : null;
      createArtifact(id, type || lang || 'code', title, content.trim(), src);
      seen[id] = true;
      return '';
    });
    // Inline format: ARTIFACT: tag without fenced block
    text = text.replace(_ARTIFACT_INLINE_RE, function(m, id, type, title, srcRaw, content) {
      if (seen[id]) return '';
      var src = srcRaw ? srcRaw.replace(/^file:/, '') : null;
      createArtifact(id, type, title, (content || '').trim(), src);
      seen[id] = true;
      return '';
    });
    return text;
  }

  // ── Streaming ────────────────────────────────────────────────────────────────
  function streamArtifactChunk(id, chunk) { updateArtifactContent(id, chunk, true); }
  function finalizeArtifact(id) { if (_activeArtifactId === id) _renderActiveContent(); }

  // ── Panel resize ─────────────────────────────────────────────────────────────
  var _resizing = false, _resizeStartX = 0, _resizeStartWidth = 0;
  function _initResize() {
    var h = document.getElementById('artifactResize'); if (!h) return;
    h.addEventListener('mousedown', function(e) {
      _resizing = true; _resizeStartX = e.clientX; _resizeStartWidth = _panelWidth;
      document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; e.preventDefault();
    });
    document.addEventListener('mousemove', function(e) {
      if (!_resizing) return;
      _panelWidth = Math.max(280, Math.min(900, _resizeStartWidth + (_resizeStartX - e.clientX)));
      var p = _panel(); if (p) p.style.width = _panelWidth + 'px';
    });
    document.addEventListener('mouseup', function() {
      if (!_resizing) return; _resizing = false;
      document.body.style.cursor = ''; document.body.style.userSelect = ''; _saveWidth();
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  function initArtifactPanel() {
    _loadWidth(); _initResize();
    window.createArtifact = createArtifact;
    window.openArtifact = createArtifact;
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
    window.updateArtifactContent = updateArtifactContent;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initArtifactPanel);
  } else {
    initArtifactPanel();
  }
})();
