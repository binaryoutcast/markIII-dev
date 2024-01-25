/* -*- Mode: IDL; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * The origin of this IDL file is
 * https://w3c.github.io/webrtc-pc/#rtcdtlstransport-interface
 */

enum RTCDtlsTransportState {
  "new",
  "connecting",
  "connected",
  "closed",
  "failed"
};

[Pref="media.peerconnection.enabled",
 Exposed=Window]
interface RTCDtlsTransport : EventTarget {
  readonly attribute RTCDtlsTransportState state;
  attribute EventHandler onstatechange;
};
