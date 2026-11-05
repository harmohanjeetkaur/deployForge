// Package metrics records bounded HTTP telemetry in a private registry.
package metrics

import (
	"net/http"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type HTTP struct {
	registry *prometheus.Registry
	requests *prometheus.CounterVec
	duration *prometheus.HistogramVec
	inflight prometheus.Gauge
}

func NewHTTP() *HTTP {
	m := &HTTP{
		registry: prometheus.NewRegistry(),
		requests: prometheus.NewCounterVec(prometheus.CounterOpts{Name: "deployforge_http_requests_total", Help: "Completed HTTP requests by bounded route, method and response code."}, []string{"route", "method", "code"}),
		duration: prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: "deployforge_http_request_duration_seconds", Help: "HTTP handler duration in seconds.", Buckets: []float64{.005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5}}, []string{"route", "method"}),
		inflight: prometheus.NewGauge(prometheus.GaugeOpts{Name: "deployforge_http_requests_in_flight", Help: "HTTP requests currently being handled, excluding metrics scrapes."}),
	}
	m.registry.MustRegister(m.requests, m.duration, m.inflight)
	return m
}

func (m *HTTP) Handler() http.Handler {
	// Deliberately no process/env collectors, request data, or default global registry.
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{MaxRequestsInFlight: 2, Timeout: 5 * time.Second})
}

func methodLabel(method string) string {
	switch method {
	case "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS":
		return method
	default:
		return "OTHER"
	}
}
func routeLabel(pattern string) string {
	switch pattern {
	case "GET /":
		return "/"
	case "GET /tasks", "POST /tasks":
		return "/tasks"
	case "GET /healthz":
		return "/healthz"
	case "GET /readyz":
		return "/readyz"
	default:
		return "unmatched"
	}
}

type response struct {
	http.ResponseWriter
	code int
}

func (w *response) WriteHeader(code int) {
	if w.code != 0 {
		return
	}
	if code >= 200 {
		w.code = code
	}
	w.ResponseWriter.WriteHeader(code)
}
func (w *response) Write(b []byte) (int, error) {
	if w.code == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(b)
}
func (w *response) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (m *HTTP) Wrap(mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/metrics" {
			mux.ServeHTTP(w, r)
			return
		}
		_, pattern := mux.Handler(r)
		route, method := routeLabel(pattern), methodLabel(r.Method)
		started := time.Now()
		rw := &response{ResponseWriter: w}
		m.inflight.Inc()
		defer func() {
			panicValue := recover()
			m.inflight.Dec()
			m.duration.WithLabelValues(route, method).Observe(time.Since(started).Seconds())
			if panicValue != nil {
				// net/http may close the connection without a response on panic.
				// Preserve that behavior rather than inventing a 500 status sample.
				panic(panicValue)
			}
			code := rw.code
			if code == 0 {
				code = http.StatusOK
			}
			m.requests.WithLabelValues(route, method, strconv.Itoa(code)).Inc()
		}()
		mux.ServeHTTP(rw, r)
	})
}
