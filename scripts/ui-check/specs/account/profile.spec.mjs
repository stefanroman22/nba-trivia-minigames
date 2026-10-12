// Account suite: /profile (ProfileSettings) — username, player ID, photo with the age prompt, data export
// and account deletion. The solo account is restored in a `finally` whatever happens.
import { readFileSync } from 'node:fs';
import { test, expect, L, seedContext } from '../../lib/fixtures.mjs';
import { mintTokens, credentials, forgetAge } from '../../lib/accounts.mjs';
import { fileURLToPath } from 'node:url';
import { LOCAL_LOAD } from '../../lib/guest.mjs';
import {
  THROTTLED, HASHING, motionStep, throwawayName, apiCall, deleteAccountApi, accountExists, navState, ruleStates, dismissSwal,
} from '../../lib/account.mjs';

const AVATAR = fileURLToPath(new URL('../../fixtures/upload/avatar.png', import.meta.url));
const NAME_RULES = '.ps-note-slot ul[aria-label="Username requirements"] li.pw-rule';
const PS_WATCH = ['.ps-card', '.ps-note-slot', '.ps-stack'];

/** Open /profile, wait for the signed-in page. */
async function openProfile(audit) {
  await audit.goto('/profile', { waitFor: 'section.ps-hero' });
  await expect(audit.page.locator('section.ps-hero h1.ps-title')).toBeVisible();
}

test('[AC-PROFILE-01] @perf /profile layout; username change saves and shows in the nav and card; invalid, too long and reserved names answer inline', async ({ page, audit, vp, request, session }) => {
  test.setTimeout(240_000);
  const original = session.username;
  const renamed = `Renamed${vp.width}`;
  try {
    await openProfile(audit);
    await expect(L(page, 'account.psTitle')).toHaveText(original);
    await audit.layout();
    await audit.shot('profile');

    const input = L(page, 'account.psUsername');
    const editBtn = L(page, 'account.psUsernameBtn');

    await test.step('invalid characters', async () => {
      await editBtn.click();
      await expect(input).toHaveClass(/is-editing/);
      await motionStep(audit, 'invalid characters', async () => {
        await input.fill('bad name!');
        await expect(L(page, 'account.psNameRules').nth(1)).toHaveClass(/is-bad/);
      }, { watch: PS_WATCH, settleMs: 700 });
      expect((await ruleStates(page, NAME_RULES)).map((r) => r.state).slice(0, 2)).toEqual(['ok', 'bad']);
      await audit.shot('invalid-chars');
      await editBtn.click(); // Save
      const alert = await dismissSwal(page);
      expect(alert, 'the save is refused with an alert').toMatch(/Invalid Username|3-20/);
      await expect(L(page, 'account.psTitle')).toHaveText(original);
    });

    await test.step('too long', async () => {
      // One insert event of 26 characters (per-key typing dropped characters when the machine was busy);
      // the field's maxLength must cut it at 20 (fill() would bypass maxLength).
      await input.fill('');
      await input.focus();
      await page.keyboard.insertText('abcdefghijklmnopqrstuvwxyz');
      const value = await input.inputValue();
      if (value.length > 20) audit.violation('username-too-long', { selector: '#ps-username', measured: `${value.length} characters accepted`, expected: 'at most 20' });
      // 20 characters fit the 3-20 rule (the message shows what the field and the rules held if it never does).
      await expect.poll(async () => `${(await input.inputValue()).length} chars, rules ${(await ruleStates(page, NAME_RULES)).map((r) => r.state).join('/')}`, { timeout: 5000 }).toMatch(/^20 chars, rules ok/);
    });

    await test.step('reserved name, live server verdict', async () => {
      await motionStep(audit, 'reserved name', async () => {
        await input.fill('admin');
        await expect(L(page, 'account.psNameRules').nth(2)).toHaveClass(/is-bad/, { timeout: 10_000 });
      }, { watch: PS_WATCH, settleMs: 700 });
      const rules = await ruleStates(page, NAME_RULES);
      expect(rules).toHaveLength(3);
      expect(rules[2].label).not.toBe('Not reserved or offensive');
      await audit.shot('reserved-name');
    });

    await test.step('existing name is not "taken"', async () => {
      // Usernames repeat by design (the player ID tells them apart): testuser2's name passes every rule.
      await input.fill('testuser2');
      await expect(L(page, 'account.psNameRules').nth(2)).toHaveClass(/is-ok/, { timeout: 10_000 });
      expect((await ruleStates(page, NAME_RULES)).map((r) => r.state)).toEqual(['ok', 'ok', 'ok']);
    });

    await test.step('valid rename', async () => {
      await input.fill(renamed);
      await expect(L(page, 'account.psNameRules').nth(2)).toHaveClass(/is-ok/, { timeout: 10_000 });
      await motionStep(audit, 'rename', async () => {
        await editBtn.click(); // Save
        await expect(L(page, 'account.psTitle')).toHaveText(renamed);
        await expect(editBtn).toHaveText('Saved', { timeout: 10_000 });
      }, { watch: ['.ps-card', '.ps-hero'], settleMs: 700 });
      await expect(L(page, 'common.navUserChip')).toHaveAttribute('aria-label', new RegExp(`^${renamed} #`));
      await expect(editBtn).toHaveText('Change', { timeout: 6000 });
      await audit.shot('renamed');
      // The server has it, and the landing card shows it after a reload.
      const me = await apiCall(request, session.access, 'GET', 'me/');
      expect(me.body.user.username).toBe(renamed);
      await audit.goto('/', { waitFor: '#leaderboard .lb-card' });
      await expect(L(page, 'account.pcName')).toHaveText(renamed);
      await audit.shot('landing-card-renamed');
    });
    await audit.console({ allow: LOCAL_LOAD });
  } finally {
    const back = await apiCall(request, session.access, 'POST', 'update-profile/', { username: original });
    audit.metrics.push({ kind: 'note', label: `username restored to ${original}`, value: String(back.status), unit: '', route: '/profile' });
    const me = await apiCall(request, session.access, 'GET', 'me/');
    if (me.body?.user?.username !== original) audit.violation('cleanup', { selector: `account ${original}`, measured: `username is "${me.body?.user?.username}"`, expected: `restored to ${original}` });
  }
  await audit.done();
});

