#pragma once
#include <string>
#include <vector>

namespace null_widgets {

constexpr int kSchema = 1;

enum class Load { Ok, Missing, Corrupt, NewerSchema };

struct Failed { std::wstring repo, reason; };
struct Section { std::wstring status = L"ok"; std::vector<Failed> failed; };
struct Project { std::wstring name, path, branch, lastOpened; bool dirty = false, pinned = false; };
struct Issue { std::wstring repo, title, url, attention, localPath, assignee; std::vector<std::wstring> labels; long number = 0; };
struct Pr { std::wstring repo, title, url, author, review, checks, localPath; bool conflict = false; long number = 0; };

struct Snapshot {
  std::wstring writtenAt;  // ISO-8601 UTC as written
  Section projectsSection, issuesSection, prsSection;
  std::vector<Project> projects;
  std::vector<Issue> issues;
  std::vector<Pr> prs;
};

struct Loaded {
  Load state = Load::Missing;
  Snapshot snapshot;
};

// Never throws. Everything in the result is already validated: unsafe URLs and paths are emptied, text is capped.
Loaded ParseSnapshot(std::wstring const& json);
// Missing when the file is absent, Corrupt when it is over 2 MB, else ParseSnapshot.
Loaded LoadSnapshotFile(std::wstring const& path);
// A corrupt file keeps the last good render; every other outcome (including a deleted file) replaces it.
Loaded KeepLastGood(Loaded const& previous, Loaded fresh);

bool IsSafeGithubUrl(std::wstring const& url);
bool IsAbsoluteLocalPath(std::wstring const& path);
// Control characters become spaces; longer text is cut and ends in an ellipsis.
std::wstring CapText(std::wstring const& s, size_t maxLen);
// "2026-10-21T14:03:11Z" -> epoch seconds.
bool ParseIsoUtc(std::wstring const& iso, long long* epochSeconds);

}  // namespace null_widgets
