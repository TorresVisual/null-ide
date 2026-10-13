'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.CANCELLED = void 0;
exports.enable = enable;
const cryptoBox_1 = require("./cryptoBox");
const gistStore_1 = require("./gistStore");
const layout_1 = require("./layout");
exports.CANCELLED = 'Cancelled.';
const ATTEMPTS = 3;
const fail = (message) => ({ ok: false, message });
async function askExisting(prompts, snapshot) {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
        const passphrase = await prompts.existingPassphrase(attempt);
        if (!passphrase)
            return fail(exports.CANCELLED);
        if (await (0, cryptoBox_1.unlock)(passphrase, snapshot.files[layout_1.MANIFEST]))
            return passphrase;
    }
    return fail('That is not the passphrase for this sync store.');
}
/**
 * Sets this device up: account, consent, then either creates the store (new passphrase) or joins the existing one
 * (its passphrase, plus how to resolve the first sync). Nothing is saved until every step has succeeded.
 */
async function enable(d, p) {
    const accounts = await d.accounts();
    if (accounts.length === 0)
        return fail('Add a GitHub account (github.com) in Null Accounts first.');
    const account = accounts.length === 1 ? accounts[0] : await p.chooseAccount(accounts);
    if (!account)
        return fail(exports.CANCELLED);
    const token = await d.token(account.id, true);
    if (!token)
        return fail('GitHub did not provide a token with the gist scope.');
    if (!(await p.consent(d.categories())))
        return fail(exports.CANCELLED);
    const store = (0, gistStore_1.createGistStore)(d.io, token);
    const found = await store.find();
    if (!found.ok)
        return fail(found.message);
    let snapshot;
    let passphrase;
    if (found.value === undefined) {
        const chosen = await p.newPassphrase();
        if (!chosen)
            return fail(exports.CANCELLED);
        const { manifest } = await (0, cryptoBox_1.makeManifest)(chosen);
        const created = await store.create({ [layout_1.MANIFEST]: JSON.stringify(manifest) });
        if (!created.ok)
            return fail(created.message);
        snapshot = created.value;
        passphrase = chosen;
    }
    else {
        const read = await store.read(found.value);
        if (!read.ok)
            return fail(read.message);
        snapshot = read.value;
        const asked = await askExisting(p, snapshot);
        if (typeof asked !== 'string')
            return asked;
        passphrase = asked;
    }
    let firstSync;
    if (found.value !== undefined && Object.keys(snapshot.files).some((name) => name !== layout_1.MANIFEST)) {
        const choice = await p.firstSync();
        if (!choice)
            return fail(exports.CANCELLED);
        firstSync = choice === 'each' ? undefined : choice;
    }
    await d.savePassphrase(passphrase);
    await d.setState({ gistId: snapshot.id, accountId: account.id, owner: snapshot.owner, base: {} });
    return { ok: true, firstSync };
}
//# sourceMappingURL=enable.js.map