# Deploying to an EC2 server (Docker Compose, HTTP)

This deploys the whole stack — **PostgreSQL + NestJS backend + Next.js frontend + nginx** —
with Docker Compose. Only **port 80** is exposed; nginx routes everything from one origin, so
there are no CORS issues and the database is never public.

Target setup: an EC2 instance you already have, reached over plain HTTP at its public IP.

---

## 0. Before you start

On the **AWS console → EC2 → your instance → Security groups**, add an **inbound rule**:

| Type | Protocol | Port | Source |
|------|----------|------|--------|
| HTTP | TCP | 80 | 0.0.0.0/0 (anywhere) |
| SSH  | TCP | 22 | *your IP only* |

> **Instance size:** the Next.js build needs memory. A **t3.small (2 GB)** or larger builds
> comfortably. On a **t2/t3.micro (1 GB)** the build can be killed (OOM) — add swap first
> (see Troubleshooting) or build on a bigger instance.

SSH in:

```bash
ssh -i your-key.pem ubuntu@<YOUR_EC2_PUBLIC_IP>     # Ubuntu AMI
# or: ssh -i your-key.pem ec2-user@<YOUR_EC2_PUBLIC_IP>   # Amazon Linux AMI
```

---

## 1. Install Docker (once per instance)

**Ubuntu:**
```bash
sudo apt-get update
sudo apt-get install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && newgrp docker      # run docker without sudo
```

**Amazon Linux 2023:**
```bash
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER && newgrp docker
# compose plugin:
sudo mkdir -p /usr/libexec/docker/cli-plugins
sudo curl -sL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" \
  -o /usr/libexec/docker/cli-plugins/docker-compose
sudo chmod +x /usr/libexec/docker/cli-plugins/docker-compose
```

Verify: `docker version` and `docker compose version`.

---

## 2. Get the code & configure

```bash
git clone <YOUR_REPO_URL> Software-Engineering
cd Software-Engineering/deploy

cp .env.example .env
nano .env        # fill in the four values below
```

Set in `deploy/.env`:

- `PUBLIC_URL=http://<YOUR_EC2_PUBLIC_IP>`  — no trailing slash
- `POSTGRES_PASSWORD=` a strong password
- `JWT_SECRET=` generate with `openssl rand -hex 32`
- `AI_API_KEY=` (optional — leave blank to disable the AI assistant)

---

## 3. Build & start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

First run takes a few minutes (it builds two images). The database schema is created
automatically on first boot, and the backend applies all migrations before it starts.

Watch it come up:
```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f backend     # Ctrl-C to stop tailing
```
Wait until the backend logs `Backend running on http://localhost:3000/api`.

---

## 4. Seed the login accounts (once)

```bash
docker compose -f docker-compose.prod.yml exec backend node seed.js
```

This creates demo accounts (idempotent — safe to re-run):

| Role | Email | Password |
|------|-------|----------|
| Admin | `admin01@eventops.com` | `admin123` |
| Organizer | `organizer01@eventops.com` | `organizer123` |
| Manager | `manager01@eventops.com` | `manager123` |
| Staff | `staff01@eventops.com` | `staff123` |

> Change these passwords (or delete the demo accounts) before sharing the URL publicly.

---

## 5. Open it

Browse to **`http://<YOUR_EC2_PUBLIC_IP>`** and log in. Done.

---

## Day-to-day commands

```bash
cd Software-Engineering/deploy

# Redeploy after pulling new code:
git -C .. pull
docker compose -f docker-compose.prod.yml up -d --build

# Logs / status
docker compose -f docker-compose.prod.yml logs -f          # all services
docker compose -f docker-compose.prod.yml ps

# Stop (keep data) / start again
docker compose -f docker-compose.prod.yml stop
docker compose -f docker-compose.prod.yml start

# Stop and remove containers (data volume kept)
docker compose -f docker-compose.prod.yml down

# DANGER: also wipe the database
docker compose -f docker-compose.prod.yml down -v
```

---

## Troubleshooting

**The build gets `Killed` (out of memory).** Small instances run out of RAM during
`next build`. Add 2 GB of swap, then rebuild:
```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Site doesn't load / 502 from nginx.** The frontend or backend is still building/starting —
check `docker compose -f docker-compose.prod.yml ps` and the logs. nginx depends on both.

**Login works but no live notifications (WebSocket).** Confirm the security group allows port
80 and that you're using `http://<IP>` (the same `PUBLIC_URL` you set). nginx already proxies
the `/socket.io` upgrade; a mismatched `PUBLIC_URL` (e.g. wrong IP) is the usual cause.

**Backend keeps logging "DB not ready — retrying".** Normal for the first ~10–20s while
Postgres initializes the schema. If it never stops, check `logs db` for a schema error.

**Port 80 already in use.** Another web server is running on the host. Stop it
(`sudo systemctl stop nginx`/`apache2`) or change the published port in
`docker-compose.prod.yml` (e.g. `"8080:80"`) and open that port in the security group.

**The public IP changed after a stop/start.** EC2 public IPs are not static by default.
Update `PUBLIC_URL` in `deploy/.env`, then
`docker compose -f docker-compose.prod.yml up -d` (rebuild not needed for the backend env, but
the frontend bakes `/api` only, so no rebuild is required). Attach an **Elastic IP** to avoid this.

---

## Want HTTPS / a domain later?

Point a domain's A-record at the instance, then either put a TLS terminator in front
(AWS ALB, or Caddy/Traefik instead of the nginx container) or add Let's Encrypt (certbot)
to nginx. Ask and I'll wire it in.
