# Running MobSimLab behind nginx

MobSimLab's container speaks plain HTTP on port 8080, bound to `127.0.0.1` by default (`MOBSIMLAB_BIND`). Put a
TLS reverse proxy in front of it so browsers and AI apps reach it over HTTPS only. This page shows nginx; any
proxy that does the same works.

## 1. MobSimLab settings (`.env`)

```bash
MOBSIMLAB_PUBLIC_URL=https://plans.example.org   # the https address people open
MOBSIMLAB_BIND=127.0.0.1                           # nginx on the same host; never 0.0.0.0 without a firewall
MOBSIMLAB_TRUSTED_PROXIES=loopback                 # or nginx's own address, e.g. 10.0.0.5
```

With an `https` public address MobSimLab:

- sets the session cookie as `__Host-msl_session` with `Secure`, `HttpOnly` and `SameSite=Lax`;
- sends `Strict-Transport-Security`, a strict Content Security Policy and the other security headers itself;
- redirects a request to the https address (308) when nginx reports, in `X-Forwarded-Proto`, that the browser
  came over plain http. This only happens when `MOBSIMLAB_TRUSTED_PROXIES` lists nginx, because only then is the
  header believed.

## 2. nginx site

```nginx
# Plain http: send everyone to https.
server {
    listen 80;
    listen [::]:80;
    server_name plans.example.org;
    return 308 https://$host$request_uri;
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name plans.example.org;

    ssl_certificate     /etc/letsencrypt/live/plans.example.org/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/plans.example.org/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers off;

    # Uploads: .mslab project files up to 200 MB, population files up to MOBSIMLAB_POPULATION_UPLOAD_MB.
    client_max_body_size 200m;
    # Long simulation and analysis requests.
    proxy_read_timeout 300s;

    # Do not reveal the nginx version.
    server_tokens off;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        # Replace, never append: a client must not be able to add its own X-Forwarded-For entries.
        proxy_set_header X-Forwarded-For   $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        $connection_upgrade;
    }
}

# In the http { } block (nginx.conf):
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}
```

## 3. Nginx Proxy Manager, Traefik or Caddy in another container

When the proxy runs in its own container, MobSimLab sees the proxy's address on the Docker network between them,
not `127.0.0.1`, so `loopback` does not match. Put both on one Docker network and let the proxy reach MobSimLab by
name:

```bash
docker network create proxy                       # once; skip if your proxy already has a network
docker network connect proxy mobsimlab            # or add the network to compose.yaml (below)
docker network inspect proxy -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}'   # e.g. 172.20.0.0/16
```

In `compose.yaml`, so that it survives `docker compose up`:

```yaml
services:
  mobsimlab:
    networks: [default, proxy]
networks:
  proxy: { external: true }
```

`.env`:

```bash
MOBSIMLAB_PUBLIC_URL=https://plans.example.org
MOBSIMLAB_TRUSTED_PROXIES=172.20.0.0/16    # the subnet printed above: only containers on that network
```

In Nginx Proxy Manager, add a Proxy Host: scheme `http`, forward hostname `mobsimlab`, port `8080`, and turn on
**Websockets Support**, **Block Common Exploits** and, on the SSL tab, **Force SSL**. Nginx Proxy Manager sets
`X-Forwarded-For` and `X-Forwarded-Proto` itself. For large uploads and long requests add, under **Advanced**:

```nginx
client_max_body_size 200m;
proxy_read_timeout 300s;
```

The proxy then reaches MobSimLab over the Docker network, so the published port is not needed for it; keep
`MOBSIMLAB_BIND=127.0.0.1`. If the proxy instead reaches MobSimLab through the host's published port, MobSimLab
sees the Docker gateway of its own network (`docker network inspect mobsimlab_default -f
'{{range .IPAM.Config}}{{.Gateway}}{{end}}'`); list that address.

## 4. What not to add

- **No CORS headers.** MobSimLab answers no cross-origin requests on purpose: the web app is served from the same
  address as the API, and AI apps call `/mcp` and `/oauth/*` from their servers, which needs no CORS. Do not add
  `add_header Access-Control-Allow-Origin` (least of all `*` with credentials) in nginx.
- **No second set of security headers.** MobSimLab sends `Content-Security-Policy`, `Strict-Transport-Security`,
  `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` and `Permissions-Policy` itself. Adding them in
  nginx as well sends two copies, and browsers then apply the stricter or neither.
- **No caching of `/api`, `/oauth` or `/mcp`.** Their answers carry `Cache-Control: no-store`; do not add
  `proxy_cache` for them.
- **No response buffering that waits for the whole answer on `/mcp`.** An AI tool call can run for several
  minutes (coverage over a large area). MobSimLab then sends a space every 15 seconds so the proxy's read timeout
  does not end the call, and sets `X-Accel-Buffering: no` so nginx passes them on. A proxy that buffers the whole
  answer anyway needs a read timeout of at least the longest call.

## 5. Check it

```bash
curl -sI http://plans.example.org/ | head -3          # 308 to https://
curl -sI https://plans.example.org/api/health          # 200, with strict-transport-security and content-security-policy
curl -sI -H 'Origin: https://evil.example' https://plans.example.org/api/auth/me | grep -i access-control   # nothing
```
