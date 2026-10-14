'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATEGORY_DEFAULTS = exports.CATEGORIES = void 0;
exports.CATEGORIES = ['settings', 'keybindings', 'snippets', 'extensions', 'activity'];
/** Activity is off until the user asks for it: it uploads history that earlier sync users never agreed to share. */
exports.CATEGORY_DEFAULTS = { settings: true, keybindings: true, snippets: true, extensions: true, activity: false };
//# sourceMappingURL=types.js.map