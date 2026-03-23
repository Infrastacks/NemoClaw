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
	upstream := envOrDefault("NCP_UPSTREAM", "https://integrate.api.nvidia.com")
	port := envOrDefault("NCP_PROXY_PORT", "9000")
	listenAddr := "127.0.0.1:" + port

	target, err := url.Parse(upstream)
	if err != nil {
		log.Fatalf("[ncp-proxy] invalid NCP_UPSTREAM %q: %v", upstream, err)
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
			DisableCompression: true, // preserve streaming
		},
		// Flush immediately for SSE streaming.
		FlushInterval: -1,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/chat/completions") {
			if err := transformRequest(r); err != nil {
				log.Printf("[ncp-proxy] transform error: %v (forwarding unchanged)", err)
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

	log.Printf("[ncp-proxy] %s -> %s", listenAddr, upstream)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("[ncp-proxy] listen: %v", err)
	}
	log.Println("[ncp-proxy] shut down")
}

// transformRequest reads the request body, applies NCP-compatibility transforms,
// and replaces the body with the transformed JSON.
func transformRequest(r *http.Request) error {
	body, err := io.ReadAll(r.Body)
	r.Body.Close()
	if err != nil {
		r.Body = io.NopCloser(bytes.NewReader(body))
		return fmt.Errorf("read body: %w", err)
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		// Not JSON — forward unchanged.
		r.Body = io.NopCloser(bytes.NewReader(body))
		return fmt.Errorf("parse JSON: %w", err)
	}

	changed := transformBody(payload)
	if !changed {
		r.Body = io.NopCloser(bytes.NewReader(body))
		return nil
	}

	out, err := json.Marshal(payload)
	if err != nil {
		r.Body = io.NopCloser(bytes.NewReader(body))
		return fmt.Errorf("marshal JSON: %w", err)
	}

	log.Printf("[ncp-proxy] transformed request (%d -> %d bytes)", len(body), len(out))
	r.Body = io.NopCloser(bytes.NewReader(out))
	r.ContentLength = int64(len(out))
	r.Header.Set("Content-Length", strconv.Itoa(len(out)))
	return nil
}

// transformBody applies NCP-compatibility fixes in place. Returns true if anything changed.
func transformBody(body map[string]any) bool {
	changed := false

	// 1. Flatten content arrays to plain strings.
	if messages, ok := body["messages"].([]any); ok {
		for _, m := range messages {
			msg, ok := m.(map[string]any)
			if !ok {
				continue
			}
			parts, ok := msg["content"].([]any)
			if !ok {
				continue // already a string or null
			}
			var texts []string
			for _, p := range parts {
				part, ok := p.(map[string]any)
				if !ok {
					continue
				}
				if part["type"] == "text" {
					if t, ok := part["text"].(string); ok {
						texts = append(texts, t)
					}
				}
			}
			msg["content"] = strings.Join(texts, "\n")
			changed = true
		}
	}

	// 2. Strip "strict" from tool function definitions.
	if tools, ok := body["tools"].([]any); ok {
		for _, t := range tools {
			tool, ok := t.(map[string]any)
			if !ok {
				continue
			}
			fn, ok := tool["function"].(map[string]any)
			if !ok {
				continue
			}
			if _, has := fn["strict"]; has {
				delete(fn, "strict")
				changed = true
			}
		}
	}

	// 3. Rename "max_completion_tokens" to "max_tokens" (NCP doesn't support the newer OpenAI field).
	if v, has := body["max_completion_tokens"]; has {
		body["max_tokens"] = v
		delete(body, "max_completion_tokens")
		changed = true
	}

	return changed
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
