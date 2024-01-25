/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

const { CustomizableUITestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/CustomizableUITestUtils.sys.mjs"
);

const BASE_URL =
  "https://example.com/browser/browser/components/reportbrokensite/test/browser/";

const REPORTABLE_PAGE_URL = "https://example.com";

const REPORTABLE_PAGE_URL2 = REPORTABLE_PAGE_URL.replace(".com", ".org");

const NEW_REPORT_ENDPOINT_TEST_URL = `${BASE_URL}/sendMoreInfoTestEndpoint.html`;

const PREFS = {
  DATAREPORTING_ENABLED: "datareporting.healthreport.uploadEnabled",
  REPORTER_ENABLED: "ui.new-webcompat-reporter.enabled",
  REASON: "ui.new-webcompat-reporter.reason-dropdown",
  SEND_MORE_INFO: "ui.new-webcompat-reporter.send-more-info-link",
  NEW_REPORT_ENDPOINT: "ui.new-webcompat-reporter.new-report-endpoint",
  REPORT_SITE_ISSUE_ENABLED: "extensions.webcompat-reporter.enabled",
  PREFERS_CONTRAST_ENABLED: "layout.css.prefers-contrast.enabled",
  USE_ACCESSIBILITY_THEME: "ui.useAccessibilityTheme",
};

function add_common_setup() {
  add_setup(async function () {
    await SpecialPowers.pushPrefEnv({
      set: [[PREFS.NEW_REPORT_ENDPOINT, NEW_REPORT_ENDPOINT_TEST_URL]],
    });
    registerCleanupFunction(function () {
      for (const prefName of Object.values(PREFS)) {
        Services.prefs.clearUserPref(prefName);
      }
    });
  });
}

function clickAndAwait(toClick, evt, target) {
  const menuPromise = BrowserTestUtils.waitForEvent(target, evt);
  EventUtils.synthesizeMouseAtCenter(toClick, {}, window);
  return menuPromise;
}

async function openTab(url, win) {
  const options = {
    gBrowser:
      win?.gBrowser ||
      Services.wm.getMostRecentWindow("navigator:browser").gBrowser,
    url,
  };
  return BrowserTestUtils.openNewForegroundTab(options);
}

async function changeTab(tab, url) {
  BrowserTestUtils.startLoadingURIString(tab.linkedBrowser, url);
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
}

function closeTab(tab) {
  BrowserTestUtils.removeTab(tab);
}

function switchToWindow(win) {
  const promises = [
    BrowserTestUtils.waitForEvent(win, "focus"),
    BrowserTestUtils.waitForEvent(win, "activate"),
  ];
  win.focus();
  return Promise.all(promises);
}

function isSelectedTab(win, tab) {
  const selectedTab = win.document.querySelector(".tabbrowser-tab[selected]");
  is(selectedTab, tab);
}

function ensureReportBrokenSitePreffedOn() {
  Services.prefs.setBoolPref(PREFS.DATAREPORTING_ENABLED, true);
  Services.prefs.setBoolPref(PREFS.REPORTER_ENABLED, true);
}

function ensureReportBrokenSitePreffedOff() {
  Services.prefs.setBoolPref(PREFS.REPORTER_ENABLED, false);
}

function ensureReportSiteIssuePreffedOn() {
  Services.prefs.setBoolPref(PREFS.REPORT_SITE_ISSUE_ENABLED, true);
}

function ensureReportSiteIssuePreffedOff() {
  Services.prefs.setBoolPref(PREFS.REPORT_SITE_ISSUE_ENABLED, false);
}

function ensureSendMoreInfoEnabled() {
  Services.prefs.setBoolPref(PREFS.SEND_MORE_INFO, true);
}

function ensureSendMoreInfoDisabled() {
  Services.prefs.setBoolPref(PREFS.SEND_MORE_INFO, false);
}

function ensureReasonDisabled() {
  Services.prefs.setIntPref(PREFS.REASON, 0);
}

function ensureReasonOptional() {
  Services.prefs.setIntPref(PREFS.REASON, 1);
}

function ensureReasonRequired() {
  Services.prefs.setIntPref(PREFS.REASON, 2);
}

function isMenuItemEnabled(menuItem, itemDesc) {
  ok(!menuItem.hidden, `${itemDesc} menu item is shown`);
  ok(!menuItem.disabled, `${itemDesc} menu item is enabled`);
}

