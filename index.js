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

require("dotenv").config(); // Load .env file

const app = express();

// Enable CORS for all origins
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(bodyParser.json());

const PORT = process.env.PORT || 5000;

// 🔹 AWS S3 Config
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  // forcePathStyle: true,
});
const BUCKET = process.env.S3_BUCKET;

// Helper: generate token
function generateToken(fileId) {
  return crypto.randomBytes(16).toString("hex");
}

const tokenStore = {}; // { token: fileId }

// 🔹 Get file metadata
app.get("/wopi/files/:file_id", async (req, res) => {
  const fileId = decodeURIComponent(req.params.file_id);
  if (!fileId) return res.status(400).json({ error: "Missing file path" });

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
app.get("/wopi/files/:file_id/contents", async (req, res) => {
  const fileId = decodeURIComponent(req.params.file_id);
  if (!fileId) return res.status(400).json({ error: "Missing file path" });

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
app.post("/wopi/files/:file_id/contents", async (req, res) => {
  const fileId = decodeURIComponent(req.params.file_id);
  if (!fileId) return res.status(400).json({ error: "Missing file path" });

  try {
    const upload = new PutObjectCommand({
      Bucket: BUCKET,
      Key: fileId,
      Body: req,
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

  const token = generateToken(fileId);
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

app.listen(PORT, () => {
  // console.log(`WOPI Host running on http://localhost:${PORT}`);
  console.log(`WOPI Host running`);
});
