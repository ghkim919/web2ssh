package session

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type Session struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	AuthType string `json:"authType,omitempty"`
	KeyPath  string `json:"keyPath,omitempty"`
}

type Store struct {
	mu       sync.RWMutex
	filePath string
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

	return &Store{filePath: filepath.Join(dir, "sessions.json")}, nil
}

func (s *Store) Load() ([]Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := os.ReadFile(s.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return []Session{}, nil
		}
		return nil, err
	}

	var sessions []Session
	if err := json.Unmarshal(data, &sessions); err != nil {
		return nil, err
	}
	return sessions, nil
}

func (s *Store) save(sessions []Session) error {
	data, err := json.MarshalIndent(sessions, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.filePath, data, 0644)
}

func (s *Store) Add(sess Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	sessions, err := s.loadUnsafe()
	if err != nil {
		return err
	}

	sessions = append(sessions, sess)
	return s.save(sessions)
}

func (s *Store) Update(sess Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	sessions, err := s.loadUnsafe()
	if err != nil {
		return err
	}

	for i, existing := range sessions {
		if existing.ID == sess.ID {
			sessions[i] = sess
			return s.save(sessions)
		}
	}
	return fmt.Errorf("session not found: %s", sess.ID)
}

func (s *Store) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	sessions, err := s.loadUnsafe()
	if err != nil {
		return err
	}

	for i, existing := range sessions {
		if existing.ID == id {
			sessions = append(sessions[:i], sessions[i+1:]...)
			return s.save(sessions)
		}
	}
	return fmt.Errorf("session not found: %s", id)
}

func (s *Store) loadUnsafe() ([]Session, error) {
	data, err := os.ReadFile(s.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return []Session{}, nil
		}
		return nil, err
	}

	var sessions []Session
	if err := json.Unmarshal(data, &sessions); err != nil {
		return nil, err
	}
	return sessions, nil
}