function isMenuItemHidden(menuItem, itemDesc) {
  ok(
    !menuItem || menuItem.hidden || !BrowserTestUtils.is_visible(menuItem),
    `${itemDesc} menu item is hidden`
  );
}

function isMenuItemDisabled(menuItem, itemDesc) {
  ok(!menuItem.hidden, `${itemDesc} menu item is shown`);
  ok(menuItem.disabled, `${itemDesc} menu item is disabled`);
}

class ReportBrokenSiteHelper {
  sourceMenu = undefined;
  win = undefined;

  constructor(sourceMenu) {
    this.sourceMenu = sourceMenu;
    this.win = sourceMenu.win;
  }

  getViewNode(id) {
    return PanelMultiView.getViewNode(this.win.document, id);
  }

  get mainView() {
    return this.getViewNode("report-broken-site-popup-mainView");
  }

  get sentView() {
    return this.getViewNode("report-broken-site-popup-reportSentView");
  }

  get openPanel() {
    return this.mainView?.closest("panel");
  }

  get opened() {
    return this.openPanel?.hasAttribute("panelopen");
  }

  async open(triggerMenuItem) {
    const window = triggerMenuItem.ownerGlobal;
    const shownPromise = BrowserTestUtils.waitForEvent(
      this.mainView,
      "ViewShown"
    );
    const focusPromise = BrowserTestUtils.waitForEvent(this.URLInput, "focus");
    await EventUtils.synthesizeMouseAtCenter(triggerMenuItem, {}, window);
    await shownPromise;
    await focusPromise;
  }

