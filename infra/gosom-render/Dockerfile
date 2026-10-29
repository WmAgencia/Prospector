FROM golang:1.25-bookworm AS guard-build
WORKDIR /src
COPY guard.go .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /gosom-guard guard.go

FROM gosom/google-maps-scraper:latest
COPY --from=guard-build /gosom-guard /usr/local/bin/gosom-guard
ENV DISABLE_TELEMETRY=1
ENV PORT=10000
EXPOSE 10000
ENTRYPOINT ["/usr/local/bin/gosom-guard"]
