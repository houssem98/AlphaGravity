#!/bin/bash
# Personal website loop: houssem98 portfolio + AlphaGravity hero
# Iterates on: hero → projects grid → traction → engagement

set -e
cd "$(dirname "$0")"

echo "=== houssem98 Portfolio Loop ==="
phase="${1:-all}"

# Fetch all projects for houssem98
echo "Fetching houssem98 repos..."
repos=$(gh repo list houssem98 --json name,stargazerCount,forkCount,description,url,primaryLanguage -q '.[].name')
total=$(echo "$repos" | wc -l)

echo "✓ Found $total projects"
echo ""

# Highlight AlphaGravity metrics
echo "=== AlphaGravity (Hero) ==="
ag_stars=$(gh repo view houssem98/AlphaGravity --json stargazerCount -q .stargazerCount)
ag_forks=$(gh repo view houssem98/AlphaGravity --json forkCount -q .forkCount)
echo "Stars: $ag_stars | Forks: $ag_forks"

# List all projects
echo ""
echo "=== Portfolio Projects ==="
gh repo list houssem98 --json name,stargazerCount,primaryLanguage -q '.[] | "\(.name) (\(.stargazerCount) ⭐) [\(.primaryLanguage.name // "—")]"'

# Phase 1: Foundation
if [[ "$phase" == "all" ]] || [[ "$phase" == "foundation" ]]; then
  echo ""
  echo "=== Phase 1: Foundation ==="
  echo "TODO: Create Next.js portfolio in apps/personal-website"
  echo "TODO: Hero: AlphaGravity tagline + live demo embed"
  echo "TODO: Deploy to houssem98.dev or personal.alphagravity.com"
fi

# Phase 2: Projects grid
if [[ "$phase" == "all" ]] || [[ "$phase" == "showcase" ]]; then
  echo ""
  echo "=== Phase 2: Projects Grid ==="
  echo "TODO: Card per repo: name, stars, language, description, link"
  echo "TODO: Pinned: AlphaGravity + top 3 by stars"
  echo "TODO: Filter: language, stars"
fi

# Phase 3: Traction + story
if [[ "$phase" == "all" ]] || [[ "$phase" == "traction" ]]; then
  echo ""
  echo "=== Phase 3: Traction ==="
  echo "Total projects: $total"
  echo "AlphaGravity stars: $ag_stars"
  echo "TODO: Founder bio + timeline"
  echo "TODO: Tech stack + expertise tags"
fi

# Phase 4: Engagement
if [[ "$phase" == "all" ]] || [[ "$phase" == "engagement" ]]; then
  echo ""
  echo "=== Phase 4: Engagement ==="
  echo "TODO: Email signup"
  echo "TODO: Social links + GitHub stars counter (live)"
  echo "TODO: Blog (pull from dev.to or Medium)"
fi

echo ""
echo "Next: npx create-next-app@latest personal-website --typescript"
