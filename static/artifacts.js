// ── Hermes WebUI Artifact System ───────────────────────────────────────────────
// Claude-style artifact panel with code/preview toggle, multiple tabs,
// streaming content updates, and fullscreen support.
//
// Tag format: ARTIFACT:id|type|title
//   id    — unique artifact id (reusing updates existing)
//   type  — html, svg, mermaid, markdown, react, code, text
//   title — display title (shown in tab)
//
// The content follows the ARTIFACT: tag as a fenced code block or until
// the next tag. Example:
//
//   ARTIFACT:my-chart|html|Sales Chart
//   ```html
//   <div class="chart">...</div>
//   ```
// ─────────────────────────────────────────────────────────────────────────────────

(function() {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────────
  const _artifacts = {};       // { id: { type, title, content, codeView, previewView } }
  const _artifactOrder = [];   // ordered list of artifact ids (for tab order)
  let _activeArtifactId = null;
  let _artifactViewMode = 'preview'; // 'preview' | 'code' | 'split'
  let _panelVisible = false;
  let _panelWidth = 420;       // px, persisted to localStorage

  // ── DOM refs (lazy) ──────────────────────────────────────────────────────────
  function _panel() { return document.getElementById('artifactPanel'); }
  function _tabs() { return document.getElementById('artifactTabs'); }
  function _body() { return document.getElementById('artifactBody'); }
  function _codeView() { return document.getElementById('artifactCodeView'); }
  function _previewView() { return document.getElementById('artifactPreviewView'); }
  function _handle() { return document.getElementById('artifactResize'); }

  // ── Persistence ──────────────────────────────────────────────────────────────
  function _loadWidth() {
    try {
      const v = localStorage.getItem('hermes-artifact-panel-width');
      if (v && !isNaN(v)) _panelWidth = Math.max(280, Math.min(900, parseInt(v)));
    } catch (_) {}
  }
  function _saveWidth() {
    try { localStorage.setItem('hermes-artifact-panel-width', String(_panelWidth)); } catch (_) {}
  }

  // ── Panel visibility ─────────────────────────────────────────────────────────
  function showArtifactPanel() {
    if (_panelVisible) return;
    _panelVisible = true;
    const p = _panel();
    if (!p) return;
    p.style.display = 'flex';
    p.style.width = _panelWidth + 'px';
    // Trigger reflow for transition
    p.offsetHeight;
    // Update toggle button state
    _updateToggleBtn();
  }

  function hideArtifactPanel() {
    if (!_panelVisible) return;
    _panelVisible = false;
    const p = _panel();
    if (!p) return;
    p.style.display = 'none';
    _updateToggleBtn();
  }

  function toggleArtifactPanel() {
    if (_panelVisible) hideArtifactPanel();
    else showArtifactPanel();
  }

  function _updateToggleBtn() {
    const btn = document.getElementById('btnArtifactPanelToggle');
    if (!btn) return;
    if (_panelVisible && _activeArtifactId) {
      btn.style.display = '';
      btn.setAttribute('aria-pressed', 'true');
      btn.classList.add('active');
    } else if (_panelVisible) {
      btn.style.display = '';
      btn.setAttribute('aria-pressed', 'true');
      btn.classList.add('active');
    } else {
      btn.setAttribute('aria-pressed', 'false');
      btn.classList.remove('active');
      // Keep visible but dim if there are artifacts
      if (Object.keys(_artifacts).length === 0) {
        btn.style.display = 'none';
      }
    }
  }

  // ── Artifact CRUD ────────────────────────────────────────────────────────────
  function createArtifact(id, type, title, content) {
    // Create or update
    const existing = _artifacts[id];
    _artifacts[id] = { type: type || 'code', title: title || id, content: content || '' };

    if (!existing) {
      _artifactOrder.push(id);
      _renderTabs();
      // Auto-show panel on first artifact
      if (_artifactOrder.length === 1) {
        showArtifactPanel();
        switchArtifactTab(id);
      }
    } else if (_activeArtifactId === id) {
      _renderActiveContent();
    }

    // Update tab title if content streamed
    if (existing && _activeArtifactId === id) {
      _renderTabs();
    }
    _updateToggleBtn();
  }

  function updateArtifactContent(id, content, append) {
    const a = _artifacts[id];
    if (!a) return;
    if (append) {
      a.content += content;
    } else {
      a.content = content;
    }
    if (_activeArtifactId === id) {
      _renderActiveContent();
    }
  }

  function closeArtifact(id) {
    delete _artifacts[id];
    const idx = _artifactOrder.indexOf(id);
    if (idx >= 0) _artifactOrder.splice(idx, 1);

    if (_activeArtifactId === id) {
      // Switch to next available tab
      const nextId = _artifactOrder[Math.min(idx, _artifactOrder.length - 1)];
      if (nextId) {
        switchArtifactTab(nextId);
      } else {
        _activeArtifactId = null;
        _renderEmpty();
        hideArtifactPanel();
      }
    }
    _renderTabs();
    _updateToggleBtn();
  }

  function switchArtifactTab(id) {
    _activeArtifactId = id;
    _renderTabs();
    _renderActiveContent();
    if (!_panelVisible) showArtifactPanel();
  }

  function switchArtifactView(mode) {
    if (mode) {
      _artifactViewMode = mode;
    } else {
      // Cycle: preview → code → split → preview
      if (_artifactViewMode === 'preview') _artifactViewMode = 'code';
      else if (_artifactViewMode === 'code') _artifactViewMode = 'split';
      else _artifactViewMode = 'preview';
    }
    _renderActiveContent();
  }

  // ── Rendering ────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function _renderTabs() {
    const t = _tabs();
    if (!t) return;
    let html = '';
    for (const id of _artifactOrder) {
      const a = _artifacts[id];
      if (!a) continue;
      const active = id === _activeArtifactId ? ' active' : '';
      const typeIcon = _typeIcon(a.type);
      html += '<button class="artifact-tab' + active + '" onclick="switchArtifactTab(\'' + esc(id) + '\')" title="' + esc(a.title) + '">';
      html += '<span class="artifact-tab-icon">' + typeIcon + '</span>';
      html += '<span class="artifact-tab-title">' + esc(a.title) + '</span>';
      html += '<span class="artifact-tab-close" onclick="event.stopPropagation();closeArtifact(\'' + esc(id) + '\')" title="Close">&times;</span>';
      html += '</button>';
    }
    t.innerHTML = html;
  }

  function _typeIcon(type) {
    const icons = {
      html: '&#60;&#62;',
      react: '&#9883;',
      svg: '&#9638;',
      mermaid: '&#9671;',
      markdown: '&#9998;',
      code: '{}',
      text: '&#182;',
    };
    return icons[type] || icons.code;
  }

  function _renderEmpty() {
    const b = _body();
    const cv = _codeView();
    const pv = _previewView();
    const emp = document.getElementById('artifactEmpty');
    if (emp) emp.style.display = 'flex';
    if (b) b.style.display = 'none';
    if (cv) cv.innerHTML = '';
    if (pv) pv.innerHTML = '';
  }

  function _renderActiveContent() {
    const id = _activeArtifactId;
    const a = id ? _artifacts[id] : null;
    const b = _body();
    const cv = _codeView();
    const pv = _previewView();
    const emp = document.getElementById('artifactEmpty');

    if (!a) {
      _renderEmpty();
      return;
    }

    // Hide empty state, show body
    if (emp) emp.style.display = 'none';
    if (b) b.style.display = '';

    const content = a.content || '';
    const type = a.type || 'code';

    // Update body display based on view mode
    if (b) {
      b.className = 'artifact-body view-' + _artifactViewMode;
    }

    // Update view toggle button
    const viewBtn = document.getElementById('btnArtifactViewToggle');
    if (viewBtn) {
      viewBtn.textContent = _artifactViewMode === 'preview' ? 'Code' :
                            _artifactViewMode === 'code' ? 'Preview' :
                            _artifactViewMode === 'split' ? 'Code' : 'Preview';
    }

    // Show/hide views
    if (_artifactViewMode === 'code') {
      if (cv) { cv.style.display = ''; _setCodeContent(cv, content, type); }
      if (pv) { pv.style.display = 'none'; _setPreviewContent(pv, '', type); }
    } else if (_artifactViewMode === 'preview') {
      if (cv) { cv.style.display = 'none'; _setCodeContent(cv, '', type); }
      if (pv) { pv.style.display = ''; _setPreviewContent(pv, content, type); }
    } else { // split
      if (cv) { cv.style.display = ''; _setCodeContent(cv, content, type); }
      if (pv) { pv.style.display = ''; _setPreviewContent(pv, content, type); }
    }
  }

  function _setCodeContent(el, content, type) {
    const langMap = { html: 'html', react: 'jsx', svg: 'xml', mermaid: 'mermaid', markdown: 'md', javascript: 'js', code: '', text: '' };
    const lang = langMap[type] || '';
    el.innerHTML = '<pre class="artifact-code-pre"><code class="' + (lang ? 'language-' + lang : '') + '">' + esc(content) + '</code></pre>';
    // Trigger syntax highlighting if Prism is available
    if (typeof Prism !== 'undefined' && Prism.highlightElement) {
      const codeEl = el.querySelector('code');
      if (codeEl) {
        try { Prism.highlightElement(codeEl); } catch (_) {}
      }
    }
  }

  function _setPreviewContent(el, content, type) {
    if (!content) {
      el.innerHTML = '<div class="artifact-preview-placeholder">No content to preview</div>';
      return;
    }
    switch (type) {
      case 'html':
      case 'react':
        _renderHtmlPreview(el, content);
        break;
      case 'svg':
        _renderSvgPreview(el, content);
        break;
      case 'mermaid':
        _renderMermaidPreview(el, content);
        break;
      case 'markdown':
        _renderMarkdownPreview(el, content);
        break;
      case 'code':
      case 'text':
      default:
        _renderTextPreview(el, content, type);
        break;
    }
  }

  function _renderHtmlPreview(el, content) {
    // Sandboxed iframe with srcdoc
    const iframe = document.createElement('iframe');
    iframe.className = 'artifact-preview-iframe';
    iframe.sandbox = 'allow-scripts allow-same-origin';
    iframe.srcdoc = content;
    iframe.title = 'Artifact preview';
    el.innerHTML = '';
    el.appendChild(iframe);
  }

  function _renderSvgPreview(el, content) {
    // Extract SVG from markdown code block if needed
    let svg = content;
    if (svg.startsWith('```')) {
      svg = svg.replace(/^```.*?\n/, '').replace(/\n```$/, '');
    }
    el.innerHTML = '<div class="artifact-preview-svg">' + svg + '</div>';
  }

  function _renderMermaidPreview(el, content) {
    const id = 'mermaid-' + Math.random().toString(36).slice(2, 10);
    el.innerHTML = '<div class="mermaid-block" data-mermaid-id="' + id + '">' + esc(content) + '</div>';
    // Render mermaid if available
    if (typeof mermaid !== 'undefined') {
      try {
        mermaid.run({ nodes: [el.querySelector('.mermaid-block')] });
      } catch (_) {}
    }
  }

  function _renderMarkdownPreview(el, content) {
    // Use the existing renderMd if available
    if (typeof renderMd === 'function') {
      el.innerHTML = renderMd(content);
    } else {
      el.innerHTML = '<pre class="artifact-preview-text">' + esc(content) + '</pre>';
    }
  }

  function _renderTextPreview(el, content, type) {
    const langMap = { javascript: 'js', code: '' };
    const lang = langMap[type] || '';
    el.innerHTML = '<pre class="artifact-code-pre"><code class="' + (lang ? 'language-' + lang : '') + '">' + esc(content) + '</code></pre>';
    if (typeof Prism !== 'undefined' && Prism.highlightElement) {
      const codeEl = el.querySelector('code');
      if (codeEl) {
        try { Prism.highlightElement(codeEl); } catch (_) {}
      }
    }
  }

  // ── Fullscreen ───────────────────────────────────────────────────────────────
  function artifactFullscreen() {
    const id = _activeArtifactId;
    if (!id) return;
    const a = _artifacts[id];
    if (!a) return;

    const overlay = document.createElement('div');
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

    // Render content in fullscreen
    const fsBody = document.getElementById('artifactFullscreenBody');
    if (fsBody) {
      _setPreviewContent(fsBody, a.content, a.type);
    }

    // Escape key to close
    function onKey(e) {
      if (e.key === 'Escape') {
        closeArtifactFullscreen();
        document.removeEventListener('keydown', onKey);
      }
    }
    document.addEventListener('keydown', onKey);
  }

  function closeArtifactFullscreen() {
    const overlay = document.getElementById('artifactFullscreenOverlay');
    if (overlay) overlay.remove();
    document.body.style.overflow = '';
    _renderActiveContent(); // Refresh the panel view
  }

  // ── Download ─────────────────────────────────────────────────────────────────
  function downloadArtifact() {
    const id = _activeArtifactId;
    if (!id) return;
    const a = _artifacts[id];
    if (!a) return;

    const extMap = { html: '.html', react: '.jsx', svg: '.svg', mermaid: '.mmd', markdown: '.md', javascript: '.js', code: '.txt', text: '.txt' };
    const ext = extMap[a.type] || '.txt';
    const filename = (a.title || id).replace(/[^a-zA-Z0-9_-]/g, '_') + ext;

    const blob = new Blob([a.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  // ── ARTIFACT: Tag Parser ─────────────────────────────────────────────────────
  // Called during message rendering to extract artifact tags.
  // Returns the text with artifact tags removed, and populates _artifacts.

  const _ARTIFACT_TAG_RE = /ARTIFACT:([a-zA-Z0-9_-]+)\|([a-zA-Z0-9_-]+)\|([^\n]+)/;

  function extractArtifactsFromText(text) {
    // Find ARTIFACT:id|type|title followed by a fenced code block
    let modified = text;
    const seen = new Set();

    // Match ARTIFACT: tag + optional content in next fenced block
    const blockRe = /ARTIFACT:([a-zA-Z0-9_-]+)\|([a-zA-Z0-9_-]+)\|([^\n]+)\n*```(\w*)\n([\s\S]*?)```/g;
    modified = modified.replace(blockRe, function(match, id, type, title, lang, content) {
      createArtifact(id, type || lang || 'code', title, content.trim());
      seen.add(id);
      return ''; // Remove from rendered text
    });

    // Also handle ARTIFACT: tags without a code block (just take the rest)
    // ARTIFACT:id|type|title on its own line, content is everything after until next tag
    const inlineRe = /ARTIFACT:([a-zA-Z0-9_-]+)\|([a-zA-Z0-9_-]+)\|([^\n]+)\n([\s\S]*?)(?=\nARTIFACT:|$)/g;
    modified = modified.replace(inlineRe, function(match, id, type, title, content) {
      if (!seen.has(id)) {
        createArtifact(id, type, title, content.trim());
        seen.add(id);
      }
      return ''; // Remove from rendered text
    });

    return modified;
  }

  // ── Streaming support ────────────────────────────────────────────────────────
  // Called during SSE streaming to incrementally build artifact content
  function streamArtifactChunk(id, chunk) {
    updateArtifactContent(id, chunk, true);
  }

  function finalizeArtifact(id) {
    // Called when streaming is complete
    // Future: could trigger syntax highlighting or re-render
    if (_activeArtifactId === id) {
      _renderActiveContent();
    }
  }

  // ── Panel resize ─────────────────────────────────────────────────────────────
  let _resizing = false;
  let _resizeStartX = 0;
  let _resizeStartWidth = 0;

  function _initResize() {
    const h = _handle();
    if (!h) return;

    h.addEventListener('mousedown', function(e) {
      _resizing = true;
      _resizeStartX = e.clientX;
      _resizeStartWidth = _panelWidth;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', function(e) {
      if (!_resizing) return;
      const delta = _resizeStartX - e.clientX;
      _panelWidth = Math.max(280, Math.min(900, _resizeStartWidth + delta));
      const p = _panel();
      if (p) p.style.width = _panelWidth + 'px';
    });

    document.addEventListener('mouseup', function() {
      if (!_resizing) return;
      _resizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      _saveWidth();
    });
  }

  // ── Init ─────────────────────────────────────────────────────────────────────
  function initArtifactPanel() {
    _loadWidth();
    _initResize();
    // Export global functions
    window.openArtifact = createArtifact;
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
    window.updateArtifactContent = updateArtifactContent;
  }

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initArtifactPanel);
  } else {
    initArtifactPanel();
  }

})();
