/* -*- Mode: C++; tab-width: 8; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ts=8 sts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "mozilla/dom/HTMLVideoElement.h"

#include "mozilla/AsyncEventDispatcher.h"
#include "mozilla/dom/HTMLVideoElementBinding.h"
#include "nsGenericHTMLElement.h"
#include "nsGkAtoms.h"
#include "nsSize.h"
#include "nsError.h"
#include "nsIHttpChannel.h"
#include "nsNodeInfoManager.h"
#include "plbase64.h"
#include "prlock.h"
#include "nsRFPService.h"
#include "nsThreadUtils.h"
#include "ImageContainer.h"
#include "VideoFrameContainer.h"
#include "VideoOutput.h"

#include "FrameStatistics.h"
#include "MediaError.h"
#include "MediaDecoder.h"
#include "MediaDecoderStateMachine.h"
#include "mozilla/Preferences.h"
#include "mozilla/dom/WakeLock.h"
#include "mozilla/dom/power/PowerManagerService.h"
#include "mozilla/dom/Performance.h"
#include "mozilla/dom/TimeRanges.h"
#include "mozilla/dom/VideoPlaybackQuality.h"
#include "mozilla/dom/VideoStreamTrack.h"
#include "mozilla/StaticPrefs_media.h"
#include "mozilla/Unused.h"

#include <algorithm>
#include <limits>

extern mozilla::LazyLogModule gMediaElementLog;
#define LOG(msg, ...)                        \
  MOZ_LOG(gMediaElementLog, LogLevel::Debug, \
          ("HTMLVideoElement=%p, " msg, this, ##__VA_ARGS__))

nsGenericHTMLElement* NS_NewHTMLVideoElement(
    already_AddRefed<mozilla::dom::NodeInfo>&& aNodeInfo,
    mozilla::dom::FromParser aFromParser) {
  RefPtr<mozilla::dom::NodeInfo> nodeInfo(aNodeInfo);
  auto* nim = nodeInfo->NodeInfoManager();
  mozilla::dom::HTMLVideoElement* element =
      new (nim) mozilla::dom::HTMLVideoElement(nodeInfo.forget());
  element->Init();
  return element;
}

namespace mozilla::dom {

nsresult HTMLVideoElement::Clone(mozilla::dom::NodeInfo* aNodeInfo,
                                 nsINode** aResult) const {
  *aResult = nullptr;
  RefPtr<mozilla::dom::NodeInfo> ni(aNodeInfo);
  auto* nim = ni->NodeInfoManager();
  HTMLVideoElement* it = new (nim) HTMLVideoElement(ni.forget());
  it->Init();
  nsCOMPtr<nsINode> kungFuDeathGrip = it;
  nsresult rv = const_cast<HTMLVideoElement*>(this)->CopyInnerTo(it);
  if (NS_SUCCEEDED(rv)) {
    kungFuDeathGrip.swap(*aResult);
  }
  return rv;
}

NS_IMPL_ISUPPORTS_CYCLE_COLLECTION_INHERITED_0(HTMLVideoElement,
                                               HTMLMediaElement)

NS_IMPL_CYCLE_COLLECTION_CLASS(HTMLVideoElement)

NS_IMPL_CYCLE_COLLECTION_UNLINK_BEGIN(HTMLVideoElement)
  NS_IMPL_CYCLE_COLLECTION_UNLINK(mVisualCloneTarget)
  NS_IMPL_CYCLE_COLLECTION_UNLINK(mVisualCloneTargetPromise)
  NS_IMPL_CYCLE_COLLECTION_UNLINK(mVisualCloneSource)
  tmp->mSecondaryVideoOutput = nullptr;
NS_IMPL_CYCLE_COLLECTION_UNLINK_END_INHERITED(HTMLMediaElement)

NS_IMPL_CYCLE_COLLECTION_TRAVERSE_BEGIN_INHERITED(HTMLVideoElement,
                                                  HTMLMediaElement)
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE(mVisualCloneTarget)
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE(mVisualCloneTargetPromise)
  NS_IMPL_CYCLE_COLLECTION_TRAVERSE(mVisualCloneSource)
NS_IMPL_CYCLE_COLLECTION_TRAVERSE_END

HTMLVideoElement::HTMLVideoElement(already_AddRefed<NodeInfo>&& aNodeInfo)
    : HTMLMediaElement(std::move(aNodeInfo)),
      mVideoWatchManager(this, AbstractThread::MainThread()) {
  DecoderDoctorLogger::LogConstruction(this);
}

HTMLVideoElement::~HTMLVideoElement() {
  mVideoWatchManager.Shutdown();
  DecoderDoctorLogger::LogDestruction(this);
}

void HTMLVideoElement::UpdateMediaSize(const nsIntSize& aSize) {
  HTMLMediaElement::UpdateMediaSize(aSize);
  // If we have a clone target, we should update its size as well.
  if (mVisualCloneTarget) {
    Maybe<nsIntSize> newSize = Some(aSize);
    mVisualCloneTarget->Invalidate(ImageSizeChanged::Yes, newSize,
                                   ForceInvalidate::Yes);
  }
}

Maybe<CSSIntSize> HTMLVideoElement::GetVideoSize() const {
  if (!mMediaInfo.HasVideo()) {
    return Nothing();
  }

  if (mDisableVideo) {
    return Nothing();
  }

  CSSIntSize size;
  switch (mMediaInfo.mVideo.mRotation) {
    case VideoRotation::kDegree_90:
    case VideoRotation::kDegree_270: {
      size.width = mMediaInfo.mVideo.mDisplay.height;
      size.height = mMediaInfo.mVideo.mDisplay.width;
      break;
    }
    case VideoRotation::kDegree_0:
    case VideoRotation::kDegree_180:
    default: {
      size.height = mMediaInfo.mVideo.mDisplay.height;
      size.width = mMediaInfo.mVideo.mDisplay.width;
      break;
    }
  }
  return Some(size);
}

void HTMLVideoElement::Invalidate(ImageSizeChanged aImageSizeChanged,
                                  const Maybe<nsIntSize>& aNewIntrinsicSize,
                                  ForceInvalidate aForceInvalidate) {
  HTMLMediaElement::Invalidate(aImageSizeChanged, aNewIntrinsicSize,
                               aForceInvalidate);
  if (mVisualCloneTarget) {
    VideoFrameContainer* container =
        mVisualCloneTarget->GetVideoFrameContainer();
    if (container) {
      container->Invalidate();
    }
  }
}

bool HTMLVideoElement::ParseAttribute(int32_t aNamespaceID, nsAtom* aAttribute,
                                      const nsAString& aValue,
                                      nsIPrincipal* aMaybeScriptedPrincipal,
                                      nsAttrValue& aResult) {
  if (aAttribute == nsGkAtoms::width || aAttribute == nsGkAtoms::height) {
    return aResult.ParseHTMLDimension(aValue);
  }

  return HTMLMediaElement::ParseAttribute(aNamespaceID, aAttribute, aValue,
                                          aMaybeScriptedPrincipal, aResult);
}

void HTMLVideoElement::MapAttributesIntoRule(
    MappedDeclarationsBuilder& aBuilder) {
  MapImageSizeAttributesInto(aBuilder, MapAspectRatio::Yes);
  MapCommonAttributesInto(aBuilder);
}

NS_IMETHODIMP_(bool)
HTMLVideoElement::IsAttributeMapped(const nsAtom* aAttribute) const {
  static const MappedAttributeEntry attributes[] = {
      {nsGkAtoms::width}, {nsGkAtoms::height}, {nullptr}};

  static const MappedAttributeEntry* const map[] = {attributes,
                                                    sCommonAttributeMap};

  return FindAttributeDependence(aAttribute, map);
}

nsMapRuleToAttributesFunc HTMLVideoElement::GetAttributeMappingFunction()
    const {
  return &MapAttributesIntoRule;
}

void HTMLVideoElement::UnbindFromTree(bool aNullParent) {
  if (mVisualCloneSource) {
    mVisualCloneSource->EndCloningVisually();
  } else if (mVisualCloneTarget) {
    AsyncEventDispatcher::RunDOMEventWhenSafe(
        *this, u"MozStopPictureInPicture"_ns, CanBubble::eNo,
        ChromeOnlyDispatch::eYes);
    EndCloningVisually();
  }

  HTMLMediaElement::UnbindFromTree(aNullParent);
}

nsresult HTMLVideoElement::SetAcceptHeader(nsIHttpChannel* aChannel) {
  nsAutoCString value(
      "video/webm,"
      "video/ogg,"
      "video/*;q=0.9,"
      "application/ogg;q=0.7,"
      "audio/*;q=0.6,*/*;q=0.5");

  return aChannel->SetRequestHeader("Accept"_ns, value, false);
}

