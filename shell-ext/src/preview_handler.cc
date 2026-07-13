// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.
//
// IPreviewHandler implementation for Null IDE's curated code/text file
// types. Renders plain monospace text in Windows Explorer's Preview Pane.

#include <windows.h>
#include <shobjidl_core.h>
#include <ocidl.h>
#include <oleidl.h>

#include <algorithm>
#include <string>
#include <vector>

#include <wrl/module.h>
#include <wrl/implements.h>
#include <wrl/client.h>
#include "wil/resource.h"
#include "wil/win32_helpers.h"

using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::ComPtr;
using Microsoft::WRL::InhibitRoOriginateError;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;

namespace {

constexpr size_t kMaxPreviewBytes = 256 * 1024;  // 256 KB cap
constexpr size_t kMaxPreviewLines = 5000;
constexpr wchar_t kTruncationNotice[] =
    L"\r\n\r\n\x2026 truncated \x2014 open in Null IDE to view the full file";
constexpr wchar_t kNoPreviewNotice[] = L"No preview available for this file.";
constexpr wchar_t kPreviewWindowClass[] = L"NullIdePreviewHandlerHost";

// Reads up to kMaxPreviewBytes of |path| and decodes it as UTF-16LE/UTF-8.
// Sets |isBinary| when the first 8 KB sampled contains a NUL byte.
std::wstring LoadPreviewText(const std::wstring& path, bool* isBinary) {
  *isBinary = false;

  wil::unique_hfile file(CreateFileW(path.c_str(), GENERIC_READ,
                                     FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                                     FILE_ATTRIBUTE_NORMAL, nullptr));
  if (!file) {
    return L"";
  }

  std::vector<unsigned char> buffer(kMaxPreviewBytes);
  DWORD bytesRead = 0;
  if (!ReadFile(file.get(), buffer.data(),
               static_cast<DWORD>(buffer.size()), &bytesRead, nullptr)) {
    return L"";
  }
  buffer.resize(bytesRead);

  const size_t sampleSize = (std::min)(static_cast<size_t>(bytesRead), static_cast<size_t>(8192));
  for (size_t i = 0; i < sampleSize; ++i) {
    if (buffer[i] == 0) {
      *isBinary = true;
      return L"";
    }
  }

  std::wstring text;
  if (bytesRead >= 2 && buffer[0] == 0xFF && buffer[1] == 0xFE) {
    // UTF-16 LE BOM.
    const wchar_t* wideStart = reinterpret_cast<const wchar_t*>(buffer.data() + 2);
    const size_t wideLen = (bytesRead - 2) / sizeof(wchar_t);
    text.assign(wideStart, wideLen);
  } else {
    size_t skip = 0;
    if (bytesRead >= 3 && buffer[0] == 0xEF && buffer[1] == 0xBB && buffer[2] == 0xBF) {
      skip = 3;  // UTF-8 BOM.
    }
    const char* utf8Start = reinterpret_cast<const char*>(buffer.data() + skip);
    const int utf8Len = static_cast<int>(bytesRead - skip);
    const int wideLen = MultiByteToWideChar(CP_UTF8, 0, utf8Start, utf8Len, nullptr, 0);
    if (wideLen > 0) {
      text.resize(wideLen);
      MultiByteToWideChar(CP_UTF8, 0, utf8Start, utf8Len, text.data(), wideLen);
    }
  }

  size_t lineCount = 0;
  size_t cutAt = text.size();
  for (size_t i = 0; i < text.size(); ++i) {
    if (text[i] == L'\n') {
      if (++lineCount >= kMaxPreviewLines) {
        cutAt = i;
        break;
      }
    }
  }

  const bool truncated = (cutAt < text.size()) || (bytesRead == kMaxPreviewBytes);
  if (truncated) {
    text.resize(cutAt);
    text += kTruncationNotice;
  }

  return text;
}

LRESULT CALLBACK PreviewWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  return DefWindowProcW(hwnd, msg, wParam, lParam);
}

void EnsureWindowClassRegistered(HINSTANCE instance) {
  static bool registered = false;
  if (registered) {
    return;
  }
  WNDCLASSW wc{};
  wc.lpfnWndProc = PreviewWndProc;
  wc.hInstance = instance;
  wc.lpszClassName = kPreviewWindowClass;
  wc.hbrBackground = reinterpret_cast<HBRUSH>(COLOR_WINDOW + 1);
  RegisterClassW(&wc);
  registered = true;
}

}  // namespace

