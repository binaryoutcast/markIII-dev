/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/**
 * Tests the effect of unchecking the never-translate-language menuitem, removing
 * the language from the never-translate languages list.
 * The translations button should reappear.
 */
add_task(async function test_uncheck_never_translate_language_shows_button() {
  const { cleanup, runInPage } = await loadTestPage({
    page: SPANISH_PAGE_URL,
    languagePairs: LANGUAGE_PAIRS,
    prefs: [["browser.translations.neverTranslateLanguages", "es"]],
  });

  await assertTranslationsButton(
    { button: true, circleArrows: false, locale: false, icon: true },
    "The translations button is available"
  );

  await assertPageIsUntranslated(runInPage);

  await openTranslationsPanel({
    openFromAppMenu: true,
    onOpenPanel: assertPanelDefaultView,
  });
  await openTranslationsSettingsMenu();

  await assertIsNeverTranslateLanguage("es", { checked: true });
  await clickNeverTranslateLanguage();
  await assertIsNeverTranslateLanguage("es", { checked: false });

  await cleanup();
});
