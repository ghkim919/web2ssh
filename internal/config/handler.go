package config

import (
	"encoding/json"
	"net/http"
)

type Handler struct {
	store *Store
}

func NewHandler(store *Store) *Handler {
	return &Handler{store: store}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	switch r.Method {
	case http.MethodGet:
		h.get(w)
	case http.MethodPut:
		h.put(w, r)
	default:
		http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

func (h *Handler) get(w http.ResponseWriter) {
	settings, err := h.store.Load()
	if err != nil {
		http.Error(w, `{"error":"failed to load settings"}`, http.StatusInternalServerError)
		return
	}
	json.NewEncoder(w).Encode(settings)
}

func (h *Handler) put(w http.ResponseWriter, r *http.Request) {
	var settings Settings
	if err := json.NewDecoder(r.Body).Decode(&settings); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}

	if err := Validate(settings); err != nil {
		resp := map[string]string{"error": err.Error()}
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(resp)
		return
	}

	if err := h.store.Save(settings); err != nil {
		http.Error(w, `{"error":"failed to save settings"}`, http.StatusInternalServerError)
		return
	}

	json.NewEncoder(w).Encode(settings)
}
