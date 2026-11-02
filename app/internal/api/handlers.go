package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Server holds the dependencies for the HTTP handlers.
type Server struct {
	TaskStore *TaskStore
}

// NewServer creates a new Server instance.
func NewServer(store *TaskStore) *Server {
	return &Server{
		TaskStore: store,
	}
}

// IndexHandler handles GET / - returns application name and status.
func (s *Server) IndexHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	response := map[string]string{
		"name":   "DeployForge",
		"status": "running",
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// TasksListHandler handles GET /tasks - lists all tasks.
func (s *Server) TasksListHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	tasks := s.TaskStore.List()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tasks)
}

// TaskCreateHandler handles POST /tasks - creates a new task.
func (s *Server) TaskCreateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Title string `json:"title"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	if req.Title == "" {
		http.Error(w, "Title is required", http.StatusBadRequest)
		return
	}

	task := Task{
		ID:        generateTaskID(),
		Title:     req.Title,
		CreatedAt: time.Now().UTC(),
	}

	s.TaskStore.Add(task)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(task)
}

// HealthzHandler handles GET /healthz - health check.
func (s *Server) HealthzHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

// ReadyzHandler handles GET /readyz - readiness check.
func (s *Server) ReadyzHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

// generateTaskID generates a unique task ID.
func generateTaskID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}
