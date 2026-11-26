# Central platform production web release 97

Amplify job 97 on the production branch succeeded. The archive retrieved from that job and the local upload contain identical bytes for all 128 files. This reference records the deployed web UI and does not serve as a version lock for independently deployed backend services.

Build the web output using `infrastructure/production/build_admin_frontend.py` from this branch, with the approved local vendor assets and `--support-socket-url wss://x7o502lmzk.execute-api.us-east-1.amazonaws.com/production`. Then overlay the files under `overlays/` at the same relative paths in the output. These 25 files preserve the exact static assets used in the incremental Amplify release. Confirm that the complete file list and individual SHA-256 hashes match `manifest.json`. ZIP container metadata can differ when repacking.

Use the composition above when reproducing release 97. For a subsequent release, review the source changes and the resulting web artifact against this baseline.
