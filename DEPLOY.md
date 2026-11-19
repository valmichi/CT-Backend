# Despliegue de Cyber Tycoon Backend

Stack: **API Node.js 20 + MySQL 8** en Docker Compose. Se usan los mismos archivos
en la laptop (x86_64) y en la Orange Pi 5 Pro (ARM64): Docker descarga la variante
correcta de cada imagen y la API se construye en cada máquina.

```
Godot (cualquier lugar) ──HTTPS──► Túnel (Cloudflare / Tailscale Funnel)
                                        │
                              Orange Pi │  docker compose
                                        ▼
                                   ct-api :3000 ──► ct-mysql (red interna)
```

## 1. Probar en la laptop (Windows)

1. Instala **Docker Desktop** (usa WSL2) y Git.
2. Clona y configura:
   ```bash
   git clone https://github.com/valmichi/CT-Backend.git
   cd CT-Backend
   cp .env.example .env     # edita los valores
   ```
3. Levanta todo:
   ```bash
   docker compose up -d --build
   docker compose ps           # ct-mysql y ct-api deben salir "healthy"
   curl http://localhost:3000/api/health
   ```
4. Dashboard docente: http://localhost:3000/admin-dashboard
   (regístrate como profesor con la `ADMIN_REGISTRATION_KEY` de tu `.env`).
5. En Godot apunta a `http://localhost:3000/api` (o a la IP de la laptop en tu red).

`init.sql` solo se ejecuta la **primera vez** que se crea el volumen de MySQL.
Para reiniciar la base desde cero: `docker compose down -v` (borra los datos).

## 2. Desplegar en la Orange Pi (Ubuntu 22.04 Server)

```bash
# Docker oficial (incluye compose)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

git clone https://github.com/valmichi/CT-Backend.git
cd CT-Backend
cp .env.example .env
nano .env        # secretos NUEVOS (openssl rand -base64 48), TRUST_PROXY=1 si usas túnel

docker compose up -d --build
docker compose logs -f api
```

Los contenedores tienen `restart: unless-stopped`: vuelven a arrancar solos tras un
reinicio o un corte de luz.

**Actualizar** cuando haya cambios en GitHub:
```bash
git pull && docker compose up -d --build
```

**Respaldo de la base:**
```bash
docker exec ct-mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" cyber_tycoon' > respaldo_$(date +%F).sql
```

## 3. Exponer la API a internet

Ambas opciones funcionan detrás de CGNAT, sin abrir puertos en el router y con HTTPS.
En las dos pon `TRUST_PROXY=1` en `.env` (para que el rate limit vea la IP real de
cada jugador) y, si solo se accederá por el túnel, `API_BIND=127.0.0.1`.

### Opción A: Tailscale Funnel (gratis, sin dominio)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale funnel --bg 3000
tailscale funnel status
```
URL pública: `https://<nombre-orangepi>.<tu-tailnet>.ts.net/api`

### Opción B: Cloudflare Tunnel (dominio propio)

1. Ten un dominio gestionado en Cloudflare.
2. Cloudflare Zero Trust → Networks → Tunnels → *Create tunnel* (cloudflared) → copia el token.
3. En *Public Hostname*: `api.tudominio.com` → Service `http://api:3000`.
4. En `.env`: `CLOUDFLARE_TUNNEL_TOKEN=<token>` y `TRUST_PROXY=1`.
5. `docker compose --profile cloudflare up -d`

URL pública: `https://api.tudominio.com/api`

### Administración remota (SSH)

Instala Tailscale también en tu laptop: `ssh usuario@<nombre-orangepi>` desde
cualquier red, sin exponer SSH a internet.
