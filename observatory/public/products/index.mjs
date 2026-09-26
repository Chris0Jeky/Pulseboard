/** Product panel registry: project id → panel. A panel is { title, names, compute(events), render(model, ui) }.
 *  names are the event names it reads through /v1/product/<id>/events; compute is pure; render receives the Desk's
 *  text-only helpers. To add one: write public/products/<id>.mjs, import it here, list it in src/assets.mjs. */
import { alibiPanel } from './alibi.mjs';
export const PRODUCT_PANELS = Object.freeze({ alibi: alibiPanel });
export const productPanel = id => Object.hasOwn(PRODUCT_PANELS, id) ? PRODUCT_PANELS[id] : null;
