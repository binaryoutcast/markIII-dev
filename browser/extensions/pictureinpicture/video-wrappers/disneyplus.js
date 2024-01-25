/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

class PictureInPictureVideoWrapper {
  setCaptionContainerObserver(video, updateCaptionsFunction) {
    // Handle Disney+ (US)
    let container = document.querySelector(".dss-hls-subtitle-overlay");

    if (container) {
      const callback = () => {
        let textNodeList = container.querySelectorAll(
          ".dss-subtitle-renderer-line"
        );

        if (!textNodeList.length) {
          updateCaptionsFunction("");
          return;
        }

        updateCaptionsFunction(
          Array.from(textNodeList, x => x.textContent).join("\n")
        );
      };

      // immediately invoke the callback function to add subtitles to the PiP window
      callback();

      let captionsObserver = new MutationObserver(callback);
      captionsObserver.observe(container, {
        attributes: false,
        childList: true,
        subtree: true,
      });
      return;
    }

    // Handle Disney+ (non US version)
    container = document.querySelector(".shaka-text-container");
    if (container) {
      updateCaptionsFunction("");
      const callback = function (mutationsList, observer) {
        let textNodeList = container?.querySelectorAll("span");
        if (!textNodeList) {
          updateCaptionsFunction("");
          return;
        }

        updateCaptionsFunction(
          Array.from(textNodeList, x => x.textContent).join("\n")
        );
      };

      // immediately invoke the callback function to add subtitles to the PiP window
      callback([1], null);

      let captionsObserver = new MutationObserver(callback);

      captionsObserver.observe(container, {
        attributes: false,
        childList: true,
        subtree: true,
      });
    }
  }
}

this.PictureInPictureVideoWrapper = PictureInPictureVideoWrapper;
