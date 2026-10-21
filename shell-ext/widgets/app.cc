// null_widgets.exe: Projects / Issues / Pull Requests as borderless windows that live on the desktop (children of its icon host, so Win+D keeps them).
// Reads %LOCALAPPDATA%\Null\widgets\snapshot.json (written by the IDE) and never touches the network.
#include <windows.h>
#include <d2d1.h>
#include <dwrite.h>
#include <shlobj.h>
#include <shellscalingapi.h>
#include <windowsx.h>

#include <algorithm>
#include <cmath>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

#include <winrt/Windows.Foundation.h>

#include "actions.h"
#include "layout.h"
#include "placement.h"
#include "snapshot.h"

using namespace null_widgets;

namespace {

constexpr wchar_t kControlClass[] = L"NullWidgetsControl";
constexpr wchar_t kWidgetClass[] = L"NullWidgetsWindow";
constexpr wchar_t kMutexName[] = L"Local\\NullWidgets.Singleton";

constexpr UINT WM_APP_RELOAD = WM_APP + 1;     // the snapshot file changed
constexpr UINT WM_APP_SHOW_ALL = WM_APP + 2;  // a second launch: show every hidden widget
constexpr UINT_PTR kTickTimer = 1;             // repaint once a minute so "updated N min ago" moves on
constexpr UINT_PTR kEnsureTimer = 2;           // every 5 s: put back widget windows that Explorer took with it
constexpr int kDragThresholdPx = 4, kSnapDip = 16;

enum MenuId : UINT { kRefresh = 1, kLock, kHide, kQuit, kShowBase = 100, kRowBase = 200 };

// Null Dark (extensions/null-theme/themes/null-dark.json).
struct Palette {
  D2D1_COLOR_F bg{0.094f, 0.094f, 0.094f, 0.94f}, border{1, 1, 1, 0.08f}, hover{1, 1, 1, 0.07f};
  D2D1_COLOR_F text{0.8f, 0.8f, 0.8f, 1}, muted{0.616f, 0.616f, 0.616f, 1}, faint{0.45f, 0.45f, 0.45f, 1};
  D2D1_COLOR_F accent{0.302f, 0.667f, 0.988f, 1}, good{0.18f, 0.627f, 0.263f, 1}, warn{0.8f, 0.655f, 0, 1}, bad{0.973f, 0.318f, 0.286f, 1};
};
const Palette kPal;

struct Widget {
  Kind kind;
  HWND hwnd = nullptr;
  View view;
  int hover = -1;      // row under the cursor
  bool tracking = false;
  bool down = false, dragging = false;
  POINT downScreen{}, downOrigin{};
};

struct App {
  HINSTANCE inst = nullptr;
  HWND control = nullptr;
  std::wstring installDir, dataDir, snapshotPath, layoutPath;
  LayoutFile layout;
  Loaded loaded;  // what is drawn: the last good snapshot
  Widget widgets[kKindCount] = {{Kind::Projects}, {Kind::Issues}, {Kind::Prs}};
  ID2D1Factory* d2d = nullptr;
  IDWriteFactory* dwrite = nullptr;
} app;

template <class T>
void Release(T*& p) {
  if (p) { p->Release(); p = nullptr; }
}

std::wstring ReadText(std::wstring const& path) {
  std::ifstream f(std::filesystem::path(path), std::ios::binary);
  std::stringstream ss;
  ss << f.rdbuf();
  return std::wstring(winrt::to_hstring(ss.str()).c_str());
}

void WriteTextAtomic(std::wstring const& path, std::wstring const& text) {
  std::wstring tmp = path + L".tmp";
  std::string utf8(winrt::to_string(winrt::hstring(text)));
  {
    std::ofstream f(std::filesystem::path(tmp), std::ios::binary | std::ios::trunc);
    f << utf8;
  }
  MoveFileExW(tmp.c_str(), path.c_str(), MOVEFILE_REPLACE_EXISTING);
}

long long NowEpoch() { return static_cast<long long>(std::time(nullptr)); }

std::vector<Box> WorkAreas() {
  std::vector<Box> out;
  EnumDisplayMonitors(nullptr, nullptr,
      [](HMONITOR m, HDC, LPRECT, LPARAM lp) -> BOOL {
        MONITORINFO mi{sizeof(mi)};
        if (GetMonitorInfoW(m, &mi)) {
          reinterpret_cast<std::vector<Box>*>(lp)->push_back({mi.rcWork.left, mi.rcWork.top, mi.rcWork.right, mi.rcWork.bottom});
        }
        return TRUE;
      },
      reinterpret_cast<LPARAM>(&out));
  return out;
}

Box PrimaryWork() {
  RECT r{};
  SystemParametersInfoW(SPI_GETWORKAREA, 0, &r, 0);
  return {r.left, r.top, r.right, r.bottom};
}

// A widget sits inside Explorer's desktop window, which spans every monitor, so the DPI of the monitor under it is what counts.
double ScaleOf(HWND h) {
  HMONITOR m = MonitorFromWindow(h ? h : GetDesktopWindow(), MONITOR_DEFAULTTOPRIMARY);
  UINT dx = 96, dy = 96;
  if (FAILED(GetDpiForMonitor(m, MDT_EFFECTIVE_DPI, &dx, &dy)) || dx == 0) dx = 96;
  return static_cast<double>(dx) / 96.0;
}
int Px(double dip, double scale) { return static_cast<int>(std::lround(dip * scale)); }

SizeDip SizeOfWidget(Kind k) {
  Placement const& p = app.layout.widget[static_cast<int>(k)];
  SizeDip d = DefaultSize(k);
  return {p.w > 0 ? p.w : d.w, p.h > 0 ? p.h : d.h};
}

void SaveLayout() { WriteTextAtomic(app.layoutPath, SerializeLayout(app.layout)); }

// ---- drawing -----------------------------------------------------------------------------------------------

struct Fonts {
  IDWriteTextFormat *title = nullptr, *row = nullptr, *detail = nullptr, *foot = nullptr, *message = nullptr;
};

IDWriteTextFormat* MakeFormat(float size, DWRITE_FONT_WEIGHT weight, DWRITE_TEXT_ALIGNMENT align = DWRITE_TEXT_ALIGNMENT_LEADING) {
  IDWriteTextFormat* f = nullptr;
  if (SUCCEEDED(app.dwrite->CreateTextFormat(L"Segoe UI", nullptr, weight, DWRITE_FONT_STYLE_NORMAL, DWRITE_FONT_STRETCH_NORMAL, size, L"", &f))) {
    f->SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP);
    f->SetTextAlignment(align);
    f->SetParagraphAlignment(DWRITE_PARAGRAPH_ALIGNMENT_NEAR);
  }
  return f;
}

