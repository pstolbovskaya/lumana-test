package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"

	"github.com/lumana-test/report-service/gen/reportpb"
	"github.com/lumana-test/report-service/internal/server"
)

func main() {
	log := newLogger()
	if err := run(log); err != nil {
		log.Error("server exited with error", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger) error {
	port := env("GRPC_PORT", "50051")
	loc, err := time.LoadLocation(env("REPORT_TIMEZONE", "UTC"))
	if err != nil {
		return fmt.Errorf("REPORT_TIMEZONE: %w", err)
	}
	maxRecvMB, err := strconv.Atoi(env("GRPC_MAX_RECV_MB", "32"))
	if err != nil || maxRecvMB <= 0 {
		return fmt.Errorf("GRPC_MAX_RECV_MB must be a positive integer")
	}
	shutdownTimeout, err := time.ParseDuration(env("SHUTDOWN_TIMEOUT", "15s"))
	if err != nil {
		return fmt.Errorf("SHUTDOWN_TIMEOUT: %w", err)
	}

	lis, err := net.Listen("tcp", ":"+port)
	if err != nil {
		return fmt.Errorf("listen on :%s: %w", port, err)
	}

	srv := grpc.NewServer(
		grpc.MaxRecvMsgSize(maxRecvMB<<20),
		grpc.ChainUnaryInterceptor(server.RecoveryInterceptor(log), server.LoggingInterceptor(log)),
	)
	reportpb.RegisterReportServiceServer(srv, server.New(log, server.WithLocation(loc)))

	hs := health.NewServer()
	healthpb.RegisterHealthServer(srv, hs)
	hs.SetServingStatus("", healthpb.HealthCheckResponse_SERVING)
	hs.SetServingStatus(reportpb.ReportService_ServiceDesc.ServiceName, healthpb.HealthCheckResponse_SERVING)
	reflection.Register(srv)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		log.Info("report service listening", "addr", lis.Addr().String(), "timezone", loc.String())
		errCh <- srv.Serve(lis)
	}()

	select {
	case err := <-errCh:
		if err != nil && !errors.Is(err, grpc.ErrServerStopped) {
			return err
		}
		return nil
	case <-ctx.Done():
	}

	log.Info("shutdown signal received, draining", "timeout", shutdownTimeout.String())
	hs.Shutdown()
	done := make(chan struct{})
	go func() {
		srv.GracefulStop()
		close(done)
	}()
	select {
	case <-done:
		log.Info("server stopped gracefully")
	case <-time.After(shutdownTimeout):
		log.Warn("graceful shutdown timed out, forcing stop")
		srv.Stop()
	}
	return nil
}

func newLogger() *slog.Logger {
	var level slog.Level
	if err := level.UnmarshalText([]byte(env("LOG_LEVEL", "info"))); err != nil {
		level = slog.LevelInfo
	}
	opts := &slog.HandlerOptions{Level: level}
	var h slog.Handler
	if strings.EqualFold(env("LOG_FORMAT", "json"), "text") {
		h = slog.NewTextHandler(os.Stdout, opts)
	} else {
		h = slog.NewJSONHandler(os.Stdout, opts)
	}
	return slog.New(h).With("service", "report-service")
}

func env(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return def
}
