package server

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"web2ssh/internal/config"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type ConnectRequest struct {
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
}

type Message struct {
	Type string `json:"type"`
	Data string `json:"data"`
}

func HandleWebSocket(w http.ResponseWriter, r *http.Request, configStore *config.Store) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("websocket upgrade error: %v", err)
		return
	}
	defer conn.Close()

	var sshClient *ssh.Client
	var sshSession *ssh.Session
	var stdin chan []byte
	var stopKeepAlive chan struct{}
	var mu sync.Mutex

	for {
		_, msgBytes, err := conn.ReadMessage()
		if err != nil {
			log.Printf("read error: %v", err)
			break
		}

		var msg Message
		if err := json.Unmarshal(msgBytes, &msg); err != nil {
			log.Printf("json unmarshal error: %v", err)
			continue
		}

		switch msg.Type {
		case "connect":
			var req ConnectRequest
			if err := json.Unmarshal([]byte(msg.Data), &req); err != nil {
				sendError(conn, "invalid connect request")
				continue
			}

			settings, err := configStore.Load()
			if err != nil {
				log.Printf("failed to load settings: %v", err)
				settings = config.DefaultSettings()
			}

			client, session, stdinCh, err := connectSSH(req, conn, settings)
			if err != nil {
				sendError(conn, err.Error())
				continue
			}

			mu.Lock()
			sshClient = client
			sshSession = session
			stdin = stdinCh
			if settings.SSH.KeepAliveInterval > 0 {
				stopKeepAlive = make(chan struct{})
				go keepAlive(client, settings.SSH.KeepAliveInterval, settings.SSH.KeepAliveMaxFails, stopKeepAlive)
			}
			mu.Unlock()

			sendMessage(conn, "connected", "")

		case "input":
			mu.Lock()
			if stdin != nil {
				stdin <- []byte(msg.Data)
			}
			mu.Unlock()

		case "resize":
			var size struct {
				Cols int `json:"cols"`
				Rows int `json:"rows"`
			}
			if err := json.Unmarshal([]byte(msg.Data), &size); err == nil {
				mu.Lock()
				if sshSession != nil {
					sshSession.WindowChange(size.Rows, size.Cols)
				}
				mu.Unlock()
			}
		}
	}

	mu.Lock()
	if stopKeepAlive != nil {
		close(stopKeepAlive)
	}
	if sshSession != nil {
		sshSession.Close()
	}
	if sshClient != nil {
		sshClient.Close()
	}
	mu.Unlock()
}

func connectSSH(req ConnectRequest, wsConn *websocket.Conn, settings config.Settings) (*ssh.Client, *ssh.Session, chan []byte, error) {
	sshConfig := &ssh.ClientConfig{
		User: req.User,
		Auth: []ssh.AuthMethod{
			ssh.Password(req.Password),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         time.Duration(settings.SSH.ConnectionTimeout) * time.Second,
	}

	addr := fmt.Sprintf("%s:%d", req.Host, req.Port)
	client, err := ssh.Dial("tcp", addr, sshConfig)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("ssh dial error: %v", err)
	}

	session, err := client.NewSession()
	if err != nil {
		client.Close()
		return nil, nil, nil, fmt.Errorf("session error: %v", err)
	}

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}

	if err := session.RequestPty("xterm-256color", 24, 80, modes); err != nil {
		session.Close()
		client.Close()
		return nil, nil, nil, fmt.Errorf("pty error: %v", err)
	}

	stdinPipe, err := session.StdinPipe()
	if err != nil {
		session.Close()
		client.Close()
		return nil, nil, nil, fmt.Errorf("stdin pipe error: %v", err)
	}

	stdoutPipe, err := session.StdoutPipe()
	if err != nil {
		session.Close()
		client.Close()
		return nil, nil, nil, fmt.Errorf("stdout pipe error: %v", err)
	}

	stderrPipe, err := session.StderrPipe()
	if err != nil {
		session.Close()
		client.Close()
		return nil, nil, nil, fmt.Errorf("stderr pipe error: %v", err)
	}

	stdinCh := make(chan []byte, 100)

	go func() {
		for data := range stdinCh {
			stdinPipe.Write(data)
		}
	}()

	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stdoutPipe.Read(buf)
			if err != nil {
				return
			}
			sendMessage(wsConn, "output", string(buf[:n]))
		}
	}()

	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := stderrPipe.Read(buf)
			if err != nil {
				return
			}
			sendMessage(wsConn, "output", string(buf[:n]))
		}
	}()

	if err := session.Shell(); err != nil {
		session.Close()
		client.Close()
		return nil, nil, nil, fmt.Errorf("shell error: %v", err)
	}

	return client, session, stdinCh, nil
}

func keepAlive(client *ssh.Client, interval int, maxFails int, stop chan struct{}) {
	ticker := time.NewTicker(time.Duration(interval) * time.Second)
	defer ticker.Stop()

	failures := 0
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			_, _, err := client.SendRequest("keepalive@openssh.com", true, nil)
			if err != nil {
				failures++
				log.Printf("keepalive failed (%d/%d): %v", failures, maxFails, err)
				if failures >= maxFails {
					log.Printf("keepalive max failures reached, closing connection")
					client.Close()
					return
				}
			} else {
				failures = 0
			}
		}
	}
}

func sendMessage(conn *websocket.Conn, msgType, data string) {
	msg := Message{Type: msgType, Data: data}
	bytes, _ := json.Marshal(msg)
	conn.WriteMessage(websocket.TextMessage, bytes)
}

func sendError(conn *websocket.Conn, errMsg string) {
	sendMessage(conn, "error", errMsg)
}