bool HTMLVideoElement::IsInteractiveHTMLContent() const {
  return HasAttr(nsGkAtoms::controls) ||
         HTMLMediaElement::IsInteractiveHTMLContent();
}

gfx::IntSize HTMLVideoElement::GetVideoIntrinsicDimensions() {
  const auto& sz = mMediaInfo.mVideo.mDisplay;

  // Prefer the size of the container as it's more up to date.
  return ToMaybeRef(mVideoFrameContainer.get())
      .map([&](auto& aVFC) { return aVFC.CurrentIntrinsicSize().valueOr(sz); })
      .valueOr(sz);
}

uint32_t HTMLVideoElement::VideoWidth() {
  if (!HasVideo()) {
    return 0;
  }
  gfx::IntSize size = GetVideoIntrinsicDimensions();
  if (mMediaInfo.mVideo.mRotation == VideoRotation::kDegree_90 ||
      mMediaInfo.mVideo.mRotation == VideoRotation::kDegree_270) {
    return size.height;
  }
  return size.width;
}

uint32_t HTMLVideoElement::VideoHeight() {
  if (!HasVideo()) {
    return 0;
  }
  gfx::IntSize size = GetVideoIntrinsicDimensions();
  if (mMediaInfo.mVideo.mRotation == VideoRotation::kDegree_90 ||
      mMediaInfo.mVideo.mRotation == VideoRotation::kDegree_270) {
    return size.width;
  }
  return size.height;
}

