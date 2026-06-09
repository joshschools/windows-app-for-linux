#!/usr/bin/env bash
# Phase 1 helper: connect to Azure Virtual Desktop via FreeRDP (native RDP).
# Requires FreeRDP 3.x built with WITH_AAD=ON for ARM gateway auth.
#
# Usage:
#   ./scripts/freerdp-avd-connect.sh path/to/workspace.rdpw [--multimon] [--monitors 0,1]
#
# Environment:
#   FREERDP_USER   — username (default: prompt)
#   FREERDP_DOMAIN — optional domain / UPN suffix
#
# See docs/native-rdp-mode.md for the full development plan.

set -euo pipefail

RDPW="${1:-}"
shift || true

if [[ -z "$RDPW" || ! -f "$RDPW" ]]; then
  echo "Usage: $0 <workspace.rdpw> [--multimon] [--monitors 0,1]" >&2
  exit 1
fi

if ! command -v xfreerdp >/dev/null 2>&1; then
  echo "xfreerdp not found. Install FreeRDP 3.x with AAD/ARM support." >&2
  echo "See docs/native-rdp-mode.md" >&2
  exit 1
fi

MULTIMON=()
MONITORS=()
EXTRA=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --multimon) MULTIMON=(/multimon) ;;
    --monitors) MONITORS=(/monitors:"$2"); shift ;;
    *) EXTRA+=("$1") ;;
  esac
  shift
done

USER_ARGS=()
if [[ -n "${FREERDP_USER:-}" ]]; then
  USER_ARGS=(/u:"$FREERDP_USER")
  if [[ -n "${FREERDP_DOMAIN:-}" ]]; then
    USER_ARGS+=(/d:"$FREERDP_DOMAIN")
  fi
fi

echo "Connecting with FreeRDP (native RDP)..."
echo "  File: $RDPW"
echo "  Multi-monitor: ${MULTIMON[*]:-off}"
echo ""

exec xfreerdp "$RDPW" \
  /gateway:type:arm \
  /cert:ignore \
  +clipboard \
  /dynamic-resolution \
  "${MULTIMON[@]}" \
  "${MONITORS[@]}" \
  "${USER_ARGS[@]}" \
  "${EXTRA[@]}"
