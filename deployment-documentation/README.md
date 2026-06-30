===
# APIWatch

Lightweight API health monitoring service. Pings endpoints on a configurable schedule, tracks response time and status history in PostgreSQL, exposes a REST API for queries, and renders a simple dashboard UI.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    APIWatch Stack                    │
│                                                     │
│  ┌──────────┐   ┌──────────────┐   ┌────────────┐  │
│  │  Config   │──▶│  Core Engine  │──▶│ PostgreSQL │  │
│  │ (YAML)   │   │  (Scheduler)  │   │   (DB)     │  │
│  └──────────┘   └──────┬───────┘   └─────▲──────┘  │
│                        │                   │        │
│                        ▼                   │        │
│                 ┌──────────────┐           │        │
│                 │  REST API    │───────────┘        │
│                 │  (Express)   │                    │
│                 └──────┬───────┘                    │
│                        │                            │
│                        ▼                            │
│                 ┌──────────────┐                    │
│                 │  Dashboard   │                    │
│                 │  (Static UI) │                    │
│                 └──────────────┘                    │
└─────────────────────────────────────────────────────┘

  Docker Compose orchestrates all services on a single host.
```

**Components:**

| Component      | Role                                              |
|----------------|---------------------------------------------------|
| Core Engine    | Reads config, schedules pings, writes results     |
| REST API       | Serves query endpoints for checks & history       |
| Dashboard      | Static UI served at `/` showing status & charts   |
| PostgreSQL     | Persists endpoint definitions and check history   |

## Quick Start

### Prerequisites

- Docker & Docker Compose v2+
- (Local dev) Node.js 20+, npm 9+

### Running with Docker Compose

```bash
# Clone the repository
git clone https://github.com/your-org/apiwatch.git
cd apiwatch

# Copy and edit the configuration
cp config.example.yaml config.yaml
# Edit config.yaml with your endpoints

# Start all services
docker compose -f deployment-documentation/docker-compose.yml up -d

# View the dashboard
open http://localhost:3000
```

### Running Locally (Development)

```bash
npm install
cp config.example.yaml config.yaml
# Start Postgres locally or set DATABASE_URL
export DATABASE_URL=postgres://apiwatch:apiwatch_secret@localhost:5432/apiwatch
npm run dev
```

## REST API

| Method | Endpoint                     | Description                            |
|--------|------------------------------|----------------------------------------|
| GET    | `/api/health`                | Service health check                   |
| GET    | `/api/endpoints`             | List all monitored endpoints           |
| GET    | `/api/endpoints/:id`         | Get endpoint details                   |
| GET    | `/api/endpoints/:id/history` | Check history (query: `?since=&limit=`)|
| GET    | `/api/endpoints/:id/stats`   | Aggregated uptime & latency stats      |

### Example Response — History

```json
{
  "endpoint_id": "abc-123",
  "checks": [
    {
      "timestamp": "2025-01-15T10:00:00Z",
      "status_code": 200,
      "response_ms": 142,
      "ok": true
    }
  ]
}
```

## Configuration Reference

See `config.example.yaml` for a full example with inline comments.

Key fields:

```yaml
endpoints:
  - name: My Service           # Display name
    url: https://api.example.com/health
    method: GET                 # GET, POST, PUT, HEAD
    interval_ms: 30000          # Ping interval in milliseconds
    timeout_ms: 5000            # Request timeout
    expected_status: 200        # Expected HTTP status code
    headers: {}                 # Custom request headers
    body: null                  # Request body (POST/PUT)

history:
  retention_days: 30            # Auto-delete checks older than N days

alerts:
  consecutive_failures: 3       # Alert after N failures in a row
```

## Environment Variables

| Variable       | Default                                | Description                  |
|----------------|----------------------------------------|------------------------------|
| `PORT`         | `3000`                                 | HTTP listen port             |
| `DATABASE_URL` | —                                      | PostgreSQL connection string |
| `CONFIG_PATH`  | `config.yaml`                          | Path to config YAML          |
| `NODE_ENV`     | `development`                          | Runtime environment          |

## License

MIT