load('ext://dotenv', 'dotenv')
dotenv(fn=".env", verbose=True, showValues=False)

watch_file('.env')
secret_settings(disable_scrub = True)

include('./k8s/tools/Tiltfile')
include('./k8s/apps/provider/Tiltfile')
include('./k8s/apps/middleman/Tiltfile')
include('./k8s/apps/middleman-workflows/Tiltfile')
include('./k8s/apps/provider-workflows/Tiltfile')
