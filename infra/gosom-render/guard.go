package main

import (
 "context"
 "crypto/subtle"
 "errors"
 "fmt"
 "log"
 "net"
 "net/http"
 "net/http/httputil"
 "net/url"
 "os"
 "os/exec"
 "os/signal"
 "strings"
 "syscall"
 "time"
)
func main(){
 key:=os.Getenv("PROSPECTOR_MAPS_KEY")
 if len(key)<32 {log.Fatal("Missing PROSPECTOR_MAPS_KEY")}
 port:=os.Getenv("PORT");if port==""{port="10000"}
 ctx,stop:=signal.NotifyContext(context.Background(),syscall.SIGTERM,syscall.SIGINT);defer stop()
 upstreamCmd:=exec.CommandContext(ctx,"/usr/bin/google-maps-scraper","-web","-addr",":9090","-data-folder","/tmp/gosomdata")
 upstreamCmd.Stdout=os.Stdout;upstreamCmd.Stderr=os.Stderr
 if err:=upstreamCmd.Start();err!=nil{log.Fatal(err)}
 go func(){err:=upstreamCmd.Wait();if err!=nil && ctx.Err()==nil{log.Printf("scraper exited: %v",err);stop()}}()
 target,_:=url.Parse("http://127.0.0.1:9090")
 proxy:=httputil.NewSingleHostReverseProxy(target)
 proxy.Transport=&http.Transport{DialContext:(&net.Dialer{Timeout:3*time.Second}).DialContext,MaxIdleConnsPerHost:4,IdleConnTimeout:25*time.Second}
 proxy.ErrorHandler=func(w http.ResponseWriter,r *http.Request,e error){http.Error(w,"scraper temporarily unavailable",http.StatusBadGateway)}
 handler:=http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
  w.Header().Set("Cache-Control","no-store")
  if r.URL.Path=="/healthz" {
   if ctx.Err()!=nil {http.Error(w,"stopping",503);return}
   w.WriteHeader(200);fmt.Fprint(w,"up");return
  }
  // No anonymous access, including the upstream GUI, jobs and CSV results.
  token:=r.Header.Get("X-Prospector-Maps-Key")
  if subtle.ConstantTimeCompare([]byte(token),[]byte(key))!=1 {http.Error(w,"unauthorized",401);return}
  if !(strings.HasPrefix(r.URL.Path,"/api/v1/jobs") && (r.Method==http.MethodGet||r.Method==http.MethodPost)) {
   http.Error(w,"not found",404);return
  }
  // Prevent arbitrary submissions outside the intended internal API surface.
  if r.Method==http.MethodPost && r.URL.Path!="/api/v1/jobs" {http.Error(w,"method not allowed",405);return}
  r.Header.Del("X-Prospector-Maps-Key")
  proxy.ServeHTTP(w,r)
 })
 srv:=&http.Server{Addr:":"+port,Handler:handler,ReadHeaderTimeout:10*time.Second,ReadTimeout:20*time.Second,WriteTimeout:90*time.Second,IdleTimeout:90*time.Second}
 go func(){<-ctx.Done();closeCtx,cancel:=context.WithTimeout(context.Background(),8*time.Second);defer cancel();_ =srv.Shutdown(closeCtx)}()
 log.Printf("protected maps worker listening on %s",port)
 if err:=srv.ListenAndServe();err!=nil && !errors.Is(err,http.ErrServerClosed){log.Fatal(err)}
}
