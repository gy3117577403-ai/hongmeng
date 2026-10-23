#!/bin/sh
set -eu
# Reuse the pinned, already-built converter fonts instead of downloading an apt
# package during browser acceptance. Both release paths use identical CJK fonts.
test -n "${BROWSER_FONT_CONTAINER:-}"
font_directory="${HOME}/.local/share/fonts/hongmeng-office-preview"
mkdir -p "$font_directory"
docker cp "${BROWSER_FONT_CONTAINER}:/usr/share/fonts/opentype/noto/." "$font_directory/"
test -s "$font_directory/NotoSansCJK-Regular.ttc"
test -s "$font_directory/NotoSansCJK-Bold.ttc"
fc-cache -f "$font_directory"
fc-match -f '%{family}\n' 'Noto Sans CJK SC' | grep -F 'Noto Sans CJK SC'
echo 'Pinned converter CJK fonts are ready for browser acceptance.'
