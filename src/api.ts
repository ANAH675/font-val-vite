import axios from "axios";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

export function setAuth(token: string | null) {
  if (token) api.defaults.headers.common["Authorization"] = `Bearer ${token}`;
  else delete api.defaults.headers.common["Authorization"];
}

// Inicializa token si ya hay uno guardado
setAuth(localStorage.getItem("token"));

// Manejo de expiración o token inválido
api.interceptors.response.use(
  (response) => response,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      setAuth(null);
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);