test('[AC-PROFILE-02] @perf player ID copy swaps to "Copied!" and back; a photo upload asks the age, updates the avatar; remove reverts it', async ({ page, audit, request, session }) => {
  test.setTimeout(240_000);
  await apiCall(request, session.access, 'POST', 'account/remove-photo/');
  await forgetAge([session.username]);
  try {
    await openProfile(audit);
    const copy = L(page, 'account.psCopyBtn');
    await test.step('copy player ID', async () => {
      await expect(copy).toHaveText('Copy');
      await motionStep(audit, 'copy ID', async () => {
        await copy.click();
        await expect(copy).toHaveText('Copied!', { timeout: 2000 });
      }, { watch: ['.ps-row', '.ps-card'], settleMs: 300 });
      await audit.shot('copied');
      await expect(copy).toHaveText('Copy', { timeout: 5000 });
    });

    const avatar = L(page, 'account.psAvatar');
    const state = L(page, 'account.psPhotoState');
    const before = await avatar.getAttribute('src');
    await expect(state).toHaveText('No photo');

    await test.step('upload: age prompt, then the avatar', async () => {
      await motionStep(audit, 'photo picked, age prompt opens', async () => {
        await L(page, 'account.psPhotoInput').setInputFiles(AVATAR);
        await expect(L(page, 'account.agePrompt')).toBeVisible({ timeout: 15_000 });
      }, { watch: ['.ps-card', 'form.photo-age'], settleMs: 700 });
      await audit.layout({ scope: 'main.ps-page' });
      await audit.shot('age-prompt');
      await L(page, 'account.ageMonth').selectOption('6');
      await L(page, 'account.ageYear').selectOption(String(new Date().getFullYear() - 30));
      await motionStep(audit, 'age submitted, photo uploads', async () => {
        await L(page, 'account.ageContinue').click();
        await expect(state).toHaveText('Shown to other players', { timeout: 20_000 });
        await expect(L(page, 'account.agePrompt')).toHaveCount(0, { timeout: 5000 });
      }, { watch: ['.ps-card', '.ps-hero'], settleMs: 800 });
      const after = await avatar.getAttribute('src');
      expect(after, 'avatar src changed').not.toBe(before);
      expect(after).not.toMatch(/default/);
      await expect(L(page, 'common.navUserChip').locator('img')).toBeVisible();
      await audit.shot('photo-set');
    });

    await test.step('remove photo', async () => {
      await motionStep(audit, 'remove photo', async () => {
        await L(page, 'account.psPhotoRemove').click();
        await expect(state).toHaveText('No photo', { timeout: 10_000 });
      }, { watch: ['.ps-card', '.ps-hero'], settleMs: 700 });
      expect(await avatar.getAttribute('src')).toBe(before);
      await expect(L(page, 'common.navUserChip').locator('img')).toHaveCount(0);
      await audit.shot('photo-removed');
    });
    // 428 is the designed handshake: the first upload of an account of unknown age answers age_required.
    await audit.console({ allow: [...LOCAL_LOAD, /status of 428/, /^428 POST /] });
  } finally {
    const r = await apiCall(request, session.access, 'POST', 'account/remove-photo/');
    audit.metrics.push({ kind: 'note', label: 'photo removed (cleanup)', value: String(r.status), unit: '', route: '/profile' });
  }
  await audit.done();
});