uint32_t HTMLVideoElement::MozParsedFrames() const {
  MOZ_ASSERT(NS_IsMainThread(), "Should be on main thread.");
  if (!IsVideoStatsEnabled()) {
    return 0;
  }

  if (OwnerDoc()->ShouldResistFingerprinting(
          RFPTarget::VideoElementMozFrames)) {
    return nsRFPService::GetSpoofedTotalFrames(TotalPlayTime());
  }

  return mDecoder ? mDecoder->GetFrameStatistics().GetParsedFrames() : 0;
}

uint32_t HTMLVideoElement::MozDecodedFrames() const {
  MOZ_ASSERT(NS_IsMainThread(), "Should be on main thread.");
  if (!IsVideoStatsEnabled()) {
    return 0;
  }

  if (OwnerDoc()->ShouldResistFingerprinting(
          RFPTarget::VideoElementMozFrames)) {
    return nsRFPService::GetSpoofedTotalFrames(TotalPlayTime());
  }

  return mDecoder ? mDecoder->GetFrameStatistics().GetDecodedFrames() : 0;
}

uint32_t HTMLVideoElement::MozPresentedFrames() {
  MOZ_ASSERT(NS_IsMainThread(), "Should be on main thread.");
  if (!IsVideoStatsEnabled()) {
    return 0;
  }

  if (OwnerDoc()->ShouldResistFingerprinting(
          RFPTarget::VideoElementMozFrames)) {
    return nsRFPService::GetSpoofedPresentedFrames(TotalPlayTime(),
                                                   VideoWidth(), VideoHeight());
  }

  return mDecoder ? mDecoder->GetFrameStatistics().GetPresentedFrames() : 0;
}

uint32_t HTMLVideoElement::MozPaintedFrames() {
  MOZ_ASSERT(NS_IsMainThread(), "Should be on main thread.");
  if (!IsVideoStatsEnabled()) {
    return 0;
  }

  if (OwnerDoc()->ShouldResistFingerprinting(
          RFPTarget::VideoElementMozFrames)) {
    return nsRFPService::GetSpoofedPresentedFrames(TotalPlayTime(),
                                                   VideoWidth(), VideoHeight());
  }

  layers::ImageContainer* container = GetImageContainer();
  return container ? container->GetPaintCount() : 0;
}

double HTMLVideoElement::MozFrameDelay() {
  MOZ_ASSERT(NS_IsMainThread(), "Should be on main thread.");

  if (!IsVideoStatsEnabled() || OwnerDoc()->ShouldResistFingerprinting(
                                    RFPTarget::VideoElementMozFrameDelay)) {
    return 0.0;
  }

  VideoFrameContainer* container = GetVideoFrameContainer();
  // Hide negative delays. Frame timing tweaks in the compositor (e.g.
  // adding a bias value to prevent multiple dropped/duped frames when
  // frame times are aligned with composition times) may produce apparent
  // negative delay, but we shouldn't report that.
  return container ? std::max(0.0, container->GetFrameDelay()) : 0.0;
}

bool HTMLVideoElement::MozHasAudio() const {
  MOZ_ASSERT(NS_IsMainThread(), "Should be on main thread.");
  return HasAudio();
}

