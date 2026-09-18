#pragma comment(linker, "/manifestdependency:\"type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'\"")

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif

#include <windows.h>
#include <winhttp.h>
#include <shlwapi.h>
#include <shlobj.h>
#include <commctrl.h>
#include <tlhelp32.h>
#include <shellapi.h>
#include <strsafe.h>

#include <string>
#include <vector>
#include <memory>
#include <thread>
#include <atomic>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <algorithm>

#include "miniz.h"

namespace fs = std::filesystem;

#define WM_UPDATER_PROGRESS (WM_USER + 100)
#define WM_UPDATER_COMPLETE (WM_USER + 101)

struct UpdaterArgs {
    std::wstring repo = L"TorresVisual/null-ide";
    std::wstring version = L"";
    std::wstring installDir = L"";
    bool waitForExit = false;
    bool force = false;
    bool launch = false;
    bool includePrerelease = false;
};

struct ProgressMessage {
    int percent; // 0..100, or -1 for indeterminate
    std::wstring text;
};

class UpdaterWindow {
public:
    static void Run(const UpdaterArgs& args) {
        UpdaterWindow updater(args);
        updater.ShowDialog();
    }

private:
    UpdaterArgs m_args;
    HWND m_hwndTD = NULL;
    std::thread m_workerThread;
    std::atomic<bool> m_cancelRequested{false};
    bool m_success = false;
    std::wstring m_errorMessage;

    UpdaterWindow(const UpdaterArgs& args) : m_args(args) {}

    void ShowDialog() {
        INITCOMMONCONTROLSEX icce = { sizeof(icce), ICC_STANDARD_CLASSES | ICC_PROGRESS_CLASS };
        InitCommonControlsEx(&icce);

        TASKDIALOGCONFIG tdc = { sizeof(tdc) };
        tdc.hwndParent = NULL;
        tdc.hInstance = GetModuleHandle(NULL);
        tdc.dwFlags = TDF_SHOW_PROGRESS_BAR | TDF_CALLBACK_TIMER | TDF_ALLOW_DIALOG_CANCELLATION;
        tdc.pszWindowTitle = L"Null IDE Updater";
        tdc.pszMainInstruction = L"Updating Null IDE";
        tdc.pszContent = L"Initializing update process...";
        tdc.nDefaultButton = IDCANCEL;
        tdc.pfCallback = TaskDialogCallbackProc;
        tdc.lpCallbackData = reinterpret_cast<LONG_PTR>(this);

        int buttonPressed = 0;
        TaskDialogIndirect(&tdc, &buttonPressed, NULL, NULL);

        if (m_workerThread.joinable()) {
            m_workerThread.join();
        }
    }

    static HRESULT CALLBACK TaskDialogCallbackProc(HWND hwnd, UINT uNotification, WPARAM wParam, LPARAM lParam, LONG_PTR dwRefData) {
        (void)lParam;
        UpdaterWindow* self = reinterpret_cast<UpdaterWindow*>(dwRefData);
        if (!self) return S_OK;

        switch (uNotification) {
        case TDN_CREATED:
            self->m_hwndTD = hwnd;
            // Send marquee style if needed or initial state
            SendMessage(hwnd, TDM_SET_PROGRESS_BAR_POS, 0, 0);
            self->m_workerThread = std::thread(&UpdaterWindow::WorkerThreadProc, self);
            break;

        case TDN_BUTTON_CLICKED:
            if (static_cast<int>(wParam) == IDCANCEL) {
                self->m_cancelRequested = true;
                SendMessage(hwnd, TDM_SET_ELEMENT_TEXT, TDE_CONTENT, reinterpret_cast<LPARAM>(L"Cancelling update..."));
                return S_FALSE; // Don't close dialog immediately, wait for worker thread
            }
            break;

        case TDN_HYPERLINK_CLICKED:
            break;

        case TDN_NAVIGATED:
            break;

        default:
            break;
        }

        return S_OK;
    }

    void PostProgress(int percent, const std::wstring& text) {
        if (!m_hwndTD) return;
        ProgressMessage* msg = new ProgressMessage{ percent, text };
        PostMessage(m_hwndTD, WM_USER + 200, 0, reinterpret_cast<LPARAM>(msg));
    }