D2D1_COLOR_F ToneColor(Tone t) {
  switch (t) {
    case Tone::Muted: return kPal.muted;
    case Tone::Accent: return kPal.accent;
    case Tone::Good: return kPal.good;
    case Tone::Warn: return kPal.warn;
    case Tone::Bad: return kPal.bad;
    default: return kPal.text;
  }
}

// Draws spans left to right on one line; the span that runs out of room is cut with an ellipsis.
void DrawSpans(ID2D1RenderTarget* rt, ID2D1SolidColorBrush* brush, IDWriteTextFormat* fmt, std::vector<Span> const& spans, float x, float y,
               float maxX, bool dimmed) {
  IDWriteInlineObject* ellipsis = nullptr;
  DWRITE_TRIMMING trim{DWRITE_TRIMMING_GRANULARITY_CHARACTER, 0, 0};
  for (auto const& s : spans) {
    if (x >= maxX) break;
    IDWriteTextLayout* layout = nullptr;
    if (FAILED(app.dwrite->CreateTextLayout(s.text.c_str(), static_cast<UINT32>(s.text.size()), fmt, maxX - x, 24.f, &layout))) break;
    if (!ellipsis) app.dwrite->CreateEllipsisTrimmingSign(fmt, &ellipsis);
    layout->SetTrimming(&trim, ellipsis);
    DWRITE_TEXT_METRICS m{};
    layout->GetMetrics(&m);
    D2D1_COLOR_F c = ToneColor(s.tone);
    if (dimmed) c.a *= 0.5f;
    brush->SetColor(c);
    rt->DrawTextLayout(D2D1::Point2F(x, y), layout, brush);
    x += m.widthIncludingTrailingWhitespace;
    layout->Release();
  }
  Release(ellipsis);
}

