const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const cors = require("cors");
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");

require("dotenv").config();

const app = express();

// Enable CORS for all origins (⚠️ restrict to Collabora domain in production)
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

app.use(bodyParser.raw({ type: "*/*", limit: "50mb" })); // raw body for PutFile

const PORT = process.env.PORT || 5000;

// 🔹 AWS S3 Config
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.S3_BUCKET;

// Helper: generate token
function generateToken() {
  return crypto.randomBytes(16).toString("hex");
}

const tokenStore = {}; // { token: fileId }

// Middleware: validate access_token
function validateToken(req, res, next) {
  let token = req.query.access_token || req.headers["authorization"];
  if (!token) {
    return res.status(401).json({ error: "Missing access token" });
  }

  // Strip Bearer if present
  token = token.replace(/^Bearer\\s+/i, "");

  const fileId = tokenStore[token];
  if (!fileId) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  // Attach fileId to request for use in routes
  req.fileId = fileId;
  req.token = token;
  next();
}

// 🔹 Get file metadata
app.get("/wopi/files/:file_id", validateToken, async (req, res) => {
  const fileId = req.fileId; // from token
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
    };

    res.json(fileInfo);
  } catch (err) {
    console.error("HeadObject error:", err);
    res.status(404).json({ error: "File not found" });
  }
});

// 🔹 Get file contents from S3
app.get("/wopi/files/:file_id/contents", validateToken, async (req, res) => {
  const fileId = req.fileId;
  try {
    const command = new GetObjectCommand({ Bucket: BUCKET, Key: fileId });
    const data = await s3.send(command);

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

// 🔹 Save file contents back to S3
app.post("/wopi/files/:file_id/contents", validateToken, async (req, res) => {
  const fileId = req.fileId;
  try {
    const upload = new PutObjectCommand({
      Bucket: BUCKET,
      Key: fileId,
      Body: req.body,
    });

    await s3.send(upload);

    res.status(200).end();
  } catch (err) {
    console.error("PutObject error:", err);
    res.status(500).json({ error: "Failed to save file" });
  }
});

// 🔹 Generate access URL for frontend
app.get("/access", (req, res) => {
  const fileId = req.query.path;
  if (!fileId) return res.status(400).json({ error: "Missing file path" });

  const token = generateToken();
  tokenStore[token] = fileId;

  const encodedFileId = encodeURIComponent(fileId);
  const WOPISrc = encodeURIComponent(
    `${process.env.WOPI_HOST_DOMAIN}/wopi/files/${encodedFileId}`
  );

  res.json({
    url: `${process.env.COLLABORA_DOMAIN}/loleaflet/dist/loleaflet.html?WOPISrc=${WOPISrc}&access_token=${token}`,
    token,
  });
});

app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));

// Default route
app.get("/", (req, res) => {
  res.send("WOPI Server Running...");
});

module.exports = app;
