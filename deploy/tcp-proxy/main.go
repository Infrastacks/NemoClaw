package main

import (
	"context"
	"io"
	"log"
	"net"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"
)

func main() {
	listenPort := envOrDefault("PROXY_LISTEN_PORT", "18800")
	targetPort := envOrDefault("PROXY_TARGET_PORT", "18789")
	listenAddr := "0.0.0.0:" + listenPort
	targetAddr := "127.0.0.1:" + targetPort

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	listener, err := net.Listen("tcp", listenAddr)
	if err != nil {
		log.Fatalf("[tcp-proxy] listen %s: %v", listenAddr, err)
	}

	log.Printf("[tcp-proxy] %s -> %s", listenAddr, targetAddr)

	var wg sync.WaitGroup
	var active atomic.Int64

	// Close listener when context is cancelled (graceful shutdown).
	go func() {
		<-ctx.Done()
		listener.Close()
	}()

	for {
		conn, err := listener.Accept()
		if err != nil {
			select {
			case <-ctx.Done():
				// Expected: listener closed during shutdown.
			default:
				log.Printf("[tcp-proxy] accept: %v", err)
			}
			break
		}
		wg.Add(1)
		go relay(conn, targetAddr, &wg, &active)
	}

	// Drain in-flight connections with a timeout.
	done := make(chan struct{})
	go func() { wg.Wait(); close(done) }()

	select {
	case <-done:
		log.Println("[tcp-proxy] all connections drained")
	case <-time.After(5 * time.Second):
		log.Println("[tcp-proxy] drain timeout, exiting")
	}
}

func relay(client net.Conn, targetAddr string, wg *sync.WaitGroup, active *atomic.Int64) {
	defer wg.Done()
	defer client.Close()

	n := active.Add(1)
	log.Printf("[tcp-proxy] +conn %s (active=%d)", client.RemoteAddr(), n)
	defer func() { log.Printf("[tcp-proxy] -conn %s (active=%d)", client.RemoteAddr(), active.Add(-1)) }()

	upstream, err := net.Dial("tcp", targetAddr)
	if err != nil {
		log.Printf("[tcp-proxy] dial %s: %v", targetAddr, err)
		return
	}
	defer upstream.Close()

	done := make(chan struct{})
	go func() {
		io.Copy(upstream, client)
		if tc, ok := upstream.(*net.TCPConn); ok {
			tc.CloseWrite()
		}
		close(done)
	}()

	io.Copy(client, upstream)
	if tc, ok := client.(*net.TCPConn); ok {
		tc.CloseWrite()
	}
	<-done
}

func envOrDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
