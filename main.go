package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"

	"web2ssh/internal/config"
	"web2ssh/internal/server"
	"web2ssh/internal/session"
)

//go:embed web/*
var webFS embed.FS

func main() {
	port := flag.Int("port", 8080, "server port")
	flag.Parse()

	webContent, err := fs.Sub(webFS, "web")
	if err != nil {
		log.Fatal(err)
	}

	sessionStore, err := session.NewStore()
	if err != nil {
		log.Fatal(err)
	}
	sessionHandler := session.NewHandler(sessionStore)

	configStore, err := config.NewStore()
	if err != nil {
		log.Fatal(err)
	}
	configHandler := config.NewHandler(configStore)

	mux := http.NewServeMux()

	mux.Handle("/", http.FileServer(http.FS(webContent)))
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		server.HandleWebSocket(w, r, configStore)
	})
	mux.Handle("/api/sessions", sessionHandler)
	mux.Handle("/api/sessions/", sessionHandler)
	mux.Handle("/api/settings", configHandler)

	addr := fmt.Sprintf(":%d", *port)
	fmt.Printf("web2ssh server starting at http://localhost%s\n", addr)

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
