//
// Autogenerated from Python template.  Hands off.
//

#include <stdlib.h>
#include <string.h>

#include "IPDLUnitTests.h"

#include "base/command_line.h"
#include "base/string_util.h"
#include "base/task.h"
#include "base/thread.h"

#include "nsRegion.h"

#include "IPDLUnitTestSubprocess.h"

// clang-format off
//-----------------------------------------------------------------------------
//===== TEMPLATED =====
${INCLUDES}
//-----------------------------------------------------------------------------
// clang-format on

using namespace std;

using base::Thread;

namespace mozilla {
namespace _ipdltest {

void* gParentActor;
IPDLUnitTestSubprocess* gSubprocess;

void* gChildActor;

// Note: in threaded mode, this will be non-null (for both parent and
// child, since they share one set of globals).
Thread* gChildThread;
MessageLoop* gParentMessageLoop;
bool gParentDone;
bool gChildDone;

void DeleteChildActor();

//-----------------------------------------------------------------------------
// data/functions accessed by both parent and child processes

char* gIPDLUnitTestName = nullptr;

const char* IPDLUnitTestName() {
  if (!gIPDLUnitTestName) {
#if defined(XP_WIN)
    vector<wstring> args = CommandLine::ForCurrentProcess()->GetLooseValues();
    gIPDLUnitTestName = ::strdup(WideToUTF8(args[0]).c_str());
#else
    vector<string> argv = CommandLine::ForCurrentProcess()->argv();
    gIPDLUnitTestName = ::moz_xstrdup(argv[1].c_str());
#endif
  }
  return gIPDLUnitTestName;
}

}  // namespace _ipdltest
}  // namespace mozilla

namespace {

enum IPDLUnitTestType {
  NoneTest = 0,

  // clang-format off
//-----------------------------------------------------------------------------
//===== TEMPLATED =====
${ENUM_VALUES}

  LastTest = ${LAST_ENUM}
//-----------------------------------------------------------------------------
//clang-format on
};

IPDLUnitTestType IPDLUnitTestFromString(const char* const aString) {
  if (!aString) return static_cast<IPDLUnitTestType>(0);
// clang-format off
//-----------------------------------------------------------------------------
//===== TEMPLATED =====
${STRING_TO_ENUMS}
//-----------------------------------------------------------------------------
  // clang-format on
  else return static_cast<IPDLUnitTestType>(0);
}

IPDLUnitTestType IPDLUnitTest() {
  return IPDLUnitTestFromString(::mozilla::_ipdltest::IPDLUnitTestName());
}

}  // namespace

//-----------------------------------------------------------------------------
// parent process only

