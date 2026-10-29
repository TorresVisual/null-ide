import { test } from 'node:test';
import * as assert from 'node:assert';
import { archOf, buildRunArgs, containerFolder, envFile, fromAuthority, gitKeyOverrides, parseConfig, substitute, toAuthority, Vars } from './devcontainer';

const vars: Vars = { localWorkspaceFolder: 'D:/code/my proj', containerWorkspaceFolder: '/workspaces/my proj', env: { HOME: '/h' } };

test('parseConfig handles comments, trailing commas and slashes inside strings', () => {
  const cfg = parseConfig(`{
    // line
    "image": "host:8443/a/b:tag", /* block */
    "initializeCommand": "sh -c 'echo // not a comment, }'",
    "runArgs": ["--env-file", "x",],
  }`);
  assert.strictEqual(cfg.image, 'host:8443/a/b:tag');
  assert.strictEqual(cfg.initializeCommand, "sh -c 'echo // not a comment, }'");
  assert.deepStrictEqual(cfg.runArgs, ['--env-file', 'x']);
});

test('substitute', () => {
  assert.strictEqual(substitute('${localWorkspaceFolder}/.devcontainer/.env', vars), 'D:/code/my proj/.devcontainer/.env');
  assert.strictEqual(substitute('${localWorkspaceFolderBasename}:${localEnv:HOME}:${nope}', vars), 'my proj:/h:${nope}');
});

test('authority round-trips non-ascii paths', () => {
  const p = 'D:\\Cödé\\proj';
  assert.strictEqual(fromAuthority(toAuthority(p)), p);
});

test('containerFolder', () => {
  assert.strictEqual(containerFolder({}, 'D:\\a\\proj'), '/workspaces/proj');
  assert.strictEqual(containerFolder({ workspaceFolder: '/w/${localWorkspaceFolderBasename}' }, 'D:\\a\\proj'), '/w/proj');
});

test('buildRunArgs puts runArgs before the image and overrides the entrypoint', () => {
  const args = buildRunArgs(
    { image: 'img:1', runArgs: ['--env-file', '${localWorkspaceFolder}/.devcontainer/.env'], containerEnv: { A: 'b' } },
    vars, 'n',
  );
  assert.deepStrictEqual(args.slice(0, 4), ['run', '-d', '--name', 'n']);
  assert.ok(args.includes('D:/code/my proj/.devcontainer/.env'));
  assert.deepStrictEqual(args.slice(args.indexOf('--entrypoint')), ['--entrypoint', 'sh', 'img:1', '-c', 'while sleep 1000; do :; done']);
  assert.ok(args.indexOf('A=b') > 0);
});

test('archOf', () => {
  assert.strictEqual(archOf('x86_64\n'), 'x64');
  assert.strictEqual(archOf('aarch64\n'), 'arm64');
});

test('gitKeyOverrides repoints null-accounts key paths (case-insensitive) and leaves other config alone', () => {
  const key = 'C:/Users/Moritz/.ssh/null-accounts/gl_ed25519';
  const env = gitKeyOverrides('c:\\users\\moritz\\.ssh\\null-accounts','/home/vscode/.ssh/null-accounts', {
    sshCommand: `ssh -i '${key}' -o IdentitiesOnly=yes`,
    signingKey: key,
  });
  assert.deepStrictEqual(env, {
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: 'core.sshCommand',
    GIT_CONFIG_VALUE_0: "ssh -i '/home/vscode/.ssh/null-accounts/gl_ed25519' -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new",
    GIT_CONFIG_KEY_1: 'user.signingkey',
    GIT_CONFIG_VALUE_1: '/home/vscode/.ssh/null-accounts/gl_ed25519',
  });
  assert.deepStrictEqual(gitKeyOverrides('C:/Users/Moritz/.ssh/null-accounts', '/k', { sshCommand: 'ssh -i /elsewhere/key', signingKey: '/elsewhere/key' }), {});
  assert.deepStrictEqual(gitKeyOverrides('C:/Users/Moritz/.ssh/null-accounts', '/k', {}), {});
});

test('envFile quotes single quotes for sh', () => {
  assert.strictEqual(envFile({ A: "it's" }), "export A='it'\\''s'\n");
});
