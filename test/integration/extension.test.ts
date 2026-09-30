/**
 * VS Code integration tests.
 *
 * These run inside a real VS Code instance against the fixture workspace in
 * `test/fixtures`. They cover the parts a unit test cannot reach: command
 * registration, the custom editor, reveal timers and the guarantee that opening
 * a file in EnvShield never modifies it.
 */

import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { RevealRegistry } from '../../src/security/RevealRegistry';
import { ScreenProtection } from '../../src/streamer/ScreenProtection';

// Read from the manifest so renaming the publisher cannot silently skip the
// whole suite: `getExtension` would return undefined and `before` would fail.
import { publisher, name } from '../../package.json';

const EXTENSION_ID = `${publisher}.${name}`;

function fixture(name: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'the fixture workspace must be open');
  return vscode.Uri.joinPath(folder.uri, name);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('EnvShield extension', () => {
  before(async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, 'the extension must be installed in the test host');
    await extension.activate();
  });

  after(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.workspace
      .getConfiguration('envshield')
      .update('streamerMode', undefined, vscode.ConfigurationTarget.Workspace);
  });

  it('registers every contributed command', async () => {
    const registered = await vscode.commands.getCommands(true);
    const expected = [
      'envshield.openEnvironmentFile',
      'envshield.openAsPlainText',
      'envshield.hideAllSecrets',
      'envshield.revealAllSecrets',
      'envshield.toggleStreamerMode',
      'envshield.scanWorkspace',
      'envshield.configure',
      'envshield.revealVariable',
      'envshield.hideVariable',
      'envshield.copyVariableValue',
      'envshield.refresh',
      'envshield.setDefaultEditor',
      'envshield.clearDefaultEditor',
      'envshield.showWelcome',
      'envshield.alwaysMaskVariable',
      'envshield.neverMaskVariable',
    ];
    for (const command of expected) {
      assert.ok(registered.includes(command), `${command} is not registered`);
    }
  });

  it('opens a .env file in the EnvShield editor without modifying it', async () => {
    const uri = fixture('.env');
    const before = await vscode.workspace.fs.readFile(uri);

    await vscode.commands.executeCommand('vscode.openWith', uri, 'envshield.envEditor');
    await delay(600);

    const after = await vscode.workspace.fs.readFile(uri);
    assert.deepEqual(
      Buffer.from(after).toString('utf8'),
      Buffer.from(before).toString('utf8'),
      'opening the secure editor must never rewrite the file',
    );

    const document = vscode.workspace.textDocuments.find(
      (candidate) => candidate.uri.toString() === uri.toString(),
    );
    if (document) {
      assert.equal(document.isDirty, false, 'the document must not be dirty after opening');
    }

    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('can still open the same file as plain text', async () => {
    const uri = fixture('.env');
    await vscode.commands.executeCommand('envshield.openAsPlainText', uri);
    await delay(400);
    const editor = vscode.window.activeTextEditor;
    assert.ok(editor, 'a text editor must be active');
    assert.equal(editor.document.uri.toString(), uri.toString());
    assert.ok(editor.document.getText().includes('API_KEY'));
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  it('toggles Streamer Mode and persists it', async () => {
    const read = (): boolean =>
      vscode.workspace.getConfiguration('envshield').get<boolean>('streamerMode', false);

    const initial = read();
    await vscode.commands.executeCommand('envshield.toggleStreamerMode');
    await delay(300);
    assert.equal(read(), !initial, 'the setting must follow the toggle');

    await vscode.commands.executeCommand('envshield.toggleStreamerMode');
    await delay(300);
    assert.equal(read(), initial, 'toggling twice must return to the initial state');
  });

  it('runs a workspace scan and reports diagnostics without values', async () => {
    await vscode.commands.executeCommand('envshield.scanWorkspace');
    await delay(1500);

    const all = vscode.languages.getDiagnostics();
    const ours = all.flatMap(([uri, diagnostics]) =>
      diagnostics
        .filter((diagnostic) => diagnostic.source === 'EnvShield')
        .map((diagnostic) => ({ uri, diagnostic })),
    );

    assert.ok(ours.length > 0, 'the fixture workspace contains fake secrets to find');
    for (const { diagnostic } of ours) {
      const message = String(diagnostic.message);
      assert.ok(!message.includes('sk-proj-0000000000000000'), 'a value leaked into a diagnostic');
      assert.ok(!message.includes('not-a-real-password'), 'a value leaked into a diagnostic');
      assert.ok(!message.includes('EXAMPLE-NOT-A-REAL'), 'a value leaked into a diagnostic');
    }
  });

  it('does not flag the template file', async () => {
    const diagnostics = vscode.languages.getDiagnostics(fixture('.env.example'));
    assert.equal(
      diagnostics.filter((diagnostic) => diagnostic.source === 'EnvShield').length,
      0,
      '.env.example must be treated as public by default',
    );
  });
});

describe('RevealRegistry', () => {
  const uri = vscode.Uri.parse('untitled:reveal-test');

  it('reveals and hides a single variable', () => {
    const registry = new RevealRegistry();
    registry.reveal(uri, 'A@0', 0);
    assert.equal(registry.isRevealed(uri, 'A@0'), true);
    assert.equal(registry.revealedCount, 1);

    registry.hide(uri, 'A@0');
    assert.equal(registry.isRevealed(uri, 'A@0'), false);
    registry.dispose();
  });

  it('re-masks automatically after the timeout', async () => {
    const registry = new RevealRegistry();
    registry.reveal(uri, 'A@0', 150);
    assert.equal(registry.isRevealed(uri, 'A@0'), true);
    await delay(400);
    assert.equal(registry.isRevealed(uri, 'A@0'), false, 'the timeout must re-mask the value');
    registry.dispose();
  });

  it('never re-masks when the timeout is zero', async () => {
    const registry = new RevealRegistry();
    registry.reveal(uri, 'A@0', 0);
    await delay(300);
    assert.equal(registry.isRevealed(uri, 'A@0'), true);
    registry.dispose();
  });

  it('hideAll cancels every pending timer', async () => {
    const registry = new RevealRegistry();
    let events = 0;
    const subscription = registry.onDidChange(() => {
      events += 1;
    });

    registry.reveal(uri, 'A@0', 1000);
    registry.reveal(uri, 'B@1', 1000);
    registry.hideAll();
    assert.equal(registry.revealedCount, 0);

    const eventsAfterHide = events;
    await delay(1200);
    assert.equal(events, eventsAfterHide, 'a cancelled timer must not fire later');

    subscription.dispose();
    registry.dispose();
  });

  it('disposing clears everything', () => {
    const registry = new RevealRegistry();
    registry.reveal(uri, 'A@0', 0);
    registry.dispose();
    assert.equal(registry.revealedCount, 0);
  });
});

describe('ScreenProtection', () => {
  it('engages providers registered before and after it is turned on', () => {
    const protection = new ScreenProtection();
    let engaged = 0;
    let disengaged = 0;

    protection.register({
      id: 'first',
      engage: () => {
        engaged += 1;
      },
      disengage: () => {
        disengaged += 1;
      },
    });

    protection.setEngaged(true);
    assert.equal(engaged, 1);

    protection.register({
      id: 'second',
      engage: () => {
        engaged += 1;
      },
      disengage: () => {
        disengaged += 1;
      },
    });
    assert.equal(engaged, 2, 'a provider registered while engaged must engage immediately');

    protection.setEngaged(false);
    assert.equal(disengaged, 2);
    protection.dispose();
  });

  it('enforce re-masks without changing the engaged state', () => {
    const protection = new ScreenProtection();
    let engaged = 0;
    protection.register({
      id: 'only',
      engage: () => {
        engaged += 1;
      },
      disengage: () => undefined,
    });

    protection.enforce();
    assert.equal(engaged, 1);
    assert.equal(protection.isEngaged, false, 'panic must not silently enable Streamer Mode');
    protection.dispose();
  });

  it('unregisters a provider when its subscription is disposed', () => {
    const protection = new ScreenProtection();
    let engaged = 0;
    const subscription = protection.register({
      id: 'temporary',
      engage: () => {
        engaged += 1;
      },
      disengage: () => undefined,
    });

    subscription.dispose();
    protection.enforce();
    assert.equal(engaged, 0);
    protection.dispose();
  });
});