void Render(Widget& w) {
  if (!w.hwnd || !IsWindowVisible(w.hwnd)) return;
  double scale = ScaleOf(w.hwnd);
  SizeDip sd = SizeOfWidget(w.kind);
  int pw = Px(sd.w, scale), ph = Px(sd.h, scale);

  HDC screen = GetDC(nullptr);
  HDC mem = CreateCompatibleDC(screen);
  BITMAPINFO bi{};
  bi.bmiHeader = {sizeof(BITMAPINFOHEADER), pw, -ph, 1, 32, BI_RGB};
  void* bits = nullptr;
  HBITMAP bmp = CreateDIBSection(screen, &bi, DIB_RGB_COLORS, &bits, nullptr, 0);
  HGDIOBJ old = SelectObject(mem, bmp);

  ID2D1DCRenderTarget* rt = nullptr;
  D2D1_RENDER_TARGET_PROPERTIES props = D2D1::RenderTargetProperties(
      D2D1_RENDER_TARGET_TYPE_DEFAULT, D2D1::PixelFormat(DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED), 96.f * static_cast<float>(scale),
      96.f * static_cast<float>(scale), D2D1_RENDER_TARGET_USAGE_GDI_COMPATIBLE);
  if (SUCCEEDED(app.d2d->CreateDCRenderTarget(&props, &rt))) {
    RECT bounds{0, 0, pw, ph};
    rt->BindDC(mem, &bounds);
    ID2D1SolidColorBrush* brush = nullptr;
    rt->CreateSolidColorBrush(kPal.bg, &brush);
    Fonts f{MakeFormat(13.f, DWRITE_FONT_WEIGHT_SEMI_BOLD), MakeFormat(13.f, DWRITE_FONT_WEIGHT_NORMAL), MakeFormat(11.f, DWRITE_FONT_WEIGHT_NORMAL),
            MakeFormat(11.f, DWRITE_FONT_WEIGHT_NORMAL), MakeFormat(13.f, DWRITE_FONT_WEIGHT_NORMAL, DWRITE_TEXT_ALIGNMENT_CENTER)};

    float W = static_cast<float>(sd.w), H = static_cast<float>(sd.h);
    View const& v = w.view;
    rt->BeginDraw();
    rt->Clear(D2D1::ColorF(0, 0, 0, 0));
    D2D1_ROUNDED_RECT card = D2D1::RoundedRect(D2D1::RectF(0.5f, 0.5f, W - 0.5f, H - 0.5f), 10.f, 10.f);
    brush->SetColor(kPal.bg);
    rt->FillRoundedRectangle(card, brush);
    brush->SetColor(kPal.border);
    rt->DrawRoundedRectangle(card, brush, 1.f);

    brush->SetColor(kPal.text);
    rt->DrawText(v.title.c_str(), static_cast<UINT32>(v.title.size()), f.title, D2D1::RectF(14, 9, W - 14, kHeaderDip), brush);

    if (!v.message.empty()) {
      brush->SetColor(kPal.muted);
      rt->DrawText(v.message.c_str(), static_cast<UINT32>(v.message.size()), f.message, D2D1::RectF(14, kHeaderDip + 24, W - 14, H - kFooterDip), brush);
    }
    for (size_t i = 0; i < v.rows.size(); ++i) {
      float top = static_cast<float>(kHeaderDip + i * kRowDip);
      if (static_cast<int>(i) == w.hover && v.rows[i].click.kind != ActionKind::None) {
        brush->SetColor(kPal.hover);
        rt->FillRoundedRectangle(D2D1::RoundedRect(D2D1::RectF(6, top, W - 6, top + kRowDip - 2), 6.f, 6.f), brush);
      }
      DrawSpans(rt, brush, f.row, v.rows[i].title, 14, top + 3, W - 14, v.rows[i].dimmed);
      DrawSpans(rt, brush, f.detail, v.rows[i].detail, 14, top + 22, W - 14, v.rows[i].dimmed);
    }
    if (!v.footer.empty()) {
      brush->SetColor(v.stale ? kPal.faint : kPal.muted);
      rt->DrawText(v.footer.c_str(), static_cast<UINT32>(v.footer.size()), f.foot, D2D1::RectF(14, H - kFooterDip + 2, W - 14, H), brush);
    }
    rt->EndDraw();

    Release(f.title); Release(f.row); Release(f.detail); Release(f.foot); Release(f.message);
    Release(brush);
    Release(rt);
  }

  RECT wr{};
  GetWindowRect(w.hwnd, &wr);
  POINT pos{wr.left, wr.top}, src{0, 0};
  ScreenToClient(GetParent(w.hwnd), &pos);  // a child window is positioned in its parent's client coordinates
  SIZE size{pw, ph};
  BLENDFUNCTION blend{AC_SRC_OVER, 0, 255, AC_SRC_ALPHA};
  UpdateLayeredWindow(w.hwnd, screen, &pos, &size, mem, &src, 0, &blend, ULW_ALPHA);

  SelectObject(mem, old);
  DeleteObject(bmp);
  DeleteDC(mem);
  ReleaseDC(nullptr, screen);
}

