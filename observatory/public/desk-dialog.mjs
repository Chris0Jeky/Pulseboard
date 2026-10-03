/** Keep keyboard focus inside the Desk's native modal dialogs, including boundary wraps.
 * Native showModal(), Escape, inert background and return focus remain browser-owned.
 * Re-read the small, controlled dialog DOM on every Tab: drawers change and export buttons disable.
 */
const dialogTabStops = 'a[href], button, input, select, textarea, summary, [tabindex]';
for (const dialog of document.querySelectorAll('dialog')) {
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !dialog.matches(':modal')) return;
    const stops = [...dialog.querySelectorAll(dialogTabStops)].filter(node => node.tabIndex >= 0
      && !node.matches(':disabled') && !node.closest('[hidden], [inert]')
      && node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible');
    const first = stops[0], last = stops.at(-1), active = document.activeElement;
    // Every current dialog has a close control. Still contain focus if all controls become unavailable.
    if (!first) { event.preventDefault(); dialog.focus(); return; }
    if (event.shiftKey ? active === first || active === dialog : active === last || active === dialog) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  });
}
