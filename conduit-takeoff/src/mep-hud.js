// Revit-Style Live Floating MEP HUD Overlay & Direct Dimension Typing
// Displays dynamic length badge, polar angle badge, elevation pill,
// and handles direct keyboard numeric entry (e.g. typing "3.5" + Enter to commit segment).

export function createMepHud({ container = document.body, onCommitDistance, onCommitAngle } = {}) {
  // Create HUD DOM element
  const hudEl = document.createElement('div');
  hudEl.id = 'conduit-mep-hud';
  hudEl.className = 'conduit-mep-hud';
  hudEl.setAttribute('aria-hidden', 'true');
  hudEl.innerHTML = `
    <div class="mep-hud-pill mep-hud-length" title="Current segment length (Type number + Enter)">
      <span class="mep-hud-icon">📏</span>
      <span class="mep-hud-value" id="mep-hud-length-val">0.00 m</span>
      <input type="text" class="mep-hud-input" id="mep-hud-num-input" placeholder="0.00" autocomplete="off" />
    </div>
    <div class="mep-hud-pill mep-hud-angle" title="Direction Angle">
      <span class="mep-hud-icon">∡</span>
      <span class="mep-hud-value" id="mep-hud-angle-val">0.0°</span>
    </div>
    <div class="mep-hud-pill mep-hud-elevation" title="Active Middle Elevation">
      <span class="mep-hud-label">EL:</span>
      <span class="mep-hud-value" id="mep-hud-elev-val">2.80 m</span>
    </div>
  `;

  container.appendChild(hudEl);

  const lengthValEl = hudEl.querySelector('#mep-hud-length-val');
  const numInputEl = hudEl.querySelector('#mep-hud-num-input');
  const anglePillEl = hudEl.querySelector('.mep-hud-angle');
  const angleValEl = hudEl.querySelector('#mep-hud-angle-val');
  const elevValEl = hudEl.querySelector('#mep-hud-elev-val');

  let isVisible = false;
  let isTyping = false;
  let currentRawLengthM = 0;
  let currentAngleDeg = 0;

  // Handle direct numeric input
  numInputEl.addEventListener('keydown', (e) => {
    e.stopPropagation(); // Don't trigger 3D viewport shortcuts while typing numbers

    if (e.key === 'Enter') {
      e.preventDefault();
      const val = parseFloat(numInputEl.value.trim());
      if (!isNaN(val) && val > 0) {
        if (typeof onCommitDistance === 'function') {
          onCommitDistance(val);
        }
      }
      stopTyping();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      stopTyping();
    }
  });

  numInputEl.addEventListener('blur', () => {
    stopTyping();
  });

  function startTyping(initialChar = '') {
    isTyping = true;
    hudEl.classList.add('is-typing');
    numInputEl.value = initialChar;
    numInputEl.style.display = 'inline-block';
    lengthValEl.style.display = 'none';
    numInputEl.focus();
  }

  function stopTyping() {
    isTyping = false;
    hudEl.classList.remove('is-typing');
    numInputEl.style.display = 'none';
    lengthValEl.style.display = 'inline-block';
    numInputEl.value = '';
    numInputEl.blur();
  }

  // Global keydown listener to capture typing when HUD is active
  function handleGlobalKeyDown(e) {
    if (!isVisible || isTyping) return;

    // Ignore if user is already typing in an input or textarea
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
      return;
    }

    // If user presses a digit 0-9 or decimal point, activate direct typing!
    if (/^[0-9.]$/.test(e.key)) {
      e.preventDefault();
      startTyping(e.key);
    }
  }

  window.addEventListener('keydown', handleGlobalKeyDown);

  return {
    /**
     * Update HUD position and readouts
     */
    update({ screenX, screenY, lengthM = 0, angleDeg = 0, isAngleSnapped = false, elevationM = 2.8, visible = true }) {
      if (!visible) {
        if (isVisible) this.hide();
        return;
      }

      if (!isVisible) this.show();

      currentRawLengthM = lengthM;
      currentAngleDeg = angleDeg;

      // Position HUD with slight cursor offset
      const posX = screenX + 16;
      const posY = screenY + 16;
      hudEl.style.transform = `translate3d(${posX}px, ${posY}px, 0)`;

      // Update text values if not typing
      if (!isTyping) {
        lengthValEl.textContent = `${lengthM.toFixed(2)} m`;
      }

      angleValEl.textContent = `${angleDeg.toFixed(1)}°`;
      elevValEl.textContent = `${elevationM.toFixed(2)} m`;

      // Visual highlight when snapped to standard angle
      if (isAngleSnapped) {
        anglePillEl.classList.add('snapped');
      } else {
        anglePillEl.classList.remove('snapped');
      }
    },

    show() {
      isVisible = true;
      hudEl.style.display = 'flex';
      hudEl.setAttribute('aria-hidden', 'false');
    },

    hide() {
      isVisible = false;
      stopTyping();
      hudEl.style.display = 'none';
      hudEl.setAttribute('aria-hidden', 'true');
    },

    isInputActive() {
      return isTyping;
    },

    destroy() {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      if (hudEl.parentElement) {
        hudEl.parentElement.removeChild(hudEl);
      }
    },
  };
}