void Rebuild(Widget& w) {
  w.view = BuildView(app.loaded, w.kind, RowsThatFit(SizeOfWidget(w.kind).h), NowEpoch());
  if (w.hover >= static_cast<int>(w.view.rows.size())) w.hover = -1;
  Render(w);
}

void RebuildAll() {
  for (auto& w : app.widgets) Rebuild(w);
}

void Reload() {
  app.loaded = KeepLastGood(app.loaded, LoadSnapshotFile(app.snapshotPath));
  RebuildAll();
}

// ---- placement ---------------------------------------------------------------------------------------------

// Widgets are layered child windows of the desktop's icon host (SHELLDLL_DefView): Windows keeps those on the desktop through Win+D and
// below every app. A top-level window pinned above Progman is hidden by Win+D (docs/specs/native-windows-widgets-gate.md).
HWND FindDesktopHost() {
  HWND prog = FindWindowW(L"Progman", nullptr);
  if (!prog) return nullptr;
  HWND v = FindWindowExW(prog, nullptr, L"SHELLDLL_DefView", nullptr);
  if (v) return v;
  DWORD_PTR ignored = 0;
  SendMessageTimeoutW(prog, 0x052C, 0xD, 0x1, SMTO_NORMAL, 1000, &ignored);  // older builds: make Progman spawn the WorkerW that holds the icons
  v = FindWindowExW(prog, nullptr, L"SHELLDLL_DefView", nullptr);
  if (v) return v;
  EnumWindows(
      [](HWND h, LPARAM lp) -> BOOL {
        if (HWND d = FindWindowExW(h, nullptr, L"SHELLDLL_DefView", nullptr)) {
          *reinterpret_cast<HWND*>(lp) = d;
          return FALSE;
        }
        return TRUE;
      },
      reinterpret_cast<LPARAM>(&v));
  return v;
}

HWND CreateWidgetWindow(Widget& w, HWND host) {
  HWND h = CreateWindowExW(WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE, kWidgetClass, TitleOf(w.kind), WS_POPUP, 0, 0, 10, 10, nullptr, nullptr,
                           app.inst, nullptr);
  if (!h) return nullptr;
  SetWindowLongPtrW(h, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(&w));
  SetWindowLongPtrW(h, GWL_STYLE, (GetWindowLongPtrW(h, GWL_STYLE) & ~static_cast<LONG_PTR>(WS_POPUP)) | WS_CHILD);
  SetParent(h, host);
  SetWindowPos(h, HWND_TOP, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED);
  return h;
}

// True when a window had to be (re)created. Explorer destroys the children of its desktop window when it restarts.
bool EnsureWindows() {
  HWND host = FindDesktopHost();
  if (!host) return false;
  bool created = false;
  for (auto& w : app.widgets) {
    if (w.hwnd && IsWindow(w.hwnd) && GetParent(w.hwnd) == host) continue;
    if (w.hwnd && IsWindow(w.hwnd)) DestroyWindow(w.hwnd);
    w.hwnd = CreateWidgetWindow(w, host);
    w.hover = -1;
    w.tracking = w.down = w.dragging = false;
    created = created || w.hwnd != nullptr;
  }
  return created;
}

Box WindowBox(HWND h) {
  RECT r{};
  GetWindowRect(h, &r);
  return {r.left, r.top, r.right, r.bottom};
}

void MoveTo(Widget& w, Box b) {
  POINT p{b.left, b.top};
  ScreenToClient(GetParent(w.hwnd), &p);
  SetWindowPos(w.hwnd, nullptr, p.x, p.y, b.w(), b.h(), SWP_NOACTIVATE | SWP_NOZORDER);
}

