
# Stage 1: Build the Go application
# Go 1.26.10 fixes the standard-library CVEs reported by release CI.
# Pin the multi-platform index so amd64 and arm64 use the reviewed toolchain.
FROM golang:1.26.10-alpine@sha256:a2012b4a1d1f9f7e9f44e0d39b805a901e856b1dd80b4e6ee4338db547050308 AS builder

WORKDIR /app

COPY go.mod go.sum* ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o /deployforge ./cmd/api

# Stage 2: Run the compiled application
FROM alpine:3.22

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=builder /deployforge /app/deployforge

USER appuser

EXPOSE 8080

CMD ["/app/deployforge"]
