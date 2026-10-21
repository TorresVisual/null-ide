#include "layout.h"

#include <algorithm>

namespace null_widgets {

namespace {

constexpr int kMaxRows[kKindCount] = {8, 10, 10};  // the same constants as widgetTypes.ts

Span S(std::wstring text, Tone tone = Tone::Normal) { return Span{std::move(text), tone}; }

// Parts separated by " \u00b7 ".
std::vector<Span> Joined(std::vector<Span> parts) {
  std::vector<Span> out;
  for (auto& p : parts) {
    if (p.text.empty()) continue;
    if (!out.empty()) out.push_back(S(L" \u00b7 ", Tone::Muted));
    out.push_back(std::move(p));
  }
  return out;
}

std::wstring Num(long n) { return L"#" + std::to_wstring(n) + L" "; }

std::wstring ReasonText(std::wstring const& status) {
  if (status == L"signed_out") return L"Signed out of GitHub";
  if (status == L"offline") return L"Offline";
  return L"Could not update";
}

std::wstring Labels(std::vector<std::wstring> const& labels) {
  std::wstring out;
  for (auto const& l : labels) out += (out.empty() ? L"" : L", ") + l;
  return out;
}

Row ProjectRow(Project const& p, long long now) {
  Row r;
  if (p.pinned) r.title.push_back(S(L"\u2605 ", Tone::Accent));
  r.title.push_back(S(p.name));
  if (p.dirty) r.title.push_back(S(L" \u25cf", Tone::Warn));
  long long opened = 0;
  std::wstring when = ParseIsoUtc(p.lastOpened, &opened) ? FormatAge(now - opened) : L"";
  r.detail = Joined({S(p.branch, Tone::Muted), S(when, Tone::Muted)});
  if (!p.path.empty()) {
    r.click = {ActionKind::OpenProject, p.path, L"Open"};
    r.menu = {r.click, {ActionKind::OpenProjectNewWindow, p.path, L"Open in new window"}};
  }
  return r;
}

Row IssueRow(Issue const& i) {
  Row r;
  r.title = {S(Num(i.number), Tone::Muted), S(i.title)};
  r.detail = Joined({S(i.attention == L"assigned" ? L"assigned" : L"mentioned", i.attention == L"assigned" ? Tone::Accent : Tone::Muted),
                     S(i.repo, Tone::Muted), S(Labels(i.labels), Tone::Muted)});
  if (!i.url.empty()) {
    r.click = {ActionKind::OpenUrl, i.url, L"Open in browser"};
    r.menu.push_back(r.click);
  }
  if (!i.localPath.empty()) r.menu.push_back({ActionKind::OpenProject, i.localPath, L"Open project"});
  return r;
}

Row PrRow(Pr const& p) {
  Row r;
  r.title = {S(Num(p.number), Tone::Muted), S(p.title)};
  Span review = p.review == L"requested" ? S(L"review requested", Tone::Accent)
              : p.review == L"approved"  ? S(L"approved", Tone::Good)
              : p.review == L"changes"   ? S(L"changes requested", Tone::Bad)
                                         : S(L"");
  Span checks = p.checks == L"failing" ? S(L"checks failing", Tone::Bad)
              : p.checks == L"pending" ? S(L"checks pending", Tone::Warn)
              : p.checks == L"passing" ? S(L"checks passing", Tone::Good)
                                       : S(L"");
  r.detail = Joined({review, checks, S(p.conflict ? L"conflict" : L"", Tone::Bad), S(p.repo, Tone::Muted), S(p.author, Tone::Muted)});
  if (!p.url.empty()) {
    r.click = {ActionKind::OpenUrl, p.url, L"Open in browser"};
    r.menu.push_back(r.click);
  }
  if (!p.localPath.empty()) r.menu.push_back({ActionKind::OpenProject, p.localPath, L"Open project"});
  return r;
}

template <class T, class F>
void FillRows(View& v, std::vector<T> const& items, int maxRows, bool dimmed, F make) {
  for (size_t i = 0; i < items.size() && static_cast<int>(i) < maxRows; ++i) {
    Row r = make(items[i]);
    r.dimmed = dimmed;
    v.rows.push_back(std::move(r));
  }
}

}  // namespace

SizeDip DefaultSize(Kind kind) {
  return kind == Kind::Projects ? SizeDip{320, 240} : SizeDip{360, 320};
}

wchar_t const* TitleOf(Kind kind) {
  return kind == Kind::Projects ? L"Projects" : kind == Kind::Issues ? L"Issues" : L"Pull Requests";
}

wchar_t const* KeyOf(Kind kind) {
  return kind == Kind::Projects ? L"projects" : kind == Kind::Issues ? L"issues" : L"prs";
}

int RowsThatFit(int heightDip) {
  return std::max(1, (heightDip - kHeaderDip - kFooterDip - kPadDip) / kRowDip);
}

std::wstring FormatAge(long long s) {
  if (s < 60) return L"just now";
  if (s < 3600) return std::to_wstring(s / 60) + L" min ago";
  if (s < 86400) return std::to_wstring(s / 3600) + L" h ago";
  return std::to_wstring(s / 86400) + L" d ago";
}

View BuildView(Loaded const& loaded, Kind kind, int maxRows, long long now) {
  View v;
  v.title = TitleOf(kind);
  if (loaded.state == Load::NewerSchema) {
    v.message = L"Update Null IDE";
    return v;
  }
  if (loaded.state != Load::Ok) {
    v.message = L"Open Null IDE to set up widgets";
    return v;
  }
  Snapshot const& s = loaded.snapshot;
  maxRows = std::min(maxRows, kMaxRows[static_cast<int>(kind)]);
  Section const& sec = kind == Kind::Projects ? s.projectsSection : kind == Kind::Issues ? s.issuesSection : s.prsSection;
  bool dimmed = sec.status != L"ok";
  if (kind == Kind::Projects) FillRows(v, s.projects, maxRows, dimmed, [&](Project const& p) { return ProjectRow(p, now); });
  if (kind == Kind::Issues) FillRows(v, s.issues, maxRows, dimmed, IssueRow);
  if (kind == Kind::Prs) FillRows(v, s.prs, maxRows, dimmed, PrRow);

  if (v.rows.empty()) {
    v.message = dimmed ? ReasonText(sec.status)
              : kind == Kind::Projects ? L"No recent projects"
              : kind == Kind::Issues   ? L"No issues need your attention"
                                       : L"No pull requests need your attention";
  }

  std::vector<Span> footer;
  if (dimmed) {
    footer.push_back(S(ReasonText(sec.status)));
  } else if (!sec.failed.empty()) {
    size_t n = sec.failed.size();
    footer.push_back(S(std::to_wstring(n) + (n == 1 ? L" repo not updated" : L" repos not updated")));
  }
  long long written = 0;
  if (ParseIsoUtc(s.writtenAt, &written)) {
    long long age = std::max(0LL, now - written);
    footer.push_back(S(L"updated " + FormatAge(age)));
    v.stale = age >= kStaleAfterSeconds;
  }
  for (auto const& sp : Joined(std::move(footer))) v.footer += sp.text;
  return v;
}

}  // namespace null_widgets