JSObject* HTMLVideoElement::WrapNode(JSContext* aCx,
                                     JS::Handle<JSObject*> aGivenProto) {
  return HTMLVideoElement_Binding::Wrap(aCx, this, aGivenProto);
}

already_AddRefed<VideoPlaybackQuality>
HTMLVideoElement::GetVideoPlaybackQuality() {
  DOMHighResTimeStamp creationTime = 0;
  uint32_t totalFrames = 0;
  uint32_t droppedFrames = 0;

  if (IsVideoStatsEnabled()) {
    if (nsPIDOMWindowInner* window = OwnerDoc()->GetInnerWindow()) {
      Performance* perf = window->GetPerformance();
      if (perf) {
        creationTime = perf->Now();
      }
    }

    if (mDecoder) {
      if (OwnerDoc()->ShouldResistFingerprinting(
              RFPTarget::VideoElementPlaybackQuality)) {
        totalFrames = nsRFPService::GetSpoofedTotalFrames(TotalPlayTime());
        droppedFrames = nsRFPService::GetSpoofedDroppedFrames(
            TotalPlayTime(), VideoWidth(), VideoHeight());
      } else {
        FrameStatistics* stats = &mDecoder->GetFrameStatistics();
        if (sizeof(totalFrames) >= sizeof(stats->GetParsedFrames())) {
          totalFrames = stats->GetTotalFrames();
          droppedFrames = stats->GetDroppedFrames();
        } else {
          uint64_t total = stats->GetTotalFrames();
          const auto maxNumber = std::numeric_limits<uint32_t>::max();
          if (total <= maxNumber) {
            totalFrames = uint32_t(total);
            droppedFrames = uint32_t(stats->GetDroppedFrames());
          } else {
            // Too big number(s) -> Resize everything to fit in 32 bits.
            double ratio = double(maxNumber) / double(total);
            totalFrames = maxNumber;  // === total * ratio
            droppedFrames = uint32_t(double(stats->GetDroppedFrames()) * ratio);
          }
        }
      }
      if (!StaticPrefs::media_video_dropped_frame_stats_enabled()) {
        droppedFrames = 0;
      }
    }
  }

  RefPtr<VideoPlaybackQuality> playbackQuality =
      new VideoPlaybackQuality(this, creationTime, totalFrames, droppedFrames);
  return playbackQuality.forget();
}

void HTMLVideoElement::WakeLockRelease() {
  HTMLMediaElement::WakeLockRelease();
  ReleaseVideoWakeLockIfExists();
}

void HTMLVideoElement::UpdateWakeLock() {
  HTMLMediaElement::UpdateWakeLock();
  if (!mPaused) {
    CreateVideoWakeLockIfNeeded();
  } else {
    ReleaseVideoWakeLockIfExists();
  }
}

bool HTMLVideoElement::ShouldCreateVideoWakeLock() const {
  if (!StaticPrefs::media_video_wakelock()) {
    return false;
  }
  // Only request wake lock for video with audio or video from media
  // stream, because non-stream video without audio is often used as a
  // background image.
  //
  // Some web conferencing sites route audio outside the video element,
  // and would not be detected unless we check for media stream, so do
  // that below.
  //
  // Media streams generally aren't used as background images, though if
  // they were we'd get false positives. If this is an issue, we could
  // check for media stream AND document has audio playing (but that was
  // tricky to do).
  return HasVideo() && (mSrcStream || HasAudio());
}

void HTMLVideoElement::CreateVideoWakeLockIfNeeded() {
  if (AppShutdown::IsInOrBeyond(ShutdownPhase::AppShutdownConfirmed)) {
    return;
  }
  if (!mScreenWakeLock && ShouldCreateVideoWakeLock()) {
    RefPtr<power::PowerManagerService> pmService =
        power::PowerManagerService::GetInstance();
    NS_ENSURE_TRUE_VOID(pmService);

    ErrorResult rv;
    mScreenWakeLock = pmService->NewWakeLock(u"video-playing"_ns,
                                             OwnerDoc()->GetInnerWindow(), rv);
  }
}

void HTMLVideoElement::ReleaseVideoWakeLockIfExists() {
  if (mScreenWakeLock) {
    ErrorResult rv;
    mScreenWakeLock->Unlock(rv);
    rv.SuppressException();
    mScreenWakeLock = nullptr;
    return;
  }
}

