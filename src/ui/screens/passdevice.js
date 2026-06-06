// screens/passdevice.js — the hotseat "pass-the-device" interstitial.
//
// Between two consecutive HUMAN turns the next player must not glimpse the board
// or the (now-revealed) incoming hand while the previous player is still holding
// the device. This module shows a full-screen OPAQUE overlay that hides
// everything underneath until the incoming player taps Ready.
//
// It is intentionally NOT a router screen: the game screen stays mounted beneath
// it so the canvas keeps its layout box (no resize/repaint race). The overlay is
// a transient element appended to #app and removed on acknowledge.
//
// Observable State Contract:
//   [data-testid="pass-device"]        — the overlay (present only while showing)
//   [data-testid="pass-device-target"] — the "P{n} ({name}), ready?" line
//   button[data-action="ready"]        — acknowledge
// window.__APP__.screen stays 'game' while the overlay covers it.

let current = null;

/**
 * Show the interstitial for the incoming player.
 * @param {{ playerNumber:number, name:string, onReady:()=>void }} opts
 */
export function showPassDevice({ playerNumber, name, onReady }) {
  hidePassDevice(); // never stack two

  const overlay = document.createElement('div');
  overlay.className = 'passdevice';
  overlay.dataset.testid = 'pass-device';

  const card = document.createElement('div');
  card.className = 'passdevice-card';

  const h = document.createElement('h1');
  h.className = 'passdevice-title';
  h.textContent = 'Pass the device';
  card.appendChild(h);

  const sub = document.createElement('p');
  sub.className = 'passdevice-sub';
  sub.dataset.testid = 'pass-device-target';
  sub.textContent = `P${playerNumber} (${name}), ready?`;
  card.appendChild(sub);

  const note = document.createElement('p');
  note.className = 'passdevice-note';
  note.textContent =
    'Hand the device to the next player. The board and hands stay hidden until they tap Ready.';
  card.appendChild(note);

  const ready = document.createElement('button');
  ready.className = 'primary big';
  ready.dataset.action = 'ready';
  ready.textContent = "I'm ready";
  ready.addEventListener('click', () => {
    hidePassDevice();
    if (onReady) onReady();
  });
  card.appendChild(ready);

  overlay.appendChild(card);
  (document.getElementById('app') || document.body).appendChild(overlay);
  current = overlay;
  try { ready.focus(); } catch (_) { /* headless */ }
  return overlay;
}

export function hidePassDevice() {
  if (current && current.parentNode) current.parentNode.removeChild(current);
  current = null;
}

export function isPassDeviceShowing() {
  return current != null;
}
