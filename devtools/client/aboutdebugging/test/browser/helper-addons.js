/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

/* import-globals-from head.js */

function _getSupportsFile(path) {
  const cr = Cc["@mozilla.org/chrome/chrome-registry;1"].getService(
    Ci.nsIChromeRegistry
  );
  const uri = Services.io.newURI(CHROME_URL_ROOT + path);
  const fileurl = cr.convertChromeURL(uri);
  return fileurl.QueryInterface(Ci.nsIFileURL);
}

async function enableExtensionDebugging() {
  // Disable security prompt
  await pushPref("devtools.debugger.prompt-connection", false);
}
/* exported enableExtensionDebugging */

/**
 * Install an extension using the AddonManager so it does not show up as temporary.
 */
async function installRegularExtension(pathOrFile) {
  const isFile = typeof pathOrFile.isFile === "function" && pathOrFile.isFile();
  const file = isFile ? pathOrFile : _getSupportsFile(pathOrFile).file;
  const install = await AddonManager.getInstallForFile(file);
  return new Promise((resolve, reject) => {
    if (!install) {
      throw new Error(`An install was not created for ${file.path}`);
    }
    install.addListener({
      onDownloadFailed: reject,
      onDownloadCancelled: reject,
      onInstallFailed: reject,
      onInstallCancelled: reject,
      onInstallEnded: resolve,
    });
    install.install();
  });
}
/* exported installRegularExtension */

/**
 * Install a temporary extension at the provided path, with the provided name.
 * Will use a mock file picker to select the file.
 */
async function installTemporaryExtension(pathOrFile, name, document) {
  const { Management } = ChromeUtils.importESModule(
    "resource://gre/modules/Extension.sys.mjs"
  );

  info("Install temporary extension named " + name);
  // Mock the file picker to select a test addon
  prepareMockFilePicker(pathOrFile);

  const onAddonInstalled = new Promise(done => {
    Management.on("startup", function listener(event, extension) {
      if (extension.name != name) {
        return;
      }

      Management.off("startup", listener);
      done(extension);
    });
  });

  // Trigger the file picker by clicking on the button
  document.querySelector(".qa-temporary-extension-install-button").click();

  info("Wait for addon to be installed");
  return onAddonInstalled;
}
/* exported installTemporaryExtension */

function createTemporaryXPI(xpiData) {
  const { ExtensionTestCommon } = ChromeUtils.importESModule(
    "resource://testing-common/ExtensionTestCommon.sys.mjs"
  );

  const { background, files, id, name, extraProperties } = xpiData;
  info("Generate XPI file for " + id);

  const manifest = Object.assign(
    {},
    {
      browser_specific_settings: { gecko: { id } },
      manifest_version: 2,
      name,
      version: "1.0",
    },
    extraProperties
  );

  const xpiFile = ExtensionTestCommon.generateXPI({
    background,
    files,
    manifest,
  });
  registerCleanupFunction(() => xpiFile.exists() && xpiFile.remove(false));
  return xpiFile;
}
/* exported createTemporaryXPI */

/**
 * Remove the existing temporary XPI file generated by ExtensionTestCommon and create a
 * new one at the same location.
 * @return {File} the temporary extension XPI file created
 */
function updateTemporaryXPI(xpiData, existingXPI) {
  info("Delete and regenerate XPI for " + xpiData.id);

  // Store the current name to check the xpi is correctly replaced.
  const existingName = existingXPI.leafName;
  info("Delete existing XPI named: " + existingName);
  existingXPI.exists() && existingXPI.remove(false);

  const xpiFile = createTemporaryXPI(xpiData);
  // Check that the name of the new file is correct
  if (xpiFile.leafName !== existingName) {
    throw new Error(
      "New XPI created with unexpected name: " + xpiFile.leafName
    );
  }
  return xpiFile;
}
/* exported updateTemporaryXPI */

/**
 * Install a fake temporary extension by creating a temporary in-memory XPI file.
 * @return {File} the temporary extension XPI file created
 */
async function installTemporaryExtensionFromXPI(xpiData, document) {
  const xpiFile = createTemporaryXPI(xpiData);
  const extension = await installTemporaryExtension(
    xpiFile,
    xpiData.name,
    document
  );

  info("Wait until the addon debug target appears");
  await waitUntil(() => findDebugTargetByText(xpiData.name, document));
  return { extension, xpiFile };
}
/* exported installTemporaryExtensionFromXPI */

