/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
#ifndef _mozilla_dom_WorkerIPCUtils_h
#define _mozilla_dom_WorkerIPCUtils_h

#include "ipc/EnumSerializer.h"

// Undo X11/X.h's definition of None
#undef None

#include "mozilla/dom/WorkerBinding.h"

namespace IPC {

template <>
struct ParamTraits<mozilla::dom::WorkerType>
    : public ContiguousEnumSerializer<mozilla::dom::WorkerType,
                                      mozilla::dom::WorkerType::Classic,
                                      mozilla::dom::WorkerType::EndGuard_> {};

}  // namespace IPC

#endif  // _mozilla_dom_WorkerIPCUtils_h