class __declspec(uuid(PREVIEW_HANDLER_UUID)) PreviewHandler final
    : public RuntimeClass<RuntimeClassFlags<ClassicCom | InhibitRoOriginateError>,
                          IPreviewHandler, IPreviewHandlerVisuals,
                          IObjectWithSite, IOleWindow, IInitializeWithFile> {
 public:
  // IInitializeWithFile
  IFACEMETHODIMP Initialize(LPCWSTR filePath, DWORD grfMode) {
    UNREFERENCED_PARAMETER(grfMode);
    filePath_ = filePath;
    return S_OK;
  }

  // IPreviewHandler
  IFACEMETHODIMP SetWindow(HWND hwnd, const RECT* rect) {
    parentWindow_ = hwnd;
    if (rect) {
      rect_ = *rect;
    }
    if (previewWindow_) {
      SetParent(previewWindow_, parentWindow_);
      MoveWindow(previewWindow_, rect_.left, rect_.top,
                rect_.right - rect_.left, rect_.bottom - rect_.top, TRUE);
    }
    return S_OK;
  }

  IFACEMETHODIMP SetRect(const RECT* rect) {
    if (!rect) {
      return E_POINTER;
    }
    rect_ = *rect;
    if (previewWindow_) {
      MoveWindow(previewWindow_, rect_.left, rect_.top,
                rect_.right - rect_.left, rect_.bottom - rect_.top, TRUE);
    }
    return S_OK;
  }

  IFACEMETHODIMP DoPreview() {
    if (!parentWindow_ || filePath_.empty()) {
      return E_UNEXPECTED;
    }

    const HINSTANCE instance = wil::GetModuleInstanceHandle();
    EnsureWindowClassRegistered(instance);

    if (previewWindow_) {
      DestroyWindow(previewWindow_);
      previewWindow_ = nullptr;
      textControl_ = nullptr;
    }

    previewWindow_ = CreateWindowExW(
        0, kPreviewWindowClass, L"", WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS,
        rect_.left, rect_.top, rect_.right - rect_.left,
        rect_.bottom - rect_.top, parentWindow_, nullptr, instance, nullptr);
    if (!previewWindow_) {
      return HRESULT_FROM_WIN32(GetLastError());
    }

    textControl_ = CreateWindowExW(
        0, L"EDIT", L"",
        WS_CHILD | WS_VISIBLE | WS_VSCROLL | ES_MULTILINE | ES_READONLY |
            ES_AUTOVSCROLL,
        0, 0, rect_.right - rect_.left, rect_.bottom - rect_.top,
        previewWindow_, nullptr, instance, nullptr);
    if (!textControl_) {
      return HRESULT_FROM_WIN32(GetLastError());
    }

    NONCLIENTMETRICSW metrics{sizeof(metrics)};
    if (SystemParametersInfoW(SPI_GETNONCLIENTMETRICS, sizeof(metrics), &metrics, 0)) {
      metrics.lfMessageFont.lfPitchAndFamily = FIXED_PITCH | FF_MODERN;
      wcsncpy_s(metrics.lfMessageFont.lfFaceName, L"Cascadia Mono", _TRUNCATE);
      font_.reset(CreateFontIndirectW(&metrics.lfMessageFont));
      if (!font_) {
        wcsncpy_s(metrics.lfMessageFont.lfFaceName, L"Consolas", _TRUNCATE);
        font_.reset(CreateFontIndirectW(&metrics.lfMessageFont));
      }
      if (font_) {
        SendMessageW(textControl_, WM_SETFONT, reinterpret_cast<WPARAM>(font_.get()), TRUE);
      }
    }

    bool isBinary = false;
    const std::wstring text = LoadPreviewText(filePath_, &isBinary);
    SetWindowTextW(textControl_, isBinary ? kNoPreviewNotice : text.c_str());

    return S_OK;
  }

  IFACEMETHODIMP Unload() {
    if (previewWindow_) {
      DestroyWindow(previewWindow_);
      previewWindow_ = nullptr;
      textControl_ = nullptr;
    }
    font_.reset();
    filePath_.clear();
    return S_OK;
  }

  IFACEMETHODIMP SetFocus() {
    if (textControl_) {
      ::SetFocus(textControl_);
      return S_OK;
    }
    return S_FALSE;
  }

  IFACEMETHODIMP QueryFocus(HWND* focusedWindow) {
    if (!focusedWindow) {
      return E_POINTER;
    }
    *focusedWindow = GetFocus();
    return *focusedWindow ? S_OK : E_FAIL;
  }

  IFACEMETHODIMP TranslateAccelerator(MSG* msg) {
    UNREFERENCED_PARAMETER(msg);
    return S_FALSE;
  }

  // IPreviewHandlerVisuals
  IFACEMETHODIMP SetBackgroundColor(COLORREF color) {
    UNREFERENCED_PARAMETER(color);
    return S_OK;
  }
  IFACEMETHODIMP SetFont(const LOGFONTW* font) {
    UNREFERENCED_PARAMETER(font);
    return S_OK;
  }
  IFACEMETHODIMP SetTextColor(COLORREF color) {
    UNREFERENCED_PARAMETER(color);
    return S_OK;
  }

  // IObjectWithSite
  IFACEMETHODIMP SetSite(IUnknown* site) {
    site_ = site;
    return S_OK;
  }

  IFACEMETHODIMP GetSite(REFIID riid, void** site) {
    if (!site) {
      return E_POINTER;
    }
    *site = nullptr;
    return site_ ? site_.CopyTo(riid, site) : E_FAIL;
  }

  // IOleWindow
  IFACEMETHODIMP GetWindow(HWND* hwnd) {
    if (!hwnd) {
      return E_POINTER;
    }
    *hwnd = previewWindow_;
    return previewWindow_ ? S_OK : E_FAIL;
  }

  IFACEMETHODIMP ContextSensitiveHelp(BOOL enterMode) {
    UNREFERENCED_PARAMETER(enterMode);
    return E_NOTIMPL;
  }

 private:
  std::wstring filePath_;
  HWND parentWindow_ = nullptr;
  HWND previewWindow_ = nullptr;
  HWND textControl_ = nullptr;
  RECT rect_{};
  wil::unique_hfont font_;
  ComPtr<IUnknown> site_;
};

CoCreatableClass(PreviewHandler)
CoCreatableClassWrlCreatorMapInclude(PreviewHandler)
