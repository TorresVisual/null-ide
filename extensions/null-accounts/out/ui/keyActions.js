'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeyActions = void 0;
const keyUpload_1 = require("../keyUpload");
const gitPlan_1 = require("../gitPlan");
const sshAccount_1 = require("../sshAccount");
const sshCheck_1 = require("../sshCheck");
const sshKey_1 = require("../sshKey");
const who = (a) => `${a.username}@${a.host}`;
/**
 * What the Accounts panel's key buttons do. Each method throws an Error with a message fit to show the user;
 * notifications that need no answer are fired without waiting (a toast resolves only when dismissed).
 * Changing a key goes through `accounts.update`, so the git wiring follows on its own.
 */
class KeyActions {
    d;
    constructor(d) {
        this.d = d;
    }
    /** Creates a new key for the account and offers to put it on the server. */
    async generate(id) {
        const account = this.need(id);
        if (account.sshKeyPath) {
            const go = await this.d.ui.confirm(`Replace the SSH key of ${who(account)}?`, 'The current key file stays on disk. Commit signing is switched off until you turn it on again for the new key.', 'Generate');
            if (!go) {
                return;
            }
        }
        const file = await this.d.generate({ host: account.host, username: account.username, email: account.email });
        await this.setKey(account, file);
        await this.afterNewKey(id);
    }
    /** The next step after a key was created: the server has to learn its public half. */
    async afterNewKey(id) {
        const account = this.need(id);
        const label = account.authMethod === 'ssh' ? `Copy key and open ${account.host}` : `Upload to ${account.host}`;
        const choice = await this.d.ui.info(`Created an SSH key for ${who(account)}. ${account.host} has to know its public key before it can be used.`, label, 'Copy public key');
        if (choice === label) {
            await this.upload(id);
        }
        else if (choice === 'Copy public key') {
            await this.copyPublic(id);
        }
    }
    /** Uses a key file the user already has. */
    async attach(id) {
        const account = this.need(id);
        const picked = await this.d.ui.pickKeyFile();
        if (!picked) {
            return;
        }
        const problem = (0, sshAccount_1.checkKeyPath)(picked, this.d.home, this.d.exists);
        if (problem) {
            throw new Error(problem);
        }
        await this.setKey(account, picked);
        await this.test(id);
    }
    async copyPublic(id) {
        const account = this.need(id);
        await this.d.ui.copy(this.publicKey(account).line);
        void this.d.ui.info(`Copied the public key of ${who(account)}.`);
    }
    /** Puts the public key on the server for pushing and signing; for an account without a token, copies it and opens the page to paste it into. */
    async upload(id) {
        const account = this.need(id);
        const key = this.publicKey(account);
        if (account.authMethod === 'ssh') {
            await this.d.ui.copy(key.line);
            await this.d.ui.open((0, keyUpload_1.keySettingsUrl)(account));
            const twice = account.provider === 'github' ? ' Add it once as an Authentication key and once as a Signing key.' : '';
            void this.d.ui.info(`Public key copied. Paste it on the page that just opened.${twice} Then press Test.`);
            return;
        }
        const scopes = account.provider === 'github' ? keyUpload_1.GITHUB_KEY_SCOPES : [];
        const token = await this.d.getToken(account, scopes, { interactive: true });
        if (!token) {
            throw new Error(`There is no sign-in for ${who(account)}. Re-authenticate the account and try again, or use Copy public key and add the key by hand.`);
        }
        const result = await this.d.upload(account, token, key, (0, sshKey_1.keyTitle)(this.d.hostname, this.d.now()));
        if (!result.ok) {
            throw new Error(result.message);
        }
        void this.d.ui.info(result.already ? `${account.host} already had this key.` : `Added the key to ${who(account)} for pushing and signing.`);
        await this.test(id);
    }
    /** `ssh -T` with only this key. */
    async test(id) {
        const account = this.need(id);
        const check = await this.d.checkSsh(account.host, this.keyFile(account));
        const outcome = (0, sshCheck_1.describeSshTest)(account, check);
        void (outcome.level === 'warn' ? this.d.ui.warn(outcome.text) : this.d.ui.info(outcome.text));
    }
    /** Signing is only switched on once the key is known to sign without any prompt: a failed signature blocks the commit. */
    async setSigning(id, on) {
        const account = this.need(id);
        if (!on) {
            await this.d.accounts.update(id, { signCommits: undefined });
            return;
        }
        const keyFile = this.keyFile(account);
        if (!this.d.exists(keyFile)) {
            throw new Error(`The key file ${keyFile} was not found.`);
        }
        const check = await this.d.canSign(keyFile);
        if (!check.ok) {
            throw new Error(check.message);
        }
        await this.d.accounts.update(id, { signCommits: true });
        void this.d.ui.info(`Commits in projects using ${who(account)} will be signed. They show as Verified once the public key is on ${account.host} as a signing key (Upload does both).`);
    }
    /** Deletes a key Null IDE created; for a key the user brought, only stops using it. */
    async removeKey(id) {
        const account = this.need(id);
        if (account.authMethod === 'ssh') {
            throw new Error('An SSH-only account needs its key. Generate or choose another key, or remove the account.');
        }
        const keyFile = this.keyFile(account);
        const managed = (0, sshKey_1.isManagedKey)(keyFile, this.d.home);
        const go = await this.d.ui.confirm(managed ? `Delete the SSH key of ${who(account)}?` : `Stop using the SSH key of ${who(account)}?`, managed
            ? `The key files are deleted from this computer. ${account.host} keeps trusting the public key until you remove it in your SSH key settings there.`
            : 'The key file stays where it is.', managed ? 'Delete' : 'Stop using');
        if (!go) {
            return;
        }
        // Config first, so the repos let go of the key before its file disappears.
        await this.d.accounts.update(id, { sshKeyPath: undefined, signCommits: undefined });
        if (managed) {
            this.d.deleteManagedKey(keyFile);
        }
    }
    /** A new key is not a signing key on the server yet, so signing starts off. */
    async setKey(account, file) {
        await this.d.accounts.update(account.id, { sshKeyPath: file, signCommits: undefined });
    }
    need(id) {
        const account = this.d.accounts.get(id);
        if (!account) {
            throw new Error('That account no longer exists.');
        }
        return account;
    }
    keyFile(account) {
        const file = (0, gitPlan_1.sshKeyFile)(account, this.d.home);
        if (!file) {
            throw new Error(`${who(account)} has no SSH key yet.`);
        }
        return file;
    }
    publicKey(account) {
        return this.d.readPublicKey(this.keyFile(account));
    }
}
exports.KeyActions = KeyActions;
//# sourceMappingURL=keyActions.js.map