const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");

require("dotenv").config();

const app = express();

// Enable CORS for Collabora
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-WOPI-Lock",
      "X-WOPI-OldLock",
    ],
  })
);

// Use raw body for PUT
app.use(bodyParser.raw({ type: "*/*", limit: "50mb" }));

const PORT = process.env.PORT || 5000;

// AWS S3 config
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.S3_BUCKET;

// Static token for simplicity
const STATIC_TOKEN = "test_token";

// In-memory locks: { fileId: lockToken }
const locks = {};

// Middleware: check token
function validateToken(req, res, next) {
  const token = req.query.access_token || req.headers["authorization"];
  if (!token || token.replace(/^Bearer\s+/i, "") !== STATIC_TOKEN) {
    return res.status(401).json({ error: "Invalid or missing token" });
  }
  next();
}

// -------------------- WOPI Endpoints --------------------

// CheckFileInfo
app.get("/wopi/files/:file_id", validateToken, async (req, res) => {
  const fileId = decodeURIComponent(req.params.file_id);

  try {
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: fileId })
    );

    const fileInfo = {
      BaseFileName: fileId.split("/").pop(),
      Size: head.ContentLength,
      OwnerId: "admin",
      UserId: "user1",
      Version: head.LastModified.getTime().toString(),
      SupportsUpdate: true,
      UserCanWrite: true,
      SupportsLocks: true,
      UserFriendlyName: "User1",
    };

    res.json(fileInfo);
  } catch (err) {
    console.error("HeadObject error:", err);
    res.status(404).json({ error: "File not found" });
  }
});

// GetFile
app.get("/wopi/files/:file_id/contents", validateToken, async (req, res) => {
  const fileId = decodeURIComponent(req.params.file_id);

  try {
    const data = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: fileId })
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    data.Body.pipe(res);
  } catch (err) {
    console.error("GetObject error:", err);
    res.status(404).end();
  }
});

// PutFile
app.post("/wopi/files/:file_id/contents", validateToken, async (req, res) => {
  const fileId = decodeURIComponent(req.params.file_id);
  const lockHeader = req.headers["x-wopi-lock"];

  // Check lock
  if (locks[fileId] && locks[fileId] !== lockHeader) {
    return res.status(409).json({ error: "File is locked by another user" });
  }

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: fileId,
        Body: req.body,
      })
    );
    res.status(200).end();
  } catch (err) {
    console.error("PutObject error:", err);
    res.status(500).json({ error: "Failed to save file" });
  }
});

// -------------------- Lock Endpoints --------------------

// Lock
app.post("/wopi/files/:file_id/lock", validateToken, (req, res) => {
  const fileId = decodeURIComponent(req.params.file_id);
  const lock = req.headers["x-wopi-lock"];

  if (!lock)
    return res.status(400).json({ error: "Missing X-WOPI-Lock header" });

  if (locks[fileId] && locks[fileId] !== lock) {
    return res.status(409).json({ error: "File already locked" });
  }

  locks[fileId] = lock;
  res.status(200).end();
});

// Unlock
app.post("/wopi/files/:file_id/unlock", validateToken, (req, res) => {
  const fileId = decodeURIComponent(req.params.file_id);
  const lock = req.headers["x-wopi-lock"];

  if (!lock)
    return res.status(400).json({ error: "Missing X-WOPI-Lock header" });

  if (locks[fileId] !== lock) {
    return res.status(409).json({ error: "Lock mismatch" });
  }

  delete locks[fileId];
  res.status(200).end();
});

// RefreshLock
app.post("/wopi/files/:file_id/refresh", validateToken, (req, res) => {
  const fileId = decodeURIComponent(req.params.file_id);
  const lock = req.headers["x-wopi-lock"];

  if (!lock)
    return res.status(400).json({ error: "Missing X-WOPI-Lock header" });

  if (locks[fileId] !== lock) {
    return res.status(409).json({ error: "Lock mismatch" });
  }

  // Simply keep the lock
  res.status(200).end();
});

// -------------------- Generate Access URL --------------------
app.get("/access", (req, res) => {
  const fileId = req.query.path;
  if (!fileId) return res.status(400).json({ error: "Missing file path" });

  const encodedFileId = encodeURIComponent(fileId);
  const WOPISrc = encodeURIComponent(
    `${process.env.WOPI_HOST_DOMAIN}/wopi/files/${encodedFileId}`
  );

  res.json({
    url: `${process.env.COLLABORA_DOMAIN}/browser/dist/cool.html?WOPISrc=${WOPISrc}&access_token=${STATIC_TOKEN}`,
    token: STATIC_TOKEN,
  });
});

// -------------------- Default --------------------
app.get("/", (req, res) => res.send("WOPI Server Running..."));

app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));

module.exports = app;
