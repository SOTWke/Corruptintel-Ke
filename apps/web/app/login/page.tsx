"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSession } from "../../lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${process.env.API_BASE_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message || "Login failed.");
        return;
      }
      saveSession(json.data.token, json.data.role);
      router.push("/admin/review-queue");
    } catch {
      setError("Could not reach the API.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: "3rem auto" }}>
      <h1 style={{ fontFamily: "var(--font-serif)" }}>Researcher Login</h1>
      <p className="evidence-note">
        Accounts are provisioned by an existing admin — there is no public
        signup on this platform.
      </p>
      <form onSubmit={handleSubmit} className="card">
        <label style={{ display: "block", marginBottom: "0.75rem" }}>
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ display: "block", width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
          />
        </label>
        <label style={{ display: "block", marginBottom: "1rem" }}>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ display: "block", width: "100%", padding: "0.5rem", marginTop: "0.25rem" }}
          />
        </label>
        {error && <p style={{ color: "var(--accent)" }}>{error}</p>}
        <button
          type="submit"
          disabled={loading}
          style={{ background: "var(--accent)", color: "white", padding: "0.6rem 1.2rem", border: "none", borderRadius: 4, fontWeight: 600 }}
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
