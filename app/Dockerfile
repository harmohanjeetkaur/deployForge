
# Stage 1: Build the Go application
FROM golang:1.25-alpine AS builder

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
