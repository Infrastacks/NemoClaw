package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func main() {
	upstream := envOrDefault("AZURE_UPSTREAM", "https://localhost")
	port := envOrDefault("AZURE_PROXY_PORT", "9001")
	apiVersion := envOrDefault("AZURE_API_VERSION", "2025-04-01-preview")
	listenAddr := "127.0.0.1:" + port

	target, err := url.Parse(upstream)
	if err != nil {
		log.Fatalf("[azure-proxy] invalid AZURE_UPSTREAM %q: %v", upstream, err)
	}

	proxy := &httputil.ReverseProxy{
		Director: func(req *http.Request) {
			req.URL.Scheme = target.Scheme
			req.URL.Host = target.Host
			req.Host = target.Host
		},
		Transport: &http.Transport{
			MaxIdleConns:       10,
			IdleConnTimeout:    90 * time.Second,
			DisableCompression: true,
		},
		FlushInterval: -1, // flush SSE immediately
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","provider":"azure"}`))
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/chat/completions") {
			if err := transformAzureRequest(r, apiVersion); err != nil {
				log.Printf("[azure-proxy] transform error: %v (forwarding unchanged)", err)
			}
		}
		proxy.ServeHTTP(w, r)
	})

	srv := &http.Server{Addr: listenAddr, Handler: mux}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	go func() {
		<-ctx.Done()
		shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutCtx)
	}()

	log.Printf("[azure-proxy] %s -> %s (api-version=%s)", listenAddr, upstream, apiVersion)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("[azure-proxy] listen: %v", err)
	}
	log.Println("[azure-proxy] shut down")
}

// transformAzureRequest converts an OpenAI-format request to Azure AI Foundry format:
// 1. Bearer auth → api-key header
// 2. URL rewrite: /v1/chat/completions → /openai/deployments/{model}/chat/completions?api-version=...
// 3. Remove model from body
func transformAzureRequest(r *http.Request, apiVersion string) error {
	// 1. Convert auth: Authorization: Bearer X → api-key: X
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		apiKey := strings.TrimPrefix(auth, "Bearer ")
		r.Header.Set("api-key", apiKey)
		r.Header.Del("Authorization")
	}

	// 2. Read body to extract model
	body, err := io.ReadAll(r.Body)
	r.Body.Close()
	if err != nil {
		r.Body = io.NopCloser(bytes.NewReader(body))
		return fmt.Errorf("read body: %w", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		r.Body = io.NopCloser(bytes.NewReader(body))
		return fmt.Errorf("parse JSON: %w", err)
	}

	// Extract model for URL path
	model, _ := payload["model"].(string)
	if model == "" {
		r.Body = io.NopCloser(bytes.NewReader(body))
		return fmt.Errorf("no model field in request body")
	}

	// 3. Rewrite URL path: strip /v1 prefix, add Azure deployment path
	// /v1/chat/completions → /openai/deployments/{model}/chat/completions
	newPath := fmt.Sprintf("/openai/deployments/%s/chat/completions", model)
	r.URL.Path = newPath
	r.URL.RawQuery = "api-version=" + apiVersion

	// 4. Remove model from body (Azure uses deployment name in URL, not body)
	delete(payload, "model")

	out, err := json.Marshal(payload)
	if err != nil {
		r.Body = io.NopCloser(bytes.NewReader(body))
		return fmt.Errorf("marshal JSON: %w", err)
	}

	log.Printf("[azure-proxy] %s → %s (%d -> %d bytes)", model, newPath, len(body), len(out))
	r.Body = io.NopCloser(bytes.NewReader(out))
	r.ContentLength = int64(len(out))
	r.Header.Set("Content-Length", strconv.Itoa(len(out)))
	return nil
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