bool HTMLVideoElement::SetVisualCloneTarget(
    RefPtr<HTMLVideoElement> aVisualCloneTarget,
    RefPtr<Promise> aVisualCloneTargetPromise) {
  MOZ_DIAGNOSTIC_ASSERT(
      !aVisualCloneTarget || aVisualCloneTarget->IsInComposedDoc(),
      "Can't set the clone target to a disconnected video "
      "element.");
  MOZ_DIAGNOSTIC_ASSERT(!mVisualCloneSource,
                        "Can't clone a video element that is already a clone.");
  if (!aVisualCloneTarget ||
      (aVisualCloneTarget->IsInComposedDoc() && !mVisualCloneSource)) {
    mVisualCloneTarget = std::move(aVisualCloneTarget);
    mVisualCloneTargetPromise = std::move(aVisualCloneTargetPromise);
    return true;
  }
  return false;
}

bool HTMLVideoElement::SetVisualCloneSource(
    RefPtr<HTMLVideoElement> aVisualCloneSource) {
  MOZ_DIAGNOSTIC_ASSERT(
      !aVisualCloneSource || aVisualCloneSource->IsInComposedDoc(),
      "Can't set the clone source to a disconnected video "
      "element.");
  MOZ_DIAGNOSTIC_ASSERT(!mVisualCloneTarget,
                        "Can't clone a video element that is already a "
                        "clone.");
  if (!aVisualCloneSource ||
      (aVisualCloneSource->IsInComposedDoc() && !mVisualCloneTarget)) {
    mVisualCloneSource = std::move(aVisualCloneSource);
    return true;
  }
  return false;
}

/* static */
bool HTMLVideoElement::IsVideoStatsEnabled() {
  return StaticPrefs::media_video_stats_enabled();
}

double HTMLVideoElement::TotalPlayTime() const {
  double total = 0.0;

  if (mPlayed) {
    uint32_t timeRangeCount = mPlayed->Length();

    for (uint32_t i = 0; i < timeRangeCount; i++) {
      double begin = mPlayed->Start(i);
      double end = mPlayed->End(i);
      total += end - begin;
    }

    if (mCurrentPlayRangeStart != -1.0) {
      double now = CurrentTime();
      if (mCurrentPlayRangeStart != now) {
        total += now - mCurrentPlayRangeStart;
      }
    }
  }

  return total;
}

already_AddRefed<Promise> HTMLVideoElement::CloneElementVisually(
    HTMLVideoElement& aTargetVideo, ErrorResult& aRv) {
  MOZ_ASSERT(IsInComposedDoc(),
             "Can't clone a video that's not bound to a DOM tree.");
  MOZ_ASSERT(aTargetVideo.IsInComposedDoc(),
             "Can't clone to a video that's not bound to a DOM tree.");
  if (!IsInComposedDoc() || !aTargetVideo.IsInComposedDoc()) {
    aRv.Throw(NS_ERROR_UNEXPECTED);
    return nullptr;
  }

  nsPIDOMWindowInner* win = OwnerDoc()->GetInnerWindow();
  if (!win) {
    aRv.Throw(NS_ERROR_UNEXPECTED);
    return nullptr;
  }

  RefPtr<Promise> promise = Promise::Create(win->AsGlobal(), aRv);
  if (aRv.Failed()) {
    return nullptr;
  }

  // Do we already have a visual clone target? If so, shut it down.
  if (mVisualCloneTarget) {
    EndCloningVisually();
  }

  // If there's a poster set on the target video, clear it, otherwise
  // it'll display over top of the cloned frames.
  aTargetVideo.UnsetHTMLAttr(nsGkAtoms::poster, aRv);
  if (aRv.Failed()) {
    return nullptr;
  }

  if (!SetVisualCloneTarget(&aTargetVideo, promise)) {
    aRv.Throw(NS_ERROR_FAILURE);
    return nullptr;
  }

  if (!aTargetVideo.SetVisualCloneSource(this)) {
    mVisualCloneTarget = nullptr;
    aRv.Throw(NS_ERROR_FAILURE);
    return nullptr;
  }

  aTargetVideo.SetMediaInfo(mMediaInfo);

  if (IsInComposedDoc() && !StaticPrefs::media_cloneElementVisually_testing()) {
    NotifyUAWidgetSetupOrChange();
  }

  MaybeBeginCloningVisually();

  return promise.forget();
}

void HTMLVideoElement::StopCloningElementVisually() {
  if (mVisualCloneTarget) {
    EndCloningVisually();
  }
}

