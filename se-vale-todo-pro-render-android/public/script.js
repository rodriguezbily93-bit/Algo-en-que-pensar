const socket = io();

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const statusEl = document.getElementById("status");
const onlineCount = document.getElementById("onlineCount");

const findBtn = document.getElementById("findBtn");
const nextBtn = document.getElementById("nextBtn");
const muteBtn = document.getElementById("muteBtn");
const cameraBtn = document.getElementById("cameraBtn");
const reportBtn = document.getElementById("reportBtn");
const filterSelect = document.getElementById("filterSelect");

const chatBox = document.getElementById("chatBox");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

let localStream;
let pc;
let partnerId = null;
let muted = false;
let cameraOff = false;

const rtcConfig = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" }
  ]
};

function setStatus(text) {
  statusEl.textContent = text;
}

function addMessage(text, mine = false) {
  const div = document.createElement("div");
  div.className = "message";
  div.textContent = mine ? "Tú: " + text : "Usuario: " + text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

async function startCamera() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
  } catch (e) {
    alert("No se pudo acceder a cámara/micrófono. Revisa permisos del navegador.");
  }
}

function closePeer() {
  if (pc) {
    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.close();
    pc = null;
  }
  remoteVideo.srcObject = null;
}

function createPeer() {
  closePeer();

  pc = new RTCPeerConnection(rtcConfig);

  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    setStatus("Conectado");
  };

  pc.onicecandidate = (event) => {
    if (event.candidate && partnerId) {
      socket.emit("signal", { to: partnerId, data: { candidate: event.candidate } });
    }
  };
}

findBtn.onclick = () => {
  setStatus("Buscando usuario...");
  socket.emit("find");
};

nextBtn.onclick = () => {
  closePeer();
  partnerId = null;
  setStatus("Buscando siguiente usuario...");
  socket.emit("next");
};

muteBtn.onclick = () => {
  muted = !muted;
  localStream.getAudioTracks().forEach(track => track.enabled = !muted);
  muteBtn.textContent = muted ? "Unmute" : "Mute";
};

cameraBtn.onclick = () => {
  cameraOff = !cameraOff;
  localStream.getVideoTracks().forEach(track => track.enabled = !cameraOff);
  cameraBtn.textContent = cameraOff ? "Encender cámara" : "Cámara";
};

filterSelect.onchange = () => {
  localVideo.style.filter = filterSelect.value;
};

sendBtn.onclick = sendMessage;
chatInput.addEventListener("keydown", e => {
  if (e.key === "Enter") sendMessage();
});

function sendMessage() {
  const message = chatInput.value.trim();
  if (!message || !partnerId) return;

  socket.emit("chat-message", { to: partnerId, message });
  addMessage(message, true);
  chatInput.value = "";
}
const welcomeScreen = document.getElementById("welcomeScreen");
const startAppBtn = document.getElementById("startAppBtn");

if (startAppBtn) {
  startAppBtn.onclick = async () => {
    welcomeScreen.style.display = "none";

    try {
      await startCamera();
    } catch (e) {
      console.error(e);
    }
  };
}
reportBtn.onclick = async () => {
  if (!partnerId) return alert("No hay usuario conectado para reportar.");

  const reason = prompt("Motivo del reporte:");
  if (!reason) return;

  await fetch("/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      reporterId: socket.id,
      reportedSocketId: partnerId,
      reason
    })
  });

  alert("Reporte enviado.");
};

socket.on("stats", stats => {
  onlineCount.textContent = stats.online;
});

socket.on("waiting", () => {
  setStatus("Esperando otro usuario...");
});

socket.on("matched", async ({ partnerId: id, initiator }) => {
  partnerId = id;
  createPeer();

  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", { to: partnerId, data: { offer } });
  }
});

socket.on("signal", async ({ from, data }) => {
  partnerId = from;

  if (data.offer) {
    createPeer();
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socket.emit("signal", { to: partnerId, data: { answer } });
  }

  if (data.answer && pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
  }

  if (data.candidate && pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    } catch (e) {
      console.error(e);
    }
  }
});

socket.on("chat-message", ({ message }) => {
  addMessage(message, false);
});

socket.on("partner-left", () => {
  closePeer();
  partnerId = null;
  setStatus("El usuario salió. Presiona Next o Buscar.");
});

