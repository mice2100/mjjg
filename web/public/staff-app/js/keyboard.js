// On-screen keyboard for iPads and tablets.
// The tablet's own keyboard covers half the screen, so text fields get inputmode="none"
// (the system keyboard stays hidden; a physical keyboard still works) and this keyboard docks
// at the bottom. The app shrinks above it, so nothing is covered. Number fields
// (inputmode decimal / numeric / tel) get a number pad. The header button switches back to
// the tablet's own keyboard when needed (for example to type in another language).
// A strip on top of the keys always shows the field's name and what has been typed, so the text
// stays readable even when the window above is too short to show the field itself.
// Landscape tablets: the keyboard docks on the right and the app shrinks to its left (more room
// across than up and down). Upright screens and phones: it docks at the bottom.
'use strict';

const OSK = {
  // On by default on touch screens; remembered per device.
  on: (() => {
    try {
      const v = localStorage.getItem('jg_osk');
      if (v != null) return v === 'on';
    } catch { /* private mode */ }
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  })(),
  el: null, target: null, layout: 'abc', shift: false,
};

const TEXT_INPUT = 'input:not([type]), input[type="text"], input[type="search"], input[type="tel"], input[type="email"], input[type="number"], textarea';

// Remember each field's real keyboard type, then hide the system keyboard (or restore it).
function oskPrepare(root = document) {
  root.querySelectorAll(TEXT_INPUT).forEach((el) => {
    if (el.dataset.oskMode === undefined) el.dataset.oskMode = el.getAttribute('inputmode') || '';
    if (el.dataset.oskMode === 'none') return; // the phone keypad field has its own buttons
    if (OSK.on) el.setAttribute('inputmode', 'none');
    else if (el.dataset.oskMode) el.setAttribute('inputmode', el.dataset.oskMode);
    else el.removeAttribute('inputmode');
  });
}
new MutationObserver((list) => {
  for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) oskPrepare(n.matches?.(TEXT_INPUT) ? n.parentNode || n : n);
}).observe(document.documentElement, { childList: true, subtree: true });

const isNumberField = (el) => ['decimal', 'numeric', 'tel'].includes(el.dataset.oskMode);

const ROWS = {
  abc: [
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
    ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'back'],
    ['123', ',', 'space', '.', "'", 'done'],
  ],
  sym: [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['-', '/', ':', ';', '(', ')', '$', '&', '@', '#'],
    ['%', '+', '=', '*', '"', '?', '!', 'back'],
    ['abc', ',', 'space', '.', "'", 'done'],
  ],
  num: [
    ['1', '2', '3'],
    ['4', '5', '6'],
    ['7', '8', '9'],
    ['.', '0', 'back'],
  ],
};
const LABEL = { shift: '⇧', back: '⌫', space: 'space', done: 'Done', '123': '123', abc: 'ABC' };

function oskRender() {
  if (!OSK.el) {
    OSK.el = document.createElement('div');
    OSK.el.id = 'osk';
    OSK.el.className = 'osk';
    OSK.el.setAttribute('role', 'group');
    OSK.el.setAttribute('aria-label', 'On-screen keyboard');
    // pointerdown + preventDefault: tapping a key never takes the focus away from the field.
    OSK.el.addEventListener('pointerdown', (e) => {
      const b = e.target.closest('[data-k]');
      e.preventDefault();
      if (b) oskPress(b.dataset.k);
    });
    document.body.appendChild(OSK.el);
  }
  const layout = OSK.target && isNumberField(OSK.target) ? 'num' : OSK.layout;
  const rows = ROWS[layout].map((row) => `<div class="osk-row">${row.map((k) => {
    const text = LABEL[k] || (OSK.shift && layout === 'abc' ? k.toUpperCase() : k);
    const cls = k.length > 1 ? ` osk-fn osk-${k}` : '';
    return `<button type="button" tabindex="-1" class="osk-key${cls}${k === 'shift' && OSK.shift ? ' on' : ''}" data-k="${esc(k)}">${esc(text)}</button>`;
  }).join('')}</div>`).join('');
  OSK.el.className = `osk${layout === 'num' ? ' osk-numpad' : ''}`;
  const keys = layout === 'num' ? `<div class="osk-keys"><div class="osk-pad">${rows}</div><div class="osk-side"><button type="button" tabindex="-1" class="osk-key osk-fn osk-done" data-k="done">Done</button></div></div>` : rows;
  OSK.el.innerHTML = `<div class="osk-bar"><span class="osk-label"></span><span class="osk-text"></span></div>${keys}`;
  oskEcho();
  // Letters and the number pad differ in height: keep the window above in step.
  if (!OSK.el.hidden && document.body.classList.contains('osk-open')) oskFit();
}

