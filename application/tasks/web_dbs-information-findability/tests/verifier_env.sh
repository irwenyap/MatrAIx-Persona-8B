#!/bin/bash
set -euo pipefail
TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VERIFIER_DIR="${HARBOR_VERIFIER_DIR:-/logs/verifier}"
export TESTS_DIR VERIFIER_DIR HARBOR_VERIFIER_DIR="${VERIFIER_DIR}"
mkdir -p "${VERIFIER_DIR}"