void HTMLVideoElement::MaybeBeginCloningVisually() {
  if (!mVisualCloneTarget) {
    return;
  }

  if (mDecoder) {
    mDecoder->SetSecondaryVideoContainer(
        mVisualCloneTarget->GetVideoFrameContainer());
    NotifyDecoderActivityChanges();
    UpdateMediaControlAfterPictureInPictureModeChanged();
  } else if (mSrcStream) {
    VideoFrameContainer* container =
        mVisualCloneTarget->GetVideoFrameContainer();
    if (container) {
      mSecondaryVideoOutput = MakeRefPtr<FirstFrameVideoOutput>(
          container, AbstractThread::MainThread());
      mVideoWatchManager.Watch(
          mSecondaryVideoOutput->mFirstFrameRendered,
          &HTMLVideoElement::OnSecondaryVideoOutputFirstFrameRendered);
      SetSecondaryMediaStreamRenderer(container, mSecondaryVideoOutput);
    }
    UpdateMediaControlAfterPictureInPictureModeChanged();
  }
}

void HTMLVideoElement::EndCloningVisually() {
  MOZ_ASSERT(mVisualCloneTarget);

  if (mDecoder) {
    mDecoder->SetSecondaryVideoContainer(nullptr);
    NotifyDecoderActivityChanges();
  } else if (mSrcStream) {
    if (mSecondaryVideoOutput) {
      mVideoWatchManager.Unwatch(
          mSecondaryVideoOutput->mFirstFrameRendered,
          &HTMLVideoElement::OnSecondaryVideoOutputFirstFrameRendered);
      mSecondaryVideoOutput = nullptr;
    }
    SetSecondaryMediaStreamRenderer(nullptr);
  }

  Unused << mVisualCloneTarget->SetVisualCloneSource(nullptr);
  Unused << SetVisualCloneTarget(nullptr);

  UpdateMediaControlAfterPictureInPictureModeChanged();

  if (IsInComposedDoc() && !StaticPrefs::media_cloneElementVisually_testing()) {
    NotifyUAWidgetSetupOrChange();
  }
}

void HTMLVideoElement::OnSecondaryVideoContainerInstalled(
    const RefPtr<VideoFrameContainer>& aSecondaryContainer) {
  MOZ_ASSERT(NS_IsMainThread());
  MOZ_DIAGNOSTIC_ASSERT_IF(mVisualCloneTargetPromise, mVisualCloneTarget);
  if (!mVisualCloneTargetPromise) {
    // Clone target was unset.
    return;
  }

  VideoFrameContainer* container = mVisualCloneTarget->GetVideoFrameContainer();
  if (NS_WARN_IF(container != aSecondaryContainer)) {
    // Not the right container.
    return;
  }

  NS_DispatchToCurrentThread(NewRunnableMethod(
      "Promise::MaybeResolveWithUndefined", mVisualCloneTargetPromise,
      &Promise::MaybeResolveWithUndefined));
  mVisualCloneTargetPromise = nullptr;
}

void HTMLVideoElement::OnSecondaryVideoOutputFirstFrameRendered() {
  OnSecondaryVideoContainerInstalled(
      mVisualCloneTarget->GetVideoFrameContainer());
}

void HTMLVideoElement::OnVisibilityChange(Visibility aNewVisibility) {
  HTMLMediaElement::OnVisibilityChange(aNewVisibility);

  // See the alternative part after step 4, but we only pause/resume invisible
  // autoplay for non-audible video, which is different from the spec. This
  // behavior seems aiming to reduce the power consumption without interering
  // users, and Chrome and Safari also chose to do that only for non-audible
  // video, so we want to match them in order to reduce webcompat issue.
  // https://html.spec.whatwg.org/multipage/media.html#ready-states:eligible-for-autoplay-2
  if (!HasAttr(nsGkAtoms::autoplay) || IsAudible()) {
    return;
  }

  if (aNewVisibility == Visibility::ApproximatelyVisible && mPaused &&
      IsEligibleForAutoplay() && AllowedToPlay()) {
    LOG("resume invisible paused autoplay video");
    RunAutoplay();
  }

  // We need to consider the Pip window as well, which won't reflect in the
  // visibility event.
  if ((aNewVisibility == Visibility::ApproximatelyNonVisible &&
       !IsCloningElementVisually()) &&
      mCanAutoplayFlag) {
    LOG("pause non-audible autoplay video when it's invisible");
    PauseInternal();
    mCanAutoplayFlag = true;
    return;
  }
}

}  // namespace mozilla::dom

#undef LOG