test.describe('throwaway account', () => {
  test.use({ persona: 'guest' });

  test('[AC-PROFILE-03] export downloads the data as JSON; delete account needs DELETE (and the password), then logs out', async ({ page, context, baseURL, audit, vp, request }) => {
    test.skip(!vp.core, THROTTLED);
    test.setTimeout(180_000);
    // A throwaway user made the way sign-up makes it (consent stamped), signed in with a minted session.
    const name = throwawayName(2, vp);
    const { password, email } = credentials(name);
    const tokens = (await mintTokens([name]))[name];
    await seedContext(context, baseURL, tokens);
    let deleted = false;
    try {
      await openProfile(audit);
      await expect(L(page, 'account.psTitle')).toHaveText(name);
      await audit.layout();
      await audit.shot('profile-throwaway');

      await test.step('export', async () => {
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20_000 }), L(page, 'account.psDownload').click()]);
        expect(download.suggestedFilename()).toBe('swish-quest-my-data.json');
        const file = await download.path();
        const data = JSON.parse(readFileSync(file, 'utf8'));
        expect(typeof data, 'export is a JSON object').toBe('object');
        expect(JSON.stringify(data), 'export holds this account').toContain(name);
        audit.metrics.push({ kind: 'note', label: 'export keys', value: Object.keys(data).slice(0, 8).join(','), unit: '', route: '/profile' });
      });

      await test.step('delete: guarded', async () => {
        await L(page, 'account.psDeleteToggle').click();
        await expect(L(page, 'account.psDeletePanel')).toBeVisible();
        await page.waitForTimeout(500);
        await audit.layout({ scope: 'main.ps-page' });
        await audit.shot('delete-panel');
        const confirm = L(page, 'account.psDeleteConfirm');
        await expect(confirm).toBeDisabled();
        await L(page, 'account.psDeleteWord').fill('delete');
        await expect(confirm, 'lower-case "delete" does not unlock the button').toBeDisabled();
        await L(page, 'account.psDeleteWord').fill('DELETE');
        await expect(confirm).toBeEnabled();
        // A wrong password: the server refuses, the message shows inline, the account stays.
        await L(page, 'account.psDeletePassword').fill(`${password}x`);
        await motionStep(audit, 'wrong delete password', async () => {
          await confirm.click();
          await expect(L(page, 'account.psDeleteError')).toBeVisible({ timeout: 10_000 });
        }, { watch: ['.ps-card', '.ps-delete'], settleMs: 700 });
        await expect(L(page, 'account.psDeleteError')).toContainText(/password/i);
        await expect(confirm).toBeEnabled();
        expect(await accountExists(request, email, password), 'the account is still there').toBe(true);
        await audit.shot('delete-wrong-password');
      });

      await test.step('delete: confirmed', async () => {
        await L(page, 'account.psDeletePassword').fill(password);
        await L(page, 'account.psDeleteConfirm').click();
        await expect(L(page, 'guest.profilePrompt')).toBeVisible({ timeout: 20_000 });
        expect(await navState(page)).toMatchObject({ chip: null });
        expect(await page.evaluate(() => [localStorage.getItem('accessToken'), localStorage.getItem('refreshToken')])).toEqual([null, null]);
        expect(await accountExists(request, email, password), 'the account is gone').toBe(false);
        deleted = true;
        await audit.shot('after-delete');
      });
      await audit.console({ allow: [...LOCAL_LOAD, ...HASHING, /status of 403/, /^403 POST /] });
    } finally {
      if (!deleted) {
        const status = await deleteAccountApi(request, name);
        audit.metrics.push({ kind: 'note', label: `cleanup ${name}`, value: String(status), unit: '', route: '/profile' });
      }
    }
    await audit.done();
  });
});

