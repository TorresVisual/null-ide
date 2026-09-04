# Create and push a new tag (auto-bump patch version)

# Get latest tag
$latestTag = git describe --tags --abbrev=0

if (-not $latestTag) {
    Write-Host "No tags found. Creating initial tag v0.0.1"
    $newTag = "v0.0.1"
} else {
    Write-Host "Latest tag: $latestTag"

    # Remove leading "v" if present
    $version = $latestTag -replace "^v", ""

    # Split into major.minor.patch
    $parts = $version.Split(".")
    if ($parts.Count -ne 3) {
        Write-Host "Tag format not semver (expected vX.Y.Z). Aborting."
        exit 1
    }

    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]

    # Increment patch
    $patch++

    $newTag = "v$major.$minor.$patch"
}

Write-Host "Creating new tag: $newTag"

# Create tag
git tag $newTag

# Push tag to origin
git push origin $newTag

Write-Host "Done."