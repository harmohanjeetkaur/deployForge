# DeployForge

A DevOps/Platform Engineering portfolio project demonstrating modern infrastructure and deployment practices.

The project now includes a React/Express control center, Helm/GitOps deployment
and rollback, monitoring, and a self-service tag → CI → image → deployment workflow.
See the [dashboard guide](dashboard/README.md) and the
[release architecture and setup](dashboard/docs/self-service-releases.md).
Release execution remains disabled by default. The release workflow has been
tested with mocks; a real end-to-end release still requires explicit approval.
The original API walkthrough below describes the initial project phase.

## Phase 1: Task Management REST API

A simple Go-based REST API for task management using Go's standard library.

### Features

- **GET /** - Returns application name and status
- **GET /tasks** - Lists all tasks
- **POST /tasks** - Creates a new task with a title
- **GET /healthz** - Health check endpoint
- **GET /readyz** - Readiness check endpoint

### Implementation Details

- Built with Go 1.22+ using standard `net/http` package
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
PORT=3000 go run cmd/api/main.go
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
gofmt ./...
go vet ./...
```

### Project Structure

```
deployForge/
├── app/
│   ├── cmd/
│   │   └── api/
│   │       └── main.go          # Application entry point
│   ├── internal/
│   │   └── api/
│   │       ├── task.go          # Task model and storage
│   │       ├── handlers.go      # HTTP handlers
│   │       └── handlers_test.go # Unit tests
│   └── go.mod                   # Go module definition
├── .gitignore
└── README.md
```

### Future Phases

This is Phase 1 of a multi-phase project. Future phases will include:
- Database integration
- Docker containerization
- Kubernetes deployment
- Terraform infrastructure
- CI/CD pipelines
- Monitoring and observability
