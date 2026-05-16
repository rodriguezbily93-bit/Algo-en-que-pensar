let adminToken = "";

document.getElementById("loginBtn").onclick = async () => {
  const password = document.getElementById("password").value;

  const res = await fetch("/api/admin/login", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({ password })
  });

  const data = await res.json();
  if (data.token) {
    adminToken = data.token;
    alert("Admin conectado");
  } else {
    alert("Contraseña incorrecta");
  }
};

document.getElementById("loadBtn").onclick = async () => {
  const res = await fetch("/api/admin/reports", {
    headers: { Authorization: "Bearer " + adminToken }
  });

  const reports = await res.json();
  const box = document.getElementById("reports");
  box.innerHTML = "";

  if (!Array.isArray(reports)) {
    box.textContent = JSON.stringify(reports);
    return;
  }

  reports.forEach(r => {
    const div = document.createElement("div");
    div.className = "message";
    div.innerHTML = `
      <b>Reportado:</b> ${r.reportedSocketId}<br>
      <b>Reportador:</b> ${r.reporterId}<br>
      <b>Motivo:</b> ${r.reason}<br>
      <small>${new Date(r.createdAt).toLocaleString()}</small>
    `;
    box.appendChild(div);
  });
};
