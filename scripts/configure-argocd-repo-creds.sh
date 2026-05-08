#!/usr/bin/env sh
set -eu

ARGOCD_NAMESPACE="${ARGOCD_NAMESPACE:-argocd}"
ARGOCD_APP_NAME="${ARGOCD_APP_NAME:-dev-cicd-challenge}"
ARGOCD_REPO_SECRET_NAME="${ARGOCD_REPO_SECRET_NAME:-repo-dev-cicd-challenge-gitlab}"
ARGOCD_REPO_NAME="${ARGOCD_REPO_NAME:-dev-cicd-challenge-gitlab}"
ARGOCD_REPO_URL="${ARGOCD_REPO_URL:-https://gitlab.com/hernan2003a/dev-cicd-challenge.git}"
ARGOCD_USERNAME="${ARGOCD_USERNAME:-oauth2}"

restore_terminal() {
  if [ -n "${ARGOCD_STTY_STATE:-}" ]; then
    stty "${ARGOCD_STTY_STATE}" 2>/dev/null || true
  else
    stty echo 2>/dev/null || true
  fi
}

prompt_for_token() {
  if [ -n "${ARGOCD_TOKEN:-}" ]; then
    return 0
  fi

  if [ ! -t 0 ]; then
    echo "ARGOCD_TOKEN is not set and stdin is not interactive."
    echo "Export ARGOCD_TOKEN or rerun this script from a terminal so it can prompt for the token."
    echo "Optional overrides: ARGOCD_USERNAME, ARGOCD_NAMESPACE, ARGOCD_APP_NAME, ARGOCD_REPO_URL."
    exit 1
  fi

  printf "Paste ARGOCD_TOKEN for %s: " "${ARGOCD_REPO_URL}" >&2
  ARGOCD_STTY_STATE="$(stty -g 2>/dev/null || true)"
  trap 'restore_terminal' EXIT HUP INT TERM
  stty -echo 2>/dev/null || true

  if ! IFS= read -r ARGOCD_TOKEN; then
    restore_terminal
    trap - EXIT HUP INT TERM
    printf '\n' >&2
    echo "Failed to read ARGOCD_TOKEN from terminal."
    exit 1
  fi

  restore_terminal
  trap - EXIT HUP INT TERM
  printf '\n' >&2

  if [ -z "${ARGOCD_TOKEN:-}" ]; then
    echo "ARGOCD_TOKEN is empty."
    exit 1
  fi
}

if ! command -v kubectl >/dev/null 2>&1; then
  echo "kubectl is required but was not found in PATH."
  exit 1
fi

prompt_for_token

SECRET_ACTION="created"
if kubectl get secret -n "${ARGOCD_NAMESPACE}" "${ARGOCD_REPO_SECRET_NAME}" >/dev/null 2>&1; then
  SECRET_ACTION="updated"
fi

cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: ${ARGOCD_REPO_SECRET_NAME}
  namespace: ${ARGOCD_NAMESPACE}
  labels:
    argocd.argoproj.io/secret-type: repository
stringData:
  name: ${ARGOCD_REPO_NAME}
  type: git
  url: ${ARGOCD_REPO_URL}
  username: ${ARGOCD_USERNAME}
  password: ${ARGOCD_TOKEN}
EOF

kubectl annotate application.argoproj.io -n "${ARGOCD_NAMESPACE}" "${ARGOCD_APP_NAME}" argocd.argoproj.io/refresh=hard --overwrite >/dev/null 2>&1 || true

echo "Argo CD repository secret ${ARGOCD_REPO_SECRET_NAME} ${SECRET_ACTION} in namespace ${ARGOCD_NAMESPACE}."
echo "Argo CD repository credentials applied for ${ARGOCD_REPO_URL}."
echo "Application refresh requested for ${ARGOCD_APP_NAME}."
echo "Verify with: kubectl get application -n ${ARGOCD_NAMESPACE} ${ARGOCD_APP_NAME} -o yaml"