async function removeTemporaryExtension(name, document) {
  info(`Wait for removable extension with name: '${name}'`);
  const buttonName = ".qa-temporary-extension-remove-button";
  await waitUntil(() => {
    const extension = findDebugTargetByText(name, document);
    return extension && extension.querySelector(buttonName);
  });
  info(`Remove the temporary extension with name: '${name}'`);
  const temporaryExtensionItem = findDebugTargetByText(name, document);
  temporaryExtensionItem.querySelector(buttonName).click();

  info("Wait until the debug target item disappears");
  await waitUntil(() => !findDebugTargetByText(name, document));
}
/* exported removeTemporaryExtension */

async function removeExtension(id, name, document) {
  info(
    "Retrieve the extension instance from the addon manager, and uninstall it"
  );
  const extension = await AddonManager.getAddonByID(id);
  extension.uninstall();

  info("Wait until the addon disappears from about:debugging");
  await waitUntil(() => !findDebugTargetByText(name, document));
}
/* exported removeExtension */

function prepareMockFilePicker(pathOrFile) {
  const isFile = typeof pathOrFile.isFile === "function" && pathOrFile.isFile();
  const file = isFile ? pathOrFile : _getSupportsFile(pathOrFile).file;

  // Mock the file picker to select a test addon
  const MockFilePicker = SpecialPowers.MockFilePicker;
  MockFilePicker.init(window);
  MockFilePicker.setFiles([file]);
}
/* exported prepareMockFilePicker */

function promiseBackgroundContextEvent(extensionId, eventName) {
  const { Management } = ChromeUtils.importESModule(
    "resource://gre/modules/Extension.sys.mjs"
  );

  return new Promise(resolve => {
    Management.on(eventName, function listener(_evtName, context) {
      if (context.extension.id === extensionId) {
        Management.off(eventName, listener);
        resolve();
      }
    });
  });
}

function promiseBackgroundContextLoaded(extensionId) {
  return promiseBackgroundContextEvent(extensionId, "proxy-context-load");
}
/* exported promiseBackgroundContextLoaded */

function promiseBackgroundContextUnloaded(extensionId) {
  return promiseBackgroundContextEvent(extensionId, "proxy-context-unload");
}
/* exported promiseBackgroundContextUnloaded */

async function assertBackgroundStatus(
  extName,
  { document, expectedStatus, targetElement }
) {
  const target = targetElement || findDebugTargetByText(extName, document);
  const getBackgroundStatusElement = () =>
    target.querySelector(".extension-backgroundscript__status");
  await waitFor(
    () =>
      getBackgroundStatusElement()?.classList.contains(
        `extension-backgroundscript__status--${expectedStatus}`
      ),
    `Wait ${extName} Background script status "${expectedStatus}" to be rendered`
  );
}
/* exported assertBackgroundStatus */

function getExtensionInstance(extensionId) {
  const policy = WebExtensionPolicy.getByID(extensionId);
  ok(policy, `Got a WebExtensionPolicy instance for ${extensionId}`);
  ok(policy.extension, `Got an Extension class instance for ${extensionId}`);
  return policy.extension;
}
/* exported getExtensionInstance */

async function triggerExtensionEventPageIdleTimeout(extensionId) {
  await getExtensionInstance(extensionId).terminateBackground();
}
/* exported triggerExtensionEventPageIdleTimeout */

async function wakeupExtensionEventPage(extensionId) {
  await getExtensionInstance(extensionId).wakeupBackground();
}
/* exported wakeupExtensionEventPage */

function promiseTerminateBackgroundScriptIgnored(extensionId) {
  const extension = getExtensionInstance(extensionId);
  return new Promise(resolve => {
    extension.once("background-script-suspend-ignored", resolve);
  });
}
/* exported promiseTerminateBackgroundScriptIgnored */

async function promiseBackgroundStatusUpdate(window) {
  waitForDispatch(
    window.AboutDebugging.store,
    "EXTENSION_BGSCRIPT_STATUS_UPDATED"
  );
}
/* exported promiseBackgroundStatusUpdate */
