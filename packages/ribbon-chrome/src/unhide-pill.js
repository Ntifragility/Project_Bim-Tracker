/**
 * Revizto-Style Unhide Floating Viewport Pill.
 * Shows a glowing button at the bottom of the viewport when elements are hidden,
 * indicating the count of hidden elements and restoring visibility on click.
 *
 * @param {HTMLElement} container Viewport container element
 * @param {object} options
 * @param {object} [options.visibility] Visibility controller (with onVisibilityChange & unhideAll)
 * @param {Function} [options.onUnhide] Callback when clicked
 * @param {string} [options.id] Optional element ID
 * @returns {object} { element, update, destroy }
 */
export function createUnhidePill(container, options = {}) {
  if (!container) return null;
  const visibility = options.visibility;

  const pill = document.createElement('button');
  pill.type = 'button';
  pill.id = options.id || 'rc-unhide-pill';
  pill.className = 'rc-unhide-pill hidden';
  pill.title = 'Unhide all hidden elements (Ctrl + Shift + H)';
  pill.setAttribute('aria-label', 'Unhide hidden elements');
  pill.innerHTML = `
    <svg class="rc-unhide-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
      <line x1="2" y1="2" x2="22" y2="22"/>
    </svg>
    <span>Unhide</span>
    <span class="rc-unhide-badge" id="rc-unhide-count">0</span>
  `;

  container.appendChild(pill);

  const countBadge = pill.querySelector('#rc-unhide-count');

  function update(count) {
    const num = Number(count) || 0;
    if (num > 0) {
      if (countBadge) countBadge.textContent = String(num);
      pill.classList.remove('hidden');
    } else {
      pill.classList.add('hidden');
    }
  }

  let unsubscribe = null;
  if (visibility && typeof visibility.onVisibilityChange === 'function') {
    unsubscribe = visibility.onVisibilityChange(update);
  }

  const handleClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof options.onUnhide === 'function') {
      options.onUnhide();
    } else if (visibility && typeof visibility.unhideAll === 'function') {
      visibility.unhideAll();
    }
  };

  pill.addEventListener('click', handleClick);

  return {
    element: pill,
    update,
    destroy() {
      if (typeof unsubscribe === 'function') unsubscribe();
      pill.removeEventListener('click', handleClick);
      pill.remove();
    },
  };
}
