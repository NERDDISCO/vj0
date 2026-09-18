# Separate proxy diagnostic

At 08:52 UTC on 2026-09-18, the default Python urllib client received HTTP403
with `error code: 1010` from the Runpod HTTPS proxy. Curl immediately received
HTTP200 from the same `/debug` endpoint. Headers and bodies are preserved here.
The existing benchmark control client already sends its declared benchmark
User-Agent and was not changed. No browser or proxy policy was modified.

Cloudflare documents1010 as a denial based on the client/browser signature:
[official error1010 documentation](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-1xxx-errors/error-1010/).
This confirms a separate client-dependent proxy rejection. It does **not** prove
that the earlier two Chrome connection-start failures had the same cause,
because those failures do not have a saved HTTP403 response body.
