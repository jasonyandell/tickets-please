// screens/menu.js — the landing screen: branding, Play, and a How-to-play modal.
//
// Pure DOM construction; no engine knowledge. renderMenu populates the given
// container once at boot. The Play button calls back into the controller, which
// routes to the setup screen.

/**
 * @param {HTMLElement} container - the [data-screen="menu"] section.
 * @param {{ onPlay: () => void }} hooks
 */
export function renderMenu(container, { onPlay }) {
  container.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'menu-card';

  const title = document.createElement('h1');
  title.className = 'menu-title';
  title.textContent = 'tickets-please 🚂';
  card.appendChild(title);

  const tagline = document.createElement('p');
  tagline.className = 'menu-tagline';
  tagline.textContent =
    'A public-domain railway game for 2–5 players on one machine — any mix of humans and AI.';
  card.appendChild(tagline);

  const play = document.createElement('button');
  play.className = 'primary big';
  play.dataset.action = 'play';
  play.textContent = 'Play';
  play.addEventListener('click', onPlay);
  card.appendChild(play);

  // --- How to play (inline, toggled — no <dialog> needed for zero-dep) ------
  const howBtn = document.createElement('button');
  howBtn.className = 'link';
  howBtn.dataset.action = 'how-to-play';
  howBtn.textContent = 'How to play';
  card.appendChild(howBtn);

  const how = document.createElement('div');
  how.className = 'menu-how';
  how.hidden = true;
  how.innerHTML = `
    <h2>How to play</h2>
    <p>On your turn, do <strong>one</strong> of:</p>
    <ul>
      <li><strong>Draw 2 train cards</strong> — from the deck or the face-up row
        (a face-up wild costs your whole turn).</li>
      <li><strong>Claim a route</strong> — spend matching-color cards equal to the
        route's length to place your trains.</li>
      <li><strong>Draw destination tickets</strong> — secret city-to-city goals
        worth points if completed (and a penalty if not).</li>
    </ul>
    <p>When a player runs low on trains the last round begins. Most points from
      routes, completed tickets, and the longest path wins.</p>`;
  card.appendChild(how);

  howBtn.addEventListener('click', () => {
    how.hidden = !how.hidden;
    howBtn.textContent = how.hidden ? 'How to play' : 'Hide how to play';
  });

  container.appendChild(card);
}
