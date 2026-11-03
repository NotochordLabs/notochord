#!/bin/sh
# Entry point of the runner image. Keeps the state on the mounted volume in charge:
# with a manifest it runs; without one it deploys only when DEPLOY_ARGS asks for it.
set -eu
: "${EXPERIMENT_NAME:?Set EXPERIMENT_NAME}"
manifest="runner/state/$EXPERIMENT_NAME/manifest.json"
if [ ! -f "$manifest" ]; then
  if [ -z "${DEPLOY_ARGS:-}" ]; then
    echo "No manifest at $manifest and DEPLOY_ARGS is empty. Nothing was sent. Waiting."
    exec sleep infinity
  fi
  echo "Deploying $EXPERIMENT_NAME: $DEPLOY_ARGS"
  # shellcheck disable=SC2086
  npx tsx runner/cli.ts deploy --name "$EXPERIMENT_NAME" $DEPLOY_ARGS
fi
exec npx tsx runner/cli.ts run --name "$EXPERIMENT_NAME"
