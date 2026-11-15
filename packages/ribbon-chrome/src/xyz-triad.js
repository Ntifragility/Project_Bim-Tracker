/**
 * Revit-Style Corner Orientation Triad (UCS Widget).
 * Renders an authentic 2D canvas orientation triad in the corner of a 3D viewport.
 * Zero external dependencies (reads camera.matrixWorldInverse directly).
 *
 * @param {HTMLElement} container Viewport container element
 * @param {object} options
 * @param {object|Function} options.camera Three.js camera (or camera provider)
 * @param {object|Function} [options.controls] Orbit/Camera controls (listens for 'update' event)
 * @param {'bottom-left'|'bottom-right'|'top-right'} [options.position='bottom-left']
 * @returns {object} { render, destroy }
 */
export function createXyzTriad(container, options = {}) {
  if (!container) return null;

  const position = options.position || 'bottom-left';
  const getCamera = () => {
    if (typeof options.camera === 'function') return options.camera();
    if (options.camera?.three) return options.camera.three;
    return options.camera;
  };
  const getControls = () => {
    if (typeof options.controls === 'function') return options.controls();
    if (options.controls?.controls) return options.controls.controls;
    return options.controls;
  };

  const triadContainer = document.createElement('div');
  triadContainer.className = 'revit-xyz-triad';
  triadContainer.setAttribute('data-rc-host', '');

  let posStyle = 'bottom: 24px; left: 24px;';
  if (position === 'bottom-right') posStyle = 'bottom: 24px; right: 24px;';
  else if (position === 'top-right') posStyle = 'top: 24px; right: 24px;';

  triadContainer.style.cssText = `
    position: absolute;
    ${posStyle}
    width: 90px;
    height: 90px;
    pointer-events: none;
    z-index: 40;
    user-select: none;
  `;

  const canvas = document.createElement('canvas');
  canvas.width = 180;
  canvas.height = 180;
  canvas.style.cssText = 'width: 90px; height: 90px; display: block;';
  triadContainer.appendChild(canvas);
  container.appendChild(triadContainer);

  const ctx = canvas.getContext ? canvas.getContext('2d') : null;

  function render() {
    if (!ctx) return;
    const camera = getCamera();
    if (!camera) return;

    const m = camera.matrixWorldInverse?.elements;
    if (!m || m.length < 16) return;

    ctx.clearRect(0, 0, 180, 180);

    // Subtle dark circular background
    ctx.beginPath();
    ctx.arc(90, 90, 84, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)';
    ctx.stroke();

    // "XYZ" header badge
    ctx.font = 'bold 10px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('XYZ AXIS', 90, 10);

    const cx = 90;
    const cy = 96;
    const armLength = 50;

    const axes = [
      { name: 'X', color: '#ef4444', vx: m[0], vy: -m[1], depth: m[2] },
      { name: 'Y', color: '#22c55e', vx: m[4], vy: -m[5], depth: m[6] },
      { name: 'Z', color: '#3b82f6', vx: m[8], vy: -m[9], depth: m[10] },
    ];

    // Sort by depth so closer axes render on top
    axes.sort((a, b) => a.depth - b.depth);

    for (const axis of axes) {
      const ex = cx + axis.vx * armLength;
      const ey = cy + axis.vy * armLength;

      // Draw axis stem
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = axis.color;
      ctx.lineCap = 'round';
      ctx.stroke();

      // Draw endpoint bead with letter
      ctx.beginPath();
      ctx.arc(ex, ey, 9.5, 0, Math.PI * 2);
      ctx.fillStyle = axis.color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(axis.name, ex, ey);
    }

    // Origin bead
    ctx.beginPath();
    ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
  }

  const controls = getControls();
  if (controls?.addEventListener) {
    controls.addEventListener('update', render);
  }

  // Initial draw
  render();

  return {
    render,
    destroy() {
      if (controls?.removeEventListener) {
        controls.removeEventListener('update', render);
      }
      if (triadContainer.parentElement) {
        triadContainer.parentElement.removeChild(triadContainer);
      }
    },
  };
}
