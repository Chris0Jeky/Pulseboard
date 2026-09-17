// Keep testable helpers in worker modules; workerd treats named exports as entrypoints.
export { default } from './watch-worker.mjs';
