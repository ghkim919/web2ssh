package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type SSHSettings struct {
	ConnectionTimeout  int `json:"connectionTimeout"`
	KeepAliveInterval  int `json:"keepAliveInterval"`
	KeepAliveMaxFails  int `json:"keepAliveMaxFails"`
}

type TerminalSettings struct {
	FontSize       int    `json:"fontSize"`
	CursorStyle    string `json:"cursorStyle"`
	CursorBlink    bool   `json:"cursorBlink"`
	ScrollbackLines int   `json:"scrollbackLines"`
}

type Settings struct {
	SSH      SSHSettings      `json:"ssh"`
	Terminal TerminalSettings `json:"terminal"`
}

type Store struct {
	mu       sync.RWMutex
	filePath string
}

func DefaultSettings() Settings {
	return Settings{
		SSH: SSHSettings{
			ConnectionTimeout: 10,
			KeepAliveInterval: 30,
			KeepAliveMaxFails: 3,
		},
		Terminal: TerminalSettings{
			FontSize:        14,
			CursorStyle:     "block",
			CursorBlink:     true,
			ScrollbackLines: 1000,
		},
	}
}

func NewStore() (*Store, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("get home dir: %w", err)
	}

	dir := filepath.Join(home, ".web2ssh")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, fmt.Errorf("create config dir: %w", err)
	}

	return &Store{filePath: filepath.Join(dir, "settings.json")}, nil
}

func (s *Store) Load() (Settings, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := os.ReadFile(s.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return DefaultSettings(), nil
		}
		return Settings{}, err
	}

	settings := DefaultSettings()
	if err := json.Unmarshal(data, &settings); err != nil {
		return Settings{}, err
	}
	return settings, nil
}

func (s *Store) Save(settings Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.filePath, data, 0644)
}

func Validate(settings Settings) error {
	ssh := settings.SSH
	if ssh.ConnectionTimeout < 1 || ssh.ConnectionTimeout > 120 {
		return fmt.Errorf("connectionTimeout must be between 1 and 120")
	}
	if ssh.KeepAliveInterval < 0 || ssh.KeepAliveInterval > 600 {
		return fmt.Errorf("keepAliveInterval must be between 0 and 600")
	}
	if ssh.KeepAliveMaxFails < 1 || ssh.KeepAliveMaxFails > 100 {
		return fmt.Errorf("keepAliveMaxFails must be between 1 and 100")
	}

	term := settings.Terminal
	if term.FontSize < 8 || term.FontSize > 72 {
		return fmt.Errorf("fontSize must be between 8 and 72")
	}
	validCursor := map[string]bool{"block": true, "underline": true, "bar": true}
	if !validCursor[term.CursorStyle] {
		return fmt.Errorf("cursorStyle must be block, underline, or bar")
	}
	if term.ScrollbackLines < 0 || term.ScrollbackLines > 100000 {
		return fmt.Errorf("scrollbackLines must be between 0 and 100000")
	}

	return nil
}
