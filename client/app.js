let keyPair, sharedKey;
let map, userMarker, peerMarker;
let ws;

const BACKEND_WS_URL = "wss://YOUR_BACKEND_WS_URL"; // Change this!

initMap();

function initMap() {
  map = L.map('map').setView([0, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
}

async function generateKeys() {
  keyPair = await window.crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );

  const publicKeyRaw = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(publicKeyRaw)));

  const qrDiv = document.getElementById("qr");
  qrDiv.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?data=${b64}&size=150x150" />`;
}

function startQRScanner() {
  const reader = new Html5Qrcode("reader");
  reader.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: 250 },
    async (scanned) => {
      await deriveSharedKey(scanned);
      reader.stop();
      document.getElementById("reader").innerHTML = "Key Exchange Complete ✅";
    }
  );
}

async function deriveSharedKey(peerBase64Key) {
  const peerRaw = Uint8Array.from(atob(peerBase64Key), c => c.charCodeAt(0));
  const peerKey = await crypto.subtle.importKey(
    "raw",
    peerRaw,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    []
  );
  sharedKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: peerKey },
    keyPair.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function startSharing() {
  if (!sharedKey) return alert("Key not established yet.");

  ws = new WebSocket(BACKEND_WS_URL);

  ws.onmessage = async (event) => {
    const { iv, ciphertext } = JSON.parse(event.data);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv) },
      sharedKey,
      new Uint8Array(ciphertext)
    );
    const decoded = JSON.parse(new TextDecoder().decode(decrypted));
    updatePeerMarker(decoded.lat, decoded.lon);
  };

  navigator.geolocation.watchPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    updateUserMarker(latitude, longitude);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(
      JSON.stringify({ lat: latitude, lon: longitude })
    );
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      sharedKey,
      encoded
    );
    ws.send(
      JSON.stringify({
        iv: Array.from(iv),
        ciphertext: Array.from(new Uint8Array(ciphertext)),
      })
    );
  });

  setTimeout(() => {
    ws.close();
    alert("Location sharing expired.");
  }, 5 * 60 * 1000); // 5 minutes
}

function updateUserMarker(lat, lon) {
  if (userMarker) {
    userMarker.setLatLng([lat, lon]);
  } else {
    userMarker = L.marker([lat, lon], { title: "You" }).addTo(map);
  }
  map.setView([lat, lon], 13);
}

function updatePeerMarker(lat, lon) {
  if (peerMarker) {
    peerMarker.setLatLng([lat, lon]);
  } else {
    peerMarker = L.marker(
      [lat, lon],
      {
        title: "Peer",
        icon: L.icon({
          iconUrl: "https://leafletjs.com/examples/custom-icons/leaf-red.png",
          iconSize: [25, 41],
        }),
      }
    ).addTo(map);
  }
}
