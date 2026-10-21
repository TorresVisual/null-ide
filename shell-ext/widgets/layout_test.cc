#include "check.h"
#include "layout.h"

using namespace null_widgets;

constexpr long long kWritten = 1792591391;  // 2026-10-21T14:03:11Z, the writtenAt of the fixtures

static std::wstring Text(std::vector<Span> const& spans) {
  std::wstring s;
  for (auto const& p : spans) s += p.text;
  return s;
}

static void TestRows() {
  auto ok = ParseSnapshot(ReadFixture("ok.json"));
  long long now = kWritten + 300;

  View projects = BuildView(ok, Kind::Projects, 8, now);
  CHECK(projects.title == L"Projects" && projects.rows.size() == 2 && projects.message.empty());
  CHECK(Text(projects.rows[0].title) == L"\u2605 null-ide \u25cf");
  CHECK(Text(projects.rows[0].detail) == L"main \u00b7 1 h ago");
  CHECK(projects.rows[0].click.kind == ActionKind::OpenProject && projects.rows[0].click.target == L"D:\\Coding\\Apps\\null-ide");
  CHECK(projects.rows[0].menu.size() == 2 && projects.rows[0].menu[1].kind == ActionKind::OpenProjectNewWindow);
  CHECK(Text(projects.rows[1].title) == L"site");

  View issues = BuildView(ok, Kind::Issues, 10, now);
  CHECK(Text(issues.rows[0].title) == L"#7 Crash on save");
  CHECK(Text(issues.rows[0].detail) == L"assigned \u00b7 o/r \u00b7 bug");
  CHECK(issues.rows[0].click.kind == ActionKind::OpenUrl && issues.rows[0].click.target == L"https://github.com/o/r/issues/7");
  CHECK(issues.rows[0].menu.size() == 2 && issues.rows[0].menu[1].kind == ActionKind::OpenProject);  // it has a local checkout

  View prs = BuildView(ok, Kind::Prs, 10, now);
  CHECK(Text(prs.rows[0].title) == L"#9 Add widgets");
  CHECK(Text(prs.rows[0].detail) == L"review requested \u00b7 checks failing \u00b7 conflict \u00b7 o/r \u00b7 sam");
  CHECK(prs.rows[0].menu.size() == 1);  // no local checkout: only "Open in browser"

  CHECK(BuildView(ok, Kind::Projects, 1, now).rows.size() == 1);  // the renderer trims to what fits
  CHECK(RowsThatFit(240) == 4 && RowsThatFit(320) == 6 && RowsThatFit(10) == 1);
}

static void TestFooterAndStates() {
  auto ok = ParseSnapshot(ReadFixture("ok.json"));
  View fresh = BuildView(ok, Kind::Issues, 10, kWritten + 300);
  CHECK(fresh.footer == L"updated 5 min ago" && !fresh.stale);
  View old = BuildView(ok, Kind::Issues, 10, kWritten + kStaleAfterSeconds);
  CHECK(old.footer == L"updated 6 h ago" && old.stale);
  CHECK(!BuildView(ok, Kind::Issues, 10, kWritten + kStaleAfterSeconds - 1).stale);

  auto partial = ParseSnapshot(ReadFixture("partial.json"));
  View p = BuildView(partial, Kind::Issues, 10, kWritten + 60);
  CHECK(p.footer == L"2 repos not updated \u00b7 updated 1 min ago" && !p.rows[0].dimmed);
  CHECK(BuildView(partial, Kind::Prs, 10, kWritten).message == L"No pull requests need your attention");

  auto out = ParseSnapshot(ReadFixture("signed_out.json"));
  View s = BuildView(out, Kind::Issues, 10, kWritten + 60);
  CHECK(s.rows.size() == 1 && s.rows[0].dimmed && s.footer == L"Signed out of GitHub \u00b7 updated 1 min ago");
  CHECK(BuildView(out, Kind::Projects, 10, kWritten).message == L"No recent projects");  // projects are independent of GitHub

  Loaded missing;
  CHECK(BuildView(missing, Kind::Prs, 10, kWritten).message == L"Open Null IDE to set up widgets");
  Loaded corrupt;
  corrupt.state = Load::Corrupt;
  CHECK(BuildView(corrupt, Kind::Prs, 10, kWritten).message == L"Open Null IDE to set up widgets");
  CHECK(BuildView(ParseSnapshot(ReadFixture("newer_schema.json")), Kind::Prs, 10, kWritten).message == L"Update Null IDE");

  CHECK(FormatAge(5) == L"just now" && FormatAge(90) == L"1 min ago" && FormatAge(7200) == L"2 h ago" && FormatAge(200000) == L"2 d ago");
}

static void TestHostileRowsHaveNoActions() {
  auto h = ParseSnapshot(ReadFixture("hostile.json"));
  View issues = BuildView(h, Kind::Issues, 10, kWritten);
  CHECK(issues.rows.size() == 4);
  for (auto const& r : issues.rows) CHECK(r.click.kind == ActionKind::None && r.menu.empty());
  View projects = BuildView(h, Kind::Projects, 10, kWritten);
  CHECK(projects.rows[0].click.kind == ActionKind::None && projects.rows[1].click.kind == ActionKind::None);
  CHECK(projects.rows[2].click.kind == ActionKind::OpenProject);
  // Markup-looking text stays text.
  CHECK(Text(issues.rows[0].title) == L"#1 ${$host.widgetSize} {{x}} <b>hi</b>");
}

int main() {
  winrt::init_apartment();
  TestRows();
  TestFooterAndStates();
  TestHostileRowsHaveNoActions();
  return Finish("layout_test");
}
