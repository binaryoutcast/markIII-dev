/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

// Sanity test that we can show allocation stack work when loading a new page

"use strict";

const {
  toggleRecordingAllocationStacks,
} = require("resource://devtools/client/memory/actions/allocations.js");
const {
  takeSnapshotAndCensus,
} = require("resource://devtools/client/memory/actions/snapshot.js");
const censusDisplayActions = require("resource://devtools/client/memory/actions/census-display.js");
const { viewState } = require("resource://devtools/client/memory/constants.js");
const {
  changeView,
} = require("resource://devtools/client/memory/actions/view.js");

const TEST_URL =
  "https://example.com/browser/devtools/client/memory/test/browser/doc_steady_allocation.html";

this.test = makeMemoryTest("about:blank", async function ({ tab, panel }) {
  const heapWorker = panel.panelWin.gHeapAnalysesClient;
  const { getState, dispatch } = panel.panelWin.gStore;
  const doc = panel.panelWin.document;

  dispatch(changeView(viewState.CENSUS));

  dispatch(
    censusDisplayActions.setCensusDisplay(
      censusDisplays.invertedAllocationStack
    )
  );
  is(getState().censusDisplay.breakdown.by, "allocationStack");

  await dispatch(toggleRecordingAllocationStacks(panel._commands));
  ok(getState().allocations.recording);

  await navigateTo(TEST_URL);

  const front = getState().front;
  await dispatch(takeSnapshotAndCensus(front, heapWorker));

  const names = [...doc.querySelectorAll(".frame-link-function-display-name")];
  ok(names.length, "Should have rendered some allocation stack tree items");
  ok(
    names.some(e => !!e.textContent.trim()),
    "And at least some of them should have functionDisplayNames"
  );
});
