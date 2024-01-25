/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

ChromeUtils.defineESModuleGetters(this, {
  ADLINK_CHECK_TIMEOUT_MS:
    "resource:///actors/SearchSERPTelemetryChild.sys.mjs",
  CustomizableUITestUtils:
    "resource://testing-common/CustomizableUITestUtils.sys.mjs",
  SearchSERPTelemetry: "resource:///modules/SearchSERPTelemetry.sys.mjs",
  SearchSERPTelemetryUtils: "resource:///modules/SearchSERPTelemetry.sys.mjs",
  SearchTestUtils: "resource://testing-common/SearchTestUtils.sys.mjs",
  SearchUtils: "resource://gre/modules/SearchUtils.sys.mjs",
  TelemetryTestUtils: "resource://testing-common/TelemetryTestUtils.sys.mjs",
});

ChromeUtils.defineLazyGetter(this, "UrlbarTestUtils", () => {
  const { UrlbarTestUtils: module } = ChromeUtils.importESModule(
    "resource://testing-common/UrlbarTestUtils.sys.mjs"
  );
  module.init(this);
  return module;
});

ChromeUtils.defineLazyGetter(this, "searchCounts", () => {
  return Services.telemetry.getKeyedHistogramById("SEARCH_COUNTS");
});

ChromeUtils.defineLazyGetter(this, "SEARCH_AD_CLICK_SCALARS", () => {
  const sources = [
    ...BrowserSearchTelemetry.KNOWN_SEARCH_SOURCES.values(),
    "unknown",
  ];
  return [
    ...sources.map(v => `browser.search.withads.${v}`),
    ...sources.map(v => `browser.search.adclicks.${v}`),
  ];
});

let gCUITestUtils = new CustomizableUITestUtils(window);

SearchTestUtils.init(this);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// sharedData messages are only passed to the child on idle. Therefore
// we wait for a few idles to try and ensure the messages have been able
// to be passed across and handled.
async function waitForIdle() {
  for (let i = 0; i < 10; i++) {
    await new Promise(resolve => Services.tm.idleDispatchToMainThread(resolve));
  }
}

function getPageUrl(useAdPage = false) {
  let page = useAdPage ? "searchTelemetryAd.html" : "searchTelemetry.html";
  return `https://example.org/browser/browser/components/search/test/browser/telemetry/${page}`;
}

function getSERPUrl(page, organic = false) {
  let url =
    getRootDirectory(gTestPath).replace(
      "chrome://mochitests/content",
      "https://example.org"
    ) + page;
  return `${url}?s=test${organic ? "" : "&abc=ff"}`;
}

async function typeInSearchField(browser, text, fieldName) {
  await SpecialPowers.spawn(
    browser,
    [[fieldName, text]],
    async function ([contentFieldName, contentText]) {
      // Put the focus on the search box.
      let searchInput = content.document.getElementById(contentFieldName);
      searchInput.focus();
      searchInput.value = contentText;
    }
  );
}

async function searchInSearchbar(inputText, win = window) {
  await new Promise(r => waitForFocus(r, win));
  let sb = win.BrowserSearch.searchBar;
  // Write the search query in the searchbar.
  sb.focus();
  sb.value = inputText;
  sb.textbox.controller.startSearch(inputText);
  // Wait for the popup to show.
  await BrowserTestUtils.waitForEvent(sb.textbox.popup, "popupshown");
  // And then for the search to complete.
  await TestUtils.waitForCondition(
    () =>
      sb.textbox.controller.searchStatus >=
      Ci.nsIAutoCompleteController.STATUS_COMPLETE_NO_MATCH,
    "The search in the searchbar must complete."
  );
  return sb.textbox.popup;
}

// Ad links are processed after a small delay. We need to allow tests to wait
// for that before checking telemetry, otherwise the received values may be
// too small in some cases.
function promiseWaitForAdLinkCheck() {
  return new Promise(resolve =>
    /* eslint-disable-next-line mozilla/no-arbitrary-setTimeout */
    setTimeout(resolve, ADLINK_CHECK_TIMEOUT_MS)
  );
}

