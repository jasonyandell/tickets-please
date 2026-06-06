// app.js — tiny screen router + the Observable State Contract surface.
//
// Replaces the old single always-on pane. The DOM has one <section data-screen>
// per screen (menu | setup | game | gameover); exactly one is `.active` (shown)
// at a time. Zero dependencies; no framework.
//
// This module also OWNS `window.__APP__`, the read-only snapshot the e2e suite
// reads instead of sampling pixels:
//   window.__APP__ = { screen, viewModel, lastAction }
// The router keeps `.screen` current; main.js refreshes `.viewModel` each render
// and records `.lastAction` whenever an action is applied.

export const SCREENS = ['menu', 'setup', 'game', 'gameover'];

// The single contract object. Defined module-side so headless imports don't
// throw, mirrored onto window when a DOM exists.
export const APP = { screen: null, viewModel: null, lastAction: null };
if (typeof window !== 'undefined') window.__APP__ = APP;

/**
 * Build a router over the [data-screen] sections found under `root`.
 *
 * @param {HTMLElement} root - container holding the screen sections.
 * @param {(name:string)=>void} [onShow] - hook fired after a screen is shown.
 * @returns {{ show(name:string):void, current:string|null, sections:object }}
 */
export function createRouter(root, onShow) {
  const sections = {};
  root.querySelectorAll('[data-screen]').forEach((sec) => {
    sections[sec.dataset.screen] = sec;
  });

  function show(name) {
    if (!sections[name]) throw new Error(`unknown screen: ${name}`);
    for (const [n, sec] of Object.entries(sections)) {
      sec.classList.toggle('active', n === name);
    }
    APP.screen = name;
    if (onShow) onShow(name);
  }

  return {
    show,
    get current() { return APP.screen; },
    sections,
  };
}

// Contract writers used by main.js (keep window.__APP__ a plain JSON snapshot).
export function setViewModel(vm) { APP.viewModel = vm; }
export function setLastAction(action) { APP.lastAction = action; }
