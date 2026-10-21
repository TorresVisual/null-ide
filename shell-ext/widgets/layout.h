#pragma once
#include <string>
#include <vector>

#include "snapshot.h"

namespace null_widgets {

enum class Kind { Projects = 0, Issues = 1, Prs = 2 };
constexpr int kKindCount = 3;

enum class Tone { Normal, Muted, Accent, Good, Warn, Bad };
struct Span { std::wstring text; Tone tone = Tone::Normal; };

enum class ActionKind { None, OpenUrl, OpenProject, OpenProjectNewWindow };
struct Action {
  ActionKind kind = ActionKind::None;
  std::wstring target;  // URL or absolute project path, already validated by ParseSnapshot
  std::wstring label;   // menu text
};

struct Row {
  std::vector<Span> title, detail;
  Action click;              // left click; None when the row has nothing to open
  std::vector<Action> menu;  // right-click items for this row
  bool dimmed = false;
};

struct View {
  std::wstring title;
  std::vector<Row> rows;
  std::wstring message;  // drawn instead of the rows when non-empty
  std::wstring footer;
  bool stale = false;    // footer muted
};

// The footer is muted once the snapshot is older than this.
constexpr long long kStaleAfterSeconds = 6 * 3600;

// Metrics in DIPs; the renderer and the hit test share them.
constexpr int kHeaderDip = 36, kRowDip = 40, kFooterDip = 24, kPadDip = 8;

struct SizeDip { int w, h; };
SizeDip DefaultSize(Kind kind);
wchar_t const* TitleOf(Kind kind);
wchar_t const* KeyOf(Kind kind);  // "projects" | "issues" | "prs"
int RowsThatFit(int heightDip);   // at least 1

std::wstring FormatAge(long long seconds);
View BuildView(Loaded const& loaded, Kind kind, int maxRows, long long nowEpoch);

}  // namespace null_widgets
