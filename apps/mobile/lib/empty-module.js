/**
 * Empty module stub for Node.js built-ins that don't exist in React Native.
 *
 * Some dependencies (e.g. expensify-common) import Node.js built-ins like
 * `readline`, `fs`, `child_process` for their CLI code paths. These imports
 * run at module-evaluation time but the actual CLI functions are never called
 * in the RN runtime. Metro can't resolve these modules, so we stub them to
 * this empty module so bundling succeeds.
 *
 * The stub exports nothing — any code that tries to use these built-ins at
 * runtime will fail, but that's fine because those code paths are never
 * reached in the mobile app.
 */

module.exports = {};
