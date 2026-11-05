package api

import (
	"deployforge/app/internal/metrics"
	"net/http"
)

// NewHandler keeps application routing and telemetry wiring shared with tests.
func NewHandler(store *TaskStore) http.Handler {
	server := NewServer(store)
	telemetry := metrics.NewHTTP()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /", server.IndexHandler)
	mux.HandleFunc("GET /tasks", server.TasksListHandler)
	mux.HandleFunc("POST /tasks", server.TaskCreateHandler)
	mux.HandleFunc("GET /healthz", server.HealthzHandler)
	mux.HandleFunc("GET /readyz", server.ReadyzHandler)
	mux.Handle("GET /metrics", telemetry.Handler())
	return telemetry.Wrap(mux)
}
