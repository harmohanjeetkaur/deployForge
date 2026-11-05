# DeployForge example application

The workload released by the DeployForge platform is a small Go task API.
It supplies a real container, health probes, and Prometheus instrumentation
for exercising the release and rollback workflow.

## API overview

A simple Go-based REST API for task management using Go's standard library.

### Features

- **GET /** - Returns application name and status
- **GET /tasks** - Lists all tasks
- **POST /tasks** - Creates a new task with a title
- **GET /healthz** - Health check endpoint
- **GET /readyz** - Readiness check endpoint

### Implementation Details

- Built with Go 1.26.10+ using standard `net/http` package
- Uses Go 1.22+ ServeMux routing
- In-memory task storage using `sync.RWMutex` for thread-safe access
- Tasks are reset when the application restarts
- Graceful shutdown on SIGINT/SIGTERM signals
- Configurable port via PORT environment variable (default: 8080)

### Running the Application

```bash
cd app
go run cmd/api/main.go
```

The server will start on port 8080 by default. To use a different port:

```bash
PORT=8081 go run cmd/api/main.go
```

### API Endpoints

#### Get Application Status
```bash
curl http://localhost:8080/
```

#### List Tasks
```bash
curl http://localhost:8080/tasks
```

#### Create a Task
```bash
curl -X POST http://localhost:8080/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "My first task"}'
```

#### Health Check
```bash
curl http://localhost:8080/healthz
```

#### Readiness Check
```bash
curl http://localhost:8080/readyz
```

### Running Tests

```bash
cd app
go test ./...
```

### Formatting and Linting

```bash
cd app
gofmt -l .
go vet ./...
```

`GET /metrics` exposes application Prometheus instrumentation.
Tasks are in memory; this sample is not a persistent production task service.