// Puts every widget where the layout says, clamped to the monitors that exist now.
void ApplyLayout() {
  auto work = WorkAreas();
  for (int i = 0; i < kKindCount; ++i) {
    Widget& w = app.widgets[i];
    if (!w.hwnd) continue;  // Explorer is not ready yet; EnsureWindows tries again
    Placement& p = app.layout.widget[i];
    double scale = ScaleOf(w.hwnd);
    SizeDip sd = SizeOfWidget(w.kind);
    int pw = Px(sd.w, scale), ph = Px(sd.h, scale);
    Box b = p.placed ? Box{p.x, p.y, p.x + pw, p.y + ph} : DefaultBox(w.kind, PrimaryWork(), scale);
    b = ClampToMonitors(b, work);
    MoveTo(w, b);
    p.placed = true;
    p.x = b.left;
    p.y = b.top;
    ShowWindow(w.hwnd, p.visible ? SW_SHOWNOACTIVATE : SW_HIDE);
  }
  RebuildAll();
}

// ---- widget window -----------------------------------------------------------------------------------------

int RowAt(Widget const& w, int yPx) {
  double scale = ScaleOf(w.hwnd);
  int top = Px(kHeaderDip, scale), row = Px(kRowDip, scale);
  if (yPx < top) return -1;
  int i = (yPx - top) / row;
  return i < static_cast<int>(w.view.rows.size()) ? i : -1;
}

void ShowMenu(Widget& w, POINT screenPt, int row) {
  HMENU m = CreatePopupMenu();
  if (row >= 0) {
    auto const& items = w.view.rows[row].menu;
    for (size_t i = 0; i < items.size(); ++i) AppendMenuW(m, MF_STRING, kRowBase + i, items[i].label.c_str());
    if (!items.empty()) AppendMenuW(m, MF_SEPARATOR, 0, nullptr);
  }
  AppendMenuW(m, MF_STRING, kRefresh, L"Refresh");
  AppendMenuW(m, MF_STRING | (app.layout.locked ? MF_CHECKED : 0), kLock, L"Lock widgets");
  AppendMenuW(m, MF_STRING, kHide, L"Hide this widget");
  for (int i = 0; i < kKindCount; ++i) {
    if (!app.layout.widget[i].visible) {
      std::wstring label = std::wstring(L"Show ") + TitleOf(static_cast<Kind>(i));
      AppendMenuW(m, MF_STRING, kShowBase + i, label.c_str());
    }
  }
  AppendMenuW(m, MF_SEPARATOR, 0, nullptr);
  AppendMenuW(m, MF_STRING, kQuit, L"Quit widgets");

  SetForegroundWindow(app.control);  // without this the menu does not close when the user clicks elsewhere (a child window cannot take focus)
  UINT id = TrackPopupMenu(m, TPM_RETURNCMD | TPM_RIGHTBUTTON, screenPt.x, screenPt.y, 0, app.control, nullptr);
  PostMessageW(app.control, WM_NULL, 0, 0);
  DestroyMenu(m);

  int idx = static_cast<int>(w.kind);
  if (id >= kRowBase && id < kRowBase + 8 && row >= 0 && id - kRowBase < w.view.rows[row].menu.size()) {
    Run(w.view.rows[row].menu[id - kRowBase], app.installDir);
  } else if (id == kRefresh) {
    Reload();
  } else if (id == kLock) {
    app.layout.locked = !app.layout.locked;
    SaveLayout();
  } else if (id == kHide) {
    app.layout.widget[idx].visible = false;
    ShowWindow(w.hwnd, SW_HIDE);
    SaveLayout();
  } else if (id >= kShowBase && id < kShowBase + kKindCount) {
    app.layout.widget[id - kShowBase].visible = true;
    ShowWindow(app.widgets[id - kShowBase].hwnd, SW_SHOWNOACTIVATE);
    SaveLayout();
    Reload();
  } else if (id == kQuit) {
    PostMessageW(app.control, WM_CLOSE, 0, 0);
  }
}