// The field's name (its label, else its placeholder) and its text with the cursor.
function fieldLabel(el) {
  const l = el.labels?.[0] || el.closest('.field, label')?.querySelector('label');
  const t = (l && l !== el ? l.textContent : '') || el.getAttribute('aria-label') || '';
  return t.replace(/\s+/g, ' ').trim();
}
function oskEcho() {
  const el = OSK.target;
  if (!OSK.el || !el) return;
  const label = OSK.el.querySelector('.osk-label'), text = OSK.el.querySelector('.osk-text');
  label.textContent = fieldLabel(el) || 'Typing';
  const v = el.value || '';
  let at = v.length;
  try { if (el.selectionStart != null) at = el.selectionStart; } catch { /* email / number fields */ }
  text.classList.toggle('osk-empty', !v);
  text.innerHTML = v ? `${esc(v.slice(0, at))}<i class="osk-caret"></i>${esc(v.slice(at))}` : `<i class="osk-caret"></i>${esc(el.placeholder || '')}`;
  text.scrollLeft = text.scrollWidth; // long notes: keep the end in view
}
document.addEventListener('input', (e) => { if (OSK.target && e.target === OSK.target) oskEcho(); });
document.addEventListener('selectionchange', () => { if (OSK.target && document.activeElement === OSK.target) oskEcho(); });

// Side or bottom, and how much room the app leaves for the keyboard.
const OSK_SIDE = window.matchMedia('(orientation: landscape) and (min-width: 900px)');
function oskFit() {
  const open = !!OSK.el && !OSK.el.hidden && document.body.classList.contains('osk-open');
  const side = OSK_SIDE.matches;
  document.body.classList.toggle('osk-right', side);
  const root = document.documentElement.style;
  root.setProperty('--osk-h', open && !side ? OSK.el.offsetHeight + 'px' : '0px');
  root.setProperty('--osk-w', open && side ? OSK.el.offsetWidth + 'px' : '0px');
}
OSK_SIDE.addEventListener?.('change', () => {
  oskFit();
  if (OSK.target) setTimeout(() => OSK.target?.scrollIntoView({ block: 'center', inline: 'nearest' }), 60);
});

function oskShow(el) {
  OSK.target = el;
  // Capital first letter for names; plain for everything else.
  OSK.shift = !isNumberField(el) && !el.value && /name/i.test(el.id + ' ' + (el.dataset.input || ''));
  oskRender();
  OSK.el.hidden = false;
  document.body.classList.add('osk-open');
  oskFit();
  setTimeout(() => el.scrollIntoView({ block: 'center', inline: 'nearest' }), 30);
}

function oskHide() {
  OSK.target = null;
  if (OSK.el) OSK.el.hidden = true;
  document.body.classList.remove('osk-open');
  oskFit();
}

function oskType(el, text) {
  const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
  try {
    el.setRangeText(text, start, end, 'end');
  } catch {
    el.value += text; // type="email" / "number" have no selection API
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function oskPress(k) {
  // The app may have re-rendered the field; type into whatever has the focus now.
  const el = document.activeElement && document.activeElement.matches(TEXT_INPUT) ? document.activeElement : null;
  if (!el) { oskHide(); return; }
  OSK.target = el;
  if (k === 'shift') { OSK.shift = !OSK.shift; oskRender(); return; }
  if (k === '123') { OSK.layout = 'sym'; oskRender(); return; }
  if (k === 'abc') { OSK.layout = 'abc'; oskRender(); return; }
  if (k === 'done') {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    el.blur();
    oskHide();
    return;
  }
  if (k === 'back') {
    const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
    if (start === end && start > 0) el.setSelectionRange(start - 1, end);
    oskType(el, '');
    return;
  }
  oskType(el, k === 'space' ? ' ' : OSK.shift && OSK.layout === 'abc' ? k.toUpperCase() : k);
  if (OSK.shift) { OSK.shift = false; oskRender(); }
}

document.addEventListener('focusin', (e) => {
  if (!OSK.on || !e.target.matches(TEXT_INPUT) || e.target.dataset.oskMode === 'none') return;
  oskShow(e.target);
});
document.addEventListener('focusout', () => {
  // Re-rendering moves the focus to a new copy of the field; only hide when nothing is typed into.
  setTimeout(() => {
    const a = document.activeElement;
    if (!a || !a.matches(TEXT_INPUT) || a.dataset.oskMode === 'none') oskHide();
    else if (OSK.on && a !== OSK.target) oskShow(a);
  }, 60);
});

function oskToggle() {
  OSK.on = !OSK.on;
  try { localStorage.setItem('jg_osk', OSK.on ? 'on' : 'off'); } catch { /* private mode */ }
  oskPrepare();
  if (!OSK.on) oskHide();
  oskButton();
  toast(OSK.on ? 'Using the on-screen keyboard' : 'Using the tablet keyboard');
}
function oskButton() {
  const b = $('oskBtn');
  if (b) { b.textContent = OSK.on ? 'Keyboard: screen' : 'Keyboard: tablet'; b.classList.toggle('off', !OSK.on); }
}
oskPrepare();