async function assertSearchSourcesTelemetry(
  expectedHistograms,
  expectedScalars
) {
  let histSnapshot = {};
  let scalars = {};

  // This used to rely on the implied 100ms initial timer of
  // TestUtils.waitForCondition. See bug 1515466.
  await new Promise(resolve => setTimeout(resolve, 100));

  await TestUtils.waitForCondition(() => {
    histSnapshot = searchCounts.snapshot();
    return (
      Object.getOwnPropertyNames(histSnapshot).length ==
      Object.getOwnPropertyNames(expectedHistograms).length
    );
  }, "should have the correct number of histograms");

  if (Object.entries(expectedScalars).length) {
    await TestUtils.waitForCondition(() => {
      scalars =
        Services.telemetry.getSnapshotForKeyedScalars("main", false).parent ||
        {};
      return Object.getOwnPropertyNames(expectedScalars).every(
        scalar => scalar in scalars
      );
    }, "should have the expected keyed scalars");
  }

  Assert.equal(
    Object.getOwnPropertyNames(histSnapshot).length,
    Object.getOwnPropertyNames(expectedHistograms).length,
    "Should only have one key"
  );

  for (let [key, value] of Object.entries(expectedHistograms)) {
    Assert.ok(
      key in histSnapshot,
      `Histogram should have the expected key: ${key}`
    );
    Assert.equal(
      histSnapshot[key].sum,
      value,
      `Should have counted the correct number of visits for ${key}`
    );
  }

  for (let [name, value] of Object.entries(expectedScalars)) {
    Assert.ok(name in scalars, `Scalar ${name} should have been added.`);
    Assert.deepEqual(
      scalars[name],
      value,
      `Should have counted the correct number of visits for ${name}`
    );
  }

  for (let name of SEARCH_AD_CLICK_SCALARS) {
    Assert.equal(
      name in scalars,
      name in expectedScalars,
      `Should have matched ${name} in scalars and expectedScalars`
    );
  }
}

function resetTelemetry() {
  searchCounts.clear();
  Services.telemetry.clearScalars();
  Services.fog.testResetFOG();
}

/**
 * First checks that we get the correct number of recorded Glean impression events
 * and the recorded Glean impression events have the correct keys and values.
 *
 * Then it checks that there are the the correct engagement events associated with the
 * impression events.
 *
 * @param {Array} expectedEvents The expected impression events whose keys and
 * values we use to validate the recorded Glean impression events.
 */
