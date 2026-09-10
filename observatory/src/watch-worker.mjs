// SPDX-License-Identifier: GPL-3.0-only
import legacy from './worker.mjs';
import { withWatch } from '../watch/api.mjs';
const worker = withWatch(legacy);
export const handle = (request, env, ctx) => worker.fetch(request, env, ctx);
export default worker;
