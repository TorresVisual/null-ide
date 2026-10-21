#include "check.h"
#include "placement.h"

using namespace null_widgets;

static bool Same(Box a, Box b) { return a.left == b.left && a.top == b.top && a.right == b.right && a.bottom == b.bottom; }

static void TestFile() {
  LayoutFile l;
  l.locked = true;
  l.widget[1] = {false, true, -300, 40, 400, 0};
  l.widget[2].placed = true;
  l.widget[2].x = 10;
  l.widget[2].y = 20;
  LayoutFile back = ParseLayout(SerializeLayout(l));
  CHECK(back.locked);
  CHECK(!back.widget[1].visible && back.widget[1].placed && back.widget[1].x == -300 && back.widget[1].y == 40);
  CHECK(back.widget[1].w == 400 && back.widget[1].h == 0);
  CHECK(back.widget[0].visible && !back.widget[0].placed);  // never saved: defaults
  CHECK(back.widget[2].placed && back.widget[2].x == 10 && back.widget[2].y == 20);

  // Garbage and hostile values never throw and never produce a nonsense size.
  CHECK(!ParseLayout(L"").locked && !ParseLayout(L"{nope").widget[0].placed && !ParseLayout(L"[]").widget[0].placed);
  LayoutFile odd = ParseLayout(L"{\"locked\":\"yes\",\"widgets\":{\"projects\":{\"x\":5,\"y\":\"7\",\"w\":99999,\"h\":-5,\"visible\":3},\"issues\":7}}");
  CHECK(!odd.locked && !odd.widget[0].placed && odd.widget[0].w == 0 && odd.widget[0].h == 0 && odd.widget[0].visible);
  CHECK(odd.widget[1].visible && !odd.widget[1].placed);
}

static void TestBoxes() {
  Box primary{0, 0, 1920, 1040};
  CHECK(Same(DefaultBox(Kind::Projects, primary, 1.0), Box{1576, 24, 1896, 264}));
  CHECK(Same(DefaultBox(Kind::Issues, primary, 1.0), Box{1536, 280, 1896, 600}));
  CHECK(Same(DefaultBox(Kind::Prs, primary, 1.0), Box{1536, 616, 1896, 936}));
  CHECK(DefaultBox(Kind::Projects, primary, 2.0).w() == 640);

  std::vector<Box> two{{0, 0, 1920, 1040}, {1920, 0, 3840, 1040}};
  CHECK(Same(ClampToMonitors(Box{-100, 50, 220, 290}, two), Box{0, 50, 320, 290}));            // off the left edge
  CHECK(Same(ClampToMonitors(Box{1800, 50, 2160, 370}, two), Box{1920, 50, 2280, 370}));       // mostly on monitor 2
  CHECK(Same(ClampToMonitors(Box{100, 900, 420, 1140}, two), Box{100, 800, 420, 1040}));       // below the work area
  CHECK(Same(ClampToMonitors(Box{2000, 100, 2320, 340}, two), Box{2000, 100, 2320, 340}));     // already fine
  std::vector<Box> one{{0, 0, 1920, 1040}};
  CHECK(Same(ClampToMonitors(Box{3000, 100, 3320, 340}, one), Box{1600, 100, 1920, 340}));     // its monitor was unplugged
  CHECK(Same(ClampToMonitors(Box{50, 50, 2150, 1500}, one), Box{0, 0, 2100, 1450}));           // bigger than the monitor: top-left
  CHECK(Same(ClampToMonitors(Box{5, 5, 25, 25}, {}), Box{5, 5, 25, 25}));                      // no monitor list: unchanged

  CHECK(Same(SnapToEdges(Box{10, 12, 330, 252}, one, 16), Box{0, 0, 320, 240}));
  CHECK(Same(SnapToEdges(Box{1590, 400, 1910, 640}, one, 16), Box{1600, 400, 1920, 640}));     // right edge
  CHECK(Same(SnapToEdges(Box{100, 400, 420, 640}, one, 16), Box{100, 400, 420, 640}));         // nothing near
  CHECK(Same(SnapToEdges(Box{100, 810, 420, 1030}, one, 16), Box{100, 820, 420, 1040}));       // bottom edge only
}

int main() {
  winrt::init_apartment();
  TestFile();
  TestBoxes();
  return Finish("placement_test");
}