    // Process custom messages directly in a hook or by custom window subclass if needed.
    // However, TaskDialogIndirect doesn't process custom WM_USER messages by default unless handled in Callback or subclassed.
    // So we safely handle TaskDialog updates directly or via TaskDialog messages:
    void DirectUpdateUI(int percent, const std::wstring& text) {
        if (!m_hwndTD) return;
        if (percent >= 0) {
            SendMessage(m_hwndTD, TDM_SET_PROGRESS_BAR_MARQUEE, FALSE, 0);
            SendMessage(m_hwndTD, TDM_SET_PROGRESS_BAR_POS, static_cast<WPARAM>(percent), 0);
        } else {
            SendMessage(m_hwndTD, TDM_SET_PROGRESS_BAR_MARQUEE, TRUE, 0);
        }
        SendMessage(m_hwndTD, TDM_SET_ELEMENT_TEXT, TDE_CONTENT, reinterpret_cast<LPARAM>(text.c_str()));
    }

    void WorkerThreadProc() {
        try {
            ExecuteUpdate();
            DirectUpdateUI(100, L"Update completed successfully!");
            Sleep(500);
            SendMessage(m_hwndTD, TDM_CLICK_BUTTON, IDOK, 0);
        }
        catch (const std::exception& ex) {
            std::string errStr = ex.what();
            std::wstring wErr(errStr.begin(), errStr.end());
            DirectUpdateUI(0, L"Error: " + wErr);
            MessageBoxW(m_hwndTD, wErr.c_str(), L"Update Failed", MB_ICONERROR | MB_OK);
            SendMessage(m_hwndTD, TDM_CLICK_BUTTON, IDCANCEL, 0);
        }
        catch (...) {
            DirectUpdateUI(0, L"An unknown error occurred during update.");
            MessageBoxW(m_hwndTD, L"An unknown error occurred.", L"Update Failed", MB_ICONERROR | MB_OK);
            SendMessage(m_hwndTD, TDM_CLICK_BUTTON, IDCANCEL, 0);
        }
    }

    void ExecuteUpdate() {
        // 1. Wait for IDE process to exit if requested
        if (m_args.waitForExit && !m_args.installDir.empty()) {
            WaitForIdeExit(m_args.installDir);
        }

        if (m_cancelRequested) return;

        // 2. Fetch Release Metadata from GitHub API
        DirectUpdateUI(-1, L"Checking for latest release from GitHub...");
        std::wstring tagToFetch = m_args.version;
        std::wstring downloadUrl;
        std::wstring assetName;
        int64_t assetSize = 0;
        std::wstring releaseTag;

        FetchReleaseInfo(m_args.repo, tagToFetch, downloadUrl, assetName, assetSize, releaseTag);

        if (downloadUrl.empty()) {
            throw std::runtime_error("Could not find suitable null-ide-win32-x64 release asset.");
        }

        if (m_cancelRequested) return;

        // 3. Download Asset
        fs::path tempDir = fs::temp_directory_path() / (L"null-ide-update-" + std::to_wstring(GetTickCount64()));
        fs::create_directories(tempDir);
        fs::path zipPath = tempDir / assetName;

        DirectUpdateUI(0, L"Downloading " + assetName + L"...");
        DownloadFile(downloadUrl, zipPath, assetSize);

        if (m_cancelRequested) return;

        // 4. Extract Package
        fs::path extractDir = tempDir / L"extract";
        fs::create_directories(extractDir);
        DirectUpdateUI(0, L"Extracting update package...");
        ExtractZip(zipPath, extractDir);

        if (m_cancelRequested) return;

        // Locate null.exe or Null.exe inside extractDir (case-insensitive)
        fs::path packageRoot;
        std::wstring matchedExeName = L"Null.exe";

        for (auto& entry : fs::recursive_directory_iterator(extractDir)) {
            if (entry.is_regular_file()) {
                std::wstring fname = entry.path().filename().wstring();
                if (_wcsicmp(fname.c_str(), L"null.exe") == 0 || _wcsicmp(fname.c_str(), L"Null.exe") == 0) {
                    packageRoot = entry.path().parent_path();
                    matchedExeName = fname;
                    break;
                }
            }
        }
        if (packageRoot.empty()) {
            throw std::runtime_error("Invalid package: null.exe / Null.exe not found in extracted zip.");
        }

        // 5. Stage and Swap Installation
        DirectUpdateUI(-1, L"Installing Null IDE update...");

        fs::path targetInstallDir = m_args.installDir;
        if (targetInstallDir.empty()) {
            // Default fallback
            wchar_t localAppData[MAX_PATH];
            SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, localAppData);
            targetInstallDir = fs::path(localAppData) / L"Programs" / L"Null IDE";
        }

