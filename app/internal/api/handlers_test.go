package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestIndexHandler(t *testing.T) {
	store := NewTaskStore()
	server := NewServer(store)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()

	server.IndexHandler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var response map[string]string
	if err := json.NewDecoder(w.Body).Decode(&response); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if response["name"] != "DeployForge" {
		t.Errorf("Expected name 'DeployForge', got '%s'", response["name"])
	}

	if response["status"] != "running" {
		t.Errorf("Expected status 'running', got '%s'", response["status"])
	}
}

func TestIndexHandlerMethodNotAllowed(t *testing.T) {
	store := NewTaskStore()
	server := NewServer(store)

	req := httptest.NewRequest(http.MethodPost, "/", nil)
	w := httptest.NewRecorder()

	server.IndexHandler(w, req)

	if w.Code != http.StatusMethodNotAllowed {
		t.Errorf("Expected status 405, got %d", w.Code)
	}
}

func TestTasksListHandler(t *testing.T) {
	store := NewTaskStore()
	server := NewServer(store)

	// Add a task first
	task := Task{ID: "1", Title: "Test Task"}
	store.Add(task)

	req := httptest.NewRequest(http.MethodGet, "/tasks", nil)
	w := httptest.NewRecorder()

	server.TasksListHandler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var tasks []Task
	if err := json.NewDecoder(w.Body).Decode(&tasks); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if len(tasks) != 1 {
		t.Errorf("Expected 1 task, got %d", len(tasks))
	}

	if tasks[0].Title != "Test Task" {
		t.Errorf("Expected title 'Test Task', got '%s'", tasks[0].Title)
	}
}

func TestTasksListHandlerEmpty(t *testing.T) {
	store := NewTaskStore()
	server := NewServer(store)

	req := httptest.NewRequest(http.MethodGet, "/tasks", nil)
	w := httptest.NewRecorder()

	server.TasksListHandler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	var tasks []Task
	if err := json.NewDecoder(w.Body).Decode(&tasks); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if len(tasks) != 0 {
		t.Errorf("Expected 0 tasks, got %d", len(tasks))
	}
}

func TestTaskCreateHandler(t *testing.T) {
	store := NewTaskStore()
	server := NewServer(store)

	body := `{"title": "New Task"}`
	req := httptest.NewRequest(http.MethodPost, "/tasks", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.TaskCreateHandler(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("Expected status 201, got %d", w.Code)
	}

	var task Task
	if err := json.NewDecoder(w.Body).Decode(&task); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}

	if task.Title != "New Task" {
		t.Errorf("Expected title 'New Task', got '%s'", task.Title)
	}

	if task.ID == "" {
		t.Error("Expected task ID to be generated")
	}

	// Verify task was stored
	tasks := store.List()
	if len(tasks) != 1 {
		t.Errorf("Expected 1 task in store, got %d", len(tasks))
	}
}

func TestTaskCreateHandlerEmptyTitle(t *testing.T) {
	store := NewTaskStore()
	server := NewServer(store)

	body := `{"title": ""}`
	req := httptest.NewRequest(http.MethodPost, "/tasks", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.TaskCreateHandler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestTaskCreateHandlerMissingTitle(t *testing.T) {
	store := NewTaskStore()
	server := NewServer(store)

	body := `{}`
	req := httptest.NewRequest(http.MethodPost, "/tasks", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.TaskCreateHandler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestTaskCreateHandlerInvalidJSON(t *testing.T) {
	store := NewTaskStore()
	server := NewServer(store)

	body := `invalid json`
	req := httptest.NewRequest(http.MethodPost, "/tasks", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	server.TaskCreateHandler(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("Expected status 400, got %d", w.Code)
	}
}

func TestHealthzHandler(t *testing.T) {
	store := NewTaskStore()
	server := NewServer(store)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	w := httptest.NewRecorder()

	server.HealthzHandler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	if w.Body.String() != "OK" {
		t.Errorf("Expected body 'OK', got '%s'", w.Body.String())
	}
}

func TestReadyzHandler(t *testing.T) {
	store := NewTaskStore()
	server := NewServer(store)

	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	w := httptest.NewRecorder()

	server.ReadyzHandler(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", w.Code)
	}

	if w.Body.String() != "OK" {
		t.Errorf("Expected body 'OK', got '%s'", w.Body.String())
	}
}

func TestTaskStore(t *testing.T) {
	store := NewTaskStore()

	// Test adding tasks
	task1 := Task{ID: "1", Title: "Task 1"}
	task2 := Task{ID: "2", Title: "Task 2"}

	store.Add(task1)
	store.Add(task2)

	// Test listing
	tasks := store.List()
	if len(tasks) != 2 {
		t.Errorf("Expected 2 tasks, got %d", len(tasks))
	}

	// Verify tasks are stored correctly
	foundTask1 := false
	foundTask2 := false
	for _, task := range tasks {
		if task.ID == "1" && task.Title == "Task 1" {
			foundTask1 = true
		}
		if task.ID == "2" && task.Title == "Task 2" {
			foundTask2 = true
		}
	}

	if !foundTask1 {
		t.Error("Task 1 not found in store")
	}

	if !foundTask2 {
		t.Error("Task 2 not found in store")
	}
}
