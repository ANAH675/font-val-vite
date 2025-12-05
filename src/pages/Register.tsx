import React, { useState } from "react";
import { api, setAuth } from "../api";
import { useNavigate, Link } from "react-router-dom";
import { AxiosError } from "axios";

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const { data } = await api.post("/api/auth/register", {
        name,
        email,
        password,
      });
      localStorage.setItem("token", data.token);
      setAuth(data.token);
      navigate("/dashboard");
    } catch (err) {
      if (err instanceof AxiosError) {
        setError(err?.response?.data?.message || "Error during registration");
      } else {
        setError("Error during registration");
      }
    }
  }

  return (
    <div className="register-container">
      <form onSubmit={onSubmit} className="register-box">
        <h2>Create Account</h2>
        
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          required
        />
        
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
        />
        
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
        />
        
        <button type="submit">Sign Up</button>
        
        {error && <div className="error-message">{error}</div>}
        
        <div className="register-link">
          Already have an account?{" "}
          <Link to="/login">Log in</Link>
        </div>
      </form>
    </div>
  );
}
