package metrics

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func gauge(t *testing.T, m *HTTP) float64 {
	t.Helper()
	families, err := m.registry.Gather()
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range families {
		if f.GetName() == "deployforge_http_requests_in_flight" {
			return f.Metric[0].GetGauge().GetValue()
		}
	}
	t.Fatal("missing in-flight gauge")
	return -1
}
func TestBoundedLabelsAndStatus(t *testing.T) {
	m := NewHTTP()
	mux := http.NewServeMux()
	mux.HandleFunc("GET /tasks", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(201)
		w.WriteHeader(500)
		_, _ = w.Write([]byte("private response"))
	})
	h := m.Wrap(mux)
	for _, path := range []string{"/tasks?token=private-query", "/private-unknown-a", "/private-unknown-b"} {
		r := httptest.NewRequest("GET", path, nil)
		r.Header.Set("Authorization", "Bearer private-auth")
		h.ServeHTTP(httptest.NewRecorder(), r)
	}
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("PRIVATE-METHOD", "/private-unknown", nil))
	f, err := m.registry.Gather()
	if err != nil {
		t.Fatal(err)
	}
	found201, found404, foundOther := false, false, false
	for _, family := range f {
		for _, metric := range family.Metric {
			for _, label := range metric.Label {
				if !map[string]bool{"route": true, "method": true, "code": true}[label.GetName()] {
					t.Fatalf("unexpected label %s", label.GetName())
				}
				v := label.GetValue()
				if strings.Contains(v, "private") {
					t.Fatalf("sensitive or unbounded label %q", v)
				}
				if label.GetName() == "code" && v == "201" {
					found201 = true
				}
				if label.GetName() == "code" && v == "404" {
					found404 = true
				}
				if label.GetName() == "method" && v == "OTHER" {
					foundOther = true
				}
			}
		}
	}
	if !found201 || !found404 || !foundOther {
		t.Fatal("response or method labels missing")
	}
	if gauge(t, m) != 0 {
		t.Fatal("in-flight did not settle")
	}
}
func TestInflightAndPanicCleanup(t *testing.T) {
	m := NewHTTP()
	mux := http.NewServeMux()
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	mux.HandleFunc("GET /tasks", func(http.ResponseWriter, *http.Request) { close(started); <-release })
	go func() {
		defer close(done)
		m.Wrap(mux).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/tasks", nil))
	}()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("handler did not start")
	}
	if gauge(t, m) != 1 {
		t.Error("active request not counted")
	}
	close(release)
	<-done
	if gauge(t, m) != 0 {
		t.Fatal("gauge did not settle")
	}
	families, _ := m.registry.Gather()
	for _, family := range families {
		if family.GetName() == "deployforge_http_request_duration_seconds" {
			if family.Metric[0].Histogram.GetSampleCount() != 1 || family.Metric[0].Histogram.GetSampleSum() <= 0 {
				t.Fatal("request duration was not observed")
			}
		}
	}
	panicMux := http.NewServeMux()
	panicMux.HandleFunc("GET /tasks", func(http.ResponseWriter, *http.Request) { panic("private panic") })
	func() {
		defer func() {
			if recover() == nil {
				t.Error("panic was swallowed")
			}
		}()
		m.Wrap(panicMux).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", "/tasks", nil))
	}()
	if gauge(t, m) != 0 {
		t.Fatal("panic leaked in-flight request")
	}
	out := httptest.NewRecorder()
	m.Handler().ServeHTTP(out, httptest.NewRequest("GET", "/metrics", nil))
	if strings.Contains(out.Body.String(), `code="500"`) || strings.Contains(out.Body.String(), "private panic") {
		t.Fatal("panic invented a response status or exposed private data")
	}
}
func TestScrapesDoNotInstrumentThemselves(t *testing.T) {
	m := NewHTTP()
	mux := http.NewServeMux()
	mux.Handle("GET /metrics", m.Handler())
	h := m.Wrap(mux)
	for range 2 {
		out := httptest.NewRecorder()
		h.ServeHTTP(out, httptest.NewRequest("GET", "/metrics", nil))
		if out.Code != 200 {
			t.Fatal(out.Code)
		}
		if strings.Contains(out.Body.String(), "deployforge_http_requests_total{") {
			t.Fatal("scrape counted as application traffic")
		}
		if !strings.Contains(out.Header().Get("Content-Type"), "text/plain") {
			t.Fatal("not Prometheus text")
		}
	}
}

func TestExplicitServerErrorAndDuration(t *testing.T) {
	m := NewHTTP()
	mux := http.NewServeMux()
	mux.HandleFunc("POST /tasks", func(w http.ResponseWriter, r *http.Request) { http.Error(w, "error", http.StatusServiceUnavailable) })
	out := httptest.NewRecorder()
	m.Wrap(mux).ServeHTTP(out, httptest.NewRequest("POST", "/tasks", nil))
	if out.Code != 503 {
		t.Fatal("handler response changed")
	}
	samples := httptest.NewRecorder()
	m.Handler().ServeHTTP(samples, httptest.NewRequest("GET", "/metrics", nil))
	if !strings.Contains(samples.Body.String(), `code="503",method="POST",route="/tasks"} 1`) {
		t.Fatal("real 5xx not counted")
	}
}
