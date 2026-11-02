package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"deployforge/app/internal/api"
)

func main() {
	// Get port from environment variable, default to 8080
	port := getEnv("PORT", "8080")
	addr := ":" + port

	// Initialize task store and server
	taskStore := api.NewTaskStore()
	server := api.NewServer(taskStore)

	// Create ServeMux with Go 1.22+ routing
	mux := http.NewServeMux()

	// Register handlers
	mux.HandleFunc("GET /", server.IndexHandler)
	mux.HandleFunc("GET /tasks", server.TasksListHandler)
	mux.HandleFunc("POST /tasks", server.TaskCreateHandler)
	mux.HandleFunc("GET /healthz", server.HealthzHandler)
	mux.HandleFunc("GET /readyz", server.ReadyzHandler)

	// Configure HTTP server
	httpServer := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	// Start server in a goroutine
	go func() {
		log.Printf("Starting DeployForge API on %s", addr)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	// Wait for interrupt signal for graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down server...")

	// Graceful shutdown with timeout
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := httpServer.Shutdown(ctx); err != nil {
		log.Fatalf("Server shutdown error: %v", err)
	}

	log.Println("Server stopped")
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
