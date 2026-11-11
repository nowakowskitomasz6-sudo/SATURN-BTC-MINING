

const express = require("express");
const crypto = require("crypto");

const app = express();
app.use(express.json());

const miners = new Map();
const blocks = [];

function publicMiner(miner) {
  return {
    id: miner.id,
    name: miner.name,
    device: miner.device,
    hashrateTH: miner.hashrateTH,
    connected: miner.connected,
    acceptedShares: miner.acceptedShares
  };
}

app.get("/", (req, res) => {
  res.send("SATURN BTC MINING - server is running");
});

app.get("/api/status", (req, res) => {
  const list = [...miners.values()];
  res.json({
    project: "SATURN",
    network: "testnet",
    miners: list.map(publicMiner),
    minerCount: list.length,
    totalHashrateTH: list.reduce(
      (sum, miner) => sum + miner.hashrateTH, 0
    ),
    blocks
  });
});

app.post("/api/register", (req, res) => {
  const { name, device, hashrateTH, payoutAddress } = req.body;

  if (!name || !device || !payoutAddress ||
      !Number.isFinite(hashrateTH) || hashrateTH <= 0) {
    return res.status(400).json({
      error: "Missing or invalid registration data"
    });
  }

  const id = crypto.randomUUID();

  const miner = {
    id,
    name,
    device,
    hashrateTH,
    payoutAddress,
    connected: false,
    acceptedShares: 0
  };

  miners.set(id, miner);

  res.status(201).json({
    message: "Miner registered",
    miner: publicMiner(miner),
    workerLogin: `SATURN.${id}`
  });
});

app.post("/api/share", (req, res) => {
  const { minerId, accepted } = req.body;
  const miner = miners.get(minerId);

  if (!miner) {
    return res.status(404).json({ error: "Miner not found" });
  }

  if (accepted !== true) {
    return res.status(400).json({ error: "Share not accepted" });
  }

  miner.acceptedShares += 1;
  miner.connected = true;

  res.json({ message: "Share recorded" });
});

app.post("/api/block-candidate", (req, res) => {
  const { minerId, blockHash } = req.body;
  const miner = miners.get(minerId);

  if (!miner || !blockHash) {
    return res.status(400).json({ error: "Invalid candidate" });
  }

  const candidate = {
    minerId,
    minerName: miner.name,
    blockHash,
    detectedAt: new Date().toISOString(),
    status: "UNVERIFIED"
  };

  blocks.push(candidate);

  res.status(202).json({
    message: "Candidate saved; Bitcoin node verification required",
    candidate
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`SATURN server listening on ${PORT}`);
});
