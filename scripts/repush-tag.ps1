# Move tag to latest commit and force push
$tag = git describe --tags --abbrev=0

Write-Host "Moving tag $tag to latest commit..."

git tag -f $tag
git push origin $tag --force