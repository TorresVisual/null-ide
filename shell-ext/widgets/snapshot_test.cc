#include "check.h"
#include "snapshot.h"

using namespace null_widgets;

static void TestParse() {
  auto ok = ParseSnapshot(ReadFixture("ok.json"));
  CHECK(ok.state == Load::Ok);
  CHECK(ok.snapshot.projects.size() == 2 && ok.snapshot.projects[0].name == L"null-ide" && ok.snapshot.projects[0].dirty);
  CHECK(ok.snapshot.projects[0].pinned && ok.snapshot.projects[0].path == L"D:\\Coding\\Apps\\null-ide");
  CHECK(ok.snapshot.issues.size() == 1 && ok.snapshot.issues[0].number == 7 && ok.snapshot.issues[0].labels.size() == 1);
  CHECK(ok.snapshot.issues[0].localPath == L"D:\\Coding\\Apps\\null-ide");
  CHECK(ok.snapshot.prs[0].conflict && ok.snapshot.prs[0].review == L"requested" && ok.snapshot.prs[0].checks == L"failing");

  auto partial = ParseSnapshot(ReadFixture("partial.json"));
  CHECK(partial.state == Load::Ok && partial.snapshot.issuesSection.status == L"ok" && partial.snapshot.issuesSection.failed.size() == 2);
  CHECK(partial.snapshot.issuesSection.failed[1].repo == L"o/two" && partial.snapshot.issuesSection.failed[1].reason == L"offline");

  auto out = ParseSnapshot(ReadFixture("signed_out.json"));
  CHECK(out.snapshot.issuesSection.status == L"signed_out" && out.snapshot.issues.size() == 1);
  CHECK(out.snapshot.prsSection.status == L"signed_out" && out.snapshot.projectsSection.status == L"ok");

  CHECK(ParseSnapshot(ReadFixture("newer_schema.json")).state == Load::NewerSchema);
  CHECK(ParseSnapshot(ReadFixture("corrupt.json")).state == Load::Corrupt);
  CHECK(ParseSnapshot(L"").state == Load::Corrupt);
  CHECK(ParseSnapshot(L"[1,2,3]").state == Load::Corrupt);
  CHECK(ParseSnapshot(L"{\"writtenAt\":\"x\"}").state == Load::Corrupt);  // no schema
  CHECK(LoadSnapshotFile(L"C:\\definitely\\not\\here.json").state == Load::Missing);

  // Wrong types degrade; they never throw.
  auto odd = ParseSnapshot(L"{\"schema\":1,\"writtenAt\":5,\"projects\":\"x\",\"issues\":{\"items\":[1,\"a\",{\"number\":\"n\"}]}}");
  CHECK(odd.state == Load::Ok && odd.snapshot.projects.empty() && odd.snapshot.issues.size() == 1 && odd.snapshot.issues[0].number == 0);

  // A section is capped at 200 items however large the file is.
  std::wstring many = L"{\"schema\":1,\"issues\":{\"items\":[";
  for (int i = 0; i < 500; ++i) many += (i ? L",{}" : L"{}");
  many += L"]}}";
  CHECK(ParseSnapshot(many).snapshot.issues.size() == 200);
}

static void TestHostile() {
  auto h = ParseSnapshot(ReadFixture("hostile.json"));
  CHECK(h.state == Load::Ok);
  // A flag-looking path and a relative path are emptied; the absolute one survives.
  CHECK(h.snapshot.projects.size() == 3);
  CHECK(h.snapshot.projects[0].path.empty() && h.snapshot.projects[1].path.empty() && h.snapshot.projects[2].path == L"C:\\work\\good");
  // Only https://github.com/... survives as a URL; localPath "-n" is dropped.
  CHECK(h.snapshot.issues.size() == 4);
  for (auto const& i : h.snapshot.issues) CHECK(i.url.empty());
  CHECK(h.snapshot.issues[0].localPath.empty());
  // Text is kept as it is (it is only ever drawn as plain text), but capped.
  CHECK(h.snapshot.issues[0].title == L"${$host.widgetSize} {{x}} <b>hi</b>");
  std::wstring big = ReadFixture("hostile.json");
  big.replace(big.find(L"HUGE"), 4, std::wstring(10000, L'A'));
  auto capped = ParseSnapshot(big);
  CHECK(capped.snapshot.prs[0].title.size() == 121);  // 120 + the ellipsis
  CHECK(capped.snapshot.prs[0].url == L"https://github.com/o/r/pull/5");

  CHECK(IsSafeGithubUrl(L"https://github.com/o/r/issues/7"));
  CHECK(!IsSafeGithubUrl(L"http://github.com/o/r"));
  CHECK(!IsSafeGithubUrl(L"https://github.com"));
  CHECK(!IsSafeGithubUrl(L"https://github.com/"));
  CHECK(!IsSafeGithubUrl(L"https://GitHub.com.evil.com/x"));
  CHECK(!IsSafeGithubUrl(L"https://github.com@evil.com/x"));
  CHECK(!IsSafeGithubUrl(L"https://github.com/ x"));
  CHECK(!IsSafeGithubUrl(L"https://github.com/\"x"));
  CHECK(!IsSafeGithubUrl(L"https://github.com/o\\r"));
  CHECK(IsAbsoluteLocalPath(L"C:\\a b\\c"));
  CHECK(!IsAbsoluteLocalPath(L"--flag"));
  CHECK(!IsAbsoluteLocalPath(L"-n"));
  CHECK(!IsAbsoluteLocalPath(L"C:rel"));
  CHECK(!IsAbsoluteLocalPath(L"\\\\?\\C:\\x"));
  CHECK(!IsAbsoluteLocalPath(L"\\\\server\\share"));
  CHECK(!IsAbsoluteLocalPath(L"C:\\a|b"));
  CHECK(CapText(L"a\nb", 10) == L"a b");
  CHECK(CapText(L"abcdef", 3) == L"abc\u2026");
  long long t = 0;
  CHECK(ParseIsoUtc(L"2026-10-21T14:03:11Z", &t) && t == 1792591391);
  CHECK(!ParseIsoUtc(L"yesterday", &t));
}

static void TestKeepLastGood() {
  auto good = ParseSnapshot(ReadFixture("ok.json"));
  Loaded corrupt;
  corrupt.state = Load::Corrupt;
  Loaded missing;  // Missing by default
  CHECK(KeepLastGood(good, corrupt).state == Load::Ok);                // torn write: keep what is drawn
  CHECK(KeepLastGood(good, missing).state == Load::Missing);           // file deleted (widgets turned off): fall back
  CHECK(KeepLastGood(missing, corrupt).state == Load::Corrupt);        // nothing to keep
  CHECK(KeepLastGood(good, ParseSnapshot(ReadFixture("newer_schema.json"))).state == Load::NewerSchema);
}

int main() {
  winrt::init_apartment();
  TestParse();
  TestHostile();
  TestKeepLastGood();
  return Finish("snapshot_test");
}