  async #assertClickAndViewChanges(button, view, newView, newFocus) {
    ok(view.closest("panel").hasAttribute("panelopen"), "Panel is open");
    ok(BrowserTestUtils.is_visible(button), "Button is visible");
    ok(!button.disabled, "Button is enabled");
    const promises = [];
    if (newView) {
      if (newView.nodeName == "panel") {
        promises.push(BrowserTestUtils.waitForEvent(newView, "popupshown"));
      } else {
        promises.push(BrowserTestUtils.waitForEvent(newView, "ViewShown"));
      }
    } else {
      promises.push(BrowserTestUtils.waitForEvent(view, "ViewHiding"));
    }
    if (newFocus) {
      promises.push(BrowserTestUtils.waitForEvent(newFocus, "focus"));
    }
    EventUtils.synthesizeMouseAtCenter(button, {}, this.win);
    await Promise.all(promises);
  }

  async awaitReportSentViewOpened() {
    await Promise.all([
      BrowserTestUtils.waitForEvent(this.sentView, "ViewShown"),
      BrowserTestUtils.waitForEvent(this.okayButton, "focus"),
    ]);
  }

  async clickSend() {
    await this.#assertClickAndViewChanges(
      this.sendButton,
      this.mainView,
      this.sentView,
      this.okayButton
    );
  }

  waitForSendMoreInfoTab() {
    return BrowserTestUtils.waitForNewTab(
      this.win.gBrowser,
      NEW_REPORT_ENDPOINT_TEST_URL
    );
  }

  async clickSendMoreInfo() {
    const newTabPromise = this.waitForSendMoreInfoTab();
    EventUtils.synthesizeMouseAtCenter(this.sendMoreInfoLink, {}, this.win);
    const newTab = await newTabPromise;
    const receivedData = await SpecialPowers.spawn(
      newTab.linkedBrowser,
      [],
      async function () {
        await content.wrappedJSObject.messageArrived;
        return content.wrappedJSObject.message;
      }
    );
    this.win.gBrowser.removeCurrentTab();
    return receivedData;
  }

  async clickCancel() {
    await this.#assertClickAndViewChanges(this.cancelButton, this.mainView);
  }

  async clickOkay() {
    await this.#assertClickAndViewChanges(this.okayButton, this.sentView);
  }

  async clickBack() {
    await this.#assertClickAndViewChanges(
      this.backButton,
      this.sourceMenu.popup
    );
  }

  isBackButtonEnabled() {
    ok(BrowserTestUtils.is_visible(this.backButton), "Back button is visible");
    ok(!this.backButton.disabled, "Back button is enabled");
  }

  close() {
    if (this.opened) {
      this.openPanel?.hidePopup(false);
    }
    this.sourceMenu?.close();
  }

  // UI element getters
  get URLInput() {
    return this.getViewNode("report-broken-site-popup-url");
  }

  get URLInvalidMessage() {
    return this.getViewNode("report-broken-site-popup-invalid-url-msg");
  }

  get reasonInput() {
    return this.getViewNode("report-broken-site-popup-reason");
  }

  get reasonDropdownPopup() {
    return this.reasonInput.querySelector("menupopup");
  }

  get reasonRequiredMessage() {
    return this.getViewNode("report-broken-site-popup-missing-reason-msg");
  }

  get reasonLabelRequired() {
    return this.getViewNode("report-broken-site-popup-reason-label");
  }

  get reasonLabelOptional() {
    return this.getViewNode("report-broken-site-popup-reason-optional-label");
  }

  get descriptionTextarea() {
    return this.getViewNode("report-broken-site-popup-description");
  }

  get sendMoreInfoLink() {
    return this.getViewNode("report-broken-site-popup-send-more-info-link");
  }

  get backButton() {
    return this.mainView.querySelector(".subviewbutton-back");
  }

  get sendButton() {
    return this.getViewNode("report-broken-site-popup-send-button");
  }

  get cancelButton() {
    return this.getViewNode("report-broken-site-popup-cancel-button");
  }

  get okayButton() {
    return this.getViewNode("report-broken-site-popup-okay-button");
  }

  // Test helpers

  #setInput(input, value) {
    input.value = value;
    input.dispatchEvent(
      new UIEvent("input", { bubbles: true, view: this.win })
    );
  }

  setURL(value) {
    this.#setInput(this.URLInput, value);
  }

  chooseReason(value) {
    const item = this.getViewNode(`report-broken-site-popup-reason-${value}`);
    const input = this.reasonInput;
    input.selectedItem = item;
    input.dispatchEvent(
      new UIEvent("command", { bubbles: true, view: this.win })
    );
  }

  dismissDropdownPopup() {
    const menuPromise = BrowserTestUtils.waitForEvent(
      this.reasonDropdownPopup,
      "popuphidden"
    );
    EventUtils.synthesizeKey("KEY_Escape");
    return menuPromise;
  }

  setDescription(value) {
    this.#setInput(this.descriptionTextarea, value);
  }

  isURL(expected) {
    is(this.URLInput.value, expected);
  }

  isURLInvalidMessageShown() {
    ok(
      BrowserTestUtils.is_visible(this.URLInvalidMessage),
      "'Please enter a valid URL' message is shown"
    );
  }

  isURLInvalidMessageHidden() {
    ok(
      !BrowserTestUtils.is_visible(this.URLInvalidMessage),
      "'Please enter a valid URL' message is hidden"
    );
  }

  isReasonNeededMessageShown() {
    ok(
      BrowserTestUtils.is_visible(this.reasonRequiredMessage),
      "'Please choose a reason' message is shown"
    );
  }

  isReasonNeededMessageHidden() {
    ok(
      !BrowserTestUtils.is_visible(this.reasonRequiredMessage),
      "'Please choose a reason' message is hidden"
    );
  }

  isSendButtonEnabled() {
    ok(BrowserTestUtils.is_visible(this.sendButton), "Send button is visible");
    ok(!this.sendButton.disabled, "Send button is enabled");
  }

  isSendButtonDisabled() {
    ok(BrowserTestUtils.is_visible(this.sendButton), "Send button is visible");
    ok(this.sendButton.disabled, "Send button is disabled");
  }

  isSendMoreInfoShown() {
    ok(
      BrowserTestUtils.is_visible(this.sendMoreInfoLink),
      "send more info is shown"
    );
  }

  isSendMoreInfoHidden() {
    ok(
      !BrowserTestUtils.is_visible(this.sendMoreInfoLink),
      "send more info is hidden"
    );
  }

  isSendMoreInfoShownOrHiddenAppropriately() {
    if (Services.prefs.getBoolPref(PREFS.SEND_MORE_INFO)) {
      this.isSendMoreInfoShown();
    } else {
      this.isSendMoreInfoHidden();
    }
  }

  isReasonHidden() {
    ok(
      !BrowserTestUtils.is_visible(this.reasonInput),
      "reason drop-down is hidden"
    );
    ok(
      !BrowserTestUtils.is_visible(this.reasonLabelOptional),
      "optional reason label is hidden"
    );
    ok(
      !BrowserTestUtils.is_visible(this.reasonLabelRequired),
      "required reason label is hidden"
    );
  }

  isReasonRequired() {
    ok(
      BrowserTestUtils.is_visible(this.reasonInput),
      "reason drop-down is shown"
    );
    ok(
      !BrowserTestUtils.is_visible(this.reasonLabelOptional),
      "optional reason label is hidden"
    );
    ok(
      BrowserTestUtils.is_visible(this.reasonLabelRequired),
      "required reason label is shown"
    );
  }

  isReasonOptional() {
    ok(
      BrowserTestUtils.is_visible(this.reasonInput),
      "reason drop-down is shown"
    );
    ok(
      BrowserTestUtils.is_visible(this.reasonLabelOptional),
      "optional reason label is shown"
    );
    ok(
      !BrowserTestUtils.is_visible(this.reasonLabelRequired),
      "required reason label is hidden"
    );
  }

  isReasonShownOrHiddenAppropriately() {
    const pref = Services.prefs.getIntPref(PREFS.REASON);
    if (pref == 2) {
      this.isReasonOptional();
    } else if (pref == 1) {
      this.isReasonOptional();
    } else {
      this.isReasonHidden();
    }
  }

  isDescription(expected) {
    return this.descriptionTextarea.value == expected;
  }

  isMainViewResetToCurrentTab() {
    this.isURL(this.win.gBrowser.selectedBrowser.currentURI.spec);
    this.isDescription("");
    this.isReasonShownOrHiddenAppropriately();
    this.isSendMoreInfoShownOrHiddenAppropriately();
  }
}