LRESULT CALLBACK WidgetProc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
  Widget* w = reinterpret_cast<Widget*>(GetWindowLongPtrW(h, GWLP_USERDATA));
  if (!w) return DefWindowProcW(h, msg, wp, lp);
  switch (msg) {
    case WM_MOUSEACTIVATE:
      return MA_NOACTIVATE;
    case WM_MOUSEMOVE: {
      POINT pt{GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
      if (!w->tracking) {
        TRACKMOUSEEVENT t{sizeof(t), TME_LEAVE, h, 0};
        TrackMouseEvent(&t);
        w->tracking = true;
      }
      if (w->down && !app.layout.locked) {
        POINT s = pt;
        ClientToScreen(h, &s);
        if (!w->dragging && (std::abs(s.x - w->downScreen.x) > kDragThresholdPx || std::abs(s.y - w->downScreen.y) > kDragThresholdPx)) w->dragging = true;
        if (w->dragging) {
          Box cur = WindowBox(h);
          Box want{w->downOrigin.x + s.x - w->downScreen.x, w->downOrigin.y + s.y - w->downScreen.y, 0, 0};
          want.right = want.left + cur.w();
          want.bottom = want.top + cur.h();
          MoveTo(*w, SnapToEdges(want, WorkAreas(), Px(kSnapDip, ScaleOf(h))));
          return 0;
        }
      }
      int row = RowAt(*w, pt.y);
      if (row != w->hover) {
        w->hover = row;
        Render(*w);
      }
      return 0;
    }
    case WM_MOUSELEAVE:
      w->tracking = false;
      if (w->hover != -1) {
        w->hover = -1;
        Render(*w);
      }
      return 0;
    case WM_LBUTTONDOWN: {
      w->down = true;
      w->dragging = false;
      SetCapture(h);
      w->downScreen = {GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
      ClientToScreen(h, &w->downScreen);
      Box b = WindowBox(h);
      w->downOrigin = {b.left, b.top};
      return 0;
    }
    case WM_LBUTTONUP: {
      bool wasDragging = w->dragging;
      w->down = w->dragging = false;
      ReleaseCapture();
      if (wasDragging) {
        Box b = WindowBox(h);
        Placement& p = app.layout.widget[static_cast<int>(w->kind)];
        p.placed = true;
        p.x = b.left;
        p.y = b.top;
        SaveLayout();
      } else {
        int row = RowAt(*w, GET_Y_LPARAM(lp));
        if (row >= 0) Run(w->view.rows[row].click, app.installDir);
      }
      return 0;
    }
    case WM_RBUTTONUP: {
      POINT pt{GET_X_LPARAM(lp), GET_Y_LPARAM(lp)};
      int row = RowAt(*w, pt.y);
      ClientToScreen(h, &pt);
      ShowMenu(*w, pt, row);
      return 0;
    }
    case WM_NCDESTROY:
      if (w->hwnd == h) w->hwnd = nullptr;  // Explorer restarted (EnsureWindows may already have made a new window)
      break;
    case WM_CLOSE:  // taskkill without /F, or Alt+F4 on a focused widget: quit everything
      PostMessageW(app.control, WM_CLOSE, 0, 0);
      return 0;
  }
  return DefWindowProcW(h, msg, wp, lp);
}

// ---- control window: second launches, file changes, display and power events --------------------------------

LRESULT CALLBACK ControlProc(HWND h, UINT msg, WPARAM wp, LPARAM lp) {
  static UINT const taskbarCreated = RegisterWindowMessageW(L"TaskbarCreated");
  if (msg == taskbarCreated) {  // Explorer restarted: the old widget windows are gone, make new ones on its new desktop
    EnsureWindows();
    ApplyLayout();
    return 0;
  }
  switch (msg) {
    case WM_APP_RELOAD:
      Reload();
      return 0;
    case WM_APP_SHOW_ALL:
      for (int i = 0; i < kKindCount; ++i) {
        app.layout.widget[i].visible = true;
        ShowWindow(app.widgets[i].hwnd, SW_SHOWNOACTIVATE);
      }
      SaveLayout();
      Reload();
      return 0;
    case WM_TIMER:
      if (wp == kEnsureTimer) {
        if (EnsureWindows()) ApplyLayout();
      } else {
        RebuildAll();
      }
      return 0;
    case WM_DISPLAYCHANGE:
    case WM_DPICHANGED:
    case WM_SETTINGCHANGE:
      if (msg != WM_SETTINGCHANGE || wp == SPI_SETWORKAREA) ApplyLayout();
      return 0;
    case WM_POWERBROADCAST:
      if (wp == PBT_APMRESUMEAUTOMATIC || wp == PBT_APMRESUMESUSPEND) {
        EnsureWindows();
        ApplyLayout();
        Reload();
      }
      return TRUE;
    case WM_CLOSE:
    case WM_ENDSESSION:
      DestroyWindow(h);
      return 0;
    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;
  }
  return DefWindowProcW(h, msg, wp, lp);
}

// Posts WM_APP_RELOAD when anything in the widgets folder changes. Reload() reads the file again, so extra wake-ups are harmless.
DWORD WINAPI WatchThread(LPVOID) {
  HANDLE n = FindFirstChangeNotificationW(app.dataDir.c_str(), FALSE, FILE_NOTIFY_CHANGE_LAST_WRITE | FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_SIZE);
  if (n == INVALID_HANDLE_VALUE) return 1;
  while (WaitForSingleObject(n, INFINITE) == WAIT_OBJECT_0) {
    Sleep(150);  // let the writer finish its rename
    PostMessageW(app.control, WM_APP_RELOAD, 0, 0);
    if (!FindNextChangeNotification(n)) break;
  }
  FindCloseChangeNotification(n);
  return 0;
}

std::wstring KnownFolder(REFKNOWNFOLDERID id) {
  PWSTR p = nullptr;
  std::wstring out;
  if (SUCCEEDED(SHGetKnownFolderPath(id, 0, nullptr, &p))) out = p;
  CoTaskMemFree(p);
  return out;
}

}  // namespace

