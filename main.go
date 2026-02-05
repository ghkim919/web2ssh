package main

import (
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"

	"web2ssh/internal/server"
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

	mux := http.NewServeMux()

	mux.Handle("/", http.FileServer(http.FS(webContent)))
	mux.HandleFunc("/ws", server.HandleWebSocket)

	addr := fmt.Sprintf(":%d", *port)
	fmt.Printf("web2ssh server starting at http://localhost%s\n", addr)

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}