namespace mozilla {
namespace _ipdltest {

void DeferredParentShutdown();

void IPDLUnitTestThreadMain(char* testString);

void IPDLUnitTestMain(void* aData) {
  char* testString = reinterpret_cast<char*>(aData);

  // Check if we are to run the test using threads instead:
  const char* prefix = "thread:";
  const int prefixLen = strlen(prefix);
  if (!strncmp(testString, prefix, prefixLen)) {
    IPDLUnitTestThreadMain(testString + prefixLen);
    return;
  }

  IPDLUnitTestType test = IPDLUnitTestFromString(testString);
  if (!test) {
    // use this instead of |fail()| because we don't know what the test is
    fprintf(stderr, MOZ_IPDL_TESTFAIL_LABEL "| %s | unknown unit test %s\n",
            "<--->", testString);
    MOZ_CRASH("can't continue");
  }
  gIPDLUnitTestName = testString;

  // Check whether this test is enabled for processes:
  switch (test) {
    // clang-format off
//-----------------------------------------------------------------------------
//===== TEMPLATED =====
${PARENT_ENABLED_CASES_PROC}
//-----------------------------------------------------------------------------
      // clang-format on

    default:
      fail("not reached");
      return;  // unreached
  }

  printf(MOZ_IPDL_TESTINFO_LABEL "| running test | %s\n", gIPDLUnitTestName);

  std::vector<std::string> testCaseArgs;
  testCaseArgs.push_back(testString);

  gSubprocess = new IPDLUnitTestSubprocess();
  if (!gSubprocess->SyncLaunch(testCaseArgs))
    fail("problem launching subprocess");

  IPC::Channel* transport = gSubprocess->GetChannel();
  if (!transport) fail("no transport");

  base::ProcessId child = base::GetProcId(gSubprocess->GetChildProcessHandle());

  switch (test) {
    // clang-format off
//-----------------------------------------------------------------------------
//===== TEMPLATED =====
${PARENT_MAIN_CASES_PROC}
//-----------------------------------------------------------------------------
      // clang-format on

    default:
      fail("not reached");
      return;  // unreached
  }
}

void IPDLUnitTestThreadMain(char* testString) {
  IPDLUnitTestType test = IPDLUnitTestFromString(testString);
  if (!test) {
    // use this instead of |fail()| because we don't know what the test is
    fprintf(stderr, MOZ_IPDL_TESTFAIL_LABEL "| %s | unknown unit test %s\n",
            "<--->", testString);
    MOZ_CRASH("can't continue");
  }
  gIPDLUnitTestName = testString;

  // Check whether this test is enabled for threads:
  switch (test) {
    // clang-format off
//-----------------------------------------------------------------------------
//===== TEMPLATED =====
${PARENT_ENABLED_CASES_THREAD}
//-----------------------------------------------------------------------------
      // clang-format on

    default:
      fail("not reached");
      return;  // unreached
  }

  printf(MOZ_IPDL_TESTINFO_LABEL "| running test | %s\n", gIPDLUnitTestName);

  std::vector<std::string> testCaseArgs;
  testCaseArgs.push_back(testString);

  gChildThread = new Thread("ParentThread");
  if (!gChildThread->Start()) fail("starting parent thread");

  gParentMessageLoop = MessageLoop::current();
  MessageLoop* childMessageLoop = gChildThread->message_loop();

  switch (test) {
    // clang-format off
//-----------------------------------------------------------------------------
//===== TEMPLATED =====
${PARENT_MAIN_CASES_THREAD}
//-----------------------------------------------------------------------------
      // clang-format on

    default:
      fail("not reached");
      return;  // unreached
  }
}

void DeleteParentActor() {
  if (!gParentActor) return;

  switch (IPDLUnitTest()) {
    // clang-format off
//-----------------------------------------------------------------------------
//===== TEMPLATED =====
${PARENT_DELETE_CASES}
//-----------------------------------------------------------------------------
      // clang-format on
    default:
      ::mozilla::_ipdltest::fail("???");
  }
}

void QuitXPCOM() {
  DeleteParentActor();

  static NS_DEFINE_CID(kAppShellCID, NS_APPSHELL_CID);
  nsCOMPtr<nsIAppShell> appShell(do_GetService(kAppShellCID));
  appShell->Exit();
}

void DeleteSubprocess(MessageLoop* uiLoop) {
  // pong to QuitXPCOM
  gSubprocess->Destroy();
  gSubprocess = nullptr;
  uiLoop->PostTask(NewRunnableFunction("QuitXPCOM", QuitXPCOM));
}

void DeferredParentShutdown() {
  // ping to DeleteSubprocess
  XRE_GetIOMessageLoop()->PostTask(NewRunnableFunction(
      "DeleteSubprocess", DeleteSubprocess, MessageLoop::current()));
}

void TryThreadedShutdown() {
  // Stop if either:
  // - the child has not finished,
  // - the parent has not finished,
  // - or this code has already executed.
  // Remember: this TryThreadedShutdown() task is enqueued
  // by both parent and child (though always on parent's msg loop).
  if (!gChildDone || !gParentDone || !gChildThread) return;

  delete gChildThread;
  gChildThread = 0;
  DeferredParentShutdown();
}

void ChildCompleted() {
  // Executes on the parent message loop once child has completed.
  gChildDone = true;
  TryThreadedShutdown();
}

void QuitParent() {
  if (gChildThread) {
    gParentDone = true;
    MessageLoop::current()->PostTask(
        NewRunnableFunction("TryThreadedShutdown", TryThreadedShutdown));
  } else {
    // defer "real" shutdown to avoid *Channel::Close() racing with the
    // deletion of the subprocess
    MessageLoop::current()->PostTask(
        NewRunnableFunction("DeferredParentShutdown", DeferredParentShutdown));
  }
}

static void ChildDie() {
  DeleteChildActor();
  XRE_ShutdownChildProcess();
}

void QuitChild() {
  if (gChildThread) {  // Threaded-mode test
    gParentMessageLoop->PostTask(
        NewRunnableFunction("ChildCompleted", ChildCompleted));
  } else {  // Process-mode test
    MessageLoop::current()->PostTask(NewRunnableFunction("ChildDie", ChildDie));
  }
}

}  // namespace _ipdltest
}  // namespace mozilla

//-----------------------------------------------------------------------------
// child process only

namespace mozilla {
namespace _ipdltest {

void DeleteChildActor() {
  if (!gChildActor) return;

  switch (IPDLUnitTest()) {
    // clang-format off
//-----------------------------------------------------------------------------
//===== TEMPLATED =====
${CHILD_DELETE_CASES}
//-----------------------------------------------------------------------------
      // clang-format on
    default:
      ::mozilla::_ipdltest::fail("???");
  }
}

void IPDLUnitTestChildInit(IPC::Channel* transport, base::ProcessId parentPid,
                           MessageLoop* worker) {
  switch (IPDLUnitTest()) {
    // clang-format off
//-----------------------------------------------------------------------------
//===== TEMPLATED =====
${CHILD_INIT_CASES}
//-----------------------------------------------------------------------------
      // clang-format on

    default:
      fail("not reached");
      return;  // unreached
  }
}

}  // namespace _ipdltest
}  // namespace mozilla
