import React, { useEffect, useState } from "react";

const API = process.env.REACT_APP_API || "http://localhost:5000";
const BASE_DOMAIN = process.env.REACT_APP_BASE_DOMAIN || "lvh.me";

function App() {
  const [repoUrl, setRepoUrl] = useState("");
  const [deployments, setDeployments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLogs, setSelectedLogs] = useState(null);
  const [error, setError] = useState("");

  async function fetchList() {
    try {
      const res = await fetch(`${API}/deployments`);
      if (!res.ok) throw new Error("Failed to fetch deployments");
      const json = await res.json();
      setDeployments(json);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    fetchList();
    const iv = setInterval(fetchList, 5000);
    return () => clearInterval(iv);
  }, []);

  async function submit() {
    if (!repoUrl) return alert("Enter a repo URL");
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API}/deploy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl }),
      });
      if (!res.ok) throw new Error("Failed to start deployment");
      const j = await res.json();
      setRepoUrl("");
      alert(`Deployment started: ${j.id}\nPreview: ${j.previewUrl}`);
      fetchList();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function viewLogs(id) {
    try {
      const res = await fetch(`${API}/logs/${id}`);
      if (!res.ok) throw new Error("Failed to fetch logs");
      const j = await res.json();
      setSelectedLogs({ id, ...j });
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    if (!window.confirm("Delete deployment?")) return;
    try {
      await fetch(`${API}/delete/${id}`, { method: "DELETE" });
      fetchList();
    } catch (err) {
      setError(err.message);
    }
  }

  async function restart(id) {
    try {
      await fetch(`${API}/restart/${id}`, { method: "POST" });
      fetchList();
    } catch (err) {
      setError(err.message);
    }
  }

  const statusColor = (status) => {
    if (status === "running") return "green";
    if (status === "building") return "orange";
    if (status === "error") return "red";
    return "gray";
  };

  return (
    <div style={{ padding: 20, fontFamily: "Arial, sans-serif" }}>
      <h1>🚀 Mini-deploy Dashboard</h1>

      <div style={{ marginBottom: 20 }}>
        <input
          style={{ width: 500, padding: 8 }}
          placeholder="https://github.com/username/repo"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
        />
        <button
          onClick={submit}
          disabled={loading}
          style={{ marginLeft: 8, padding: "8px 12px" }}
        >
          {loading ? "Starting..." : "Deploy"}
        </button>
      </div>

      {error && <p style={{ color: "red" }}>⚠️ {error}</p>}

      <h2>Deployments</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              ID
            </th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              Repo
            </th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              Status
            </th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              Preview
            </th>
            <th style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {deployments.map((d) => (
            <tr key={d.id}>
              <td style={{ padding: "8px 0" }}>{d.id}</td>
              <td>{d.repoUrl}</td>
              <td style={{ color: statusColor(d.status) }}>{d.status}</td>
              <td>
                <a
                  target="_blank"
                  rel="noreferrer"
                  href={`http://${d.id}.${BASE_DOMAIN}`}
                >
                  {d.id}.{BASE_DOMAIN}
                </a>
              </td>
              <td>
                <button onClick={() => viewLogs(d.id)}>Logs</button>
                <button
                  onClick={() => restart(d.id)}
                  style={{ marginLeft: 8 }}
                >
                  Restart
                </button>
                <button
                  onClick={() => remove(d.id)}
                  style={{ marginLeft: 8, color: "red" }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedLogs && (
        <div style={{ marginTop: 20 }}>
          <h3>📜 Logs for {selectedLogs.id}</h3>
          <h4>Build</h4>
          <pre
            style={{
              background: "#f4f4f4",
              padding: 10,
              maxHeight: 300,
              overflow: "auto",
            }}
          >
            {selectedLogs.build}
          </pre>
          <h4>Runtime</h4>
          <pre
            style={{
              background: "#f4f4f4",
              padding: 10,
              maxHeight: 300,
              overflow: "auto",
            }}
          >
            {selectedLogs.runtime}
          </pre>
          <button onClick={() => setSelectedLogs(null)}>Close</button>
        </div>
      )}
    </div>
  );
}

export default App;
