load('ext://dotenv', 'dotenv')
dotenv(fn=".env", verbose=True, showValues=False)

# Dev secrets (AUTH_SECRET, provider ENCRYPTION_KEY/IV, NOTIFICATION_ENCRYPTION_KEY)
# are generated once per machine into a gitignored file, never committed.
# Delete the file to regenerate; see k8s/tools/dev-secrets.sh.
DEV_SECRETS_FILE = '.local/tilt-dev-secrets.env'
local('./k8s/tools/dev-secrets.sh ' + DEV_SECRETS_FILE, quiet=True)
dotenv(fn=DEV_SECRETS_FILE, verbose=False, showValues=False)

watch_file('.env')
secret_settings(disable_scrub = True)

include('./k8s/tools/Tiltfile')

LOCALNET_ENABLED = os.getenv('LOCALNET_ENABLED', '') == 'true'
if LOCALNET_ENABLED:
    include('./k8s/tools/localnet/Tiltfile')

include('./k8s/apps/provider/Tiltfile')
include('./k8s/apps/middleman/Tiltfile')
include('./k8s/apps/middleman-workflows/Tiltfile')
include('./k8s/apps/provider-workflows/Tiltfile')