int WINAPI wWinMain(HINSTANCE inst, HINSTANCE, PWSTR, int) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  HANDLE once = CreateMutexW(nullptr, TRUE, kMutexName);
  if (GetLastError() == ERROR_ALREADY_EXISTS) {
    // A second launch (null-setup, "Null: Set Up Widgets"): bring every hidden widget back and leave.
    if (HWND other = FindWindowW(kControlClass, nullptr)) PostMessageW(other, WM_APP_SHOW_ALL, 0, 0);
    return 0;
  }
  winrt::init_apartment(winrt::apartment_type::single_threaded);
  ScrubIdeEnvironment();

  wchar_t exe[MAX_PATH];
  GetModuleFileNameW(nullptr, exe, MAX_PATH);
  app.installDir = std::filesystem::path(exe).parent_path().wstring();
  app.dataDir = KnownFolder(FOLDERID_LocalAppData) + L"\\Null\\widgets";
  std::filesystem::create_directories(app.dataDir);
  SetCurrentDirectoryW(app.dataDir.c_str());  // never keep the install folder busy: an update has to rename it
  app.snapshotPath = app.dataDir + L"\\snapshot.json";
  app.layoutPath = app.dataDir + L"\\layout.json";
  app.layout = ParseLayout(ReadText(app.layoutPath));

  D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, &app.d2d);
  DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED, __uuidof(IDWriteFactory), reinterpret_cast<IUnknown**>(&app.dwrite));
  if (!app.d2d || !app.dwrite) return 1;

  app.inst = inst;
  WNDCLASSEXW cc{sizeof(cc)};
  cc.lpfnWndProc = ControlProc;
  cc.hInstance = inst;
  cc.lpszClassName = kControlClass;
  RegisterClassExW(&cc);
  WNDCLASSEXW wc{sizeof(wc)};
  wc.lpfnWndProc = WidgetProc;
  wc.hInstance = inst;
  wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  wc.lpszClassName = kWidgetClass;
  RegisterClassExW(&wc);

  // A hidden top-level window (not message-only): only those receive WM_DISPLAYCHANGE and WM_POWERBROADCAST.
  app.control = CreateWindowExW(WS_EX_TOOLWINDOW, kControlClass, L"Null Widgets", WS_POPUP, 0, 0, 0, 0, nullptr, nullptr, inst, nullptr);
  EnsureWindows();  // false while Explorer is still starting at login: the 5 s timer keeps trying
  app.loaded = LoadSnapshotFile(app.snapshotPath);
  ApplyLayout();
  SaveLayout();
  SetTimer(app.control, kTickTimer, 60 * 1000, nullptr);
  SetTimer(app.control, kEnsureTimer, 5 * 1000, nullptr);
  CloseHandle(CreateThread(nullptr, 0, WatchThread, nullptr, 0, nullptr));

  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }
  Release(app.d2d);
  Release(app.dwrite);
  CloseHandle(once);
  return 0;
}
