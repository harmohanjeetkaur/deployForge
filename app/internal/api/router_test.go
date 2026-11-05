package api

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestInstrumentedRoutesAndPrivateMetrics(t *testing.T) {
	h := NewHandler(NewTaskStore())
	for _, tc := range []struct {
		method, path, body string
		status             int
	}{
		{"GET", "/healthz", "", 200}, {"GET", "/readyz", "", 200}, {"GET", "/tasks", "", 200},
		{"POST", "/tasks", `{"title":"private-task-title"}`, 201}, {"POST", "/tasks", `invalid-private-body`, 400}, {"DELETE", "/tasks", "", 405},
	} {
		out := httptest.NewRecorder()
		h.ServeHTTP(out, httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body)))
		if out.Code != tc.status {
			t.Fatalf("%s %s got %d", tc.method, tc.path, out.Code)
		}
	}
	out := httptest.NewRecorder()
	h.ServeHTTP(out, httptest.NewRequest("GET", "/metrics?token=private-query", nil))
	text := out.Body.String()
	for _, name := range []string{"deployforge_http_requests_total", "deployforge_http_request_duration_seconds_bucket", "deployforge_http_requests_in_flight"} {
		if !strings.Contains(text, name) {
			t.Fatalf("missing %s", name)
		}
	}
	for _, secret := range []string{"private-task-title", "private-query", "invalid-private-body", "process_start_time", "go_goroutines"} {
		if strings.Contains(text, secret) {
			t.Fatalf("unexpected data %s", secret)
		}
	}
	if !strings.Contains(text, `code="201",method="POST",route="/tasks"} 1`) || !strings.Contains(text, `code="400",method="POST",route="/tasks"} 1`) {
		t.Fatal("real handler status counts incorrect")
	}
	// Each server gets an isolated registry, avoiding duplicate registration and cross-test samples.
	other := httptest.NewRecorder()
	NewHandler(NewTaskStore()).ServeHTTP(other, httptest.NewRequest("GET", "/metrics", nil))
	if strings.Contains(other.Body.String(), `code="201"`) {
		t.Fatal("registry shared between servers")
	}
}
