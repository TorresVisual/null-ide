#pragma once
#include <string>
#include <vector>

#include "layout.h"

namespace null_widgets {

struct Box {
  int left = 0, top = 0, right = 0, bottom = 0;
  int w() const { return right - left; }
  int h() const { return bottom - top; }
};

// One widget's saved state. x/y are virtual-screen pixels; w/h are DIPs (0 = the default size of the widget).
struct Placement {
  bool visible = true;
  bool placed = false;  // false until the widget has a position (first run, or a file without one)
  int x = 0, y = 0;
  int w = 0, h = 0;
};

struct LayoutFile {
  bool locked = false;
  Placement widget[kKindCount];
};

// Never throws; anything unreadable falls back to the defaults (unplaced, visible, unlocked).
LayoutFile ParseLayout(std::wstring const& json);
std::wstring SerializeLayout(LayoutFile const& layout);

// First-run position: a column down the right edge of the primary work area. `scale` is dpi / 96.
Box DefaultBox(Kind kind, Box primaryWork, double scale);

// Moves `r` fully inside the monitor it overlaps most (the nearest one when it overlaps none).
Box ClampToMonitors(Box r, std::vector<Box> const& work);
// Pulls `r` onto a work-area edge that is within `threshold` pixels.
Box SnapToEdges(Box r, std::vector<Box> const& work, int threshold);

}  // namespace null_widgets
