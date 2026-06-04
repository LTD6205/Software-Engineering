# EC2 Docker Compose Deployment

This guide runs the full Event Ops stack on one AWS EC2 Amazon Linux instance:

- Nginx on public port `80`
- Next.js frontend on the internal Docker network
- NestJS backend on the internal Docker network
- PostgreSQL 16 on the internal Docker network with a named volume

## 1. Create The EC2 Instance

Use Amazon Linux 2023. A `t3.small` or larger instance is recommended because Next.js production builds can use more memory than a `t2.micro`.

Security group inbound rules:

| Type | Port | Source |
|---|---:|---|
| SSH | 22 | Your IP address |
| HTTP | 80 | `0.0.0.0/0` |

Do not open PostgreSQL port `5432`, backend port `3000`, or frontend port `3001`.

## 2. Install Docker

SSH into the instance:

```bash
ssh -i path/to/key.pem ec2-user@YOUR_EC2_PUBLIC_IP
```

Install and start Docker:

```bash
sudo dnf update -y
sudo dnf install -y docker git
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user
exit
```

SSH back in so the Docker group change applies:

```bash
ssh -i path/to/key.pem ec2-user@YOUR_EC2_PUBLIC_IP
docker --version
docker compose version
```

## 3. Get The Project Onto EC2

Clone from your repository:

```bash
git clone YOUR_REPOSITORY_URL event-ops
cd event-ops
```

If this is not in a remote Git repository yet, upload the folder from your machine instead:

```bash
scp -i path/to/key.pem -r "/path/to/Project" ec2-user@YOUR_EC2_PUBLIC_IP:~/event-ops
ssh -i path/to/key.pem ec2-user@YOUR_EC2_PUBLIC_IP
cd ~/event-ops
```

## 4. Configure Environment

Create the root `.env` file:

```bash
cp .env.example .env
nano .env
```

Set these values:

```env
PUBLIC_ORIGIN=http://YOUR_EC2_PUBLIC_IP
DB_USERNAME=postgres
DB_PASSWORD=use_a_strong_database_password
DB_NAME=event_ops
JWT_SECRET=replace_with_output_from_openssl_rand
DEEPSEEK_API_KEY=
```

Generate a JWT secret:

```bash
openssl rand -hex 32
```

If you later point a domain at the instance, change `PUBLIC_ORIGIN` to `http://your-domain.com` or `https://your-domain.com`.

## 5. Build And Start

From the project root:

```bash
docker compose up -d --build
docker compose ps
```

Check logs if a service is not healthy:

```bash
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f nginx
```

## 6. Initialize The Database

The backend uses TypeORM with `synchronize: false`, so it does not create or update tables automatically. Initialize the database in this order:

1. Apply the baseline schema from the root `database_creating.txt`.
2. Run the idempotent SQL migrations from `event-ops-backend/migrations/`.
3. Seed the default login accounts from `event-ops-backend/seed.js`.

Run the schema SQL once. If you kept the example database username and database name:

```bash
docker exec -i event_ops_db psql -U postgres -d event_ops < database_creating.txt
```

If you changed `DB_USERNAME` or `DB_NAME`, use those values in the command:

```bash
docker exec -i event_ops_db psql -U YOUR_DB_USERNAME -d YOUR_DB_NAME < database_creating.txt
```

Apply migrations. This is safe to run repeatedly:

```bash
docker compose exec backend npm run db:migrate
```

Create default accounts. This is also safe to run repeatedly; existing seeded accounts are updated:

```bash
docker compose exec backend npm run seed
```

If you see `relation "users" does not exist`, the baseline schema was not applied. Re-run the `psql < database_creating.txt` command above, then run migrations and seed again.

If you reset the database with `docker compose down -v`, repeat all three initialization commands.

Open the app:

```text
http://YOUR_EC2_PUBLIC_IP
```

Default login examples:

| Role | Email | Password |
|---|---|---|
| Admin | `admin01@eventops.com` | `admin123` |
| Organizer | `organizer01@eventops.com` | `organizer123` |
| Manager | `manager01@eventops.com` | `manager123` |
| Staff | `staff01@eventops.com` | `staff123` |

## 7. Update The App

Pull or upload the latest code, then rebuild:

```bash
git pull
docker compose up -d --build
docker compose exec backend npm run db:migrate
```

If you uploaded files with `scp`, run only:

```bash
docker compose up -d --build
docker compose exec backend npm run db:migrate
```

## 8. Operate The Stack

View running containers:

```bash
docker compose ps
```

Tail all logs:

```bash
docker compose logs -f
```

Stop without deleting data:

```bash
docker compose stop
```

Start again:

```bash
docker compose up -d
```

Delete containers and the database volume:

```bash
docker compose down -v
```

Use `down -v` only when you intentionally want to erase the database. After this command, repeat the database initialization steps in section 6.

## 9. Back Up The Database

Create a durable host-side database dump:

```bash
mkdir -p backups
docker exec event_ops_db pg_dump -U postgres event_ops > backups/event_ops_$(date +%Y%m%d-%H%M%S).sql
```

If you changed `DB_USERNAME` or `DB_NAME`, replace `postgres` and `event_ops` in that command.

## 10. Add HTTPS Later

For HTTPS, point a domain to the EC2 public IP first. Then either:

- put an AWS Application Load Balancer with an ACM certificate in front of the instance, or
- add Certbot on the EC2 host and update the Nginx setup for port `443`.

After HTTPS is active, update `.env`:

```env
PUBLIC_ORIGIN=https://your-domain.com
```

Then restart:

```bash
docker compose up -d
```