        fs::path parentDir = targetInstallDir.parent_path();
        fs::create_directories(parentDir);

        fs::path stageDir = parentDir / (L".null-ide-stage-" + std::to_wstring(GetTickCount64()));
        fs::path bakDir   = parentDir / (L".null-ide-bak-" + std::to_wstring(GetTickCount64()));

        // Move files from packageRoot to stageDir
        fs::rename(packageRoot, stageDir);

        // Preserve portable 'data' folder if present
        fs::path dataDir = targetInstallDir / L"data";
        if (fs::exists(dataDir)) {
            DirectUpdateUI(-1, L"Preserving user data...");
            fs::rename(dataDir, stageDir / L"data");
        }

        // Perform atomic swap
        if (fs::exists(targetInstallDir)) {
            RenameWithRetry(targetInstallDir, bakDir, 10, 500);
        }
        RenameWithRetry(stageDir, targetInstallDir, 10, 500);

        // Write install metadata
        WriteInstallMetadata(targetInstallDir, m_args.repo, releaseTag);

        // Clean up backup directory asynchronously or safely
        std::error_code ec;
        fs::remove_all(bakDir, ec);
        fs::remove_all(tempDir, ec);

        // 6. Launch updated IDE if requested
        if (m_args.launch) {
            fs::path exePath = targetInstallDir / matchedExeName;
            if (!fs::exists(exePath)) {
                exePath = targetInstallDir / L"null.exe";
            }
            if (!fs::exists(exePath)) {
                exePath = targetInstallDir / L"Null.exe";
            }

            if (fs::exists(exePath)) {
                STARTUPINFOW si = { sizeof(si) };
                PROCESS_INFORMATION pi = {};
                std::wstring cmd = L"\"" + exePath.wstring() + L"\"";
                CreateProcessW(NULL, &cmd[0], NULL, NULL, FALSE, 0, NULL, targetInstallDir.c_str(), &si, &pi);
                if (pi.hProcess) CloseHandle(pi.hProcess);
                if (pi.hThread) CloseHandle(pi.hThread);
            }
        }
    }

    void WaitForIdeExit(const fs::path& installDir) {
        DirectUpdateUI(-1, L"Waiting for Null IDE to close...");

        DWORD startTime = GetTickCount();
        const DWORD timeoutMs = 15000;

        while (GetTickCount() - startTime < timeoutMs) {
            if (m_cancelRequested) return;

            std::vector<DWORD> pids = GetProcessesInDir(installDir);
            if (pids.empty()) return;

            Sleep(500);
        }

        // Force kill if still running after timeout
        KillProcessesInDir(installDir);
        Sleep(500);
    }

    void KillProcessesInDir(const fs::path& dirPath) {
        std::vector<DWORD> pids = GetProcessesInDir(dirPath);
        for (DWORD pid : pids) {
            if (pid == GetCurrentProcessId()) continue;
            HANDLE hProc = OpenProcess(PROCESS_TERMINATE, FALSE, pid);
            if (hProc) {
                TerminateProcess(hProc, 0);
                CloseHandle(hProc);
            }
        }
    }

    std::vector<DWORD> GetProcessesInDir(const fs::path& dirPath) {
        std::vector<DWORD> result;
        std::wstring dirStr = fs::absolute(dirPath).wstring();
        if (!dirStr.empty() && dirStr.back() != L'\\' && dirStr.back() != L'/') {
            dirStr += L'\\';
        }
        std::transform(dirStr.begin(), dirStr.end(), dirStr.begin(), ::towlower);

        HANDLE hSnap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (hSnap == INVALID_HANDLE_VALUE) return result;

        PROCESSENTRY32W pe = { sizeof(pe) };
        if (Process32FirstW(hSnap, &pe)) {
            do {
                if (pe.th32ProcessID == GetCurrentProcessId()) continue;
                HANDLE hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pe.th32ProcessID);
                if (hProc) {
                    wchar_t pathBuf[MAX_PATH] = { 0 };
                    DWORD size = MAX_PATH;
                    if (QueryFullProcessImageNameW(hProc, 0, pathBuf, &size)) {
                        std::wstring pLower(pathBuf);
                        std::transform(pLower.begin(), pLower.end(), pLower.begin(), ::towlower);
                        if (pLower.rfind(dirStr, 0) == 0) {
                            result.push_back(pe.th32ProcessID);
                        }
                    }
                    CloseHandle(hProc);
                }
            } while (Process32NextW(hSnap, &pe));
        }
        CloseHandle(hSnap);
        return result;
    }

    void FetchReleaseInfo(const std::wstring& repo, const std::wstring& tag,
                         std::wstring& outDownloadUrl, std::wstring& outAssetName,
                         int64_t& outAssetSize, std::wstring& outTag) {
        HINTERNET hSession = WinHttpOpen(L"Null-IDE-Updater/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                         WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
        if (!hSession) throw std::runtime_error("WinHttpOpen failed.");

        DWORD redirectOption = WINHTTP_OPTION_REDIRECT_POLICY_ALWAYS;
        WinHttpSetOption(hSession, WINHTTP_OPTION_REDIRECT_POLICY, &redirectOption, sizeof(redirectOption));

        HINTERNET hConnect = WinHttpConnect(hSession, L"api.github.com", INTERNET_DEFAULT_HTTPS_PORT, 0);
        if (!hConnect) {
            WinHttpCloseHandle(hSession);
            throw std::runtime_error("WinHttpConnect failed.");
        }

        std::wstring path = tag.empty() ? (L"/repos/" + repo + L"/releases/latest")
                                       : (L"/repos/" + repo + L"/releases/tags/" + tag);

        HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"GET", path.c_str(), NULL,
                                                WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                                WINHTTP_FLAG_SECURE);
        if (!hRequest) {
            WinHttpCloseHandle(hConnect);
            WinHttpCloseHandle(hSession);
            throw std::runtime_error("WinHttpOpenRequest failed.");
        }

        std::wstring headers = L"User-Agent: Null-IDE-Updater\r\nAccept: application/vnd.github.v3+json\r\n";
        
        wchar_t tokenBuf[1024] = { 0 };
        if (GetEnvironmentVariableW(L"GITHUB_TOKEN", tokenBuf, 1024) > 0) {
            headers += L"Authorization: Bearer " + std::wstring(tokenBuf) + L"\r\n";
        }

        if (!WinHttpSendRequest(hRequest, headers.c_str(), static_cast<DWORD>(headers.length()),
                                WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
            !WinHttpReceiveResponse(hRequest, NULL)) {
            WinHttpCloseHandle(hRequest);
            WinHttpCloseHandle(hConnect);
            WinHttpCloseHandle(hSession);
            throw std::runtime_error("GitHub API HTTP request failed.");
        }

        std::string jsonBuffer;
        DWORD bytesAvailable = 0;
        while (WinHttpQueryDataAvailable(hRequest, &bytesAvailable) && bytesAvailable > 0) {
            std::vector<char> buf(bytesAvailable);
            DWORD bytesRead = 0;
            if (WinHttpReadData(hRequest, buf.data(), bytesAvailable, &bytesRead)) {
                jsonBuffer.append(buf.data(), bytesRead);
            }
        }

        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);

        // Simple JSON extraction for asset matching "null-ide-win32-x64*.zip"
        // Find "tag_name": "vX.Y.Z"
        size_t tagPos = jsonBuffer.find("\"tag_name\"");
        if (tagPos != std::string::npos) {
            size_t valStart = jsonBuffer.find("\"", tagPos + 10);
            size_t valEnd   = jsonBuffer.find("\"", valStart + 1);
            if (valStart != std::string::npos && valEnd != std::string::npos) {
                std::string t = jsonBuffer.substr(valStart + 1, valEnd - valStart - 1);
                outTag = std::wstring(t.begin(), t.end());
            }
        }

        // Search assets array for null-ide-win32-x64*.zip
        size_t assetPos = jsonBuffer.find("null-ide-win32-x64");
        if (assetPos == std::string::npos) {
            throw std::runtime_error("Release asset matching null-ide-win32-x64*.zip not found in release response.");
        }

        // Find asset name
        size_t nameStart = jsonBuffer.rfind("\"", assetPos);
        size_t nameEnd   = jsonBuffer.find("\"", assetPos);
        std::string aName = jsonBuffer.substr(nameStart + 1, nameEnd - nameStart - 1);
        outAssetName = std::wstring(aName.begin(), aName.end());

        // Find browser_download_url near this asset
        size_t urlPos = jsonBuffer.find("\"browser_download_url\"", assetPos);
        if (urlPos == std::string::npos) {
            urlPos = jsonBuffer.rfind("\"browser_download_url\"", assetPos);
        }
        if (urlPos != std::string::npos) {
            size_t uStart = jsonBuffer.find("\"", urlPos + 22);
            size_t uEnd   = jsonBuffer.find("\"", uStart + 1);
            std::string uStr = jsonBuffer.substr(uStart + 1, uEnd - uStart - 1);
            outDownloadUrl = std::wstring(uStr.begin(), uStr.end());
        }

        // Find size
        size_t sizePos = jsonBuffer.find("\"size\"", assetPos);
        if (sizePos == std::string::npos) {
            sizePos = jsonBuffer.rfind("\"size\"", assetPos);
        }
        if (sizePos != std::string::npos) {
            size_t numStart = jsonBuffer.find_first_of("0123456789", sizePos + 6);
            size_t numEnd   = jsonBuffer.find_first_not_of("0123456789", numStart);
            if (numStart != std::string::npos) {
                outAssetSize = std::stoll(jsonBuffer.substr(numStart, numEnd - numStart));
            }
        }
    }

    void DownloadFile(const std::wstring& url, const fs::path& destPath, int64_t totalSize) {
        URL_COMPONENTS urlComp = { sizeof(urlComp) };
        wchar_t hostName[256] = { 0 };
        wchar_t urlPath[2048] = { 0 };
        urlComp.lpszHostName = hostName;
        urlComp.dwHostNameLength = 256;
        urlComp.lpszUrlPath = urlPath;
        urlComp.dwUrlPathLength = 2048;

        if (!WinHttpCrackUrl(url.c_str(), static_cast<DWORD>(url.length()), 0, &urlComp)) {
            throw std::runtime_error("Invalid download URL.");
        }

        HINTERNET hSession = WinHttpOpen(L"Null-IDE-Updater/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                         WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
        if (!hSession) throw std::runtime_error("WinHttpOpen failed.");

        DWORD redirectOption = WINHTTP_OPTION_REDIRECT_POLICY_ALWAYS;
        WinHttpSetOption(hSession, WINHTTP_OPTION_REDIRECT_POLICY, &redirectOption, sizeof(redirectOption));

        INTERNET_PORT port = (urlComp.nScheme == INTERNET_SCHEME_HTTPS) ? INTERNET_DEFAULT_HTTPS_PORT : INTERNET_DEFAULT_HTTP_PORT;
        HINTERNET hConnect = WinHttpConnect(hSession, hostName, port, 0);
        if (!hConnect) {
            WinHttpCloseHandle(hSession);
            throw std::runtime_error("Download connect failed.");
        }

        DWORD reqFlags = (urlComp.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
        HINTERNET hRequest = WinHttpOpenRequest(hConnect, L"GET", urlPath, NULL,
                                                WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                                reqFlags);
        if (!hRequest) {
            WinHttpCloseHandle(hConnect);
            WinHttpCloseHandle(hSession);
            throw std::runtime_error("Download open request failed.");
        }

        if (!WinHttpSendRequest(hRequest, WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                                WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
            !WinHttpReceiveResponse(hRequest, NULL)) {
            WinHttpCloseHandle(hRequest);
            WinHttpCloseHandle(hConnect);
            WinHttpCloseHandle(hSession);
            throw std::runtime_error("Download send request failed.");
        }

        std::ofstream outFile(destPath, std::ios::binary);
        if (!outFile) {
            WinHttpCloseHandle(hRequest);
            WinHttpCloseHandle(hConnect);
            WinHttpCloseHandle(hSession);
            throw std::runtime_error("Cannot create destination ZIP file.");
        }

        std::vector<char> buffer(65536); // 64KB chunks
        int64_t downloaded = 0;
        DWORD bytesRead = 0;

        while (WinHttpReadData(hRequest, buffer.data(), static_cast<DWORD>(buffer.size()), &bytesRead) && bytesRead > 0) {
            if (m_cancelRequested) {
                outFile.close();
                WinHttpCloseHandle(hRequest);
                WinHttpCloseHandle(hConnect);
                WinHttpCloseHandle(hSession);
                return;
            }

            outFile.write(buffer.data(), bytesRead);
            downloaded += bytesRead;

            int pct = (totalSize > 0) ? static_cast<int>((downloaded * 100) / totalSize) : -1;
            wchar_t statusBuf[256];
            double dlMB = downloaded / (1024.0 * 1024.0);
            double totalMB = totalSize / (1024.0 * 1024.0);
            if (totalSize > 0) {
                swprintf_s(statusBuf, L"Downloading... (%.1f MB / %.1f MB)", dlMB, totalMB);
            } else {
                swprintf_s(statusBuf, L"Downloading... (%.1f MB)", dlMB);
            }
            DirectUpdateUI(pct, statusBuf);
        }

        outFile.close();
        WinHttpCloseHandle(hRequest);
        WinHttpCloseHandle(hConnect);
        WinHttpCloseHandle(hSession);
    }

    void ExtractZip(const fs::path& zipPath, const fs::path& destDir) {
        std::string zipPathStr = zipPath.string();

        mz_zip_archive zip = {};
        if (!mz_zip_reader_init_file(&zip, zipPathStr.c_str(), 0)) {
            throw std::runtime_error("Failed to open ZIP archive.");
        }

        mz_uint numFiles = mz_zip_reader_get_num_files(&zip);

        for (mz_uint i = 0; i < numFiles; ++i) {
            if (m_cancelRequested) {
                mz_zip_reader_end(&zip);
                return;
            }

            mz_zip_archive_file_stat stat = {};
            if (!mz_zip_reader_file_stat(&zip, i, &stat)) continue;

            fs::path entryPath = destDir / stat.m_filename;

            if (mz_zip_reader_is_file_a_directory(&zip, i)) {
                fs::create_directories(entryPath);
            } else {
                fs::create_directories(entryPath.parent_path());
                std::string entryPathStr = entryPath.string();
                if (!mz_zip_reader_extract_to_file(&zip, i, entryPathStr.c_str(), 0)) {
                    mz_zip_reader_end(&zip);
                    throw std::runtime_error("Failed to extract ZIP entry: " + std::string(stat.m_filename));
                }
            }

            if (i % 50 == 0 || i == numFiles - 1) {
                int pct = static_cast<int>(((i + 1) * 100) / numFiles);
                wchar_t statusBuf[256];
                swprintf_s(statusBuf, L"Extracting package... (%u / %u files)", i + 1, numFiles);
                DirectUpdateUI(pct, statusBuf);
            }
        }

        mz_zip_reader_end(&zip);
    }

    void RenameWithRetry(const fs::path& from, const fs::path& to, int maxRetries, int delayMs) {
        std::error_code ec;
        for (int i = 0; i < maxRetries; ++i) {
            fs::rename(from, to, ec);
            if (!ec) return;
            Sleep(delayMs);
        }
        throw std::runtime_error("Failed to rename directory: " + ec.message());
    }

    void WriteInstallMetadata(const fs::path& installDir, const std::wstring& repo, const std::wstring& version) {
        fs::path jsonPath = installDir / L".null-ide-install.json";
        std::wofstream f(jsonPath);
        if (f) {
            f << L"{\n";
            f << L"  \"repo\": \"" << repo << L"\",\n";
            f << L"  \"version\": \"" << version << L"\",\n";
            f << L"  \"installedAt\": \"\"\n";
            f << L"}\n";
        }
    }
};

UpdaterArgs ParseArgs(int argc, wchar_t* argv[]) {
    UpdaterArgs args;
    for (int i = 1; i < argc; ++i) {
        std::wstring arg = argv[i];
        if (arg == L"--repo" && i + 1 < argc) {
            args.repo = argv[++i];
        } else if (arg.rfind(L"--repo=", 0) == 0) {
            args.repo = arg.substr(7);
        } else if (arg == L"--install-dir" && i + 1 < argc) {
            args.installDir = argv[++i];
        } else if (arg.rfind(L"--install-dir=", 0) == 0) {
            args.installDir = arg.substr(14);
        } else if (arg == L"--version" && i + 1 < argc) {
            args.version = argv[++i];
        } else if (arg.rfind(L"--version=", 0) == 0) {
            args.version = arg.substr(10);
        } else if (arg == L"--wait" || arg == L"-WaitForExit") {
            args.waitForExit = true;
        } else if (arg == L"--force" || arg == L"-Force") {
            args.force = true;
        } else if (arg == L"--launch" || arg == L"-Launch") {
            args.launch = true;
        } else if (arg == L"--include-prerelease" || arg == L"-IncludePrerelease") {
            args.includePrerelease = true;
        }
    }
    return args;
}

int WINAPI wWinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, PWSTR pCmdLine, int nCmdShow) {
    (void)hInstance; (void)hPrevInstance; (void)pCmdLine; (void)nCmdShow;
    int argc = 0;
    wchar_t** argv = CommandLineToArgvW(GetCommandLineW(), &argc);

    UpdaterArgs args = ParseArgs(argc, argv);
    LocalFree(argv);

    UpdaterWindow::Run(args);
    return 0;
}
