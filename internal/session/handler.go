package session

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"
)

type Handler struct {
	store *Store
}

func NewHandler(store *Store) *Handler {
	return &Handler{store: store}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	id := strings.TrimPrefix(r.URL.Path, "/api/sessions/")
	if id == r.URL.Path {
		id = ""
	}

	switch r.Method {
	case http.MethodGet:
		h.list(w)
	case http.MethodPost:
		h.create(w, r)
	case http.MethodPut:
		h.update(w, r, id)
	case http.MethodDelete:
		h.delete(w, id)
	default:
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

func (h *Handler) list(w http.ResponseWriter) {
	sessions, err := h.store.Load()
	if err != nil {
		http.Error(w, `{"error":"failed to load sessions"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(sessions)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	var sess Session
	if err := json.NewDecoder(r.Body).Decode(&sess); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	sess.ID = generateID()
	if sess.Port == 0 {
		sess.Port = 22
	}

	if err := h.store.Add(sess); err != nil {
		http.Error(w, `{"error":"failed to save session"}`, http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(sess)
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request, id string) {
	if id == "" {
		http.Error(w, `{"error":"session id required"}`, http.StatusBadRequest)
		return
	}

	var sess Session
	if err := json.NewDecoder(r.Body).Decode(&sess); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	sess.ID = id

	if err := h.store.Update(sess); err != nil {
		http.Error(w, `{"error":"session not found"}`, http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(sess)
}

func (h *Handler) delete(w http.ResponseWriter, id string) {
	if id == "" {
		http.Error(w, `{"error":"session id required"}`, http.StatusBadRequest)
		return
	}

	if err := h.store.Delete(id); err != nil {
		http.Error(w, `{"error":"session not found"}`, http.StatusNotFound)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func generateID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}