function assertSERPTelemetry(expectedEvents) {
  // A single test might run assertImpressionEvents more than once
  // so the Set needs to be cleared or else the impression event
  // check will throw.
  const impressionIdsSet = new Set();

  let recordedImpressions = Glean.serp.impression.testGetValue() ?? [];

  Assert.equal(
    recordedImpressions.length,
    expectedEvents.length,
    "Number of impressions matches expected events."
  );

  // Assert the impression events.
  for (let [idx, expectedEvent] of expectedEvents.entries()) {
    let impressionId = recordedImpressions[idx].extra.impression_id;
    Assert.ok(
      UUID_REGEX.test(impressionId),
      "Impression has an impression_id with a valid UUID."
    );

    Assert.ok(
      !impressionIdsSet.has(impressionId),
      "Impression has a unique impression_id."
    );

    impressionIdsSet.add(impressionId);

    // If we want to use deepEqual checks, we have to add the impressionId
    // to each impression since they are randomly generated at runtime.
    expectedEvent.impression.impression_id = impressionId;

    Assert.deepEqual(
      recordedImpressions[idx].extra,
      expectedEvent.impression,
      "Matching SERP impression values."
    );

    // Once the impression check is sufficient, add the impression_id to
    // each of the expected engagements, ad impressions, and abandonments for
    // deep equal checks.
    if (expectedEvent.engagements) {
      for (let expectedEngagment of expectedEvent.engagements) {
        expectedEngagment.impression_id = impressionId;
      }
    }
    if (expectedEvent.adImpressions) {
      for (let adImpression of expectedEvent.adImpressions) {
        adImpression.impression_id = impressionId;
      }
    }
    if (expectedEvent.abandonment) {
      expectedEvent.abandonment.impression_id = impressionId;
    }
  }

  // Group engagement events into separate array fetchable by their
  // impression_id.
  let recordedEngagements = Glean.serp.engagement.testGetValue() ?? [];
  let idToEngagements = new Map();
  let totalExpectedEngagements = 0;

  for (let recordedEngagement of recordedEngagements) {
    let impressionId = recordedEngagement.extra.impression_id;
    Assert.ok(impressionId, "Engagement event has impression_id.");

    let arr = idToEngagements.get(impressionId) ?? [];
    arr.push(recordedEngagement.extra);

    idToEngagements.set(impressionId, arr);
  }

  // Assert the engagement events.
  for (let expectedEvent of expectedEvents) {
    let impressionId = expectedEvent.impression.impression_id;
    let expectedEngagements = expectedEvent.engagements;
    if (expectedEngagements) {
      let recorded = idToEngagements.get(impressionId);
      Assert.deepEqual(
        recorded,
        expectedEngagements,
        "Matching engagement value."
      );
      totalExpectedEngagements += expectedEngagements.length;
    }
  }

  Assert.equal(
    recordedEngagements.length,
    totalExpectedEngagements,
    "Number of engagements"
  );

  let recordedAdImpressions = Glean.serp.adImpression.testGetValue() ?? [];
  let idToAdImpressions = new Map();
  let totalExpectedAdImpressions = 0;

  // The list of ad impressions are contained in a flat list. Separate them
  // into arrays organized by impressionId to make it easier to determine if
  // the page load that matches the expected ads on the page.
  for (let recordedAdImpression of recordedAdImpressions) {
    let impressionId = recordedAdImpression.extra.impression_id;
    Assert.ok(impressionId, "Ad impression has impression_id");

    let arr = idToAdImpressions.get(impressionId) ?? [];
    arr.push(recordedAdImpression.extra);
    idToAdImpressions.set(impressionId, arr);
  }

  for (let expectedEvent of expectedEvents) {
    let impressionId = expectedEvent.impression.impression_id;
    let expectedAdImpressions = expectedEvent.adImpressions ?? [];
    if (expectedAdImpressions.length) {
      let recorded = idToAdImpressions.get(impressionId) ?? {};
      Assert.deepEqual(
        recorded,
        expectedAdImpressions,
        "Matching ad impression value."
      );
    }
    totalExpectedAdImpressions += expectedAdImpressions.length;
  }

  Assert.equal(
    recordedAdImpressions.length,
    totalExpectedAdImpressions,
    "Recorded and expected ad impression counts match."
  );

  // Assert abandonment events.
  let recordedAbandonments = Glean.serp.abandonment.testGetValue() ?? [];
  let idTorecordedAbandonments = new Map();
  let totalExpectedrecordedAbandonments = 0;

  for (let recordedAbandonment of recordedAbandonments) {
    let impressionId = recordedAbandonment.extra.impression_id;
    Assert.ok(impressionId, "Abandonment event has an impression_id.");
    idTorecordedAbandonments.set(impressionId, recordedAbandonment.extra);
  }

  for (let expectedEvent of expectedEvents) {
    let impressionId = expectedEvent.impression.impression_id;
    let expectedAbandonment = expectedEvent.abandonment;
    if (expectedAbandonment) {
      let recorded = idTorecordedAbandonments.get(impressionId);
      Assert.deepEqual(
        recorded,
        expectedAbandonment,
        "Matching abandonment value."
      );
    }
    totalExpectedrecordedAbandonments += expectedAbandonment ? 1 : 0;
  }

  Assert.equal(
    recordedAbandonments.length,
    totalExpectedrecordedAbandonments,
    "Recorded and expected abandonment counts match."
  );
}

function waitForPageWithAdImpressions() {
  return TestUtils.topicObserved("reported-page-with-ad-impressions");
}

function waitForPageWithCategorizedDomains() {
  return TestUtils.topicObserved("reported-page-with-categorized-domains");
}

registerCleanupFunction(async () => {
  await PlacesUtils.history.clear();
});

async function mockRecordWithAttachment({ id, version, filename }) {
  // Get the bytes of the file for the hash and size for attachment metadata.
  let data = await IOUtils.readUTF8(getTestFilePath(filename));
  let buffer = new TextEncoder().encode(data).buffer;
  let stream = Cc["@mozilla.org/io/arraybuffer-input-stream;1"].createInstance(
    Ci.nsIArrayBufferInputStream
  );
  stream.setData(buffer, 0, buffer.byteLength);

  // Generate a hash.
  let hasher = Cc["@mozilla.org/security/hash;1"].createInstance(
    Ci.nsICryptoHash
  );
  hasher.init(Ci.nsICryptoHash.SHA256);
  hasher.updateFromStream(stream, -1);
  let hash = hasher.finish(false);
  hash = Array.from(hash, (_, i) =>
    ("0" + hash.charCodeAt(i).toString(16)).slice(-2)
  ).join("");

  let record = {
    id,
    version,
    attachment: {
      hash,
      location: `main-workspace/search-categorization/${filename}`,
      filename,
      size: buffer.byteLength,
      mimetype: "application/json",
    },
  };

  let attachment = {
    record,
    blob: new Blob([buffer]),
  };

  return { record, attachment };
}
