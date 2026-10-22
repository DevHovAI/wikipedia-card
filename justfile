# Checks before each commit
check:
    python3 -c "import json; json.load(open('hacs.json'))"
    bash ~/.claude/skills/repo-flow/scripts/privacy-scan.sh