class MenuHelper {
  menuDescription = undefined;

  win = undefined;

  constructor(win = window) {
    this.win = win;
  }

  getViewNode(id) {
    return PanelMultiView.getViewNode(this.win.document, id);
  }

  get showsBackButton() {
    return true;
  }

  get reportBrokenSite() {}

  get reportSiteIssue() {}

  get popup() {}

  get opened() {
    return this.popup?.hasAttribute("panelopen");
  }

  async open() {}

  async close() {}

  isReportBrokenSiteDisabled() {
    return isMenuItemDisabled(this.reportBrokenSite, this.menuDescription);
  }

  isReportBrokenSiteEnabled() {
    return isMenuItemEnabled(this.reportBrokenSite, this.menuDescription);
  }

  isReportBrokenSiteHidden() {
    return isMenuItemHidden(this.reportBrokenSite, this.menuDescription);
  }

  isReportSiteIssueDisabled() {
    return isMenuItemDisabled(this.reportSiteIssue, this.menuDescription);
  }

  isReportSiteIssueEnabled() {
    return isMenuItemEnabled(this.reportSiteIssue, this.menuDescription);
  }

  isReportSiteIssueHidden() {
    return isMenuItemHidden(this.reportSiteIssue, this.menuDescription);
  }

  async openReportBrokenSite() {
    if (!this.opened) {
      await this.open();
    }
    isMenuItemEnabled(this.reportBrokenSite, this.menuDescription);
    const rbs = new ReportBrokenSiteHelper(this);
    await rbs.open(this.reportBrokenSite);
    return rbs;
  }

  async openAndPrefillReportBrokenSite(url = null, description = "") {
    let rbs = await this.openReportBrokenSite();
    rbs.isMainViewResetToCurrentTab();
    if (url) {
      rbs.setURL(url);
    }
    if (description) {
      rbs.setDescription(description);
    }
    return rbs;
  }
}

class AppMenuHelper extends MenuHelper {
  menuDescription = "AppMenu";

  get reportBrokenSite() {
    return this.getViewNode("appMenu-report-broken-site-button");
  }

  get reportSiteIssue() {
    return undefined;
  }

  get popup() {
    return this.win.document.getElementById("appMenu-popup");
  }

  async open() {
    await new CustomizableUITestUtils(this.win).openMainMenu();
  }

  async close() {
    if (this.opened) {
      await new CustomizableUITestUtils(this.win).hideMainMenu();
    }
  }
}

class AppMenuHelpSubmenuHelper extends MenuHelper {
  menuDescription = "AppMenu help sub-menu";

  get reportBrokenSite() {
    return this.getViewNode("appMenu_help_reportBrokenSite");
  }

  get reportSiteIssue() {
    return this.getViewNode("appMenu_help_reportSiteIssue");
  }

  get popup() {
    return this.win.document.getElementById("appMenu-popup");
  }

  async open() {
    await new CustomizableUITestUtils(this.win).openMainMenu();

    const anchor = this.win.document.getElementById("PanelUI-menu-button");
    this.win.PanelUI.showHelpView(anchor);

    const appMenuHelpSubview = this.getViewNode("PanelUI-helpView");
    await BrowserTestUtils.waitForEvent(appMenuHelpSubview, "ViewShown");
  }

