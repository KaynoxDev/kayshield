/*
 * EnvShield secure editor - webview script.
 *
 * SECURITY MODEL
 * --------------
 * This script never has access to the file. It receives:
 *   - a masked snapshot (`init` / `update`): secrets are mask characters,
 *   - individual plaintext values (`value`), one per explicit user reveal,
 *   - orders to forget them again (`mask`).
 *
 * Consequences that matter:
 *   - the search box filters variable NAMES only; it cannot match a value,
 *     because the values are not here,
 *   - nothing is written to localStorage or sessionStorage,
 *   - closing or hiding the tab destroys this context and every revealed value
 *     with it (the panel is created with retainContextWhenHidden: false).
 *
 * No framework, no dependency: this file is the whole UI runtime.
 */

/* global acquireVsCodeApi, document, window */
(function () {
  'use strict';

  const vscode = acquireVsCodeApi();
  const payloadNode = document.getElementById('envshield-payload');
  const initial = JSON.parse(payloadNode.textContent);

  /** @type {Record<string,string>} */
  const t = initial.strings;

  /** Latest masked snapshot. Never contains a secret value. */
  let variables = initial.variables;
  let state = initial.state;

  /** Plaintext values the user explicitly revealed, kept in memory only. */
  const revealed = new Map();

  /** Id of the row currently being edited, or null. */
  let editingId = null;
  let addingVariable = false;
  let query = '';
  let toastTimer;

  /* ------------------------------------------------------------ icons --- */
  /* Codicon-derived glyphs inlined as SVG: no font to ship, no extra request,
     and they inherit the theme colour through `currentColor`. */
  const ICONS = {
    shield:
      '<path d="M8 1 2 3.2v4.3c0 3.4 2.4 6.5 6 7.5 3.6-1 6-4.1 6-7.5V3.2L8 1zm0 1.6 4.5 1.6v3.3c0 2.7-1.8 5.2-4.5 6.1-2.7-.9-4.5-3.4-4.5-6.1V4.2L8 2.6z"/>',
    eye: '<path d="M8 3C4.5 3 1.6 5.1.5 8c1.1 2.9 4 5 7.5 5s6.4-2.1 7.5-5c-1.1-2.9-4-5-7.5-5zm0 8.5A3.5 3.5 0 1 1 8 4.5a3.5 3.5 0 0 1 0 7zm0-5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>',
    eyeClosed:
      '<path d="M2.1 2 1 3.1l2.2 2.2A9 9 0 0 0 .5 8c1.1 2.9 4 5 7.5 5 1.3 0 2.6-.3 3.7-.8l2 2 1.1-1.1L2.1 2zm3.2 5.4 3.3 3.3a2 2 0 0 1-3.3-3.3zM8 3c-.9 0-1.7.1-2.5.4l1.3 1.3A3.5 3.5 0 0 1 11.3 9l2.2 2.2A9 9 0 0 0 15.5 8C14.4 5.1 11.5 3 8 3z"/>',
    copy: '<path d="M4 1h7l3 3v8h-3v3H2V4h2V1zm1 1v9h6V4.6L9.4 3H8v2H5.6L5 2zm-2 3v9h6v-2H4V5H3z"/>',
    edit: '<path d="M13.2 1.5 14.5 2.8c.4.4.4 1 0 1.4l-8.6 8.6-3.4.7.7-3.4 8.6-8.6c.4-.4 1-.4 1.4 0zM4 10.6l-.3 1.7 1.7-.3 7.3-7.3-1.4-1.4L4 10.6z"/>',
    trash:
      '<path d="M6 2h4l.5 1H14v1.5H2V3h3.5L6 2zM3.5 5.5h9L12 14H4l-.5-8.5zM6 7v5.5h1.2V7H6zm2.8 0v5.5H10V7H8.8z"/>',
    add: '<path d="M7.25 3h1.5v4.25H13v1.5H8.75V13h-1.5V8.75H3v-1.5h4.25V3z"/>',
    search:
      '<path d="M10.5 6.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0zm-.9 4.2a5.5 5.5 0 1 1 1.1-1.1l3.6 3.6-1.1 1.1-3.6-3.6z"/>',
    broadcast:
      '<path d="M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm-4.2-2.6.9 1.1a4.5 4.5 0 0 0 0 7l-.9 1.1a6 6 0 0 1 0-9.2zm8.4 0a6 6 0 0 1 0 9.2l-.9-1.1a4.5 4.5 0 0 0 0-7l.9-1.1z"/>',
    text: '<path d="M3 2h10v2h-1V3H8.6v10H10v1H6v-1h1.4V3H4v1H3V2z"/>',
  };

  function icon(name, extraClass) {
    // NOTE: `icon` is a generic class shared by every glyph. Never write a
    // positioning rule for a descendant `.icon`: a wrapper carrying the same
    // class would also match, and the glyph would be offset twice.
    const classes = extraClass ? 'icon ' + extraClass : 'icon';
    return (
      '<svg class="' +
      classes +
      '" width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" focusable="false">' +
      ICONS[name] +
      '</svg>'
    );
  }

  /* ------------------------------------------------------------ utils --- */

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function format(template, ...args) {
    return template.replace(/\{(\d+)\}/g, (match, index) => {
      const value = args[Number(index)];
      return value === undefined ? match : String(value);
    });
  }

  function severityLabel(severity) {
    switch (severity) {
      case 'secret':
        return t.severitySecret;
      case 'sensitive':
        return t.severitySensitive;
      case 'suspicious':
        return t.severitySuspicious;
      default:
        return t.severityNormal;
    }
  }

  function post(message) {
    vscode.postMessage(message);
  }

  /* ----------------------------------------------------------- render --- */

  const app = document.getElementById('app');

  function visibleVariables() {
    if (query === '') {
      return variables;
    }
    const needle = query.toLowerCase();
    // Names only. Values are not available here, by design.
    return variables.filter((variable) => variable.key.toLowerCase().includes(needle));
  }

  function renderHeader() {
    const badge = state.streamerMode
      ? '<span class="badge stream-on" role="status"><span class="dot"></span>' +
        escapeHtml(t.streamOn) +
        '</span>'
      : '<span class="badge protected">' +
        escapeHtml(format(t.protectedSummary, state.secretCount, state.totalCount)) +
        '</span>';

    return (
      '<header class="header">' +
      icon('shield') +
      '<h1>' +
      escapeHtml(t.title) +
      '</h1>' +
      '<span class="file-name">' +
      escapeHtml(state.fileName) +
      '</span>' +
      '<span class="spacer"></span>' +
      badge +
      '</header>'
    );
  }

  function renderToolbar() {
    return (
      '<div class="toolbar">' +
      '<div class="search">' +
      '<span class="search-icon">' +
      icon('search') +
      '</span>' +
      '<input id="search" type="search" autocomplete="off" spellcheck="false" ' +
      'placeholder="' +
      escapeHtml(t.searchPlaceholder) +
      '" aria-label="' +
      escapeHtml(t.searchPlaceholder) +
      '" aria-describedby="search-note" value="' +
      escapeHtml(query) +
      '" />' +
      '</div>' +
      '<span id="search-note" class="visually-hidden">' +
      escapeHtml(t.searchNote) +
      '</span>' +
      '<span class="spacer"></span>' +
      '</div>'
    );
  }

  function renderNotice() {
    if (state.streamerMode) {
      return '<p class="notice" role="status">' + escapeHtml(t.streamHint) + '</p>';
    }
    if (state.isTemplate) {
      return '<p class="notice">' + escapeHtml(t.templateHint) + '</p>';
    }
    return '';
  }

  /**
   * True when this row should display a plaintext value.
   *
   * Holding a value in `revealed` is what decides, not the `masked` flag from
   * the snapshot: the flag says what the host thinks, the map says what we
   * actually have. The host clears the map through `mask` and `update`, so it
   * stays authoritative, but a value that arrived without a matching snapshot
   * still displays instead of silently doing nothing.
   */
  function isShowingPlaintext(variable) {
    return revealed.has(variable.id) || (variable.secret && !variable.masked);
  }

  function renderValueCell(variable) {
    if (variable.empty) {
      return '<td class="value empty">' + escapeHtml(t.empty) + '</td>';
    }
    if (revealed.has(variable.id)) {
      return '<td class="value">' + escapeHtml(revealed.get(variable.id)) + '</td>';
    }
    if (variable.masked) {
      return (
        '<td class="value masked" aria-label="' +
        escapeHtml(severityLabel(variable.severity)) +
        '">' +
        escapeHtml(variable.display) +
        '</td>'
      );
    }
    return '<td class="value">' + escapeHtml(variable.display) + '</td>';
  }

  function renderActions(variable) {
    const buttons = [];

    if (variable.secret) {
      const revealing = isShowingPlaintext(variable);
      const label = format(revealing ? t.hide : t.reveal, variable.key);
      buttons.push(
        '<button class="icon-button" data-action="' +
          (revealing ? 'hide' : 'reveal') +
          '" data-id="' +
          escapeHtml(variable.id) +
          '" aria-pressed="' +
          (revealing ? 'true' : 'false') +
          '" title="' +
          escapeHtml(label) +
          '" aria-label="' +
          escapeHtml(label) +
          '"' +
          (state.streamerMode ? ' disabled' : '') +
          '>' +
          icon(revealing ? 'eyeClosed' : 'eye') +
          '</button>',
      );
    }

    buttons.push(
      '<button class="icon-button" data-action="copy" data-id="' +
        escapeHtml(variable.id) +
        '" title="' +
        escapeHtml(format(t.copy, variable.key)) +
        '" aria-label="' +
        escapeHtml(format(t.copy, variable.key)) +
        '">' +
        icon('copy') +
        '</button>',
    );

    if (!state.readOnly) {
      buttons.push(
        '<button class="icon-button" data-action="startEdit" data-id="' +
          escapeHtml(variable.id) +
          '" title="' +
          escapeHtml(format(t.edit, variable.key)) +
          '" aria-label="' +
          escapeHtml(format(t.edit, variable.key)) +
          '">' +
          icon('edit') +
          '</button>',
        '<button class="icon-button" data-action="delete" data-id="' +
          escapeHtml(variable.id) +
          '" title="' +
          escapeHtml(format(t.remove, variable.key)) +
          '" aria-label="' +
          escapeHtml(format(t.remove, variable.key)) +
          '">' +
          icon('trash') +
          '</button>',
      );
    }

    return '<td class="actions">' + buttons.join('') + '</td>';
  }

  function renderEditRow(variable) {
    return (
      '<tr class="editor-row"><td colspan="3">' +
      '<form class="inline-form" data-form="edit" data-id="' +
      escapeHtml(variable.id) +
      '">' +
      '<label class="visually-hidden" for="edit-value">' +
      escapeHtml(t.valueLabel) +
      '</label>' +
      '<input id="edit-value" name="value" type="text" autocomplete="off" spellcheck="false" ' +
      'aria-label="' +
      escapeHtml(format(t.edit, variable.key)) +
      '" />' +
      '<button class="text primary" type="submit">' +
      escapeHtml(t.save) +
      '</button>' +
      '<button class="text" type="button" data-action="cancelEdit">' +
      escapeHtml(t.cancel) +
      '</button>' +
      '</form></td></tr>'
    );
  }

  function renderRows() {
    const rows = visibleVariables();
    if (variables.length === 0) {
      return (
        '<tr><td colspan="3"><p class="empty-state">' + escapeHtml(t.noVariables) + '</p></td></tr>'
      );
    }
    if (rows.length === 0) {
      return (
        '<tr><td colspan="3"><p class="empty-state">' + escapeHtml(t.noResults) + '</p></td></tr>'
      );
    }
    return rows
      .map((variable) => {
        const row =
          '<tr data-id="' +
          escapeHtml(variable.id) +
          '">' +
          '<td class="key"><span class="severity ' +
          escapeHtml(variable.severity) +
          '" aria-hidden="true"></span>' +
          escapeHtml(variable.key) +
          '</td>' +
          renderValueCell(variable) +
          renderActions(variable) +
          '</tr>';
        return editingId === variable.id ? row + renderEditRow(variable) : row;
      })
      .join('');
  }

  function renderAddForm() {
    if (!addingVariable) {
      return '';
    }
    return (
      '<form class="inline-form" data-form="add" style="padding: 0 16px 12px">' +
      '<label class="visually-hidden" for="add-key">' +
      escapeHtml(t.keyLabel) +
      '</label>' +
      '<input id="add-key" name="key" type="text" placeholder="' +
      escapeHtml(t.keyLabel) +
      '" autocomplete="off" spellcheck="false" required pattern="[A-Za-z_][A-Za-z0-9_.-]*" />' +
      '<label class="visually-hidden" for="add-value">' +
      escapeHtml(t.valueLabel) +
      '</label>' +
      '<input id="add-value" name="value" type="text" placeholder="' +
      escapeHtml(t.valueLabel) +
      '" autocomplete="off" spellcheck="false" />' +
      '<button class="text primary" type="submit">' +
      escapeHtml(t.save) +
      '</button>' +
      '<button class="text" type="button" data-action="cancelAdd">' +
      escapeHtml(t.cancel) +
      '</button>' +
      '</form>'
    );
  }

  function renderFooter() {
    const addButton = state.readOnly
      ? ''
      : '<button class="text" data-action="startAdd">' +
        icon('add') +
        '<span>' +
        escapeHtml(t.addVariable) +
        '</span></button>';

    return (
      '<footer class="footer">' +
      addButton +
      '<span class="spacer"></span>' +
      '<button class="text" data-action="openAsText" title="' +
      escapeHtml(t.openAsText) +
      '">' +
      icon('text') +
      '<span>' +
      escapeHtml(t.openAsText) +
      '</span></button>' +
      '<button class="text" data-action="toggleStreamerMode" aria-pressed="' +
      (state.streamerMode ? 'true' : 'false') +
      '">' +
      icon('broadcast') +
      '<span>' +
      escapeHtml(state.streamerMode ? t.streamOn : t.streamOff) +
      '</span></button>' +
      '<button class="text" data-action="revealAll"' +
      (state.streamerMode ? ' disabled' : '') +
      '>' +
      escapeHtml(t.revealAll) +
      '</button>' +
      '<button class="text primary" data-action="hideAll">' +
      escapeHtml(t.hideAll) +
      '</button>' +
      '</footer>'
    );
  }

  function render() {
    const focusedId = document.activeElement && document.activeElement.getAttribute('data-id');
    const focusedAction =
      document.activeElement && document.activeElement.getAttribute('data-action');
    const searchHadFocus = document.activeElement && document.activeElement.id === 'search';
    const caret = searchHadFocus ? document.activeElement.selectionStart : null;

    app.innerHTML =
      renderHeader() +
      renderToolbar() +
      renderNotice() +
      renderAddForm() +
      '<div class="table-wrapper"><table>' +
      '<thead><tr>' +
      '<th class="col-key" scope="col">' +
      escapeHtml(t.variable) +
      '</th>' +
      '<th scope="col">' +
      escapeHtml(t.value) +
      '</th>' +
      '<th class="col-actions" scope="col">' +
      escapeHtml(t.actions) +
      '</th>' +
      '</tr></thead><tbody>' +
      renderRows() +
      '</tbody></table></div>' +
      renderFooter();

    app.setAttribute('aria-busy', 'false');
    restoreFocus(focusedId, focusedAction, searchHadFocus, caret);
  }

  function restoreFocus(focusedId, focusedAction, searchHadFocus, caret) {
    if (searchHadFocus) {
      const search = document.getElementById('search');
      if (search) {
        search.focus();
        if (caret !== null) {
          search.setSelectionRange(caret, caret);
        }
      }
      return;
    }
    if (editingId) {
      const input = document.getElementById('edit-value');
      if (input) {
        input.focus();
        return;
      }
    }
    if (addingVariable) {
      const input = document.getElementById('add-key');
      if (input) {
        input.focus();
        return;
      }
    }
    if (focusedId && focusedAction) {
      // After a reveal the button changes action; try both so focus is kept.
      const candidates = [focusedAction, focusedAction === 'reveal' ? 'hide' : 'reveal'];
      for (const action of candidates) {
        const button = app.querySelector(
          '[data-id="' + cssEscape(focusedId) + '"][data-action="' + action + '"]',
        );
        if (button) {
          button.focus();
          return;
        }
      }
    }
  }

  function cssEscape(value) {
    return String(value).replace(/["\\]/g, '\\$&');
  }

  /* ---------------------------------------------------------- toasting --- */

  function showToast(text, tone) {
    const existing = document.querySelector('.toast');
    if (existing) {
      existing.remove();
    }
    const node = document.createElement('div');
    node.className = 'toast' + (tone === 'warning' ? ' warning' : '');
    node.setAttribute('role', 'status');
    node.textContent = text;
    document.body.appendChild(node);
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => node.remove(), 4000);
  }

  /* ----------------------------------------------------------- events --- */

  app.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) {
      return;
    }
    const action = target.getAttribute('data-action');
    const id = target.getAttribute('data-id');

    switch (action) {
      case 'reveal':
        post({ type: 'reveal', id });
        break;
      case 'hide':
        revealed.delete(id);
        post({ type: 'hide', id });
        break;
      case 'copy':
        post({ type: 'copy', id });
        break;
      case 'startEdit':
        editingId = id;
        addingVariable = false;
        render();
        break;
      case 'cancelEdit':
        editingId = null;
        render();
        break;
      case 'delete':
        post({ type: 'delete', id });
        break;
      case 'startAdd':
        addingVariable = true;
        editingId = null;
        render();
        break;
      case 'cancelAdd':
        addingVariable = false;
        render();
        break;
      case 'hideAll':
        revealed.clear();
        post({ type: 'hideAll' });
        break;
      case 'revealAll':
        post({ type: 'revealAll' });
        break;
      case 'toggleStreamerMode':
        post({ type: 'toggleStreamerMode' });
        break;
      case 'openAsText':
        post({ type: 'openAsText' });
        break;
      default:
        break;
    }
  });

  app.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target;
    const kind = form.getAttribute('data-form');

    if (kind === 'edit') {
      const id = form.getAttribute('data-id');
      post({ type: 'edit', id, value: form.elements.value.value });
      editingId = null;
      render();
      return;
    }
    if (kind === 'add') {
      const key = form.elements.key.value.trim();
      if (key === '') {
        return;
      }
      post({ type: 'add', key, value: form.elements.value.value });
      addingVariable = false;
      render();
    }
  });

  app.addEventListener('input', (event) => {
    if (event.target.id === 'search') {
      query = event.target.value;
      render();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (editingId || addingVariable) {
        editingId = null;
        addingVariable = false;
        render();
        return;
      }
      // Escape with nothing open is a quick panic gesture.
      revealed.clear();
      post({ type: 'hideAll' });
    }
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'update':
        variables = message.variables;
        state = message.state;
        // Forget anything the host now considers masked.
        for (const id of Array.from(revealed.keys())) {
          const variable = variables.find((item) => item.id === id);
          if (!variable || variable.masked) {
            revealed.delete(id);
          }
        }
        render();
        break;
      case 'value':
        revealed.set(message.id, message.value);
        render();
        break;
      case 'mask':
        if (message.id) {
          revealed.delete(message.id);
        } else {
          revealed.clear();
        }
        render();
        break;
      case 'toast':
        showToast(message.text, message.tone);
        break;
      default:
        break;
    }
  });

  render();
  post({ type: 'ready' });
})();