  async close() {
    if (this.opened) {
      await new CustomizableUITestUtils(this.win).hideMainMenu();
    }
  }
}

class HelpMenuHelper extends MenuHelper {
  menuDescription = "Help Menu";

  get showsBackButton() {
    return false;
  }

  get reportBrokenSite() {
    return this.win.document.getElementById("help_reportBrokenSite");
  }

  get reportSiteIssue() {
    return this.win.document.getElementById("help_reportSiteIssue");
  }

  get popup() {
    return this.getViewNode("PanelUI-helpView");
  }

  get helpMenu() {
    return this.win.document.getElementById("menu_HelpPopup");
  }

  async openReportBrokenSite() {
    // We can't actually open the Help menu properly in testing, so the best
    // we can do to open its Report Broken Site panel is to force its DOM to be
    // prepared, and then soft-click the Report Broken Site menuitem to open it.
    await this.open();
    const shownPromise = BrowserTestUtils.waitForEvent(
      this.win,
      "ViewShown",
      true,
      e => e.target.classList.contains("report-broken-site-view")
    );
    this.reportBrokenSite.click();
    await shownPromise;
    return new ReportBrokenSiteHelper(this);
  }

  async open() {
    const { helpMenu } = this;
    const promise = BrowserTestUtils.waitForEvent(helpMenu, "popupshown");

    // This event-faking method was copied from browser_title_case_menus.js.
    // We can't actually open the Help menu in testing, but this lets us
    // force its DOM to be properly built.
    helpMenu.dispatchEvent(new MouseEvent("popupshowing", { bubbles: true }));
    helpMenu.dispatchEvent(new MouseEvent("popupshown", { bubbles: true }));

    await promise;
  }

  async close() {
    const { helpMenu } = this;
    const promise = BrowserTestUtils.waitForEvent(helpMenu, "popuphidden");

    // (Also copied from browser_title_case_menus.js)
    // Just for good measure, we'll fire the popuphiding/popuphidden events
    // after we close the menupopups.
    helpMenu.dispatchEvent(new MouseEvent("popuphiding", { bubbles: true }));
    helpMenu.dispatchEvent(new MouseEvent("popuphidden", { bubbles: true }));

    await promise;
  }
}

class ProtectionsPanelHelper extends MenuHelper {
  menuDescription = "Protections Panel";

  get reportBrokenSite() {
    this.win.gProtectionsHandler._initializePopup();
    return this.getViewNode("protections-popup-report-broken-site-button");
  }

  get reportSiteIssue() {
    return undefined;
  }

  get popup() {
    this.win.gProtectionsHandler._initializePopup();
    return this.win.document.getElementById("protections-popup");
  }

  async open() {
    const promise = BrowserTestUtils.waitForEvent(
      this.win,
      "popupshown",
      true,
      e => e.target.id == "protections-popup"
    );
    this.win.gProtectionsHandler.showProtectionsPopup();
    await promise;
  }

  async close() {
    if (this.opened) {
      const popup = this.popup;
      const promise = BrowserTestUtils.waitForEvent(popup, "popuphidden");
      PanelMultiView.hidePopup(popup, false);
      await promise;
    }
  }
}

function AppMenu(win = window) {
  return new AppMenuHelper(win);
}

function AppMenuHelpSubmenu(win = window) {
  return new AppMenuHelpSubmenuHelper(win);
}

function HelpMenu(win = window) {
  return new HelpMenuHelper(win);
}

function ProtectionsPanel(win = window) {
  return new ProtectionsPanelHelper(win);
}

function pressKeyAndAwait(event, key, config = {}) {
  const win = config.window || window;
  if (!event.then) {
    event = BrowserTestUtils.waitForEvent(win, event, config.timeout || 200);
  }
  EventUtils.synthesizeKey(key, config, win);
  return event;
}

async function pressKeyAndGetFocus(key, config = {}) {
  return (await pressKeyAndAwait("focus", key, config)).target;
}

async function tabTo(match, win = window) {
  const config = { window: win };
  const { activeElement } = win.document;
  if (activeElement?.matches(match)) {
    return activeElement;
  }
  let initial = await pressKeyAndGetFocus("VK_TAB", config);
  let target = initial;
  do {
    if (target.matches(match)) {
      return target;
    }
    target = await pressKeyAndGetFocus("VK_TAB", config);
  } while (target && target !== initial);
  return undefined;
}
